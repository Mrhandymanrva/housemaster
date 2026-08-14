/**
 * The ISN pull, on a timer.
 *
 * Runs inside the web process rather than as a second service, because the
 * work is one HTTP call every few minutes and a separate worker would be
 * another thing to deploy, watch and pay for.
 *
 * Two things make that safe. A pull is guarded by a Postgres advisory lock, so
 * even if this ever runs on two replicas only one pulls — which matters here
 * more than usual, because consuming a footprint deletes it and two readers
 * would race over the same order. And the timer re-reads its interval from the
 * connection row each tick, so changing the schedule takes hold without a
 * restart.
 */
import { q } from './lib/db.js';
import { syncOnce, isnGet, extractList, describeShape } from './integrations/isn.js';
import { pullEvents } from './integrations/isnCalendar.js';

// An arbitrary but fixed number. Any other process taking this lock is us.
const LOCK = 8110771;

const MIN_TICK = 60_000;
let timer = null;
let running = false;
let nextAt = null;

async function withLock(fn) {
  const { rows } = await q('SELECT pg_try_advisory_lock($1) AS got', [LOCK]);
  if (!rows[0].got) return { skipped: 'another pull is already running' };
  try {
    return await fn();
  } finally {
    await q('SELECT pg_advisory_unlock($1)', [LOCK]).catch(() => {});
  }
}

/** Is a pull due, and if so, do it. */
async function tick() {
  if (running) return;
  running = true;
  try {
    const { rows } = await q(
      `SELECT enabled, sync_every_minutes, last_sync_at FROM isn_connection LIMIT 1`
    );
    const c = rows[0];
    const every = Number(c?.sync_every_minutes || 0);

    if (!c?.enabled || !every) { nextAt = null; return; }

    const due = !c.last_sync_at
      || Date.now() - new Date(c.last_sync_at).getTime() >= every * 60_000;
    nextAt = c.last_sync_at
      ? new Date(new Date(c.last_sync_at).getTime() + every * 60_000)
      : new Date();
    if (!due) return;

    const out = await withLock(async () => {
      const sync = await syncOnce({ source: 'schedule' });
      // The calendar rides along but never takes the orders down with it: a
      // week grid missing its grey blocks is a worse screen, an order sync
      // that failed is a branch that cannot see its work.
      try {
        await pullEvents({ query: q },
          { get: isnGet, list: extractList, describe: describeShape });
      } catch (e) {
        console.warn('[isn] calendar pull failed, orders were fine:', e.message);
      }
      return sync;
    });
    if (out?.skipped) return;
    console.log(`[isn] pulled ${out?.orders ?? 0} orders, ${out?.sets ?? 0} sets`);
  } catch (err) {
    // syncOnce has already written the failure to isn_sync_log and the
    // connection row, which is what the ISN screen reads. Nothing here should
    // be able to take the web process down with it.
    console.error('[isn] scheduled pull failed:', err.message);
  } finally {
    running = false;
  }
}

export function startIsnSchedule() {
  if (timer) return;
  // Check every minute and decide from last_sync_at, rather than sleeping for
  // the whole interval: a deploy in the middle of an hour should not push the
  // next pull an hour out, and an interval changed in the app takes hold on
  // the next minute.
  timer = setInterval(() => { tick().catch(() => {}); }, MIN_TICK);
  timer.unref?.();
  tick().catch(() => {});         // and once at boot, in case one is overdue
}

export const isnScheduleState = () => ({ nextAt, running });
