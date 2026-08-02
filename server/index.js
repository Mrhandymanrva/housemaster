import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';

import { pool, q } from './lib/db.js';
import { syncCatalog } from './catalog/sync.js';
import authRoutes from './routes/auth.js';
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
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', async (_req, res) => {
  try {
    await q('SELECT 1');
    res.json({ ok: true, db: 'up', at: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ ok: false, db: 'down', error: e.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/ops', opsRoutes);
app.use('/api/radon', radonRoutes);
app.use('/api/isn', isnRoutes);
app.use('/api/records', recordRoutes);

// serve the built desktop app
const web = path.join(__dirname, '..', 'web', 'dist');
app.use(express.static(web, { maxAge: '1h', index: false }));
app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(web, 'index.html')));

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

const port = process.env.PORT || 8080;
try {
  await migrate();
  await syncCatalog();
  await q('SELECT refresh_compliance()');
  await q('SELECT refresh_compliance_radon()');
  app.listen(port, () => console.log(`HouseMaster Ops listening on ${port}`));
} catch (err) {
  console.error('Startup failed:', err);
  process.exit(1);
}
