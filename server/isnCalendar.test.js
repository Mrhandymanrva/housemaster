/** Run with: node server/isnCalendar.test.js
 *
 * Blocked time, read out of a calendar nobody has documentation for.
 *
 * /event/33398 answers 404 and the only calendar path in the docs is
 * availableslots, so this code cannot be written against a spec — it asks the
 * candidates in turn, keeps the first that answers, and recognises fields by
 * the shapes an API of this kind tends to use. That makes the interesting
 * tests the awkward ones: a payload with the person only in the title, a block
 * with no end, one that names nobody at all, and a path that stops answering.
 */
import assert from 'node:assert/strict';
import {
  normalizeEvent, nameFromTitle, reasonOf, daysCovered, discoverEvents, pullEvents,
  apiMessage, distinctAnswers, wantsParams, pullAvailability, isRefusal, EVENT_PATHS,
} from './integrations/isnCalendar.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const PEOPLE = {
  byIsnId: new Map([['usr-9', { employeeId: 'emp-1', name: 'Brian Slazyk' }]]),
  byName: new Map([['brian slazyk', { employeeId: 'emp-1', name: 'Brian Slazyk' }]]),
};

console.log('\nreading one event');

t('takes the person from a real field when there is one', () => {
  const e = normalizeEvent({ id: 1, title: 'Off', userId: 'usr-9', start: '2026-08-13T13:00:00Z' }, PEOPLE);
  assert.equal(e.employee_id, 'emp-1');
  assert.equal(e.matchedBy, 'id');
});

t('falls back to the name ISN writes into the title', () => {
  // The shape from the screenshot: "Off (Brian Slazyk)", no user field at all.
  const e = normalizeEvent({ id: 2, title: 'Off (Brian Slazyk)', start: '2026-08-13T13:00:00Z' }, PEOPLE);
  assert.equal(e.employee_id, 'emp-1');
  assert.equal(e.matchedBy, 'title');
  assert.equal(e.reason, 'Off', 'and the name comes off the reason, since the row says who');
});

t('prefers the field over the title when they disagree', () => {
  // A title is somebody's typing; a user id is the system's own answer.
  const e = normalizeEvent(
    { id: 3, title: 'Cover for Randy (Randy Lima)', userId: 'usr-9' }, PEOPLE);
  assert.equal(e.employee_id, 'emp-1');
  assert.equal(e.matchedBy, 'id');
});

t('does not read a parenthesis that is not a person', () => {
  assert.equal(nameFromTitle('Blocked (2 hours)'), null);
  assert.equal(nameFromTitle('Off'), null);
  assert.equal(nameFromTitle('Hold (for the Wilson job next week please)'), null);
  assert.equal(nameFromTitle('Off (Brian Slazyk)'), 'Brian Slazyk');
});

t('keeps the reason readable when there is no name on it', () => {
  assert.equal(reasonOf('Office closed'), 'Office closed');
  assert.equal(reasonOf('back injury (Randy Lima)'), 'back injury');
});

t('leaves an event nobody can be matched to unattached, not guessed', () => {
  const e = normalizeEvent({ id: 4, title: 'Office closed', start: '2026-08-13T13:00:00Z' }, PEOPLE);
  assert.equal(e.employee_id, null);
  assert.equal(e.matchedBy, null);
});

t('refuses a payload with nothing to key it by', () => {
  assert.equal(normalizeEvent({ title: 'Off' }, PEOPLE), null);
});

t('treats a block with no end as the whole day', () => {
  const e = normalizeEvent({ id: 5, title: 'Off', start: '2026-08-13T13:00:00Z' }, PEOPLE);
  assert.equal(e.all_day, true);
  assert.equal(e.ends_at, null);
});

t('reads whatever the field happens to be called', () => {
  // Nothing here can be checked against a spec, so the names are matched loosely.
  for (const raw of [
    { eventId: 9, subject: 'Off', startDateTime: '2026-08-13T13:00:00Z' },
    { ID: 9, Name: 'Off', START: '2026-08-13T13:00:00Z' },
    { id: 9, description: 'Off', datetime: '2026-08-13T13:00:00Z' },
  ]) {
    const e = normalizeEvent(raw, PEOPLE);
    assert.equal(e.isn_event_id, '9', JSON.stringify(raw));
    assert.equal(e.reason, 'Off', JSON.stringify(raw));
    assert.ok(e.starts_at instanceof Date, JSON.stringify(raw));
  }
});

