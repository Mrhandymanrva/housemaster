import { Router } from 'express';
import { q, tx } from '../lib/db.js';
import { wrap, bad, notFound } from '../lib/http.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { getEntity, bustCatalog } from '../catalog/sync.js';

const r = Router();

// ============================================================ dashboard
r.get('/dashboard', requireAuth, wrap(async (_req, res) => {
  await q('SELECT refresh_compliance()');
  await q('SELECT refresh_compliance_radon()');

  const [horizon, buckets, readiness, fleet, lowStock, pending] = await Promise.all([
    q(`SELECT id, title, subject, category, due_date, days_out, state, priority, responsible_name
         FROM compliance_horizon
        WHERE completed_date IS NULL AND due_date <= CURRENT_DATE + 180
        ORDER BY due_date LIMIT 400`),
    q(`SELECT state, count(*)::int AS n FROM compliance_horizon
        WHERE completed_date IS NULL GROUP BY state`),
    q(`SELECT * FROM inspector_readiness ORDER BY licenses_expired DESC, full_name`),
    q(`SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status='Active')::int AS active,
              count(*) FILTER (WHERE registration_expiration < CURRENT_DATE + 30)::int AS reg_soon
         FROM vehicles`),
    q(`SELECT id, item_name, quantity_on_hand, reorder_point, unit_of_measure
         FROM supplies WHERE quantity_on_hand <= reorder_point ORDER BY item_name LIMIT 25`),
    q(`SELECT count(*)::int AS n FROM field_submissions WHERE status = 'pending'`),
  ]);

  res.json({
    horizon: horizon.rows,
    buckets: Object.fromEntries(buckets.rows.map((b) => [b.state, b.n])),
    readiness: readiness.rows,
    fleet: fleet.rows[0],
    lowStock: lowStock.rows,
    pendingFieldSubmissions: pending.rows[0].n,
  });
}));

// =========================================================== compliance
r.get('/compliance', requireAuth, wrap(async (req, res) => {
  const days = Number(req.query.days) || 365;
  const { rows } = await q(
    `SELECT * FROM compliance_horizon
      WHERE due_date <= CURRENT_DATE + $1::int
      ORDER BY due_date`,
    [days]
  );
  res.json({ items: rows });
}));

r.post('/compliance/:id/clear', requireAuth, requireRole('office'), wrap(async (req, res) => {
  const { rows } = await q(
    `UPDATE compliance_items SET completed_date = COALESCE($2::date, CURRENT_DATE)
      WHERE id = $1 RETURNING *`,
    [req.params.id, req.body?.completed_date || null]
  );
  if (!rows[0]) throw notFound();
  res.json({ item: rows[0] });
}));

r.post('/compliance/refresh', requireAuth, wrap(async (_req, res) => {
  const { rows } = await q('SELECT refresh_compliance() AS n');
  res.json({ refreshed: rows[0].n });
}));

// ============================================== field app configuration
r.get('/field/config', requireAuth, wrap(async (req, res) => {
  const mods = await q(
    `SELECT m.*,
            COALESCE(json_agg(DISTINCT a.app_role) FILTER (WHERE a.app_role IS NOT NULL), '[]') AS roles
       FROM field_modules m
       LEFT JOIN field_module_access a ON a.module_id = m.id
      GROUP BY m.id ORDER BY m.sort_order, m.name`
  );
  const forms = await q(
    `SELECT f.*, json_agg(ff.* ORDER BY ff.sort_order) FILTER (WHERE ff.id IS NOT NULL) AS fields
       FROM field_forms f
       LEFT JOIN field_form_fields ff ON ff.form_id = f.id
      WHERE f.active GROUP BY f.id`
  );
  // A select field stores the name of a list, not its contents. Resolve it here
  // or the phone shows an empty picker with no way to know why.
  const choices = (await q(
    `SELECT list_key, value, label FROM lookup_values WHERE active ORDER BY list_key, sort, label`
  )).rows;
  const byList = {};
  for (const c of choices) (byList[c.list_key] ||= []).push({ value: c.value, label: c.label });

  const byModule = {};
  for (const f of forms.rows) {
    byModule[f.module_id] = {
      ...f,
      fields: (f.fields || []).map((ff) =>
        ff.lookup_list ? { ...ff, options: byList[ff.lookup_list] || [] } : ff
      ),
    };
  }
  res.json({
    modules: mods.rows.map((m) => ({ ...m, form: byModule[m.id] || null })),
  });
}));

