/** ISN sync: status, a manual pull, and the phone's job list. */
import { Router } from 'express';
import { q } from '../lib/db.js';
import { wrap, bad } from '../lib/http.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { syncOnce } from '../integrations/isn.js';

const r = Router();

r.get('/status', requireAuth, wrap(async (_req, res) => {
  const [conn, runs, gaps] = await Promise.all([
    q('SELECT * FROM isn_connection LIMIT 1'),
    q('SELECT * FROM isn_sync_log ORDER BY started_at DESC LIMIT 10'),
    q('SELECT count(*)::int AS n FROM isn_radon_orders_without_sets'),
  ]);
  const c = conn.rows[0] || null;
  res.json({
    connection: c && { ...c, credential_env_var: c.credential_env_var },
    credentialsPresent: !!(process.env.ISN_ACCESS_KEY && process.env.ISN_SECRET_ACCESS_KEY),
    runs: runs.rows,
    radonOrdersWithoutSets: gaps.rows[0].n,
  });
}));

r.post('/sync', requireAuth, requireRole('office'), wrap(async (_req, res) => {
  res.json(await syncOnce({ source: 'manual' }));
}));

r.patch('/connection', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  const allowed = ['company_key', 'service_domain', 'enabled', 'pull_window_days',
                   'auto_create_sets', 'radon_service_match', 'integration_user'];
  const sets = [], vals = [];
  for (const k of allowed) {
    if (req.body[k] !== undefined) { vals.push(req.body[k]); sets.push(`${k} = $${vals.length}`); }
  }
  if (!sets.length) throw bad('Nothing to change.');
  // changing where the ISN lives invalidates the cached endpoint
  if (req.body.company_key || req.body.service_domain) sets.push('rest_url = NULL');
  const { rows } = await q(
    `UPDATE isn_connection SET ${sets.join(', ')}, updated_at = now() RETURNING *`, vals);
  res.json({ connection: rows[0] });
}));

/** Orders that were booked with radon and never got a set placed. */
r.get('/gaps', requireAuth, wrap(async (_req, res) => {
  const { rows } = await q('SELECT * FROM isn_radon_orders_without_sets LIMIT 100');
  res.json({ orders: rows });
}));

/**
 * What the phone pulls on sync: my jobs, already filled in from the order,
 * each carrying the QA answer so the tech knows before leaving the van.
 */
r.get('/my-jobs', requireAuth, wrap(async (req, res) => {
  const who = req.query.employee_id || req.user?.employee_id;
  const [jobs, ledger] = await Promise.all([
    q(`SELECT * FROM field_todays_radon_jobs
        WHERE ($1::uuid IS NULL OR inspector_id = $1)
        ORDER BY scheduled_for NULLS LAST`, [who || null]),
    q('SELECT * FROM radon_device_ledger ORDER BY name'),
  ]);
  res.json({
    jobs: jobs.rows,
    ledger: ledger.rows.map((d) => ({
      equipmentId: d.equipment_id, name: d.name, serial: d.serial_number,
      sequence: d.sequence, interval: d.interval,
    })),
    syncedAt: new Date().toISOString(),
  });
}));

export default r;
