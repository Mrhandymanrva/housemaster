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