console.log('\nwhich days it covers');

t('covers every day between the ends', () => {
  assert.deepEqual(
    daysCovered({ starts_at: new Date('2026-08-12T13:00:00Z'), ends_at: new Date('2026-08-14T20:00:00Z') }),
    ['2026-08-12', '2026-08-13', '2026-08-14']);
});

t('is one day when there is no end', () => {
  assert.deepEqual(daysCovered({ starts_at: new Date('2026-08-12T13:00:00Z') }), ['2026-08-12']);
});

t('does not repeat or drop a day across a clock change', () => {
  const days = daysCovered({
    starts_at: new Date('2026-10-31T13:00:00Z'), ends_at: new Date('2026-11-03T13:00:00Z') });
  assert.deepEqual(days, ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']);
  assert.equal(new Set(days).size, days.length);
});

console.log('\nwhen ISN explains itself');

t('reads the message out of an error envelope', () => {
  // /events answers 200 with { status, message }. That is not an empty
  // calendar, it is the API saying what it wants, and it beats any guess made
  // from this side.
  assert.equal(apiMessage({ status: 'error', message: 'Missing required parameter: startdate' }),
    'error: Missing required parameter: startdate');
  assert.equal(apiMessage({ status: 404, message: 'No method by that name' }),
    '404: No method by that name');
});

t('says nothing about a body that is not an explanation', () => {
  assert.equal(apiMessage({ status: 'ok' }), null, 'no message to read');
  assert.equal(apiMessage({ events: [], total: 0 }), null, 'a genuinely empty list');
  assert.equal(apiMessage([]), null);
  assert.equal(apiMessage(null), null);
});

t('reads an envelope that echoed its own parameters back', () => {
  // /availableslots answers { status, message, count, zip, daysahead, offset }.
  // Six keys and no records — a three-key limit hid the one sentence saying
  // what it wanted.
  const slots = { status: 'error', message: 'zip is required', count: 0,
    zip: '', daysahead: 0, offset: null };
  assert.equal(apiMessage(slots), 'error: zip is required');
  assert.deepEqual(wantsParams(slots), ['zip', 'daysahead', 'offset'],
    'and the keys that are not status or count are the question it takes');
});

t('will not print a body big enough to be carrying records', () => {
  // describeShape never prints values, because an order carries a client's
  // name, phone and address. This is the one exception to that, so it stays
  // narrow enough that it can only ever be an error envelope.
  // Nesting is what separates an envelope from a payload: records arrive as
  // arrays and objects, and only the message is ever printed anyway.
  assert.equal(apiMessage({ status: 'ok', message: 'here you go',
    orders: [{ client: 'Jane Doe', address: '19 Cary St' }] }), null, 'that is a payload');
  assert.equal(apiMessage({ status: 'ok', message: 'x', client: { name: 'Jane' } }), null);
  // But an empty one carries nothing, and refusing it would throw away the
  // sentence explaining why it is empty — which is the whole question.
  assert.equal(apiMessage({ status: 'error', message: 'no services match', slots: [] }),
    'error: no services match');
});

t('keeps a runaway message to a readable length', () => {
  // It goes on a settings screen, not into a log file.
  assert.ok(apiMessage({ status: 'e', message: 'x'.repeat(400) }).length <= 240);
});

console.log('\nfinding the calendar');

const listOf = (payload) => (Array.isArray(payload) ? payload : payload?.events || []);

await ta('keeps the first path that answers, best first', async () => {
  const asked = [];
  const get = async (path) => {
    asked.push(path);
    if (path === '/events') throw new Error('ISN GET /events → 404');
    if (path === '/calendar/events') return { events: [{ id: 1 }] };
    throw new Error('should not have got this far');
  };
  const out = await discoverEvents(get, listOf);
  assert.equal(out.found, true);
  assert.equal(out.path, '/calendar/events');
  assert.deepEqual(asked, ['/events', '/calendar/events']);
});

t('reports each distinct answer once, the odd one out first', () => {
  // Thirty candidates saying the same thing is one fact. One of them saying
  // something different is the whole diagnosis, and it must not be buried
  // under the majority.
  const out = distinctAnswers([
    { path: '/events', ok: true, said: 'error: missing or invalid action specified' },
    { path: '/events?action=list', ok: true, said: 'error: missing or invalid action specified' },
    { path: '/events?action=getall', ok: true, said: 'error: no permission for that action' },
    { path: '/calendar', ok: false, error: 'ISN GET /calendar → 404' },
  ]);
  assert.equal(out[0].text, 'error: no permission for that action', 'the one that differed leads');
  assert.equal(out[out.length - 1].count, 2, 'and the chorus is folded into one line');
  assert.ok(out.every((a) => a.paths.length <= 2), 'with an example, not every path');
});

t('asks with an action, because ISN said it wanted one', () => {
  // "missing or invalid action specified" is the whole reason this list is not
  // just three nouns. The bare paths stay first — they cost one call to rule
  // out — and the verbs follow.
  const paths = EVENT_PATHS.map((p) => p.path);
  assert.deepEqual(paths.slice(0, 3), ['/events', '/calendar/events', '/calendar']);
  assert.ok(paths.includes('/events?action=list'));
  assert.ok(paths.some((p) => /action=/.test(p) && /startdate=/.test(p)), 'and one with a range');
  assert.equal(EVENT_PATHS[EVENT_PATHS.length - 1].kind, 'slots', 'availability is the last resort');
});

await ta('will not adopt a path that refused it', async () => {
  // What actually happened: every candidate answered 200 with
  // { status: "error", message: "missing or invalid action specified" }, the
  // first was kept for having answered at all, and Settings then reported
  // "Reading the calendar from /events" about an endpoint that had said
  // thirty-three times that there is no calendar there. Worse, holding a path
  // made the week grid think blocked time was known, which hid the
  // availability that does work.
  const out = await discoverEvents(
    async () => ({ status: 'error', message: 'missing or invalid action specified' }), listOf);
  assert.equal(out.found, false, 'a refusal is not a find');
  assert.ok(!out.path, 'and nothing is remembered');
  assert.equal(out.answers[0].text, 'error: missing or invalid action specified',
    'but what it said is kept');
});

await ta('still keeps a path that answered with a genuinely empty calendar', async () => {
  // The other half of the rule. Nothing booked is a real answer from a real
  // endpoint, and throwing it away would send the app hunting all over again
  // every time the week happens to be quiet.
  const out = await discoverEvents(async () => ({ events: [], total: 0 }), listOf);
  assert.equal(out.found, true);
  assert.equal(out.empty, true);
  assert.equal(out.path, '/events');
});

t('reads an error envelope as a refusal, and an empty list as an answer', () => {
  assert.equal(isRefusal({ status: 'error', message: 'missing or invalid action specified' }), true);
  assert.equal(isRefusal({ status: 'ERROR', message: 'x' }), true, 'however it is cased');
  assert.equal(isRefusal({ error: 'no such method' }), true, 'or spelled');
  assert.equal(isRefusal({ status: 'ok', events: [] }), false, 'nothing booked is not a refusal');
  assert.equal(isRefusal({ events: [] }), false, 'and neither is saying nothing at all');
  assert.equal(isRefusal({ error: '' }), false, 'an empty error field claims nothing');
  assert.equal(isRefusal([]), false);
  assert.equal(isRefusal(null), false);
});

await ta('says so when nothing answers, and what each one said', async () => {
  const out = await discoverEvents(async (p) => { throw new Error(`${p} → 404`); }, listOf);
  assert.equal(out.found, false);
  assert.equal(out.tried.length, EVENT_PATHS.length);
  assert.ok(out.tried.every((x) => x.ok === false && /404/.test(x.error)));
});

console.log('\nwriting it down');

function db(rows = {}) {
  const seen = [];
  return {
    seen,
    async query(text, params) {
      seen.push({ text: text.replace(/\s+/g, ' ').trim(), params: params || [] });
      if (/FROM isn_connection/.test(text)) return { rows: [rows.conn || {}] };
      if (/FROM employees/.test(text)) return { rows: rows.people || [] };
      return { rows: [] };
    },
  };
}

await ta('writes what it read and remembers the path that worked', async () => {
  const c = db({ people: [{ id: 'emp-1', full_name: 'Brian Slazyk', isn_user_id: 'usr-9' }] });
  const out = await pullEvents(c, {
    get: async (p) => (p === '/events' ? [{ id: 1, title: 'Off (Brian Slazyk)', start: '2026-08-13T13:00:00Z' }] : (() => { throw new Error('404'); })()),
    list: listOf,
    now: new Date('2026-08-11T15:00:00Z'),
  });
  assert.equal(out.found, true);
  assert.equal(out.written, 1);
  assert.ok(c.seen.some((x) => /INSERT INTO isn_events/.test(x.text)));
  assert.ok(c.seen.some((x) => /UPDATE isn_connection SET events_path/.test(x.text)));
});

await ta('clears out what the calendar no longer mentions', async () => {
  // Somebody cancels their leave. Merging would leave them marked off for a
  // holiday they did not take.
  const c = db({ people: [] });
  await pullEvents(c, {
    get: async () => [{ id: 1, title: 'Off', start: '2026-08-13T13:00:00Z' }],
    list: listOf,
    now: new Date('2026-08-11T15:00:00Z'),
  });
  const swept = c.seen.find((x) => /DELETE FROM isn_events/.test(x.text));
  assert.ok(swept, 'anything not seen in this pull goes');
  assert.match(swept.text, /last_pulled_at < \$1/);
});

await ta('writes down the finding, not the working out', async () => {
  // Settings showed "Reading the calendar from /events. Tried 33 ways in..." —
  // a list of paths where a conclusion should be. What somebody needs to know
  // is that ISN has no Events and what the app does instead.
  const c = db({ people: [] });
  const out = await pullEvents(c, {
    get: async () => ({ status: 'error', message: 'missing or invalid action specified' }),
    list: listOf, now: new Date('2026-08-11T15:00:00Z'), force: true,
  });
  assert.equal(out.found, false);
  const wrote = c.seen.find((x) => /UPDATE isn_connection SET events_path = NULL/.test(x.text));
  assert.ok(wrote, 'the path is cleared rather than left pointing at a refusal');
  assert.match(wrote.text, /events_count = 0/, 'and the count with it');
  const note = wrote.params[1];
  assert.match(note, /no calendar endpoint/i);
  assert.match(note, /missing or invalid action specified/, "in ISN's own words");
  assert.match(note, /never what is stopping them/, 'and what is used instead');
});

await ta('does not hunt through thirty candidates every hour', async () => {
  // A fruitless search is fine when somebody asked for it and wasteful on a
  // timer. The schedule waits; the button always looks.
  const c = db({ conn: { events_count: 0, events_checked_at: '2026-08-11T14:00:00Z' }, people: [] });
  const asked = [];
  const out = await pullEvents(c, {
    get: async (p) => { asked.push(p); throw new Error('404'); },
    list: listOf, now: new Date('2026-08-11T15:00:00Z'),
  });
  assert.equal(out.skipped, true);
  assert.equal(asked.length, 0, 'nothing was asked');

  const forced = await pullEvents(c, {
    get: async (p) => { asked.push(p); throw new Error('404'); },
    list: listOf, now: new Date('2026-08-11T15:00:00Z'), force: true,
  });
  assert.equal(forced.skipped, undefined);
  assert.ok(asked.length > 3, 'a press of the button looks anyway');
});

await ta('looks again once enough time has gone by', async () => {
  const c = db({ conn: { events_count: 0, events_checked_at: '2026-08-10T14:00:00Z' }, people: [] });
  let asked = 0;
  await pullEvents(c, {
    get: async () => { asked++; throw new Error('404'); },
    list: listOf, now: new Date('2026-08-11T15:00:00Z'),
  });
  assert.ok(asked > 3, 'a day later it tries again on its own');
});

await ta('uses the remembered path instead of hunting again', async () => {
  const asked = [];
  const c = db({ conn: { events_path: '/calendar/events', events_kind: 'events', events_count: 3 }, people: [] });
  await pullEvents(c, {
    get: async (p) => { asked.push(p); return []; },
    list: listOf,
    now: new Date('2026-08-11T15:00:00Z'),
  });
  assert.deepEqual(asked, ['/calendar/events'], 'one call, not five');
});

await ta('says a remembered path has stopped answering rather than going quiet', async () => {
  const c = db({ conn: { events_path: '/events', events_kind: 'events', events_count: 2 }, people: [] });
  const out = await pullEvents(c, {
    get: async () => { throw new Error('ISN GET /events → 500'); },
    list: listOf,
    now: new Date('2026-08-11T15:00:00Z'),
  });
  assert.equal(out.written, 0);
  assert.match(out.error, /500/);
  const note = c.seen.find((x) => /events_note/.test(x.text));
  assert.match(String(note.params[1]), /stopped answering/);
});

await ta('records that availability cannot say why somebody is blocked', async () => {
  const c = db({ people: [] });
  const out = await pullEvents(c, {
    get: async (p) => (p === '/calendar/availableslots' ? [] : (() => { throw new Error('404'); })()),
    list: listOf,
    now: new Date('2026-08-11T15:00:00Z'),
  });
  assert.equal(out.kind, 'slots');
  const note = c.seen.find((x) => /events_note/.test(x.text));
  // The caveat holds however many it returned — an empty availability reply is
  // still an endpoint that could never have said why.
  assert.match(String(note.params[3]), /Availability only/);
  assert.match(String(note.params[3]), /none returned any events/);
  // and it names what each candidate said, so a lone different answer shows
  assert.match(String(note.params[3]), /availableslots/);
});


console.log('\nasking who is free');

/** A client that answers the two reads pullAvailability makes. */
function availDb(people, byInspector) {
  const wrote = [];
  return {
    wrote,
    async query(text, params) {
      if (/FROM isn_orders/.test(text)) return { rows: [{ zip: '23220' }] };
      if (/FROM employees/.test(text)) return { rows: people };
      if (/INSERT INTO isn_availability/.test(text)) { wrote.push(params); return { rows: [] }; }
      return { rows: [] };
    },
  };
}

const slotAt = (iso) => ({ userid: 'u', start: iso, end: iso });

await ta('asks once per inspector, with the uuid the spec requires', async () => {
  const asked = [];
  const c = availDb([{ id: 'emp-1', full_name: 'B', isn_user_id: 'usr-9' }], {});
  await pullAvailability(c, {
    get: async (p) => { asked.push(p); return { slots: [slotAt('2026-08-10T13:00:00Z')] }; },
  });
  assert.equal(asked.length, 1);
  assert.match(asked[0], /inspector=usr-9/);
  assert.match(asked[0], /daysahead=60/);
  assert.match(asked[0], /zip=23220/, "and a postcode off the branch's own jobs");
});

await ta('records the days somebody could take work', async () => {
  const c = availDb([{ id: 'emp-1', full_name: 'B', isn_user_id: 'usr-9' }], {});
  const out = await pullAvailability(c, {
    get: async () => ({ slots: [
      slotAt('2026-08-10T13:00:00Z'), slotAt('2026-08-10T17:00:00Z'),
      slotAt('2026-08-12T13:00:00Z')] }),
  });
  assert.equal(out.withSlots, 1);
  assert.equal(c.wrote.length, 2, 'two days, not three slots');
  assert.deepEqual(c.wrote.map((w) => w[1]).sort(), ['2026-08-10', '2026-08-12']);
  assert.equal(c.wrote.find((w) => w[1] === '2026-08-10')[2], 2, 'and how many that day');
});

await ta('treats an inspector with no slots at all as unknown, not unavailable', async () => {
  // Sixty days of nothing means the question was wrong for them. Writing that
  // down would shade two months of somebody's calendar on a bad assumption.
  const c = availDb([{ id: 'emp-1', full_name: 'Priya', isn_user_id: 'usr-1' }], {});
  const out = await pullAvailability(c, {
    get: async () => ({ status: 'error', message: 'no services match', slots: [] }),
  });
  assert.equal(out.withSlots, 0);
  assert.equal(c.wrote.length, 0, 'nothing written');
  assert.match(out.failures[0], /Priya/, 'and the person is named, not just counted');
  assert.match(out.failures[0], /no services match/, 'with what ISN said about them');
});

await ta('keeps going when one inspector errors', async () => {
  const c = availDb([
    { id: 'emp-1', full_name: 'A', isn_user_id: 'u1' },
    { id: 'emp-2', full_name: 'B', isn_user_id: 'u2' },
  ], {});
  const out = await pullAvailability(c, {
    get: async (p) => {
      if (/u1/.test(p)) throw new Error('403 Forbidden');
      return { slots: [slotAt('2026-08-10T13:00:00Z')] };
    },
  });
  assert.equal(out.asked, 2);
  assert.equal(out.withSlots, 1, 'the other one still answered');
  assert.match(out.failures[0], /A: 403/);
});

await ta('says so when nobody is linked to ISN', async () => {
  const out = await pullAvailability(availDb([], {}), { get: async () => ({ slots: [] }) });
  assert.equal(out.asked, 0);
  assert.match(out.note, /nobody is linked/);
});

console.log(`\n${pass} checks passed\n`);
