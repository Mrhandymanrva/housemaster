/**
 * A month of the schedule, built from the orders already synced.
 *
 * The week grid answers "who is working this week". This answers the other
 * question somebody books against: what does the month look like, and when is
 * this person free enough to take another one.
 *
 * There is no second source. Every order already carries a scheduled start and
 * an inspector, which is the whole of a calendar — the long hunt through ISN's
 * API was only ever after the one thing orders cannot carry: time somebody has
 * blocked off. ISN keeps that out of its API entirely, so this says plainly
 * what it shows (booked work) and never implies the rest is free.
 *
 * The grid is Sunday to Saturday and always whole weeks, so the month sits in
 * the shape people read a calendar in. Days either side belong to the
 * neighbouring months and are marked as such, but their work is real and is
 * loaded — a blank last-Monday-of-August that actually has three inspections
 * on it would be a lie told for tidiness.
 */
import { OFFICE_ZONE, fromOfficeWallClock, officeParts, dayKey } from './zone.js';

const REAL_WORK = `o.order_status NOT IN ('Canceled', 'Deleted', 'Unscheduled')
                   AND o.scheduled_start IS NOT NULL`;

const num = (v) => Number(v) || 0;

const key = (d, zone) => new Intl.DateTimeFormat('en-CA',
  { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

export const initialsOf = (name = '') => String(name).trim().split(/\s+/)
  .map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

/**
 * The month asked for, and the months either side of it.
 *
 * Anything unreadable falls back to the month the office is in rather than
 * throwing — a bad value in a URL should show somebody this month, not an
 * error page.
 */
export function monthOf(want, now = new Date(), zone = OFFICE_ZONE) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(want || ''));
  const here = officeParts(now, zone);
  let year = m ? Number(m[1]) : here.year;
  let month = m ? Number(m[2]) : here.month;
  if (!(month >= 1 && month <= 12) || !(year >= 1900 && year <= 2999)) {
    year = here.year; month = here.month;
  }

  const step = (n) => {
    const y = year + Math.floor((month - 1 + n) / 12);
    const mo = ((((month - 1 + n) % 12) + 12) % 12) + 1;
    return `${y}-${String(mo).padStart(2, '0')}`;
  };

  return {
    id: `${year}-${String(month).padStart(2, '0')}`,
    year,
    month,
    label: new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' })
      .format(new Date(Date.UTC(year, month - 1, 1))),
    start: fromOfficeWallClock({ year, month, day: 1 }, zone),
    end: fromOfficeWallClock(month === 12
      ? { year: year + 1, month: 1, day: 1 } : { year, month: month + 1, day: 1 }, zone),
    prev: step(-1),
    next: step(1),
  };
}

/**
 * The whole weeks that contain a month.
 *
 * Six rows or five, whichever the month needs — padding every month to six
 * leaves a trailing empty row that reads as a fortnight of nothing booked.
 */
export function gridOf(m, zone = OFFICE_ZONE) {
  const firstDow = officeParts(m.start, zone).dow;
  const from = new Date(m.start.getTime() - firstDow * 86400000);

  const days = [];
  for (let at = from; at < m.end || days.length % 7 !== 0;) {
    const date = key(at, zone);
    const p = officeParts(at, zone);
    days.push({ date, day: p.day, inMonth: p.month === m.month && p.year === m.year });
    at = new Date(at.getTime() + 86400000);
    // A day that lost or gained an hour still has to advance exactly one date.
    if (key(at, zone) === date) at = new Date(at.getTime() + 3600000);
    if (days.length > 42) break;                    // a calendar is never longer
  }
  return days;
}

