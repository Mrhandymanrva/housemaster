/**
 * Radon sets, results and chain of custody.
 *
 * The duplicate rule lives in three layers. This file is the middle one:
 * it tells the phone whether the next set owes a duplicate, and it refuses
 * a deployment that owes one and does not have it. The database trigger
 * behind it refuses the same thing, so a bug here cannot let a QA set out
 * the door without its pair.
 */
import { Router } from 'express';
import { q, tx } from '../lib/db.js';
import { wrap, bad, notFound } from '../lib/http.js';
import { requireAuth, requireRole } from '../lib/auth.js';

const r = Router();

const rule = async () => {
  const { rows } = await q('SELECT * FROM radon_qa_rules WHERE active LIMIT 1');
  return rows[0] || null;
};

// -------------------------------------------------------- the QA answer
// The phone calls this before it opens the deployment form. It is also
// what the desktop board reads, so both sides quote the same number.
r.get('/qa-check', requireAuth, wrap(async (req, res) => {
  const { equipment_id, inspector_id } = req.query;
  if (!equipment_id && !inspector_id) throw bad('Tell me which monitor or which inspector.');

  const { rows } = await q(
    'SELECT * FROM radon_qa_next($1::uuid, $2::uuid)',
    [equipment_id || null, inspector_id || null]
  );
  const qa = rows[0];
  const cfg = await rule();

  res.json({
    ...qa,
    tolerance_pct: cfg?.rpd_tolerance_pct ?? null,
    enforced: cfg?.enforce_in_field ?? true,
    banner: qa?.duplicate_required
      ? {
          tone: 'stop',
          title: `Set ${qa.sequence_number} — this one is a duplicate`,
          body: 'Take two monitors. Place the second one right beside the first, '
              + 'same room and same height, and record both before you leave.',
        }
      : {
          tone: 'ok',
          title: `Set ${qa.sequence_number} of ${qa.interval_n}`,
          body: `One monitor. The duplicate comes due on set ${
            qa.sequence_number + (qa.interval_n - (qa.sequence_number % qa.interval_n))
          }.`,
        },
  });
}));

// The whole board, per device.
r.get('/qa-status', requireAuth, wrap(async (_req, res) => {
  const [status, cfg, flagged] = await Promise.all([
    q('SELECT * FROM radon_qa_status ORDER BY next_set_needs_duplicate DESC, name'),
    rule(),
    q(`SELECT t.id, t.test_number, t.property_address, t.result_pci_l, t.duplicate_pci_l,
              t.rpd_pct, t.deployed_at, e.full_name AS inspector_name
         FROM radon_tests t LEFT JOIN employees e ON e.id = t.inspector_id
        WHERE t.rpd_within_tolerance = false
        ORDER BY t.deployed_at DESC NULLS LAST LIMIT 25`),
  ]);
  res.json({ devices: status.rows, rule: cfg, outOfTolerance: flagged.rows });
}));

r.patch('/qa-rule', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  const allowed = ['scope', 'duplicate_interval', 'blank_interval', 'rpd_tolerance_pct',
                   'action_level_pci', 'min_hours_deployed', 'closed_house_hours', 'enforce_in_field'];
  const sets = [], vals = [];
  for (const k of allowed) {
    if (req.body[k] !== undefined) { vals.push(req.body[k]); sets.push(`${k} = $${vals.length}`); }
  }
  if (!sets.length) throw bad('Nothing to change.');
  const { rows } = await q(
    `UPDATE radon_qa_rules SET ${sets.join(', ')}, updated_at = now() WHERE active RETURNING *`, vals
  );
  res.json({ rule: rows[0] });
}));

// ------------------------------------------- what the phone downloads on sync
// One small row per monitor. The phone caches this and decides locally when
// it has no signal — see field/qa-guard.js.
r.get('/ledger', requireAuth, wrap(async (_req, res) => {
  const [ledger, cfg] = await Promise.all([
    q('SELECT * FROM radon_device_ledger ORDER BY name'),
    rule(),
  ]);
  res.json({
    devices: ledger.rows.map((d) => ({
      equipmentId: d.equipment_id, name: d.name, serial: d.serial_number,
      sequence: d.sequence, interval: d.interval, status: d.status,
    })),
    rule: cfg,
    syncedAt: new Date().toISOString(),
  });
}));

