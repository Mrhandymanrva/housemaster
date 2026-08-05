/**
 * The clock this business runs on.
 *
 * The server runs in UTC and the office does not. Anywhere a time arrives
 * without a zone on it — ISN writes "2026-08-04 09:00:00" and means nine in
 * the morning in Richmond — it has to be read against this or it lands four
 * hours out and a 9am inspection shows up as a 5am one.
 */
export const OFFICE_ZONE = 'America/New_York';

/**
 * How far the zone is from UTC at a given instant. Positive east of Greenwich.
 * Works out DST by asking the zone what the wall clock reads.
 */
function offsetAt(instant, zone = OFFICE_ZONE) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(instant).map((p) => [p.type, p.value])
  );
  const wall = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
  );
  return wall - instant.getTime();
}

/** The office's calendar date, and which day of the week it is there. */
export function officeParts(instant = new Date(), zone = OFFICE_ZONE) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone, weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(instant).map((x) => [x.type, x.value])
  );
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday),
  };
}

/**
 * Today, this week and this month — as instants, with both ends.
 *
 * Every range is half-open: from the first moment to the first moment of the
 * next one. A range with no end is not a range, and "this week" without one
 * quietly counts every job ever booked into the future.
 *
 * The week runs Sunday to Saturday, which is what the office's own board
 * shows. Postgres would say Monday, and being one day out on a Monday is the
 * kind of disagreement that gets blamed on the data.
 *
 * Calendar arithmetic happens in UTC and only the final wall-clock reading is
 * converted, so a week containing a daylight-saving change is still 7 days.
 */
export function officeRanges(now = new Date(), zone = OFFICE_ZONE) {
  const { year, month, day, dow } = officeParts(now, zone);
  const midnight = Date.UTC(year, month - 1, day);
  const at = (ms) => {
    const d = new Date(ms);
    return fromOfficeWallClock(
      { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }, zone);
  };

  return {
    dayStart: at(midnight),
    dayEnd: at(midnight + 86400000),
    weekStart: at(midnight - dow * 86400000),
    weekEnd: at(midnight + (7 - dow) * 86400000),
    monthStart: fromOfficeWallClock({ year, month, day: 1 }, zone),
    monthEnd: month === 12
      ? fromOfficeWallClock({ year: year + 1, month: 1, day: 1 }, zone)
      : fromOfficeWallClock({ year, month: month + 1, day: 1 }, zone),
  };
}

/**
 * A wall-clock reading in the office's zone, as a real instant.
 *
 * The offset depends on the instant and the instant depends on the offset, so
 * it settles in two passes — which is also what makes the hour either side of
 * a daylight-saving change come out right.
 */
export function fromOfficeWallClock(parts, zone = OFFICE_ZONE) {
  const naive = Date.UTC(
    parts.year, parts.month - 1, parts.day,
    parts.hour || 0, parts.minute || 0, parts.second || 0
  );
  let guess = naive - offsetAt(new Date(naive), zone);
  guess = naive - offsetAt(new Date(guess), zone);
  return new Date(guess);
}
