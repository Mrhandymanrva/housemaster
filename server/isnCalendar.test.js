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
  normalizeEvent, nameFromTitle, reasonOf, daysCovered, discoverEvents, pullEvents, EVENT_PATHS,
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
  assert.match(String(note.params[3]), /nothing in it/);
});

console.log(`\n${pass} checks passed\n`);
