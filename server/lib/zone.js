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
