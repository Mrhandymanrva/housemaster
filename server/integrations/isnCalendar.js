/**
 * Time somebody has blocked off.
 *
 * The week grid cannot tell a free day from a blocked one without this, which
 * means it can show a day as open when the inspector is at a funeral. In ISN
 * that is an Event rather than an Order — a title somebody typed, against a
 * person, over a stretch of the calendar.
 *
 * Nothing about ISN's calendar is documented for this office. /event/{id}
 * answers 404, and the only calendar path in the docs is availableslots, which
 * is the inverse: when somebody is free rather than what is stopping them. So
 * this does not hardcode a guess. It asks the candidate paths in order, keeps
 * the first that answers, and remembers which one — and if none answer it says
 * so plainly rather than leaving the grid to imply everyone is available.
 *
 * The field names are matched loosely for the same reason the services matcher
 * is: what comes back cannot be checked against a spec that this office can
 * read, so the code recognises the shapes an API of this kind tends to use and
 * keeps the whole payload for when one of them turns out to be wrong.
 */

/** In order of how much they would tell us, best first. */
export const EVENT_PATHS = [
  { path: '/events', kind: 'events' },
  { path: '/calendar/events', kind: 'events' },
  { path: '/calendar', kind: 'events' },
  // The fallback. Availability says when somebody is free, so blocked time is
  // a hole rather than a block: we would know they cannot work and never why.
  { path: '/calendar/availableslots', kind: 'slots' },
  { path: '/availableslots', kind: 'slots' },
];

const first = (o, names) => {
  for (const n of names) {
    for (const k of Object.keys(o || {})) {
      if (k.toLowerCase().replace(/[^a-z]/g, '') === n) {
        const v = o[k];
        if (v !== null && v !== undefined && v !== '') return v;
      }
    }
  }
  return null;
};

const ID_KEYS = ['id', 'eventid', 'uuid', 'key'];
const TITLE_KEYS = ['title', 'name', 'subject', 'description', 'label', 'text', 'note'];
const START_KEYS = ['start', 'starts', 'startdate', 'starttime', 'startdatetime',
  'datetime', 'begin', 'from', 'date'];
const END_KEYS = ['end', 'ends', 'enddate', 'endtime', 'enddatetime', 'until', 'to', 'finish'];
const ALLDAY_KEYS = ['allday', 'isallday', 'fullday'];
const USER_KEYS = ['user', 'userid', 'inspector', 'inspectorid', 'inspector1',
  'assignedto', 'assigneduser', 'staff', 'staffid'];

const asDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

const yes = (v) => {
  if (v === true) return true;
  if (v === false || v == null) return false;
  return ['yes', 'true', '1', 'y'].includes(String(v).trim().toLowerCase());
};

/**
 * ISN writes the person into the title — "Off (Brian Slazyk)" — which may be a
 * display habit rather than a field. Read as a last resort, after anything
 * that looks like a real user reference, and never in preference to one.
 */
export function nameFromTitle(title) {
  const m = String(title || '').match(/\(([^()]+)\)\s*$/);
  if (!m) return null;
  const inside = m[1].trim();
  // "(2 hours)" and "(rescheduled)" are not people.
  if (!inside || /\d/.test(inside) || inside.split(/\s+/).length > 4) return null;
  return inside;
}

/** Strip the trailing "(Name)" so the reason reads on its own in a small block. */
export const reasonOf = (title) =>
  String(title || '').replace(/\s*\([^()]+\)\s*$/, '').trim() || String(title || '').trim();

/**
 * One event out of whatever ISN sent.
 *
 * @param raw    the payload as it arrived
 * @param people { byIsnId: Map, byName: Map } from the roster, for putting a
 *               block on the right row
 */
export function normalizeEvent(raw, people = {}) {
  const id = first(raw, ID_KEYS);
  if (id === null) return null;              // nothing to key it by; not ours to invent

  const title = first(raw, TITLE_KEYS);
  const starts = asDate(first(raw, START_KEYS));
  const ends = asDate(first(raw, END_KEYS));

  const isnUser = first(raw, USER_KEYS);
  const byId = isnUser != null ? people.byIsnId?.get(String(isnUser)) : null;

  // Only fall back to the title when nothing in the payload named anybody.
  const named = byId ? null : nameFromTitle(title);
  const byName = named ? people.byName?.get(named.toLowerCase()) : null;

  const who = byId || byName || null;

  return {
    isn_event_id: String(id),
    title: title ? String(title) : null,
    reason: reasonOf(title),
    starts_at: starts,
    // A block with no end is a whole day, not a zero-length instant.
    ends_at: ends,
    all_day: yes(first(raw, ALLDAY_KEYS)) || (!!starts && !ends),
    isn_user_id: isnUser != null ? String(isnUser) : null,
    employee_id: who?.employeeId ?? null,
    inspector_name: who?.name ?? named ?? null,
    // Said out loud so the screen can admit it rather than putting a block on
    // the wrong row or dropping it.
    matchedBy: byId ? 'id' : byName ? 'title' : null,
    raw,
  };
}

/**
 * Ask each candidate in turn and keep the first that answers with a list.
 *
 * @param get   (path) => payload      — the ISN caller
 * @param list  (payload, what) => []  — extractList, which knows ISN's wrappers
 */