// ------------------------------------------------------- the review queue
r.get('/exceptions', requireAuth, wrap(async (_req, res) => {
  const { rows } = await q('SELECT * FROM radon_qa_exceptions');
  res.json({ exceptions: rows });
}));

r.post('/exceptions/:id/clear', requireAuth, requireRole('office'), wrap(async (req, res) => {
  const { rows } = await q(
    `UPDATE radon_tests
        SET qa_exception_cleared_at = now(), qa_exception_cleared_by = $2,
            qa_exception_resolution = $3
      WHERE id = $1 AND qa_exception RETURNING id, test_number`,
    [req.params.id, req.body?.employee_id || null, req.body?.resolution || 'Reviewed']
  );
  if (!rows[0]) throw notFound('No open exception with that id.');
  await q(
    `INSERT INTO radon_custody_events (radon_test_id, event_type, employee_id, notes)
     VALUES ($1,'Checked',$2,$3)`,
    [req.params.id, req.body?.employee_id || null,
     `QA exception reviewed: ${req.body?.resolution || 'Reviewed'}`]
  );
  res.json({ cleared: rows[0] });
}));

// ------------------------------------------------------------- the board
r.get('/board', requireAuth, wrap(async (_req, res) => {
  await q('SELECT refresh_compliance_radon()');
  const [open, recent, qaStatus, cfg, exceptions] = await Promise.all([
    q(`SELECT * FROM radon_open_tests ORDER BY deployed_at NULLS FIRST`),
    q(`SELECT t.id, t.test_number, t.property_address, t.status, t.result_pci_l,
              t.duplicate_pci_l, t.rpd_pct, t.rpd_within_tolerance, t.result_status,
              t.qa_duplicate_required, t.retrieved_at, e.full_name AS inspector_name
         FROM radon_tests t LEFT JOIN employees e ON e.id = t.inspector_id
        WHERE t.status IN ('Reported','At Lab','Retrieved')
        ORDER BY t.retrieved_at DESC NULLS LAST LIMIT 25`),
    q('SELECT * FROM radon_qa_status ORDER BY next_set_needs_duplicate DESC, name'),
    rule(),
    q('SELECT * FROM radon_qa_exceptions'),
  ]);
  res.json({ open: open.rows, recent: recent.rows, qa: qaStatus.rows, rule: cfg,
             exceptions: exceptions.rows });
}));

// ------------------------------------------------------------- deploying
/**
 * Body: { property_address, isn_order_id, inspector_id, test_method,
 *         primary: { equipment_id, placement_floor, placement_room, tamper_seal_number },
 *         duplicate: { ...same... } | null,
 *         closed_house_confirmed, gps: {lat,lng} }
 */
