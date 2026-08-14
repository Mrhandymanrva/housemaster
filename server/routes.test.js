/** Run with: node server/routes.test.js
 *
 * A route went missing and nothing said so.
 *
 * Moving the workbook block above the list route meant deleting it from where
 * it used to be, and the delete ran from a helper's comment to the next banner
 * — which swallowed the list, the single record, create, update and delete on
 * the way past. The server started cleanly, the tests all passed, and every
 * Records screen answered 404 with no message, because no route matched at all.
 *
 * The harness did not catch it either: it stubs /api/records/:entity itself, so
 * it was answering for routes that no longer existed.
 *
 * This is the check that would have. It reads the routers as Express sees them
 * and compares against what the app is supposed to serve, so a route that
 * disappears fails here rather than in somebody's browser.
 */
import assert from 'node:assert/strict';
import records from './routes/records.js';
import ops from './routes/ops.js';
import isn from './routes/isn.js';
import auth from './routes/auth.js';
import users from './routes/users.js';
import radon from './routes/radon.js';
import attachments from './routes/attachments.js';
import install from './routes/install.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

/** What a router actually serves, the way Express has it. */
const served = (router) => {
  const out = new Set();
  for (const layer of router.stack) {
    if (!layer.route) continue;
    for (const m of Object.keys(layer.route.methods)) {
      out.add(`${m.toUpperCase()} ${layer.route.path}`);
    }
  }
  return out;
};

const has = (router, ...paths) => {
  const got = served(router);
  for (const p of paths) {
    assert.ok(got.has(p), `${p} is not served — got:\n    ${[...got].sort().join('\n    ')}`);
  }
};

console.log('\nrecords');

t('serves the whole of a records screen, not just the clever parts', () => {
  // The five that went missing. Without them there is no list, no opening a
  // row, and no way to add, change or remove anything.
  has(records,
    'GET /:entity',
    'GET /:entity/:id',
    'POST /:entity',
    'PATCH /:entity/:id',
    'DELETE /:entity/:id');
});

t('still serves the catalog, the workbook and the paste importer', () => {
  has(records,
    'GET /catalog',
    'GET /workbook', 'POST /workbook',
    'POST /:entity/import',
    'GET /:entity/_options/list');
});

t('puts its fixed paths ahead of the wildcard that would swallow them', () => {
  // /catalog and /workbook are entity names as far as /:entity is concerned.
  // Registered after it, they would answer "no screen called workbook".
  const order = [...served(records)];
  const at = (p) => order.indexOf(p);
  assert.ok(at('GET /catalog') < at('GET /:entity'), 'catalog before the wildcard');
  assert.ok(at('GET /workbook') < at('GET /:entity'), 'workbook before the wildcard');
  assert.ok(at('POST /workbook') < at('POST /:entity'), 'workbook upload before create');
});

t('only worries about order where two patterns could match the same path', () => {
  // POST /:entity is one segment, so /vehicles/import cannot match it however
  // they are ordered — a differing segment count is its own protection. What
  // needs the order is a literal against a wildcard at the same depth, which
  // is the check above. This pins the reasoning so the next person does not
  // reorder them on a hunch.
  const depth = (p) => p.split(' ')[1].split('/').filter(Boolean).length;
  assert.equal(depth('POST /:entity'), 1);
  assert.equal(depth('POST /:entity/import'), 2);
  assert.equal(depth('GET /catalog'), depth('GET /:entity'), 'these two do collide');
  assert.equal(depth('GET /workbook'), depth('GET /:entity'), 'and so do these');
});

console.log('\nthe rest of the app');

t('ops serves the screens that hang off it', () => {
  has(ops, 'GET /dashboard', 'GET /week', 'GET /calendar', 'GET /unscheduled', 'GET /money',
    'GET /field/config', 'GET /field/today', 'GET /field/equipment',
    'GET /field/kit-claim', 'POST /field/kit-claim',
    'GET /field/jobs', 'GET /field/radon-jobs');
});

t('isn serves its link and its diagnostics', () => {
  has(isn, 'GET /status', 'POST /sync', 'PATCH /connection',
    'GET /probe', 'GET /order-lookup', 'GET /revenue-check',
    'GET /roster', 'POST /roster/adopt');
});

t('the ways in and out are all there', () => {
  has(auth, 'GET /setup', 'POST /setup', 'POST /login');
  has(users, 'GET /', 'POST /', 'PATCH /:id', 'POST /:id/password');
  has(radon, 'GET /qa-status', 'PATCH /qa-rule');
  has(attachments, 'GET /:id');
  has(install, 'GET /', 'GET /qr.svg', 'GET /qr.png');
});

console.log('\nnothing answers without saying who is asking');

t('every route but the install sheet is behind requireAuth', () => {
  // The install page is deliberately open — somebody with no account yet is
  // exactly who needs it. Everything else has a gate, and a route that lost
  // one would be a worse bug than a route that went missing.
  for (const [name, router] of [['records', records], ['ops', ops], ['isn', isn],
    ['users', users], ['radon', radon], ['attachments', attachments]]) {
    for (const layer of router.stack) {
      if (!layer.route) continue;
      const names = layer.route.stack.map((h) => h.name);
      assert.ok(names.some((n) => /requireAuth|bound requireAuth/.test(n)),
        `${name} ${layer.route.path} has no requireAuth: ${names.join(', ')}`);
    }
  }
});

console.log(`\n${pass} checks passed\n`);
