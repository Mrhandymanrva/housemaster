/**
 * The owner's question, which the app could not answer.
 *
 * Everything else here is a compliance view — what is due, what is overdue,
 * who is licensed. Useful, and not what somebody running a branch asks first.
 * This is the money.
 *
 * Three honesty rules run through all of it, because a financial screen that
 * overstates itself is worse than none:
 *
 *   Booked is not collected. ISN says what a job was sold for and whether it
 *   has been paid; those are different numbers and they are never added
 *   together or quietly swapped.
 *
 *   A month in progress is only ever compared with the same stretch of the
 *   month before. Eleven days against a whole thirty is a fake collapse, and
 *   somebody would act on it.
 *
 *   Overhead is what the app happens to know the cost of. Labour, fuel, rent
 *   and marketing are not in this app at all, so what comes back is labelled
 *   as the part that is counted, never as the cost of doing business.
 */
import { OFFICE_ZONE } from './zone.js';
import { countsAsRevenue } from './orderStatus.js';

/** Cancelled, deleted and never-scheduled jobs are not work and not revenue. */
const REAL_WORK = `${countsAsRevenue('')}
                   AND scheduled_start IS NOT NULL`;

/**
 * Overhead the records actually carry, one row per kind so the screen can say
 * where a number came from rather than showing one unexplained total.
 *
 * Deliberately narrow. Everything here is a cost with a date on it that falls
 * inside the month asked about; a subscription billed yearly is spread, a van
 * repair is not. Anything needing an assumption to include is left out and
 * named in the gaps list instead.
 */
/*
 * Each entry says which of the two dates its SQL actually uses, because
 * Postgres wants the count to match exactly: a query with no placeholders
 * handed two dates fails with "bind message supplies 2 parameters, but
 * prepared statement requires 0", which is what the screen showed the first
 * time it met a real database.
 */
const OVERHEAD = [
  { key: 'vehicle', label: 'Van service and repairs', args: 2,
    sql: `SELECT COALESCE(SUM(cost), 0) AS amount FROM vehicle_maintenance
           WHERE service_date >= $1::date AND service_date < $2::date` },
  { key: 'calibration', label: 'Calibration and equipment service', args: 2,
    sql: `SELECT COALESCE(SUM(cost), 0) AS amount FROM maintenance_records
           WHERE service_date >= $1::date AND service_date < $2::date` },
  { key: 'training', label: 'Continuing education', args: 2,
    sql: `SELECT COALESCE(SUM(cost), 0) AS amount FROM ceu_records
           WHERE completion_date >= $1::date AND completion_date < $2::date` },
  { key: 'equipment', label: 'Equipment bought', args: 2,
    sql: `SELECT COALESCE(SUM(purchase_price), 0) AS amount FROM equipment
           WHERE purchase_date >= $1::date AND purchase_date < $2::date` },
  // Recurring commitments are not dated into a month, so they are divided down
  // to what one month of them costs.
  { key: 'software', label: 'Software', args: 0,
    sql: `SELECT COALESCE(SUM(
              CASE lower(COALESCE(billing_frequency, 'monthly'))
                WHEN 'annual' THEN cost / 12.0
                WHEN 'yearly' THEN cost / 12.0
                WHEN 'quarterly' THEN cost / 3.0
                WHEN 'weekly' THEN cost * 52 / 12.0
                ELSE cost END), 0) AS amount
           FROM software_subscriptions
          WHERE status IS DISTINCT FROM 'Cancelled'` },
  { key: 'insurance', label: 'Insurance', args: 1,
    sql: `SELECT COALESCE(SUM(premium_amount) / 12.0, 0) AS amount
            FROM insurance_policies
           WHERE status IS DISTINCT FROM 'Cancelled'
             AND (expiration_date IS NULL OR expiration_date >= $1::date)` },
];

export { OVERHEAD };

/** Named on the screen, so nobody reads the total as the cost of the branch. */
export const NOT_COUNTED = [
  'wages and payroll', 'fuel and mileage', 'rent', 'marketing', 'owner draw',
];

const day = (d) => d.toISOString().slice(0, 10);

/**
 * @param client  anything with .query — the pool, or a transaction
 * @param range   periodRange(), which carries the window and the same-length
 *                slice of the one before it, so every boundary here matches
 *                the rest of the app rather than being worked out a second way
 */
