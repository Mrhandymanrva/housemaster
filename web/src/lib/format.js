/**
 * The office's clock, which is the one every date in this app means.
 *
 * The server hands back instants — the office's midnight as a moment in time.
 * Rendered in the viewer's own zone those slide, and a month boundary slides
 * into the month before. Anything that names a day or a month says which
 * clock it is reading.
 */
export const OFFICE_ZONE = 'America/New_York';

/**
 * A number out of the database, as a number.
 *
 * Postgres hands numerics back as strings, so "0" is truthy and "0" / "0" is
 * NaN. That is how somebody who owed no CEU hours at all ended up with a full
 * red bar against their name. Every place a numeric is compared or arithmetic
 * happens goes through here, so that bug cannot come back one screen at a time.
 *
 * Formatting is separate on purpose: money() and num() below turn a value into
 * something to read, this turns it into something to do sums with.
 */
export const n = (v, fallback = 0) => {
  if (v === null || v === undefined || v === '') return fallback;
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};

export const money = (v) =>
  v == null || v === '' ? '—'
  : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

export const num = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US'));

export const date = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(+d) ? '—'
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export const phone = (v) => {
  if (!v) return '—';
  const d = String(v).replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}` : v;
};

export const daysOut = (n) => {
  if (n == null) return '';
  if (n < 0) return `${Math.abs(n)}d overdue`;
  if (n === 0) return 'today';
  return `in ${n}d`;
};

/** state → pill color, used everywhere a status is shown */
export const stateColor = (s) => ({
  Overdue: 'red', Expired: 'red', Open: 'red', 'Needs Repair': 'red', 'Out of Service': 'red',
  'Due Soon': 'amber', 'Pending Renewal': 'amber', 'In Shop': 'amber', 'Under Review': 'amber',
  'In Calibration': 'amber', 'Replace Soon': 'amber',
  'On Deck': 'steel', Scheduled: 'steel', Reported: 'steel',
  Cleared: 'green', Active: 'green', 'In Service': 'green', Closed: 'green', Current: 'green',
}[s] || 'slate');

/** Plain-English urgency: "6 days late", "Today", "In 3 weeks". */
export const whenText = (n) => {
  if (n == null) return '';
  if (n < 0) {
    const d = Math.abs(n);
    if (d === 1) return '1 day late';
    if (d < 45) return `${d} days late`;
    return `${Math.round(d / 30)} months late`;
  }
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n < 14) return `In ${n} days`;
  if (n < 60) return `In ${Math.round(n / 7)} weeks`;
  return `In ${Math.round(n / 30)} months`;
};

/** Which of the four plain time buckets a day-count falls into. */
export const bucketOf = (n) =>
  n < 0 ? 'Past due' : n <= 7 ? 'This week' : n <= 30 ? 'This month' : 'Later on';

export const bucketTone = (b) =>
  ({ 'Past due': 'red', 'This week': 'amber', 'This month': 'blue' }[b] || 'slate');
