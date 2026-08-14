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

/**
 * The paths worth asking, best first.
 *
 * /events is not a 404 and not empty — it answers with
 * { status: "error", message: "missing or invalid action specified" }. So this
 * corner of ISN is action-dispatched rather than REST, which nothing in the
 * documentation says and no amount of guessing at nouns would have found. It
 * took reading the sentence the API was already sending.
 *
 * The bare paths stay first, because they are what a REST endpoint would want
 * and they cost one call to rule out. Then the same paths with the verbs an
 * action API of this vintage tends to use. A date range is tried last, on the
 * spelling ISN already uses for /orders, in case the calendar answers but
 * defaults to today.
 */
const BASES = ['/events', '/calendar/events', '/calendar'];
const ACTIONS = ['list', 'getall', 'get', 'index', 'search', 'read', 'all'];

const window = () => {
  const from = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10);
  return { from, to };
};

export const EVENT_PATHS = [
  ...BASES.map((path) => ({ path, kind: 'events' })),
  ...BASES.flatMap((base) => ACTIONS.map((a) => ({ path: `${base}?action=${a}`, kind: 'events' }))),
  ...(() => {
    const { from, to } = window();
    return [
      { path: `/events?action=list&startdate=${from}&enddate=${to}`, kind: 'events' },
      { path: `/events?action=list&start=${from}&end=${to}`, kind: 'events' },
      { path: `/events?action=list&after=${from}`, kind: 'events' },
      { path: `/events?after=${from}`, kind: 'events' },
    ];
  })(),
  // Last, and it can never say why somebody is blocked — only that they are.
  { path: '/calendar/availableslots', kind: 'slots' },
  { path: '/availableslots', kind: 'slots' },
  { path: '/calendar/availableslots?action=list', kind: 'slots' },
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

/**
 * What ISN said, when what it said was an explanation.
 *
 * /events answers 200 with { status, message } — an error envelope, not an
 * empty calendar. describeShape deliberately prints field names and never
 * values, because an order carries a client's name and address; but this
 * particular shape carries neither. It is the API explaining what it wants,
 * and reading it is the difference between "0 events" and knowing why.
 *
 * Narrow on purpose: two or three keys, a string message, nothing else. Any
 * other body stays unprinted.
 */
export function apiMessage(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

  const msg = payload.message ?? payload.error ?? payload.Message ?? payload.detail;
  if (typeof msg !== 'string' || !msg.trim()) return null;

  // The guard is not a key count — /availableslots answers with six keys and
  // no records in it, echoing the search it wanted (zip, daysahead, offset),
  // and a three-key limit hid the one sentence that says so. What separates an
  // envelope from a payload is nesting: records arrive as arrays and objects.
  // Only the message is ever printed; everything else is read to decide
  // whether this is an envelope at all.
  const values = Object.values(payload);
  if (values.length > 15) return null;
  // Nesting is only a problem when something is in it. /availableslots answers
  // with an empty slots array beside its explanation, and refusing that would
  // throw away the sentence saying why the array is empty — which is the whole
  // question. A nested value with anything in it is still a payload and is
  // still refused.
  const carries = (v) => {
    if (v === null || typeof v !== 'object') return false;
    return Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0;
  };
  if (values.some(carries)) return null;

  const status = payload.status ?? payload.Status ?? payload.code;
  return `${status != null ? `${status}: ` : ''}${msg}`.slice(0, 240);
}

/**
 * What an envelope wanted, when it told us by echoing it back.
 *
 * /availableslots returns { status, message, count, zip, daysahead, offset } —
 * the shape of the question it expects, sent back with nothing filled in. The
 * keys that are not status, message or count are the parameters it takes, and
 * that is a far better list than anything guessable.
 */
export function wantsParams(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const ignore = new Set(['status', 'message', 'error', 'detail', 'count', 'total', 'code']);
  return Object.keys(payload)
    .filter((k) => !ignore.has(k.toLowerCase()))
    .filter((k) => payload[k] === null || typeof payload[k] !== 'object');
}

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
export async function discoverEvents(get, list, describe = () => null, { zip = null } = {}) {
  const tried = [];
  // /availableslots echoed zip, daysahead and offset back as the question it
  // wanted asking. The zip comes from the branch's own jobs rather than being
  // invented, so what is asked for is somewhere they actually work.
  const candidates = zip
    ? [...EVENT_PATHS,
       { path: `/availableslots?zip=${encodeURIComponent(zip)}&daysahead=60`, kind: 'slots' },
       { path: `/calendar/availableslots?zip=${encodeURIComponent(zip)}&daysahead=60`, kind: 'slots' }]
    : EVENT_PATHS;
  let empty = null;                 // answered, but with nothing in it

  for (const candidate of candidates) {
    try {
      const payload = await get(candidate.path);
      const rows = list(payload, 'events');

      if (rows.length) {
        tried.push({ ...candidate, ok: true, count: rows.length });
        return { found: true, ...candidate, count: rows.length, sample: rows[0] || null, tried };
      }

      // An empty answer is not the same as the right answer, and taking it
      // would stop the search at a path that may simply want a date range —
      // the next candidate might be the one that talks. The shape is recorded
      // because "0" and "0, and here is the envelope it came in" are very
      // different things to somebody trying to work out why.
      const said = apiMessage(payload);
      const wants = wantsParams(payload);
      tried.push({ ...candidate, ok: true, count: 0, said, wants, shape: describe(payload) });
      empty = empty || { ...candidate, count: 0, said, wants, shape: describe(payload) };
    } catch (e) {
      tried.push({ ...candidate, ok: false, error: String(e.message).slice(0, 160) });
    }
  }

  // Nothing had anything to say. Keep the first that answered at all, so the
  // fact that the endpoint exists is not thrown away, and carry every distinct
  // thing ISN said — one candidate getting a different answer from the rest is
  // the thread worth pulling, and reporting only the first would hide it.
  if (empty) return { found: true, empty: true, ...empty, answers: distinctAnswers(tried), tried };
  return { found: false, answers: distinctAnswers(tried), tried };
}

/**
 * What ISN said, once per distinct answer, with an example of who it said it to.
 *
 * Thirty-one candidates saying the same thing is one fact, not thirty-one. But
 * one of them saying something different is the whole diagnosis, and averaging
 * them into "nothing worked" would throw it away.
 */
export function distinctAnswers(tried) {
  const byText = new Map();
  for (const t of tried) {
    const text = t.said || t.error || (t.ok ? 'answered with an empty list' : 'no answer');
    if (!byText.has(text)) byText.set(text, { text, paths: [], count: 0 });
    const e = byText.get(text);
    e.count++;
    if (e.paths.length < 2) e.paths.push(t.path);
  }
  return [...byText.values()].sort((a, b) => a.count - b.count);   // the odd one out first
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
export async function pullEvents(client,
  { get, list, describe = () => null, now = new Date(), force = false } = {}) {
  const conn = (await client.query(
    `SELECT events_path, events_kind, events_count, events_checked_at
       FROM isn_connection LIMIT 1`)).rows[0] || {};

  // Hunting through thirty candidates is fine when somebody asked for it and
  // wasteful every hour forever. A press of the button always looks; the
  // schedule waits a while before looking again.
  const lookedRecently = conn.events_checked_at
    && now - new Date(conn.events_checked_at) < 6 * 3600 * 1000;
  if (!force && !Number(conn.events_count) && lookedRecently) {
    return { found: false, skipped: true, checkedAt: conn.events_checked_at, written: 0 };
  }

  // Use the path that answered last time; only go looking if there is none.
  // A remembered path is only worth reusing if it had something to say. One
  // that answered empty gets re-discovered, in case it was the range it wanted.
  let found = conn.events_path && Number(conn.events_count) > 0
    ? { found: true, path: conn.events_path, kind: conn.events_kind || 'events' }
    : await discoverEvents(get, list, describe, { zip: await busiestZip(client) });

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
            events_checked_at = $3, events_note = $4, events_count = $5`,
    [found.path, found.kind, now,
     // What it found, and — separately — what this endpoint can never tell us.
     // The second is true however many it returned, so it is not folded into
     // the first.
     (events.length
       ? `${events.length} from ${found.path}`
       // ISN explained itself. Whatever it said beats anything guessed here,
       // and where the candidates disagreed that difference leads first.
       : `Tried ${(found.answers || []).reduce((a, x) => a + x.count, 0) || 1} ways in; none `
         + 'returned any events. '
         + (found.answers || []).map((a) =>
             `${a.paths[0]}${a.count > 1 ? ` and ${a.count - 1} more` : ''} — "${a.text}"`)
           .slice(0, 4).join(' · ')
         + (() => {
             // An endpoint that echoed its own parameters back has told us what
             // to send it, which beats anything guessable from here.
             const asked = (found.tried || []).filter((x) => x.wants?.length);
             return asked.length
               ? ` · ${asked[0].path} takes: ${asked[0].wants.join(', ')}`
               : '';
           })())
     + (found.kind === 'slots'
       ? ' Availability only, so a block shows with no reason against it.'
       : ''),
     events.length]);

  return {
    found: true, path: found.path, kind: found.kind,
    read: rows.length, written,
    unmatched: events.filter((e) => !e.employee_id).length,
  };
}

/**
 * A postcode the branch actually works in.
 *
 * /availableslots wants one, and the honest source is the orders already
 * synced rather than a number typed into the code — a branch that moves keeps
 * working without anybody remembering this exists.
 */
async function busiestZip(client) {
  try {
    const { rows } = await client.query(
      `SELECT property_zip AS zip FROM isn_orders
        WHERE property_zip IS NOT NULL AND property_zip <> ''
        GROUP BY property_zip ORDER BY count(*) DESC LIMIT 1`);
    return rows[0]?.zip || null;
  } catch {
    return null;      // a diagnostic must not fail on the way to diagnosing
  }
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


// ---------------------------------------------------------- availability

/**
 * When each inspector could take work.
 *
 * The documented calendar endpoint wants an inspector uuid and answers with
 * the windows they are free — a booking question, asked one person at a time.
 * It cannot say why somebody is unavailable, so nothing here pretends to.
 *
 * The guard that matters: an inspector whose whole window comes back empty is
 * treated as unknown, not as unavailable every day. Zero slots across sixty
 * days almost certainly means the question was wrong for them — no service
 * match, no zip coverage — and shading two months of somebody's calendar on
 * that would be the confident kind of wrong.
 */
export async function pullAvailability(client, { get, now = new Date(), daysahead = 60 } = {}) {
  const zip = await busiestZip(client);
  const { rows: people } = await client.query(
    `SELECT id, full_name, isn_user_id FROM employees
      WHERE status = 'Active' AND isn_user_id IS NOT NULL`);
  if (!people.length) return { asked: 0, withSlots: 0, days: 0, note: 'nobody is linked to ISN yet' };

  const key = (d) => new Intl.DateTimeFormat('en-CA',
    { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

  let withSlots = 0;
  let days = 0;
  const failures = [];

  for (const p of people) {
    const path = `/calendar/availableslots?inspector=${encodeURIComponent(p.isn_user_id)}`
      + `&offset=0&daysahead=${daysahead}${zip ? `&zip=${encodeURIComponent(zip)}` : ''}`;
    let payload;
    try {
      payload = await get(path);
    } catch (e) {
      failures.push(`${p.full_name}: ${String(e.message).slice(0, 90)}`);
      continue;
    }

    const slots = Array.isArray(payload?.slots) ? payload.slots : [];
    if (!slots.length) {
      // Unknown, not unavailable. Anything already stored for them is cleared
      // so a stale yes does not outlive the question that produced it.
      failures.push(`${p.full_name}: no slots at all${apiMessage(payload) ? ` (${apiMessage(payload)})` : ''}`);
      await client.query(`DELETE FROM isn_availability WHERE employee_id = $1`, [p.id]);
      continue;
    }
    withSlots++;

    const byDay = new Map();
    for (const sl of slots) {
      const at = sl?.start ? new Date(sl.start) : null;
      if (!at || Number.isNaN(at.getTime())) continue;
      const d = key(at);
      byDay.set(d, (byDay.get(d) || 0) + 1);
    }

    await client.query(`DELETE FROM isn_availability WHERE employee_id = $1`, [p.id]);
    for (const [day, n] of byDay) {
      await client.query(
        `INSERT INTO isn_availability (employee_id, day, slots, pulled_at)
         VALUES ($1, $2::date, $3, $4)
         ON CONFLICT (employee_id, day) DO UPDATE SET slots = EXCLUDED.slots,
                                                     pulled_at = EXCLUDED.pulled_at`,
        [p.id, day, n, now]);
      days++;
    }
  }

  return {
    asked: people.length, withSlots, days, zip,
    // Named rather than counted: an inspector the question does not work for
    // is a person whose week will look unknown, and somebody should know why.
    failures: failures.slice(0, 6),
  };
}