export async function discoverEvents(get, list) {
  const tried = [];
  for (const candidate of EVENT_PATHS) {
    try {
      const payload = await get(candidate.path);
      const rows = list(payload, 'events');
      // A 200 that is not a list of anything is not an answer. Recorded, so
      // the ISN screen can show what it actually said.
      tried.push({ ...candidate, ok: true, count: rows.length });
      if (Array.isArray(rows)) {
        return {
          found: true, ...candidate, count: rows.length, sample: rows[0] || null, tried,
        };
      }
    } catch (e) {
      tried.push({ ...candidate, ok: false, error: String(e.message).slice(0, 160) });
    }
  }
  return { found: false, tried };
}

/**
 * Where a block sits on the week grid.
 *
 * All-day and open-ended blocks cover every day they touch, because "Off" from
 * Wednesday to Friday has to grey all three — not just the day it started on.
 */
export function daysCovered(event, zone = 'America/New_York') {
  if (!event.starts_at) return [];
  const key = (d) => new Intl.DateTimeFormat('en-CA',
    { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

  const out = [key(event.starts_at)];
  if (!event.ends_at) return out;

  // Walk day by day rather than dividing, so a daylight-saving change inside
  // the range does not drop or repeat one.
  let at = new Date(event.starts_at);
  const last = key(event.ends_at);
  for (let guard = 0; guard < 400 && out[out.length - 1] !== last; guard++) {
    at = new Date(at.getTime() + 86400000);
    const k = key(at);
    if (k !== out[out.length - 1]) out.push(k);
  }
  return out;
}

// ------------------------------------------------------------------ sync

/**
 * Read the calendar and write down what is blocked.
 *
 * Replaces the lot each time rather than merging. A handful of blocks a week
 * makes a full replace cheap, and it is the only way an event that was
 * cancelled in ISN stops greying out a day here — merging would leave somebody
 * marked off for a holiday they did not take.
 *
 * Everything takes its collaborators as arguments so this can be run against a
 * recorded client rather than a live ISN.
 */
export async function pullEvents(client, { get, list, now = new Date() } = {}) {
  const conn = (await client.query(
    `SELECT events_path, events_kind FROM isn_connection LIMIT 1`)).rows[0] || {};

  // Use the path that answered last time; only go looking if there is none.
  let found = conn.events_path
    ? { found: true, path: conn.events_path, kind: conn.events_kind || 'events' }
    : await discoverEvents(get, list);

  if (!found.found) {
    await client.query(
      `UPDATE isn_connection SET events_path = NULL, events_kind = NULL,
              events_checked_at = $1, events_note = $2`,
      [now, 'Nothing on ISN answered for the calendar. '
        + found.tried.map((t) => `${t.path}: ${t.ok ? 'no list' : t.error}`).join(' · ')]);
    return { found: false, tried: found.tried, written: 0, kept: 0 };
  }

  let payload;
  try {
    payload = await get(found.path);
  } catch (e) {
    // A path that worked before and does not now is worth saying, not hiding.
    await client.query(
      `UPDATE isn_connection SET events_checked_at = $1, events_note = $2`,
      [now, `${found.path} stopped answering: ${String(e.message).slice(0, 160)}`]);
    return { found: true, path: found.path, error: e.message, written: 0, kept: 0 };
  }

  const rows = list(payload, 'events');
  const people = await roster(client);
  const events = rows.map((raw) => normalizeEvent(raw, people)).filter(Boolean);

  const written = await write(client, events, found, now);
  await client.query(
    `UPDATE isn_connection SET events_path = $1, events_kind = $2,
            events_checked_at = $3, events_note = $4`,
    [found.path, found.kind, now,
     `${events.length} from ${found.path}`
     + (found.kind === 'slots'
       ? ' — availability only, so a block shows as unavailable with no reason.'
       : '')]);

  return {
    found: true, path: found.path, kind: found.kind,
    read: rows.length, written,
    unmatched: events.filter((e) => !e.employee_id).length,
  };
}

/** Who ISN's ids and names point at here. */
async function roster(client) {
  const { rows } = await client.query(
    `SELECT id, full_name, isn_user_id FROM employees WHERE status = 'Active'`);
  const byIsnId = new Map();
  const byName = new Map();
  for (const r of rows) {
    const who = { employeeId: r.id, name: r.full_name };
    if (r.isn_user_id) byIsnId.set(String(r.isn_user_id), who);
    if (r.full_name) byName.set(r.full_name.toLowerCase(), who);
  }
  return { byIsnId, byName };
}

async function write(client, events, found, now) {
  let written = 0;
  for (const e of events) {
    await client.query(
      `INSERT INTO isn_events
         (isn_event_id, title, starts_at, ends_at, all_day, isn_user_id, employee_id,
          inspector_name, source_path, raw, last_pulled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (isn_event_id) DO UPDATE SET
         title = EXCLUDED.title, starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at,
         all_day = EXCLUDED.all_day, isn_user_id = EXCLUDED.isn_user_id,
         employee_id = EXCLUDED.employee_id, inspector_name = EXCLUDED.inspector_name,
         source_path = EXCLUDED.source_path, raw = EXCLUDED.raw,
         last_pulled_at = EXCLUDED.last_pulled_at`,
      [e.isn_event_id, e.title, e.starts_at, e.ends_at, e.all_day, e.isn_user_id,
       e.employee_id, e.inspector_name, found.path, JSON.stringify(e.raw), now]);
    written++;
  }
  // Anything the calendar no longer mentions is gone from the calendar.
  await client.query(`DELETE FROM isn_events WHERE last_pulled_at < $1`, [now]);
  return written;
}
