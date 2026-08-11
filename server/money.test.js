/** Run with: node server/money.test.js
 *
 * The Money screen's first meeting with a real database was an error banner:
 *
 *   bind message supplies 2 parameters, but prepared statement "" requires 0
 *
 * Two of the overhead queries have no placeholders in them and were being
 * handed the period's two dates anyway. Nothing short of Postgres would say
 * so, and there is no Postgres here — so the report is run against a client
 * that records what it was asked rather than answering it, and every statement
 * is checked for the things a database would have rejected.
 *
 * That check runs over whatever the report issues, so it covers queries added
 * later without anybody remembering to come back here.
 */
import assert from 'node:assert/strict';
import { moneyReport, rollUpServices, OVERHEAD, NOT_COUNTED } from './lib/money.js';
import { periodRange } from './lib/zone.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const AT = new Date('2026-08-11T15:00:00Z');

/** Records what it was asked instead of answering it. */
function recorder(rows = [{}]) {
  const seen = [];
  return {
    seen,
    async query(text, params) { seen.push({ text, params: params || [] }); return { rows }; },
  };
}

const placeholders = (sql) => Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((x) => Number(x[1])));

console.log('\nwhat the database would have refused');

await ta('every statement is given exactly the parameters it declares', async () => {
  const c = recorder();
  await moneyReport(c, periodRange('month', AT), { kinds: [] });
  assert.ok(c.seen.length >= 12, 'the report should be issuing its whole set');
  for (const q of c.seen) {
    const want = placeholders(q.text);
    assert.equal(q.params.length, want,
      `wants ${want}, given ${q.params.length}: ${q.text.replace(/\s+/g, ' ').trim().slice(0, 80)}`);
  }
});

await ta('and that holds for every period, not just the month', async () => {
  for (const p of ['week', 'month', 'quarter', 'year']) {
    const c = recorder();
    await moneyReport(c, periodRange(p, AT), { kinds: [] });
    for (const q of c.seen) assert.equal(q.params.length, placeholders(q.text), `${p}: ${q.text.slice(0, 60)}`);
  }
});

t('the cost queries each say how many dates they take', () => {
  for (const o of OVERHEAD) {
    assert.equal(typeof o.args, 'number', `${o.key} declares args`);
    assert.equal(o.args, placeholders(o.sql), `${o.key} declares what its sql actually uses`);
  }
});

await ta('no placeholder is skipped over', async () => {
  // $1 and $3 with no $2 also fails at bind time, and reads as a typo nobody
  // would spot in a forty-line query.
  const c = recorder();
  await moneyReport(c, periodRange('month', AT), { kinds: [] });
  for (const q of c.seen) {
    const used = new Set([...q.text.matchAll(/\$(\d+)/g)].map((x) => Number(x[1])));
    for (let i = 1; i <= placeholders(q.text); i++) {
      assert.ok(used.has(i), `$${i} missing from ${q.text.replace(/\s+/g, ' ').slice(0, 70)}`);
    }
  }
});

await ta('nothing is interpolated into the sql that should be a parameter', async () => {
  // A date or an id written into the string is both an injection risk and a
  // query the planner has to re-learn every time.
  const c = recorder();
  await moneyReport(c, periodRange('month', AT), { kinds: [] });
  for (const q of c.seen) {
    assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(q.text), `timestamp baked into: ${q.text.slice(0, 70)}`);
  }
});

console.log('\nwhat it reports');

await ta('reads a period from the range it was handed, not from today', async () => {
  const c = recorder();
  const range = periodRange('quarter', AT);
  const out = await moneyReport(c, range, { kinds: [] });
  assert.equal(out.period, 'quarter');
  assert.equal(out.month.start, range.start);
  assert.equal(out.month.end, range.end);
  assert.equal(out.priorWindow.start, range.priorStart);
});

await ta('offers no margin, because it cannot compute one honestly', async () => {
  const out = await moneyReport(recorder(), periodRange('month', AT), { kinds: [] });
  assert.equal(out.margin, null);
  assert.deepEqual(out.overhead.notCounted, NOT_COUNTED);
  assert.ok(NOT_COUNTED.includes('wages and payroll'));
});

await ta('survives a branch with nothing in it', async () => {
  // Day one, before ISN has synced anything: every sum is null, not zero.
  const out = await moneyReport(recorder([{}]), periodRange('month', AT), { kinds: [] });
  assert.equal(out.booked.month, 0);
  assert.equal(out.jobs.radonAttach, null, 'no jobs means no rate, not 0%');
  assert.equal(out.averageTicket.month, null);
  assert.equal(out.month.pace, null, 'nothing to project from');
});

console.log('\nservice lines');

t('counts a job once per service it carried', () => {
  const rows = [{ jobs: 3, booked: '1350.00', radon_jobs: 2, radon_fee: '300.00',
    services: '["Home Inspection","Radon Test"]' }];
  const out = rollUpServices(rows, [{ key: 'mold', label: 'Mold', patterns: ['mold'] }]);
  assert.equal(out.find((l) => l.key === 'inspection').jobs, 3);
  assert.equal(out.find((l) => l.key === 'radon').jobs, 2);
  assert.equal(out.find((l) => l.key === 'radon').fee, 300);
  assert.ok(!out.find((l) => l.key === 'mold'), 'a service nobody sold is not a line');
});

t('does not split a job fee across the lines it appeared on', () => {
  // ISN gives one fee for the whole job. Any split would be invented, so only
  // the line that really has its own figure carries money.
  const out = rollUpServices([{ jobs: 1, booked: '620.00', radon_jobs: 0, radon_fee: '0',
    services: '["Home Inspection","Sewer Scope"]' }], [{ key: 'sewer', label: 'Sewer', patterns: ['sewer'] }]);
  assert.equal(out.find((l) => l.key === 'sewer').booked, 0);
  assert.equal(out.find((l) => l.key === 'inspection').booked, 620);
});

console.log(`\n${pass} checks passed\n`);