r.post('/tests', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.property_address) throw bad('A radon set needs a property address.');
  if (!b.primary?.equipment_id && !b.primary?.canister_lot) {
    throw bad('Record which monitor or canister went out.');
  }

  const qa = (await q('SELECT * FROM radon_qa_next($1::uuid, $2::uuid)',
    [b.primary.equipment_id || null, b.inspector_id || null])).rows[0];

  const offline = b.source === 'field_offline';

  // The friendly refusal — but only for a set the tech can still fix. A set
  // captured with no signal was finished hours ago; rejecting it would destroy
  // the record without producing a duplicate. Those go through as exceptions.
  if (qa?.duplicate_required && !offline
      && !b.duplicate?.equipment_id && !b.duplicate?.canister_lot) {
    return res.status(422).json({
      error: 'This set needs a duplicate',
      detail: qa.reason,
      qa,
      fix: 'Place a second monitor beside the first and send both.',
    });
  }

  const out = await tx(async (c) => {
    const t = (await c.query(
      `INSERT INTO radon_tests
         (property_address, property_city, property_state, property_zip, foundation_type,
          isn_order_id, isn_order_url, client_name, client_phone, client_email, agent_name,
          test_method, inspector_id, status, deployed_at, closed_house_start,
          closed_house_confirmed, conditions_notes, qa_sequence_number,
          qa_duplicate_required, qa_reason, result_status,
          source, device_believed_sequence, device_synced_at, queued_at)
       VALUES ($1,$2,$3,COALESCE($4,'VA'),$5,$6,$7,$8,$9,$10,$11,
               COALESCE($12,'Continuous Monitor'),$13,'Scheduled',
               COALESCE($20, now()),$14,
               COALESCE($15,false),$16,$17,$18,$19,'Pending',
               COALESCE($21,'office'),$22,$23,$20)
       RETURNING *`,
      [b.property_address, b.property_city, b.property_state, b.property_zip, b.foundation_type,
       b.isn_order_id, b.isn_order_url, b.client_name, b.client_phone, b.client_email, b.agent_name,
       b.test_method, b.inspector_id, b.closed_house_start, b.closed_house_confirmed,
       b.conditions_notes, qa?.sequence_number ?? null, qa?.duplicate_required ?? false,
       qa?.reason ?? null, b.queued_at || null, b.source || null,
       b.device_believed_sequence ?? null, b.device_synced_at || null]
    )).rows[0];

    const place = async (d, role) => {
      if (!d) return null;
      const row = (await c.query(
        `INSERT INTO radon_deployments
           (radon_test_id, role, equipment_id, device_serial, canister_lot, supply_id,
            placement_floor, placement_room, placement_notes, distance_inches,
            start_at, tamper_seal_number, seal_intact)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$11,true) RETURNING *`,
        [t.id, role, d.equipment_id || null, d.device_serial || null, d.canister_lot || null,
         d.supply_id || null, d.placement_floor || null, d.placement_room || null,
         d.placement_notes || null, d.distance_inches || null, d.tamper_seal_number || null]
      )).rows[0];

      await c.query(
        `INSERT INTO radon_custody_events
           (radon_test_id, deployment_id, event_type, employee_id, gps_lat, gps_lng, photo_ref, notes)
         VALUES ($1,$2,'Placed',$3,$4,$5,$6,$7)`,
        [t.id, row.id, b.inspector_id || null, b.gps?.lat ?? null, b.gps?.lng ?? null,
         d.photo_ref || null, role === 'Duplicate' ? 'QA duplicate placed beside the primary' : null]
      );
      return row;
    };

    const primary = await place(b.primary, 'Primary');
    const duplicate = await place(b.duplicate, 'Duplicate');

    if (b.closed_house_confirmed) {
      await c.query(
        `INSERT INTO radon_custody_events (radon_test_id, event_type, employee_id, notes)
         VALUES ($1,'Client briefed',$2,'Closed-house conditions explained')`,
        [t.id, b.inspector_id || null]
      );
    }

    // Flipping to Deployed is what arms the database check.
    const deployed = (await c.query(
      `UPDATE radon_tests SET status = 'Deployed' WHERE id = $1 RETURNING *`, [t.id]
    )).rows[0];

    return { test: deployed, primary, duplicate };
  });

  await q('SELECT refresh_compliance_radon()');
  res.status(201).json({
    ...out, qa,
    exception: out.test.qa_exception
      ? { reason: out.test.qa_exception_reason, needsReview: true }
      : null,
  });
}));

// ------------------------------------------------------------ retrieving
r.post('/tests/:id/retrieve', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const out = await tx(async (c) => {
    const t = (await c.query('SELECT * FROM radon_tests WHERE id = $1', [req.params.id])).rows[0];
    if (!t) throw notFound('No radon set with that id.');

    for (const [role, reading] of [['Primary', b.result_pci_l], ['Duplicate', b.duplicate_pci_l]]) {
      if (reading == null) continue;
      await c.query(
        `UPDATE radon_deployments
            SET end_at = now(), result_pci_l = $3, seal_intact = COALESCE($4, seal_intact),
                hours_exposed = round(EXTRACT(EPOCH FROM (now() - start_at))/3600.0, 1)
          WHERE radon_test_id = $1 AND role = $2 AND NOT voided`,
        [t.id, role, reading, b.seals_intact ?? null]
      );
    }

    const updated = (await c.query(
      `UPDATE radon_tests
          SET status = 'Retrieved', retrieved_at = now(), retrieved_by_id = $2,
              result_pci_l = COALESCE($3, result_pci_l),
              duplicate_pci_l = COALESCE($4, duplicate_pci_l),
              tamper_evident = COALESCE($5, tamper_evident),
              result_status = NULL,
              conditions_notes = COALESCE($6, conditions_notes)
        WHERE id = $1 RETURNING *`,
      [t.id, b.retrieved_by_id || null, b.result_pci_l ?? null, b.duplicate_pci_l ?? null,
       b.seals_intact ?? null, b.notes || null]
    )).rows[0];

    await c.query(
      `INSERT INTO radon_custody_events
         (radon_test_id, event_type, employee_id, gps_lat, gps_lng, photo_ref, notes)
       VALUES ($1,'Retrieved',$2,$3,$4,$5,$6)`,
      [t.id, b.retrieved_by_id || null, b.gps?.lat ?? null, b.gps?.lng ?? null,
       b.photo_ref || null, b.notes || null]
    );

    return updated;
  });

  await q('SELECT refresh_compliance_radon()');
  res.json({ test: out, flagged: out.rpd_within_tolerance === false });
}));

