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

/** Orders that are not work: never happened, or were never a booking. */
export const NOT_WORK = ['canceled', 'cancelled', 'deleted', 'unscheduled'];

const col = (alias) => `${alias ? `${alias}.` : ''}order_status`;

/** How a status is read before it is compared to anything. */
export const statusOf = (alias) => `lower(btrim(coalesce(${col(alias)}, '')))`;

/**
 * Real work, whatever case ISN happens to write it in.
 *
 * @param alias  the table alias in the query, or '' when there is none
 * @param also   extra statuses to drop, e.g. 'complete' for "not yet done"
 */
export function realWork(alias = 'o', also = []) {
  const list = [...NOT_WORK, ...also.map((s) => s.toLowerCase())]
    .map((s) => `'${s}'`).join(',');
  return `${statusOf(alias)} NOT IN (${list})`;
}

/** One named status, read the same forgiving way. */
export const statusIs = (alias, status) => `${statusOf(alias)} = '${status.toLowerCase()}'`;

/** Anything but this status — used where only deleted orders are dropped. */
export const statusIsNot = (alias, status) => `${statusOf(alias)} <> '${status.toLowerCase()}'`;
