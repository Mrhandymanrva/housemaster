/**
 * Why doesn't the total match ISN's?
 *
 * A revenue figure that disagrees with the one the office already trusts is
 * worse than no figure: every number on the screen goes under suspicion, and
 * the difference is usually not a bug but a definition. Both sides are adding
 * up real jobs; they are adding up different ones, or the same ones on
 * different days.
 *
 * So this does not argue. It totals the month every way the data allows and
 * shows the answers side by side, because whichever one lands on ISN's figure
 * says what ISN is counting — and that is the whole diagnosis. Give it the
 * number from ISN and it names the basis that produces it.
 *
 * It costs nothing to run: the untouched ISN payload is kept on every order,
 * so every basis is computable from what is already stored. No re-sync, no
 * second opinion from the API.
 */
import { OFFICE_ZONE, dayKey } from './zone.js';
import { countsAsRevenue, statusIs, statusIsNot } from './orderStatus.js';

/**
 * How the app's own figure is defined, in one place, so this and the Money
 * screen cannot drift apart in what they claim to be measuring.
 */
export const APP_BASIS = {
  key: 'app',
  label: 'What the app shows',
  detail: 'Jobs by the day they are scheduled, cancelled and deleted and never-scheduled ones left out.',
};

// Cancelled and deleted only — this basis is looking for what ISN might still
// be counting that the app has dropped.
const NOT_CANCELLED = [statusIsNot('', 'Deleted'), statusIsNot('', 'Canceled'),
  statusIsNot('', 'Cancelled')].join(' AND ');

/**
 * Every way the month could reasonably be added up.
 *
 * `where` is spliced into SQL and must never carry anything from a request —
 * these are fixed strings written here, and the only parameters are the two
 * dates.
 */
const BASES = [
  { key: 'app', label: APP_BASIS.label, detail: APP_BASIS.detail,
    where: `${countsAsRevenue('')} AND scheduled_start IS NOT NULL`,
    on: 'scheduled_start' },

  { key: 'complete', label: 'Only jobs marked complete',
    detail: 'Same days, but a job ISN has not ticked off yet does not count.',
    where: statusIs('', 'Complete'), on: 'scheduled_start' },

  { key: 'not_complete', label: 'Only jobs not yet complete',
    detail: 'The other half of the one above — what is booked but not done.',
    where: `${countsAsRevenue('')} AND ${statusIsNot('', 'Complete')}`
      + ' AND scheduled_start IS NOT NULL', on: 'scheduled_start' },

  { key: 'paid', label: 'Only what has been paid',
    detail: 'Cash in rather than work booked.',
    where: `${countsAsRevenue('')} AND paid`,
    on: 'scheduled_start' },

  { key: 'with_cancelled', label: 'Including cancelled jobs',
    detail: 'If ISN is still counting something the app has dropped.',
    where: `${statusIsNot('', 'Deleted')} AND scheduled_start IS NOT NULL`, on: 'scheduled_start' },

  { key: 'booked_on', label: 'By the day the job was booked',
    detail: 'Rather than the day it happens — a common way for a report to differ.',
    where: `${NOT_CANCELLED} AND (raw->>'orderdate') IS NOT NULL`,
    on: `(raw->>'orderdate')::timestamptz` },
];

const num = (v) => Number(v) || 0;

/**
 * @param client  anything with .query
 * @param range   periodRange()
 * @param target  the figure to match, if the office has one to hand
 */
export async function revenueCheck(client, range, { target = null } = {}) {
  const totals = [];
  for (const b of BASES) {
    // The date column varies per basis, so a basis that leans on a field ISN
    // may not send has to fail softly rather than take the screen down.
    try {
      const { rows } = await client.query(
        `SELECT COALESCE(SUM(total_fee), 0) AS amount, COUNT(*) AS jobs
           FROM isn_orders
          WHERE ${b.where} AND ${b.on} >= $1 AND ${b.on} < $2`,
        [range.start, range.end]);
      totals.push({ key: b.key, label: b.label, detail: b.detail,
        amount: num(rows[0].amount), jobs: num(rows[0].jobs) });
    } catch (e) {
      totals.push({ key: b.key, label: b.label, detail: b.detail,
        amount: null, jobs: null, unavailable: e.message });
    }
  }

  const app = totals.find((x) => x.key === 'app');
  // Nearest first, so if none is exact the closest basis is still the lead.
  const scored = target != null
    ? [...totals].filter((x) => x.amount != null)
        .map((x) => ({ ...x, off: Math.round((x.amount - target) * 100) / 100 }))
        .sort((a, b) => Math.abs(a.off) - Math.abs(b.off))
    : null;
  const match = scored?.find((x) => Math.abs(x.off) < 0.01) || null;

  // Every job the app counted, so the two lists can be laid side by side when
  // no single basis explains it — which is what happens when one job differs
  // rather than one rule.
  const { rows: lines } = await client.query(
    `SELECT order_number, property_address, property_city, client_name,
            scheduled_start, total_fee, paid, order_status, has_radon,
            (raw->>'orderdate') AS booked_on,
            to_char(scheduled_start AT TIME ZONE $3, 'YYYY-MM-DD') AS on_day
       FROM isn_orders
      WHERE ${BASES[0].where} AND scheduled_start >= $1 AND scheduled_start < $2
      ORDER BY scheduled_start`,
    [range.start, range.end, OFFICE_ZONE]);

  const { rows: sync } = await client.query(
    `SELECT last_sync_at, pull_window_days FROM isn_connection LIMIT 1`);

  return {
    period: range.period,
    window: { start: range.start, end: range.end },
    app: { amount: app?.amount ?? 0, jobs: app?.jobs ?? 0 },
    target,
    difference: target == null ? null : Math.round(((app?.amount ?? 0) - target) * 100) / 100,
    match,
    nearest: scored ? scored.slice(0, 3) : null,
    totals,
    lines: lines.map((r) => ({
      orderNumber: r.order_number,
      address: [r.property_address, r.property_city].filter(Boolean).join(', '),
      client: r.client_name,
      day: dayKey(r.on_day),
      amount: num(r.total_fee),
      paid: r.paid === true,
      status: r.order_status,
      radon: r.has_radon === true,
      bookedOn: r.booked_on || null,
    })),
    // A figure that disagrees is sometimes just old. Worth seeing next to the
    // rest before anybody goes looking for a bug.
    lastSyncAt: sync[0]?.last_sync_at || null,
    pullWindowDays: sync[0]?.pull_window_days ?? null,
  };
}
