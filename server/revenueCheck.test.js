/** Run with: node server/revenueCheck.test.js
 *
 * The app said $50,164 for the month and ISN said $49,331. Neither number was
 * necessarily wrong — both sides add up real jobs, and a difference is usually
 * a definition. This is the thing that settles which, so the parts that matter
 * are: it counts every basis over the same window, it recognises the one that
 * lands on ISN's figure, and it does not pretend to when none does.
 */
import assert from 'node:assert/strict';
import { revenueCheck, APP_BASIS } from './lib/revenueCheck.js';
import { periodRange } from './lib/zone.js';

let pass = 0;
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const AT = new Date('2026-08-11T15:00:00Z');
const RANGE = periodRange('month', AT);

/**
 * Answers each basis with whatever the test set for it, and records the
 * statements so they can be checked the way a database would.
 */
function db(byBasis = {}, lines = []) {
  const seen = [];
  let nth = 0;
  return {
    seen,
    async query(text, params) {
      seen.push({ text, params: params || [] });
      if (/FROM isn_connection/.test(text)) {
        return { rows: [{ last_sync_at: '2026-08-11T14:00:00Z', pull_window_days: 61 }] };
      }
      if (/order_number/.test(text)) return { rows: lines };
      const key = Object.keys(byBasis)[nth++];
      const v = byBasis[key] ?? { amount: 0, jobs: 0 };
      return { rows: [{ amount: v.amount, jobs: v.jobs }] };
    },
  };
}

const BASES = {
  app: { amount: 50164, jobs: 81 },
  complete: { amount: 49331, jobs: 79 },
  not_complete: { amount: 833, jobs: 2 },
  paid: { amount: 26031, jobs: 44 },
  with_cancelled: { amount: 51_400, jobs: 83 },
  booked_on: { amount: 47_900, jobs: 78 },
};

console.log('\nsettling the difference');

await ta('names the way of counting that lands on ISN\'s figure', async () => {
  const out = await revenueCheck(db(BASES), RANGE, { target: 49331 });
  assert.equal(out.app.amount, 50164);
  assert.equal(out.difference, 833);
  assert.ok(out.match, 'a basis matched');
  assert.equal(out.match.key, 'complete');
  assert.equal(out.match.off, 0);
});

await ta('takes the figure however somebody types it', async () => {
  // "$49,331.00" off the ISN screen, pasted straight in.
  const out = await revenueCheck(db(BASES), RANGE, { target: 49331.0 });
  assert.equal(out.match.key, 'complete');
});

await ta('does not invent a match when nothing lands on it', async () => {
  // One odd job rather than one rule: no basis is exact, and saying so is the
  // useful answer because it sends somebody to the job list instead of to a
  // setting.
  const out = await revenueCheck(db(BASES), RANGE, { target: 49_000 });
  assert.equal(out.match, null);
  assert.ok(out.nearest.length, 'still offers the closest');
  assert.equal(out.nearest[0].key, 'complete', 'closest is the one 331 out');
  assert.equal(out.nearest[0].off, 331);
});

await ta('works with no figure to compare against', async () => {
  const out = await revenueCheck(db(BASES), RANGE, {});
  assert.equal(out.target, null);
  assert.equal(out.difference, null);
  assert.equal(out.match, null);
  assert.equal(out.totals.length, 6, 'still totals every basis');
});

await ta('survives a basis the data cannot answer', async () => {
  // orderdate is not a field ISN promises. One basis failing must not take the
  // diagnostic down — it is the thing being used to diagnose.
  const client = db(BASES);
  const real = client.query.bind(client);
  client.query = async (text, params) => {
    if (/orderdate/.test(text) && !/order_number/.test(text)) throw new Error('column does not exist');
    return real(text, params);
  };
  const out = await revenueCheck(client, RANGE, { target: 49331 });
  const dead = out.totals.find((x) => x.key === 'booked_on');
  assert.equal(dead.amount, null);
  assert.match(dead.unavailable, /does not exist/);
  assert.equal(out.match.key, 'complete', 'the others still answer');
});

await ta('hands back the jobs it counted, for reading against ISN', async () => {
  const out = await revenueCheck(db(BASES, [{
    order_number: '10241', property_address: '19 Cary St', property_city: 'Richmond',
    client_name: 'J. Doe', total_fee: '620.00', paid: true, order_status: 'Complete',
    has_radon: true, on_day: '2026-08-04', booked_on: '2026-07-28',
  }]), RANGE, { target: 49331 });
  assert.equal(out.lines.length, 1);
  assert.equal(out.lines[0].amount, 620, 'a numeric string becomes a number');
  assert.equal(out.lines[0].paid, true);
  assert.equal(out.lines[0].address, '19 Cary St, Richmond');
});

await ta('says when it last heard from ISN', async () => {
  // A total that disagrees is sometimes just old, and that is worth seeing
  // before anybody goes hunting for a bug.
  const out = await revenueCheck(db(BASES), RANGE, {});
  assert.equal(out.lastSyncAt, '2026-08-11T14:00:00Z');
  assert.equal(out.pullWindowDays, 61);
});

console.log('\nwhat the database would have refused');

await ta('every statement gets exactly the parameters it declares', async () => {
  // The same check that caught the Money screen's bind error, over this.
  const client = db(BASES);
  await revenueCheck(client, RANGE, { target: 49331 });
  for (const q of client.seen) {
    const want = Math.max(0, ...[...q.text.matchAll(/\$(\d+)/g)].map((x) => Number(x[1])));
    assert.equal(q.params.length, want, q.text.replace(/\s+/g, ' ').slice(0, 80));
  }
});

await ta('every basis is measured over the one window it was given', async () => {
  const client = db(BASES);
  await revenueCheck(client, RANGE, { target: 1 });
  const totals = client.seen.filter((x) => /SUM\(total_fee\)/.test(x.text));
  assert.equal(totals.length, 6);
  for (const q of totals) {
    assert.equal(q.params[0], RANGE.start);
    assert.equal(q.params[1], RANGE.end);
  }
});

await ta('the app basis it compares against is the one the Money screen uses', async () => {
  // If these drift, this tool starts explaining a number nobody is looking at.
  const out = await revenueCheck(db(BASES), RANGE, {});
  const app = out.totals.find((x) => x.key === 'app');
  assert.equal(app.label, APP_BASIS.label);
  assert.match(app.detail, /scheduled/);
  assert.match(app.detail, /cancelled and deleted/i);
});

console.log(`\n${pass} checks passed\n`);