export async function moneyReport(client, range, { kinds = [], receivablesLimit = 25 } = {}) {
  const monthStart = range.start;
  const monthEnd = range.end;
  const priorStart = range.priorStart;
  const priorSoFar = range.priorEnd;
  const now = new Date();

  const [head, prior, trend, horizon, services, people, receivables, ready, sync, ...overhead] = await Promise.all([
    client.query(
      `SELECT COALESCE(SUM(total_fee), 0)                             AS booked,
              COALESCE(SUM(total_fee) FILTER (WHERE paid), 0)         AS collected,
              COALESCE(SUM(total_fee) FILTER (WHERE NOT paid), 0)     AS outstanding,
              COUNT(*)                                               AS jobs,
              COUNT(*) FILTER (WHERE has_radon)                       AS radon_jobs
         FROM isn_orders
        WHERE ${REAL_WORK} AND scheduled_start >= $1 AND scheduled_start < $2`,
      [monthStart, monthEnd]),

    client.query(
      `SELECT COALESCE(SUM(total_fee), 0) AS booked, COUNT(*) AS jobs
         FROM isn_orders
        WHERE ${REAL_WORK} AND scheduled_start >= $1 AND scheduled_start < $2`,
      [priorStart, priorSoFar]),

    // Twelve months of months, whether or not there was work in them — a gap
    // has to draw as a gap rather than closing up and flattering the trend.
    client.query(
      `WITH months AS (
         SELECT generate_series(
           date_trunc('month', ($1::timestamptz AT TIME ZONE $2)) - interval '11 months',
           date_trunc('month', ($1::timestamptz AT TIME ZONE $2)),
           interval '1 month') AS m
       )
       SELECT to_char(m, 'YYYY-MM') AS month,
              COALESCE(SUM(o.total_fee), 0) AS booked,
              COALESCE(SUM(o.total_fee) FILTER (WHERE o.paid), 0) AS collected,
              COUNT(o.id) AS jobs
         FROM months
         LEFT JOIN isn_orders o
           ON date_trunc('month', (o.scheduled_start AT TIME ZONE $2)) = months.m
          AND ${countsAsRevenue('o')}
          AND o.scheduled_start IS NOT NULL
        GROUP BY m ORDER BY m`,
      [monthStart, OFFICE_ZONE]),

    // How far back the app's own records actually reach. ISN's change filter
    // only lists orders touched in the last few months, so anything older was
    // never pulled — and a month with no rows in it has to read as "not known"
    // rather than as a month the branch earned nothing in.
    client.query(
      `SELECT to_char(min(scheduled_start) AT TIME ZONE $1, 'YYYY-MM') AS first_month
         FROM isn_orders
        WHERE ${REAL_WORK}`,
      [OFFICE_ZONE]),

    // What was sold, from the services on the order rather than from the fee,
    // which is one number for the whole job.
    client.query(
      `SELECT COALESCE(SUM(total_fee), 0) AS booked, COUNT(*) AS jobs,
              COALESCE(SUM(radon_fee), 0) AS radon_fee,
              COUNT(*) FILTER (WHERE has_radon) AS radon_jobs,
              sold_services::text AS services
         FROM isn_orders
        WHERE ${REAL_WORK} AND scheduled_start >= $1 AND scheduled_start < $2
        GROUP BY sold_services::text`,
      [monthStart, monthEnd]),

    client.query(
      `SELECT COALESCE(e.full_name, o.inspector_name, 'Unassigned') AS name,
              e.id AS employee_id,
              COUNT(*)                                     AS jobs,
              COALESCE(SUM(o.total_fee), 0)                AS booked,
              COUNT(*) FILTER (WHERE o.has_radon)          AS radon_jobs
         FROM isn_orders o
         LEFT JOIN employees e ON e.id = o.employee_id
        WHERE ${REAL_WORK} AND o.scheduled_start >= $1 AND o.scheduled_start < $2
        GROUP BY 1, 2 ORDER BY booked DESC`,
      [monthStart, monthEnd]),

    // Not a number but a worklist: oldest first, because that is the call to
    // make this afternoon.
    client.query(
      `SELECT id, order_number, order_url, property_address, property_city,
              client_name, scheduled_start, total_fee,
              GREATEST(0, (CURRENT_DATE - (scheduled_start AT TIME ZONE $1)::date)) AS days
         FROM isn_orders
        WHERE ${REAL_WORK} AND NOT paid AND total_fee > 0
          AND scheduled_start < now()
        ORDER BY scheduled_start
        LIMIT ${Number(receivablesLimit) || 25}`,
      [OFFICE_ZONE]),

    // The strip along the bottom: can everybody work, and is the data fresh.
    // An owner asking about money still wants to know the answer to that.
    client.query(
      `SELECT
         (SELECT count(*) FROM inspector_readiness
           WHERE licenses_expired > 0 OR dl_expired)                       AS blocked,
         (SELECT count(*) FROM inspector_readiness)                        AS people,
         (SELECT count(*) FROM compliance_horizon
           WHERE completed_date IS NULL AND category = 'License'
             AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30)      AS licenses_soon,
         (SELECT count(*) FROM vehicles
           WHERE registration_expiration BETWEEN CURRENT_DATE AND CURRENT_DATE + 30) AS registrations_soon,
         (SELECT count(*) FROM compliance_horizon
           WHERE completed_date IS NULL AND due_date < CURRENT_DATE)       AS overdue`),
    client.query(`SELECT last_sync_at, enabled FROM isn_connection LIMIT 1`),

    ...OVERHEAD.map((o) => client.query(o.sql, [day(monthStart), day(monthEnd)].slice(0, o.args))),
  ]);

  const num = (v) => Number(v) || 0;
  const h = head.rows[0];

  const byService = rollUpServices(services.rows, kinds);
  const costs = OVERHEAD.map((o, i) => ({ ...o, sql: undefined, amount: num(overhead[i].rows[0].amount) }))
    .filter((c) => c.amount > 0);

  // Where the period lands if the rest of it looks like what has gone so far.
  // Only offered while it is still running, and only once enough of it has
  // passed for the projection to mean anything.
  const running = now < monthEnd;
  const elapsed = range.elapsed ?? (now - monthStart);
  const span = range.total || (monthEnd - monthStart);
  const pace = running && num(h.booked) > 0 && elapsed > 0.15 * span
    ? Math.round((num(h.booked) / elapsed) * span)
    : null;

  const firstMonth = horizon.rows[0]?.first_month || null;
  const rd = ready.rows[0] || {};
  const conn = sync.rows[0] || {};

  return {
    period: range.period || 'month',
    month: { start: monthStart, end: monthEnd, running, pace },
    priorWindow: { start: priorStart, end: priorSoFar },
    readiness: {
      blocked: num(rd.blocked),
      people: num(rd.people),
      licensesSoon: num(rd.licenses_soon),
      registrationsSoon: num(rd.registrations_soon),
      overdue: num(rd.overdue),
      isnSyncedAt: conn.last_sync_at || null,
      isnEnabled: conn.enabled === true,
    },
    booked: {
      month: num(h.booked),
      priorToDate: num(prior.rows[0].booked),
      collected: num(h.collected),
      outstanding: num(h.outstanding),
    },
    jobs: {
      month: num(h.jobs),
      priorToDate: num(prior.rows[0].jobs),
      radon: num(h.radon_jobs),
      // The upsell number for a branch: of the jobs booked, how many carried
      // a radon test.
      radonAttach: num(h.jobs) ? num(h.radon_jobs) / num(h.jobs) : null,
    },
    averageTicket: {
      month: num(h.jobs) ? num(h.booked) / num(h.jobs) : null,
      priorToDate: num(prior.rows[0].jobs)
        ? num(prior.rows[0].booked) / num(prior.rows[0].jobs) : null,
    },
    trend: trend.rows.map((r) => ({
      month: r.month, booked: num(r.booked), collected: num(r.collected), jobs: num(r.jobs),
      // A month before the first order on file is a month nobody has looked
      // at, and the chart must not draw it as a zero.
      known: firstMonth ? r.month >= firstMonth : false,
    })),
    knownFrom: firstMonth,
    byService,
    scoreboard: people.rows.map((r) => ({
      name: r.name, employeeId: r.employee_id,
      jobs: num(r.jobs), booked: num(r.booked),
      averageTicket: num(r.jobs) ? num(r.booked) / num(r.jobs) : null,
      radonJobs: num(r.radon_jobs),
      radonAttach: num(r.jobs) ? num(r.radon_jobs) / num(r.jobs) : null,
    })),
    receivables: {
      total: num(h.outstanding),
      jobs: receivables.rows.length,
      oldestDays: receivables.rows.length ? num(receivables.rows[0].days) : 0,
      list: receivables.rows.map((r) => ({
        id: r.id, orderNumber: r.order_number, url: r.order_url,
        address: [r.property_address, r.property_city].filter(Boolean).join(', '),
        client: r.client_name, at: r.scheduled_start, amount: num(r.total_fee), days: num(r.days),
      })),
    },
    overhead: { lines: costs, total: costs.reduce((a, c) => a + c.amount, 0), notCounted: NOT_COUNTED },
    // Stays null until there is somewhere to put a cost per hour. A margin
    // computed without labour in it would be wrong in the flattering
    // direction, which is the worst way for a number like this to be wrong.
    margin: null,
  };
}

