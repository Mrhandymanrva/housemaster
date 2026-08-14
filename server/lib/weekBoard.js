/**
 * The week, by inspector and by day.
 *
 * Home was a compliance page: everything with a date on it, soonest first.
 * True, and not the question somebody running a branch opens the app with,
 * which is who is working, what is it worth, and where are the holes.
 *
 * One row per inspector, one column per day, and the office's own week —
 * Sunday to Sunday, half-open, the same boundaries every other screen uses.
 * A job lands on the day it is scheduled for, read on the office clock, so a
 * 7pm inspection does not appear on tomorrow because the server thinks in UTC.
 *
 * Two things are deliberately not silent. A job with nobody assigned gets its
 * own row rather than being dropped for having no inspector to sit under, and
 * an inspector with no work still gets a row, because an empty week is the
 * thing worth seeing.
 *
 * Blocked-off time comes from ISN's calendar, which the app finds by asking
 * rather than by assuming — see integrations/isnCalendar.js. When nothing on
 * ISN answers, `blocked` stays null and the screen says so, because a grid
 * that quietly implies a free day is worse than one admitting it cannot tell.
 */
import { OFFICE_ZONE } from './zone.js';
import { daysCovered, reasonOf } from '../integrations/isnCalendar.js';

/** Cancelled, deleted and never-scheduled jobs are not work. */
const REAL_WORK = `o.order_status NOT IN ('Canceled', 'Deleted', 'Unscheduled')
                   AND o.scheduled_start IS NOT NULL`;

const num = (v) => Number(v) || 0;

/** The seven days of the window, as the office writes them down. */
export function daysOf(range, zone = OFFICE_ZONE) {
  const out = [];
  for (let at = new Date(range.start); at < range.end;) {
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
    out.push({
      date: key,
      weekday: new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' }).format(at),
      day: Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, day: 'numeric' }).format(at)),
    });
    at = new Date(at.getTime() + 86400000);
    // A day that lost or gained an hour still has to advance exactly one date.
    const seen = new Set(out.map((d) => d.date));
    const next = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
    if (seen.has(next)) at = new Date(at.getTime() + 3600000);
  }
  return out.slice(0, 7);
}