// -------------------------------------------------------------- results
r.post('/tests/:id/result', requireAuth, requireRole('office'), wrap(async (req, res) => {
  const b = req.body || {};
  const { rows } = await q(
    `UPDATE radon_tests
        SET result_pci_l = COALESCE($2, result_pci_l),
            duplicate_pci_l = COALESCE($3, duplicate_pci_l),
            lab_report_number = COALESCE($4, lab_report_number),
            lab_vendor_id = COALESCE($5, lab_vendor_id),
            result_status = NULL,
            status = CASE WHEN $6::boolean THEN 'Reported' ELSE 'At Lab' END,
            report_delivered_at = CASE WHEN $6::boolean THEN now() ELSE report_delivered_at END
      WHERE id = $1 RETURNING *`,
    [req.params.id, b.result_pci_l ?? null, b.duplicate_pci_l ?? null,
     b.lab_report_number || null, b.lab_vendor_id || null, !!b.deliver_to_client]
  );
  if (!rows[0]) throw notFound('No radon set with that id.');

  await q(
    `INSERT INTO radon_custody_events (radon_test_id, event_type, employee_id, notes)
     VALUES ($1, $2, $3, $4)`,
    [req.params.id, b.deliver_to_client ? 'Reported to client' : 'Result received',
     req.user?.employee_id || null, b.notes || null]
  );

  res.json({ test: rows[0] });
}));

// ------------------------------------------------------ chain of custody
r.get('/tests/:id', requireAuth, wrap(async (req, res) => {
  const [test, devices, custody] = await Promise.all([
    q(`SELECT t.*, e.full_name AS inspector_name, v.name AS lab_name
         FROM radon_tests t
         LEFT JOIN employees e ON e.id = t.inspector_id
         LEFT JOIN vendors v ON v.id = t.lab_vendor_id
        WHERE t.id = $1`, [req.params.id]),
    q(`SELECT d.*, e.name AS equipment_name, e.serial_number
         FROM radon_deployments d LEFT JOIN equipment e ON e.id = d.equipment_id
        WHERE d.radon_test_id = $1 ORDER BY d.role`, [req.params.id]),
    q(`SELECT c.*, e.full_name AS employee_name
         FROM radon_custody_events c LEFT JOIN employees e ON e.id = c.employee_id
        WHERE c.radon_test_id = $1 ORDER BY c.occurred_at`, [req.params.id]),
  ]);
  if (!test.rows[0]) throw notFound('No radon set with that id.');
  res.json({ test: test.rows[0], devices: devices.rows, custody: custody.rows });
}));

r.post('/tests/:id/custody', requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.event_type) throw bad('Say what happened.');
  const { rows } = await q(
    `INSERT INTO radon_custody_events
       (radon_test_id, deployment_id, event_type, occurred_at, employee_id, party_name,
        gps_lat, gps_lng, signature_ref, photo_ref, notes)
     VALUES ($1,$2,$3,COALESCE($4, now()),$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [req.params.id, b.deployment_id || null, b.event_type, b.occurred_at || null,
     b.employee_id || null, b.party_name || null, b.gps?.lat ?? null, b.gps?.lng ?? null,
     b.signature_ref || null, b.photo_ref || null, b.notes || null]
  );
  if (b.event_type === 'Shipped to lab') {
    await q(`UPDATE radon_tests SET status = 'At Lab' WHERE id = $1 AND status = 'Retrieved'`,
      [req.params.id]);
  }
  res.status(201).json({ event: rows[0] });
}));

export default r;