export async function calendarMonth(client, want, { zone = OFFICE_ZONE, now = new Date() } = {}) {
  const m = monthOf(want, now, zone);
  const days = gridOf(m, zone);
  // The window is the grid, not the month, so a job on a spillover day is not
  // dropped for sitting one square outside.
  const from = fromOfficeWallClock({
    year: Number(days[0].date.slice(0, 4)), month: Number(days[0].date.slice(5, 7)),
    day: Number(days[0].date.slice(8, 10)),
  }, zone);
  const last = days[days.length - 1].date;
  const to = new Date(fromOfficeWallClock({
    year: Number(last.slice(0, 4)), month: Number(last.slice(5, 7)), day: Number(last.slice(8, 10)),
  }, zone).getTime() + 86400000);

  const [jobs, people] = await Promise.all([
    client.query(
      `SELECT o.id, o.order_number, o.order_url, o.total_fee, o.paid, o.has_radon,
              o.order_status, o.property_address, o.property_city, o.client_name,
              o.scheduled_start,
              to_char(o.scheduled_start AT TIME ZONE $3, 'YYYY-MM-DD') AS on_day,
              to_char(o.scheduled_start AT TIME ZONE $3, 'FMHH12:MI AM') AS at_time,
              o.employee_id,
              COALESCE(e.full_name, o.inspector_name) AS inspector_name
         FROM isn_orders o
         LEFT JOIN employees e ON e.id = o.employee_id
        WHERE ${REAL_WORK} AND o.scheduled_start >= $1 AND o.scheduled_start < $2
        ORDER BY o.scheduled_start`,
      [from, to, zone]),

    // Everybody who could be working, so the filter offers a quiet inspector
    // rather than only the ones who happen to have work this month.
    client.query(
      `SELECT id, full_name FROM employees
        WHERE status = 'Active' AND (role IS NULL OR role NOT IN ('Office', 'Admin'))
        ORDER BY full_name`),
  ]);

  const byDate = new Map(days.map((d) => [d.date, { ...d, items: [], jobs: 0, booked: 0, radon: 0 }]));
  const who = new Map();
  const person = (id, name) => {
    const k = id || `name:${name || '__none__'}`;
    if (!who.has(k)) {
      who.set(k, {
        employeeId: id || null,
        name: name || 'Nobody assigned',
        initials: name ? initialsOf(name) : '—',
        unassigned: !name,
        jobs: 0, booked: 0,
      });
    }
    return who.get(k);
  };

  for (const p of people.rows) person(p.id, p.full_name);

  for (const r of jobs.rows) {
    const cell = byDate.get(dayKey(r.on_day));
    if (!cell) continue;                       // an edge the grid does not show
    const p = person(r.employee_id, r.inspector_name);
    cell.items.push({
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
      employeeId: r.employee_id || null,
      inspector: p.name,
      initials: p.initials,
      unassigned: p.unassigned,
    });
    cell.jobs += 1;
    cell.booked += num(r.total_fee);
    if (r.has_radon) cell.radon += 1;
    // Only the month's own days count towards the month, or a total changes
    // depending on which month you were looking at when you read it.
    if (cell.inMonth) { p.jobs += 1; p.booked += num(r.total_fee); }
  }

  const cells = days.map((d) => {
    const c = byDate.get(d.date);
    const byWho = new Map();
    for (const it of c.items) {
      const k = it.employeeId || it.inspector;
      if (!byWho.has(k)) {
        byWho.set(k, {
          employeeId: it.employeeId, name: it.inspector, initials: it.initials,
          unassigned: it.unassigned, jobs: 0, booked: 0,
        });
      }
      const e = byWho.get(k);
      e.jobs += 1;
      e.booked += it.fee;
    }
    return { ...c, byInspector: [...byWho.values()].sort((a, b) => b.jobs - a.jobs) };
  });

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const inMonth = cells.filter((c) => c.inMonth);
  const list = [...who.values()].sort((a, b) => (a.unassigned ? 1 : 0) - (b.unassigned ? 1 : 0)
    || b.jobs - a.jobs || String(a.name).localeCompare(String(b.name)));

  return {
    month: m.id,
    label: m.label,
    prev: m.prev,
    next: m.next,
    today: key(now, zone),
    weeks,
    inspectors: list,
    totals: {
      jobs: inMonth.reduce((a, c) => a + c.jobs, 0),
      booked: inMonth.reduce((a, c) => a + c.booked, 0),
      radon: inMonth.reduce((a, c) => a + c.radon, 0),
      workingDays: inMonth.filter((c) => c.jobs > 0).length,
      unassigned: inMonth.reduce((a, c) => a + c.items.filter((i) => i.unassigned).length, 0),
    },
  };
}