export async function weekBoard(client, range, { zone = OFFICE_ZONE } = {}) {
  const days = daysOf(range, zone);

  const [jobs, people, radon, events, conn] = await Promise.all([
    client.query(
      `SELECT o.id, o.order_number, o.order_url, o.total_fee, o.paid, o.has_radon,
              o.order_status, o.property_address, o.property_city, o.client_name,
              o.scheduled_start,
              (o.scheduled_start AT TIME ZONE $3)::date AS on_day,
              to_char(o.scheduled_start AT TIME ZONE $3, 'FMHH12:MI AM') AS at_time,
              o.employee_id,
              COALESCE(e.full_name, o.inspector_name) AS inspector_name
         FROM isn_orders o
         LEFT JOIN employees e ON e.id = o.employee_id
        WHERE ${REAL_WORK} AND o.scheduled_start >= $1 AND o.scheduled_start < $2
        ORDER BY o.scheduled_start`,
      [range.start, range.end, zone]),

    // Everybody who could be working, so a blank week shows as a blank row
    // rather than as an inspector who has left.
    client.query(
      `SELECT id, full_name FROM employees
        WHERE status = 'Active' AND (role IS NULL OR role NOT IN ('Office', 'Admin'))
        ORDER BY full_name`),

    client.query(
      `SELECT COUNT(*) AS out, COUNT(*) FILTER (WHERE result_status = 'Pending') AS pending
         FROM radon_tests WHERE status = 'Deployed'`),

    // Anything overlapping the window at all, not just starting in it — a week
    // off that began last Friday still blocks Monday.
    client.query(
      `SELECT isn_event_id, title, starts_at, ends_at, all_day, employee_id, inspector_name
         FROM isn_events
        WHERE starts_at < $2 AND COALESCE(ends_at, starts_at) >= $1
        ORDER BY starts_at`,
      [range.start, range.end]),

    client.query(`SELECT events_path, events_kind, events_checked_at, events_note
                    FROM isn_connection LIMIT 1`),
  ]);

  const slot = (r) => ({
    id: r.id,
    orderNumber: r.order_number,
    url: r.order_url,
    time: r.at_time,
    at: r.scheduled_start,
    address: r.property_address || r.client_name || 'Job',
    city: r.property_city,
    fee: num(r.total_fee),
    paid: r.paid === true,
    radon: r.has_radon === true,
    status: r.order_status,
    kind: 'job',
  });

  // Rows keyed by whoever the job names. An inspector ISN knows about but the
  // app has never adopted still gets a row under the name ISN gave them.
  const rows = new Map();
  const row = (key, name) => {
    if (!rows.has(key)) {
      rows.set(key, {
        employeeId: key === '__none__' ? null : key,
        name,
        unassigned: key === '__none__',
        days: Object.fromEntries(days.map((d) => [d.date, []])),
        jobs: 0, booked: 0, radon: 0,
      });
    }
    return rows.get(key);
  };

  for (const p of people.rows) row(p.id, p.full_name);

  for (const r of jobs.rows) {
    const key = r.employee_id || (r.inspector_name ? `name:${r.inspector_name}` : '__none__');
    const line = row(key, r.inspector_name || 'Nobody assigned');
    const day = String(r.on_day);
    (line.days[day] ||= []).push(slot(r));
    line.jobs += 1;
    line.booked += num(r.total_fee);
    if (r.has_radon) line.radon += 1;
  }

  const byDay = Object.fromEntries(days.map((d) => [d.date, { booked: 0, jobs: 0 }]));
  for (const r of jobs.rows) {
    const d = byDay[String(r.on_day)];
    if (!d) continue;                       // a job on an edge the window excludes
    d.booked += num(r.total_fee);
    d.jobs += 1;
  }

  // Blocks go on the row of whoever they belong to, on every day they touch.
  // One that names nobody is kept aside rather than dropped or guessed at.
  const orphanBlocks = [];
  for (const e of events.rows) {
    const block = {
      id: `ev-${e.isn_event_id}`,
      kind: 'block',
      reason: reasonOf(e.title) || 'Blocked',
      title: e.title,
      allDay: e.all_day === true,
      time: e.all_day === true ? 'All day'
        : new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' })
            .format(e.starts_at),
      who: e.inspector_name || null,
    };
    const on = daysCovered({ starts_at: e.starts_at, ends_at: e.ends_at }, zone)
      .filter((d) => days.some((x) => x.date === d));
    if (!on.length) continue;

    const line = e.employee_id ? rows.get(e.employee_id) : null;
    if (!line) { orphanBlocks.push({ ...block, days: on }); continue; }
    for (const d of on) (line.days[d] ||= []).push(block);
    line.blocked = (line.blocked || 0) + on.length;
  }

  const list = [...rows.values()];
  // Busiest first, but whoever has nobody assigned to it goes last — it is a
  // problem to fix, not a person to compare.
  list.sort((a, b) => (a.unassigned ? 1 : 0) - (b.unassigned ? 1 : 0) || b.booked - a.booked
    || String(a.name).localeCompare(String(b.name)));

  const done = jobs.rows.filter((r) => r.order_status === 'Complete').length;

  return {
    window: { start: range.start, end: range.end },
    days: days.map((d) => ({ ...d, ...byDay[d.date] })),
    inspectors: list,
    totals: {
      booked: jobs.rows.reduce((a, r) => a + num(r.total_fee), 0),
      jobs: jobs.rows.length,
      done,
      toCome: jobs.rows.length - done,
      unbilled: jobs.rows.filter((r) => r.paid !== true).reduce((a, r) => a + num(r.total_fee), 0),
      radonJobs: jobs.rows.filter((r) => r.has_radon).length,
      unassigned: list.filter((x) => x.unassigned).reduce((a, x) => a + x.jobs, 0),
    },
    radonSets: { out: num(radon.rows[0]?.out), pending: num(radon.rows[0]?.pending) },
    // null means nobody has managed to ask ISN yet, which is not the same as
    // "asked, and nothing is blocked". The screen says which.
    blocked: conn.rows[0]?.events_path ? {
      path: conn.rows[0].events_path,
      kind: conn.rows[0].events_kind,
      checkedAt: conn.rows[0].events_checked_at,
      note: conn.rows[0].events_note,
      count: events.rows.length,
      unmatched: orphanBlocks,
    } : null,
  };
}
