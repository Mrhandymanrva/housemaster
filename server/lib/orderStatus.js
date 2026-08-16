/**
 * Which orders count as work.
 *
 * The same rule was written out by hand in six places, each an exact,
 * case-sensitive list — `order_status NOT IN ('Canceled', 'Deleted',
 * 'Unscheduled')`. That holds only while ISN writes those words in exactly
 * that case with no stray spacing, and it fails silently in the worst
 * direction when it doesn't: an order ISN calls "unscheduled" walks straight
 * past a filter looking for "Unscheduled" and lands on the calendar as though
 * somebody had booked it.
 *
 * So the comparison is folded and trimmed, both spellings of cancelled are
 * covered, and it lives in one place — six copies of a rule is six chances for
 * one of them to drift.
 *
 * What this deliberately does not do is guess at other statuses. Dropping
 * anything that merely looks provisional would quietly change what the branch
 * thinks it booked, and that is a decision for whoever runs it, not for a
 * filter.
 */

/**
 * The statuses the app shipped believing were not work.
 *
 * These are now seeded rows in isn_status_rules rather than the rule itself —
 * kept here because the seed has to say something and these four are what the
 * code carried. The live answer is whatever that table says.
 */
export const NOT_WORK = ['canceled', 'cancelled', 'deleted', 'unscheduled'];

const col = (alias) => `${alias ? `${alias}.` : ''}order_status`;

/** How a status is read before it is compared to anything. */
export const statusOf = (alias) => `lower(btrim(coalesce(${col(alias)}, '')))`;

/**
 * Money is not a display preference.
 *
 * The status switches were wired into the revenue queries as well as the
 * grids, and they must not be. They answer "should this be drawn on a day?",
 * which is a question about a calendar. Whether a job is revenue is a question
 * about the business, and turning Complete off to tidy up a calendar took
 * fourteen hundred finished jobs out of the month's takings without a word.
 *
 * Revenue has one definition and it does not move: everything except the jobs
 * that never happened. A finished job is revenue. A booked job is revenue. If
 * that ever needs to change it changes here, deliberately, and not as the side
 * effect of tidying a screen.
 */
export const REVENUE_EXCLUDES = ['canceled', 'cancelled', 'deleted', 'unscheduled'];

export function countsAsRevenue(alias = 'o') {
  return `${statusOf(alias)} NOT IN (${REVENUE_EXCLUDES.map((s) => `'${s}'`).join(',')})`;
}

/**
 * Real work, according to the office rather than according to this file.
 *
 * The exclusions come out of isn_status_rules, which the owner can see and
 * change, because what ISN's words mean is a fact about how this branch runs
 * and not something to hardcode. A status with no row counts as work, so a new
 * word appearing in ISN shows up and gets turned off deliberately rather than
 * disappearing without anybody noticing.
 *
 * @param alias  the table alias in the query, or '' when there is none
 * @param also   extra statuses to drop, e.g. 'complete' for "not yet done"
 */
export function realWork(alias = 'o', also = []) {
  const extra = also.map((s) => ` AND ${statusOf(alias)} <> '${s.toLowerCase()}'`).join('');
  return `${statusOf(alias)} NOT IN `
    + `(SELECT status FROM isn_status_rules WHERE NOT counts_as_work)${extra}`;
}

/** One named status, read the same forgiving way. */
export const statusIs = (alias, status) => `${statusOf(alias)} = '${status.toLowerCase()}'`;

/** Anything but this status — used where only deleted orders are dropped. */
export const statusIsNot = (alias, status) => `${statusOf(alias)} <> '${status.toLowerCase()}'`;

/**
 * Every status ISN has actually sent, with what the app currently does with it.
 *
 * The point of this is to stop the guessing. Two rounds went into working out
 * why unscheduled orders were on the calendar, both of them reasoning about
 * what ISN probably calls things. It calls them whatever this office set up,
 * and that is knowable — it is in the data already.
 *
 * Statuses with no orders behind them are still listed if somebody has written
 * a rule for one, so a rule cannot sit there invisibly doing nothing.
 */
export async function statusCensus(client) {
  const [seen, rules] = await Promise.all([
    client.query(
      `SELECT ${statusOf('')} AS status,
              count(*)::int AS orders,
              count(*) FILTER (WHERE scheduled_start IS NOT NULL)::int AS dated,
              min(order_status) AS as_written,
              max(scheduled_start) AS latest
         FROM isn_orders
        GROUP BY 1`),
    client.query('SELECT status, counts_as_work, note FROM isn_status_rules'),
  ]);

  const byStatus = new Map();
  for (const r of seen.rows) {
    byStatus.set(r.status, {
      status: r.status,
      // What ISN writes, capitals and all, so somebody can recognise it.
      asWritten: r.as_written || null,
      orders: r.orders,
      dated: r.dated,
      latest: r.latest || null,
      countsAsWork: true,
      note: null,
    });
  }
  for (const r of rules.rows) {
    const row = byStatus.get(r.status) || {
      status: r.status, asWritten: null, orders: 0, dated: 0, latest: null,
    };
    byStatus.set(r.status, { ...row, countsAsWork: r.counts_as_work, note: r.note || null });
  }

  // Busiest first, but anything already turned off drops to the bottom — the
  // list is for finding the word that should not be on the calendar.
  return [...byStatus.values()].sort((a, b) =>
    (a.countsAsWork ? 0 : 1) - (b.countsAsWork ? 0 : 1) || b.orders - a.orders
    || String(a.status).localeCompare(String(b.status)));
}

/** Turn one status on or off. Folded, because that is how they are stored. */
export async function setStatusRule(client, status, countsAsWork) {
  const key = String(status ?? '').trim().toLowerCase();
  await client.query(
    `INSERT INTO isn_status_rules (status, counts_as_work, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (status) DO UPDATE SET counts_as_work = EXCLUDED.counts_as_work,
                                        updated_at = now()`,
    [key, countsAsWork === true]);
  return { status: key, countsAsWork: countsAsWork === true };
}