/**
 * What this person is personally on the hook for — their licences, the van
 * they drive, the equipment signed out to them.
 *
 * The office sees the whole horizon on the desktop. A tech standing at a van
 * needs the few things that stop them working today, so this is filtered to
 * them and cut off at a horizon they can act on.
 */
r.get('/field/reminders', requireAuth, wrap(async (req, res) => {
  const days = Math.min(Number(req.query.days) || 60, 365);
  if (!req.user.employee_id) return res.json({ reminders: [], overdue: 0, soon: 0 });

  const { rows } = await q(
    `SELECT h.id, h.category, h.title, h.subject, h.due_date, h.days_out, h.state, h.priority
       FROM compliance_horizon h
      WHERE h.responsible_id = $1
        AND h.completed_date IS NULL
        AND h.due_date <= CURRENT_DATE + $2::int
      ORDER BY h.due_date`,
    [req.user.employee_id, days]
  );

  res.json({
    reminders: rows,
    overdue: rows.filter((r0) => r0.days_out < 0).length,
    soon: rows.filter((r0) => r0.days_out >= 0).length,
  });
}));

r.patch('/field/modules/:id', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  const allowed = ['name', 'description', 'icon', 'accent', 'enabled', 'sort_order',
    'require_photo', 'require_gps', 'require_signature', 'allow_offline', 'auto_apply', 'target_entity'];
  const entries = Object.entries(req.body).filter(([k]) => allowed.includes(k));
  if (!entries.length) throw bad('Nothing to save');
  const set = entries.map(([k], i) => `"${k}" = $${i + 1}`).join(', ');
  const vals = entries.map(([, v]) => v);
  vals.push(req.params.id);
  const { rows } = await q(
    `UPDATE field_modules SET ${set} WHERE id = $${vals.length} RETURNING *`, vals
  );
  if (!rows[0]) throw notFound();
  res.json({ module: rows[0] });
}));