/**
 * Revenue by service line.
 *
 * ISN gives the services sold on an order but one fee for the whole job, so a
 * job's money cannot be split between its lines without inventing a split.
 * Instead each job counts once against every line it carried, and the screen
 * says so — "jobs that included this", not "revenue from this". Radon is the
 * exception, because ISN does give its fee separately.
 */
export function rollUpServices(rows, kinds) {
  const lines = new Map();
  const bump = (key, label, { jobs = 0, booked = 0, fee = null }) => {
    const line = lines.get(key) || { key, label, jobs: 0, booked: 0, fee: null };
    line.jobs += jobs;
    line.booked += booked;
    if (fee !== null) line.fee = (line.fee || 0) + fee;
    lines.set(key, line);
  };

  for (const row of rows) {
    const jobs = Number(row.jobs) || 0;
    const booked = Number(row.booked) || 0;
    const text = String(row.services || '').toLowerCase();

    bump('inspection', 'Inspections', { jobs, booked });
    const radonJobs = Number(row.radon_jobs) || 0;
    if (radonJobs) bump('radon', 'Radon', { jobs: radonJobs, fee: Number(row.radon_fee) || 0 });

    for (const k of kinds) {
      if (k.patterns.some((p) => text.includes(p))) bump(k.key, k.label, { jobs });
    }
  }
  return [...lines.values()].sort((a, b) => b.jobs - a.jobs);
}
