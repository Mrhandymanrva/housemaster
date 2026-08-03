/** ISN sync: status, a manual pull, and the phone's job list. */
import { Router } from 'express';
import { q, tx } from '../lib/db.js';
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

/**
 * Who ISN thinks is doing the work, and who that is here.
 *
 * The credentials are the company's, so every order for every inspector comes
 * down the same pipe. What makes a phone show one tech's day and not the whole
 * office is `employees.isn_user_id` — matched against the inspector on the
 * order as it is saved. Until that is filled in, an order belongs to nobody
 * and no phone counts it.
 *
 * The roster is derived from orders already pulled rather than asked for
 * separately: it needs no extra endpoint, and it can only ever list people who
 * actually have work.
 */
r.get('/inspectors', requireAuth, requireRole('office'), wrap(async (_req, res) => {
  const { rows } = await q(
    `SELECT o.inspector_isn_id,
            max(o.inspector_name)                       AS inspector_name,
            count(*)::int                               AS orders,
            max(o.scheduled_start)                      AS latest_job,
            e.id                                        AS employee_id,
            e.full_name                                 AS employee_name
       FROM isn_orders o
       LEFT JOIN employees e ON e.isn_user_id = o.inspector_isn_id
      WHERE o.inspector_isn_id IS NOT NULL
      GROUP BY o.inspector_isn_id, e.id, e.full_name
      ORDER BY count(*) DESC`
  );
  const staff = await q(
    `SELECT id, full_name, job_title, isn_user_id FROM employees
      WHERE status = 'Active' ORDER BY full_name`
  );
  res.json({
    inspectors: rows,
    unmapped: rows.filter((x) => !x.employee_id).length,
    employees: staff.rows,
  });
}));

/**
 * Tie an ISN inspector to a person here.
 *
 * Orders already pulled are re-pointed in the same breath, so a mapping made
 * today makes last week's work show up rather than only what syncs next.
 */
r.post('/inspectors/link', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  const { isn_user_id, employee_id } = req.body || {};
  if (!isn_user_id) throw bad('Which ISN inspector?');

  const out = await tx(async (c) => {
    // One ISN login belongs to one person. Clear any previous holder first.
    await c.query(`UPDATE employees SET isn_user_id = NULL WHERE isn_user_id = $1`, [isn_user_id]);

    if (employee_id) {
      await c.query(`UPDATE employees SET isn_user_id = $2 WHERE id = $1`, [employee_id, isn_user_id]);
    }
    const touched = await c.query(
      `UPDATE isn_orders SET employee_id = $2 WHERE inspector_isn_id = $1`,
      [isn_user_id, employee_id || null]
    );
    return touched.rowCount;
  });

  res.json({ ok: true, ordersReassigned: out });
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