r.put('/field/forms/:formId/fields', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  const fields = req.body?.fields;
  if (!Array.isArray(fields)) throw bad('Send a fields array');
  await tx(async (c) => {
    await c.query(`DELETE FROM field_form_fields WHERE form_id = $1`, [req.params.formId]);
    for (const [i, f] of fields.entries()) {
      await c.query(
        `INSERT INTO field_form_fields
           (form_id, key, label, input_type, required, help_text, placeholder,
            lookup_list, options, min_value, max_value, visible_if, maps_to_column, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [req.params.formId, f.key, f.label, f.input_type, !!f.required, f.help_text || null,
         f.placeholder || null, f.lookup_list || null, f.options ? JSON.stringify(f.options) : null,
         f.min_value ?? null, f.max_value ?? null, f.visible_if ? JSON.stringify(f.visible_if) : null,
         f.maps_to_column || null, (i + 1) * 10]
      );
    }
    await c.query(`UPDATE field_forms SET version = version + 1 WHERE id = $1`, [req.params.formId]);
  });
  res.json({ ok: true });
}));

// ================================================= field app submissions
/** The phone posts here. client_uuid makes retries after an offline gap safe. */
r.post('/field/submissions', requireAuth, wrap(async (req, res) => {
  const { module_key, client_uuid, payload = {}, target_id, gps, captured_at, device_id } = req.body || {};
  if (!module_key || !client_uuid) throw bad('module_key and client_uuid are required');

  const mod = (await q(`SELECT * FROM field_modules WHERE key = $1 AND enabled`, [module_key])).rows[0];
  if (!mod) throw notFound('That form is not turned on');
  const form = (await q(
    `SELECT * FROM field_forms WHERE module_id = $1 AND active ORDER BY version DESC LIMIT 1`,
    [mod.id]
  )).rows[0];
  if (!form) throw notFound('That form has no active version');

  const existing = await q(`SELECT * FROM field_submissions WHERE client_uuid = $1`, [client_uuid]);
  if (existing.rows[0]) return res.json({ submission: existing.rows[0], duplicate: true });

  const ins = await q(
    `INSERT INTO field_submissions
       (module_id, form_id, client_uuid, submitted_by, employee_id, device_id,
        target_entity, target_id, payload, gps_lat, gps_lng, captured_at, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending') RETURNING *`,
    [mod.id, form.id, client_uuid, req.user.id, req.user.employee_id, device_id || null,
     mod.target_entity, target_id || null, JSON.stringify(payload),
     gps?.lat ?? null, gps?.lng ?? null, captured_at || null]
  );

  let applied = null;
  if (mod.auto_apply) applied = await applySubmission(ins.rows[0].id, req.user.id);
  res.status(201).json({ submission: applied || ins.rows[0] });
}));

r.get('/field/submissions', requireAuth, wrap(async (req, res) => {
  const status = req.query.status || 'pending';
  const { rows } = await q(
    `SELECT s.*, m.name AS module_name, m.key AS module_key, e.full_name AS submitted_by_name
       FROM field_submissions s
       JOIN field_modules m ON m.id = s.module_id
       LEFT JOIN employees e ON e.id = s.employee_id
      WHERE ($1 = 'all' OR s.status = $1)
      ORDER BY s.received_at DESC LIMIT 200`,
    [status]
  );
  res.json({ submissions: rows });
}));

r.post('/field/submissions/:id/apply', requireAuth, requireRole('office'), wrap(async (req, res) => {
  res.json({ submission: await applySubmission(req.params.id, req.user.id) });
}));

r.post('/field/submissions/:id/reject', requireAuth, requireRole('office'), wrap(async (req, res) => {
  const { rows } = await q(
    `UPDATE field_submissions SET status='rejected', reviewed_by=$2, review_note=$3
      WHERE id=$1 RETURNING *`,
    [req.params.id, req.user.id, req.body?.note || null]
  );
  res.json({ submission: rows[0] });
}));

/**
 * Write a submission back onto the real record. Only the fields the admin
 * mapped to a column in Setup → Field App are copied over; everything else
 * stays on the submission as history.
 */
async function applySubmission(id, userId) {
  return tx(async (c) => {
    const sub = (await c.query(`SELECT * FROM field_submissions WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!sub) throw notFound();
    if (sub.status === 'applied') return sub;

    let wroteTo = sub.target_id;

    if (sub.target_entity) {
      const entity = await getEntity(sub.target_entity);
      const mapped = (await c.query(
        `SELECT key, maps_to_column FROM field_form_fields
          WHERE form_id = $1 AND maps_to_column IS NOT NULL`,
        [sub.form_id]
      )).rows;

      const valid = new Set(entity?.fields.map((f) => f.column_name) || []);
      const cols = [];
      const vals = [];
      for (const m of mapped) {
        if (!valid.has(m.maps_to_column)) continue;
        if (sub.payload[m.key] === undefined || sub.payload[m.key] === '') continue;
        vals.push(sub.payload[m.key]);
        cols.push(m.maps_to_column);
      }

      // A submission that names an existing record edits it — a van check puts
      // the odometer on the van. One that names none is reporting something
      // that happened, so it becomes a new record: a service visit, not an edit
      // to the van.
      if (cols.length && sub.target_id) {
        const sets = cols.map((col, i) => `"${col}" = $${i + 1}`).join(', ');
        vals.push(sub.target_id);
        await c.query(
          `UPDATE "${entity.table_name}" SET ${sets} WHERE id = $${vals.length}`, vals
        );
      } else if (cols.length) {
        const names = cols.map((col) => `"${col}"`).join(', ');
        const ph = cols.map((_, i) => `$${i + 1}`).join(', ');
        const made = await c.query(
          `INSERT INTO "${entity.table_name}" (${names}) VALUES (${ph}) RETURNING id`, vals
        );
        wroteTo = made.rows[0].id;
        await c.query(`UPDATE field_submissions SET target_id = $2 WHERE id = $1`, [id, wroteTo]);
      }
    }

    const out = (await c.query(
      `UPDATE field_submissions SET status='applied', applied_at=now(), reviewed_by=$2
        WHERE id=$1 RETURNING *`,
      [id, userId]
    )).rows[0];

    await c.query(
      `INSERT INTO audit_log (user_id, entity, entity_id, action, diff)
       VALUES ($1,$2,$3,'field_submit',$4)`,
      [userId, sub.target_entity, wroteTo, JSON.stringify(sub.payload)]
    );
    await c.query('SELECT refresh_compliance()');
    return out;
  });
}

// ================================================================ setup
r.get('/lookups', requireAuth, wrap(async (_req, res) => {
  const { rows } = await q(
    `SELECT list_key, value, label, color FROM lookup_values
      WHERE active ORDER BY list_key, sort, label`
  );
  const out = {};
  for (const v of rows) (out[v.list_key] ||= []).push(v);
  res.json({ lookups: out });
}));

r.post('/lookups', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  const { list_key, value, label, color, sort } = req.body || {};
  if (!list_key || !value) throw bad('A list and a value are required');
  const { rows } = await q(
    `INSERT INTO lookup_values (list_key, value, label, color, sort)
     VALUES ($1,$2,$3,$4,COALESCE($5,100))
     ON CONFLICT (list_key, value) DO UPDATE SET label=EXCLUDED.label, color=EXCLUDED.color, active=true
     RETURNING *`,
    [list_key, value, label || value, color || null, sort]
  );
  bustCatalog(); // the catalog carries these choices, so it is now stale
  res.json({ value: rows[0] });
}));

// Every list with everything in it, switched-off values included, plus the
// screens each one feeds — so it is clear what a change is about to affect.
r.get('/lookup-lists', requireAuth, requireRole('admin'), wrap(async (_req, res) => {
  const { rows } = await q(
    `SELECT l.key, l.label, l.description,
            COALESCE(u.used_by, '{}') AS used_by,
            COALESCE(json_agg(json_build_object(
              'id', v.id, 'value', v.value, 'label', v.label,
              'color', v.color, 'sort', v.sort, 'active', v.active
            ) ORDER BY v.sort, v.label) FILTER (WHERE v.id IS NOT NULL), '[]') AS values
       FROM lookup_lists l
       LEFT JOIN lookup_values v ON v.list_key = l.key
       LEFT JOIN LATERAL (
         SELECT array_agg(DISTINCT e.label_plural || ' — ' || f.label) AS used_by
           FROM meta_fields f
           JOIN meta_entities e ON e.key = f.entity_key
          WHERE f.lookup_list = l.key
       ) u ON true
      GROUP BY l.key, l.label, l.description, u.used_by
      ORDER BY l.label`
  );
  res.json({ lists: rows });
}));

// Rename, reorder, or switch a choice off. Switching off keeps it out of the
// dropdowns while leaving records that already use it readable.
r.patch('/lookups/:id', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  const allowed = ['label', 'color', 'sort', 'active'];
  const entries = Object.entries(req.body).filter(([k]) => allowed.includes(k));
  if (!entries.length) throw bad('Nothing to change');

  const set = entries.map(([k], i) => `"${k}" = $${i + 1}`).join(', ');
  const vals = entries.map(([, v]) => v);
  vals.push(req.params.id);
  const { rows } = await q(
    `UPDATE lookup_values SET ${set} WHERE id = $${vals.length} RETURNING *`,
    vals
  );
  if (!rows[0]) throw notFound('No such choice');
  bustCatalog();
  res.json({ value: rows[0] });
}));

r.patch('/screens/:entity/fields/:column', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  const allowed = ['label', 'show_in_list', 'list_order', 'form_section', 'form_order', 'width'];
  const entries = Object.entries(req.body).filter(([k]) => allowed.includes(k));
  if (!entries.length) throw bad('Nothing to save');
  const set = entries.map(([k], i) => `"${k}" = $${i + 1}`).join(', ');
  const vals = entries.map(([, v]) => v);
  vals.push(req.params.entity, req.params.column);
  const { rows } = await q(
    `UPDATE meta_fields SET ${set}, user_modified = true
      WHERE entity_key = $${vals.length - 1} AND column_name = $${vals.length} RETURNING *`,
    vals
  );
  if (!rows[0]) throw notFound();
  bustCatalog();
  res.json({ field: rows[0] });
}));

export default r;
