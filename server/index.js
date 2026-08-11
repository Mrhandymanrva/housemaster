import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';

import { pool, q, describeTarget } from './lib/db.js';
import { secretIsPlaceholder } from './lib/auth.js';
import installRoutes from './routes/install.js';
import { syncCatalog } from './catalog/sync.js';
import { startIsnSchedule } from './isnSchedule.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import attachmentRoutes from './routes/attachments.js';
import recordRoutes from './routes/records.js';
import opsRoutes from './routes/ops.js';
import radonRoutes from './routes/radon.js';
import isnRoutes from './routes/isn.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
// A submission can carry several photos, base64'd, and they are extracted into
// attachments the moment it lands. 2mb turned a three-photo radon set away.
app.use(express.json({ limit: '12mb' }));

app.get('/api/health', async (_req, res) => {
  try {
    await q('SELECT 1');
    res.json({ ok: true, db: 'up', at: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ ok: false, db: 'down', error: e.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/attachments', attachmentRoutes);
app.use('/api/ops', opsRoutes);
app.use('/api/radon', radonRoutes);
app.use('/api/isn', isnRoutes);
app.use('/api/records', recordRoutes);

// ---------------------------------------------------------------- the phone
// Served from the same origin as the API so the app has no CORS to negotiate
// and no second host to configure. The service worker sits at /phone/sw.js,
// which is what scopes it to /phone/ and nothing above it.
const phone = path.join(__dirname, '..', 'field', 'app');

// The duplicate rule lives one directory up because the tests and the desktop
// share it. Serving it inside the phone's scope keeps that single copy —
// the alternative is a build step whose only job is to duplicate one file.
app.get('/phone/qa-guard.js', (_req, res) => {
  res.type('application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(path.join(__dirname, '..', 'field', 'qa-guard.js'));
});

app.use('/phone', express.static(phone, {
  index: 'index.html',
  setHeaders(res, filePath) {
    // The worker and the manifest decide whether a phone ever sees a deploy,
    // so they are always revalidated. Everything else the worker itself caches.
    if (/sw\.js$|\.webmanifest$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    else res.setHeader('Cache-Control', 'public, max-age=3600');
  },
}));
app.get(/^\/phone(\/.*)?$/, (_req, res) => res.sendFile(path.join(phone, 'index.html')));

// How the phone gets there in the first place. Above the desktop app's
// catch-all, which would otherwise answer /install with the React shell.
app.use('/install', installRoutes);

// serve the built desktop app
const web = path.join(__dirname, '..', 'web', 'dist');
app.use(express.static(web, { maxAge: '1h', index: false }));
app.get(/^(?!\/api|\/phone).*/, (_req, res) => res.sendFile(path.join(web, 'index.html')));

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Something went wrong', detail: err.detail });
});

/** Run any .sql in db/migrations that has not been applied yet. */
async function migrate() {
  await q(`CREATE TABLE IF NOT EXISTS schema_migrations (
             filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const dir = path.join(__dirname, '..', 'db', 'migrations');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const done = new Set((await q('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename));
  for (const f of files) {
    if (done.has(f)) continue;
    console.log(`[migrate] ${f}`);
    await pool.query(await readFile(path.join(dir, f), 'utf8'));
    await q('INSERT INTO schema_migrations (filename) VALUES ($1)', [f]);
  }
}

/**
 * Nothing here listens on a port, so a failure at this stage shows up in
 * Railway only as a healthcheck that never answers. Say plainly what was being
 * attempted, so the deploy log names the cause instead of the symptom.
 */
async function preflight() {
  if (process.env.NODE_ENV === 'production' && secretIsPlaceholder()) {
    throw new Error(
      'JWT_SECRET is not set, and in production the built-in fallback is not usable — ' +
      'it is printed in the source. Set JWT_SECRET to 64 random characters and redeploy.'
    );
  }
  if (!process.env.DATABASE_URL) {
    console.warn('[startup] No DATABASE_URL. Falling back to a local postgres.');
  }
  console.log(`[startup] Connecting to ${describeTarget()}`);
  try {
    await q('SELECT 1');
  } catch (err) {
    throw new Error(`Cannot reach ${describeTarget()} — ${err.message}`);
  }
}

const port = process.env.PORT || 8080;
try {
  await preflight();
  await migrate();
  await syncCatalog();
  await q('SELECT refresh_compliance()');
  await q('SELECT refresh_compliance_radon()');
  app.listen(port, () => console.log(`HouseMaster Ops listening on ${port}`));
  // Only once the server is up: a pull that fails must not stop it starting.
  startIsnSchedule();
} catch (err) {
  console.error(`\nStartup failed. ${err.message}\n`);
  process.exit(1);
}
