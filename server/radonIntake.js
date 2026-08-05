/**
 * Opening a radon set — one implementation, two callers.
 *
 * The desktop posts a set to /api/radon/tests. The phone sends a field
 * submission that becomes the same thing. Both land here, so a set opened from
 * a driveway is indistinguishable from one opened at a desk: same sequence
 * number, same custody events, same trigger deciding whether it may reach
 * Deployed.
 *
 * Everything takes a client rather than opening its own transaction, so the
 * caller decides what is atomic with what. A phone submission that fails
 * halfway must not leave a set with no monitor on it.
 */

/** What the duplicate rule says about the next set on this monitor. */
export async function radonQaNext(c, equipmentId, inspectorId, excludeTestId = null) {
  const { rows } = await c.query(
    'SELECT * FROM radon_qa_next($1::uuid, $2::uuid, $3::uuid)',
    [equipmentId || null, inspectorId || null, excludeTestId]
  );
  return rows[0] || null;
}

/**
 * Fill in the set the office already drafted from the order.
 *
 * The draft holds the address, the client and the agent as ISN had them; what
 * the tech adds is the placement — which monitor, on what floor, and the QA
 * answer that decides whether it may reach Deployed. Anything the tech did not
 * say is left as the draft had it, so a blank field never erases what ISN knew.
 */
async function adoptDraft(c, draft, b, qa) {
  const test = (await c.query(
    `UPDATE radon_tests SET
       property_address = COALESCE($2, property_address),
       property_city    = COALESCE($3, property_city),
       foundation_type  = COALESCE($4, foundation_type),
       inspector_id     = COALESCE($5, inspector_id),
       deployed_at      = COALESCE($6, now()),
       closed_house_start = COALESCE($7, closed_house_start),
       closed_house_confirmed = COALESCE($8, closed_house_confirmed),
       conditions_notes = COALESCE($9, conditions_notes),
       qa_sequence_number = $10,
       qa_duplicate_required = $11,
       qa_reason = $12,
       source = COALESCE($13, source),
       device_believed_sequence = $14,
       device_synced_at = $15,
       queued_at = $16
     WHERE id = $1 RETURNING *`,
    [draft.id, b.property_address, b.property_city, b.foundation_type, b.inspector_id,
     b.queued_at || null, b.closed_house_start, b.closed_house_confirmed,
     b.conditions_notes, qa?.sequence_number ?? null, qa?.duplicate_required ?? false,
     qa?.reason ?? null, b.source || null, b.device_believed_sequence ?? null,
     b.device_synced_at || null, b.queued_at || null]
  )).rows[0];

  const primary = await placeDevice(c, test.id, b, b.primary, 'Primary');
  const duplicate = await placeDevice(c, test.id, b, b.duplicate, 'Duplicate');

  if (b.closed_house_confirmed) {
    await c.query(
      `INSERT INTO radon_custody_events (radon_test_id, event_type, employee_id, notes)
       VALUES ($1,'Client briefed',$2,'Closed-house conditions explained')`,
      [test.id, b.inspector_id || null]
    );
  }

  // Flipping to Deployed is what arms the database check, here as anywhere.
  const deployed = (await c.query(
    `UPDATE radon_tests SET status = 'Deployed' WHERE id = $1 RETURNING *`, [test.id]
  )).rows[0];

  return { test: deployed, primary, duplicate, qa, adopted: true };
}

/** One monitor on a set, and the custody event that says it was placed. */
async function placeDevice(c, testId, b, d, role) {
  if (!d) return null;
  const row = (await c.query(
    `INSERT INTO radon_deployments
       (radon_test_id, role, equipment_id, device_serial, canister_lot, supply_id,
        placement_floor, placement_room, placement_notes, distance_inches,
        start_at, tamper_seal_number, seal_intact)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$11,true) RETURNING *`,
    [testId, role, d.equipment_id || null, d.device_serial || null, d.canister_lot || null,
     d.supply_id || null, d.placement_floor || null, d.placement_room || null,
     d.placement_notes || null, d.distance_inches || null, d.tamper_seal_number || null]
  )).rows[0];

  await c.query(
    `INSERT INTO radon_custody_events
       (radon_test_id, deployment_id, event_type, employee_id, gps_lat, gps_lng, photo_ref, notes)
     VALUES ($1,$2,'Placed',$3,$4,$5,$6,$7)`,
    [testId, row.id, b.inspector_id || null, b.gps?.lat ?? null, b.gps?.lng ?? null,
     d.photo_ref || null, role === 'Duplicate' ? 'QA duplicate placed beside the primary' : null]
  );
  return row;
}

/**
 * Create the set, place its monitors, and arm the database check by flipping
 * it to Deployed. `b` is the shape /api/radon/tests already accepts.
 */
export async function createRadonSet(c, b) {
  const qa = await radonQaNext(c, b.primary?.equipment_id, b.inspector_id);

  // When the placement names the order it came from, the office has usually
  // already drafted a set against it — and only one non-voided set per order
  // is allowed. That draft is this job, so fill it in rather than trying to
  // open a second one beside it.
  if (b.isn_order_uuid) {
    const draft = (await c.query(
      `SELECT * FROM radon_tests
        WHERE isn_order_uuid = $1 AND status <> 'Voided'
        ORDER BY created_at LIMIT 1`, [b.isn_order_uuid]
    )).rows[0];

    if (draft) {
      if (draft.status !== 'Scheduled') {
        throw new Error(
          `That job already has a set on it — ${draft.test_number}, ${draft.status}.`);
      }
      return adoptDraft(c, draft, b, qa);
    }
  }

  const t = (await c.query(
    `INSERT INTO radon_tests
       (property_address, property_city, property_state, property_zip, foundation_type,
        isn_order_id, isn_order_url, client_name, client_phone, client_email, agent_name,
        test_method, inspector_id, status, deployed_at, closed_house_start,
        closed_house_confirmed, conditions_notes, qa_sequence_number,
        qa_duplicate_required, qa_reason, result_status,
        source, device_believed_sequence, device_synced_at, queued_at, isn_order_uuid)
     VALUES ($1,$2,$3,COALESCE($4,'VA'),$5,$6,$7,$8,$9,$10,$11,
             COALESCE($12,'Continuous Monitor'),$13,'Scheduled',
             COALESCE($20, now()),$14,
             COALESCE($15,false),$16,$17,$18,$19,'Pending',
             COALESCE($21,'office'),$22,$23,$20,$24)
     RETURNING *`,
    [b.property_address, b.property_city, b.property_state, b.property_zip, b.foundation_type,
     b.isn_order_id, b.isn_order_url, b.client_name, b.client_phone, b.client_email, b.agent_name,
     b.test_method, b.inspector_id, b.closed_house_start, b.closed_house_confirmed,
     b.conditions_notes, qa?.sequence_number ?? null, qa?.duplicate_required ?? false,
     qa?.reason ?? null, b.queued_at || null, b.source || null,
     b.device_believed_sequence ?? null, b.device_synced_at || null, b.isn_order_uuid || null]
  )).rows[0];

  const primary = await placeDevice(c, t.id, b, b.primary, 'Primary');
  const duplicate = await placeDevice(c, t.id, b, b.duplicate, 'Duplicate');

  if (b.closed_house_confirmed) {
    await c.query(
      `INSERT INTO radon_custody_events (radon_test_id, event_type, employee_id, notes)
       VALUES ($1,'Client briefed',$2,'Closed-house conditions explained')`,
      [t.id, b.inspector_id || null]
    );
  }

  // Flipping to Deployed is what arms the database check.
  const test = (await c.query(
    `UPDATE radon_tests SET status = 'Deployed' WHERE id = $1 RETURNING *`, [t.id]
  )).rows[0];

  return { test, primary, duplicate, qa };
}

/**
 * Translate a phone submission into that shape.
 *
 * Photos have already been filed by the time this runs, so the payload holds a
 * reference and the custody event stores it verbatim. Anything else — a stray
 * data URL from a submission that skipped that step — is refused rather than
 * written, because a custody record pointing at something unresolvable is
 * worse than one admitting it has no photo.
 */
export function radonSetFromSubmission(sub, payload = {}) {
  const qa = payload._qa || {};
  const ref = (key) => {
    const v = payload[key];
    return typeof v === 'string' && v.startsWith('attachment:') ? v : null;
  };

  return {
    // The job picked on the phone, so the set joins the order it was sold on
    // rather than floating loose beside it.
    isn_order_uuid: payload.isn_order_uuid || null,
    property_address: payload.address || payload.property_address || 'Address not recorded',
    foundation_type: payload.foundation_type || null,
    inspector_id: sub.employee_id || null,
    closed_house_confirmed: payload.closed_house_confirmed === true,
    conditions_notes: payload.notes || null,
    gps: sub.gps_lat != null ? { lat: sub.gps_lat, lng: sub.gps_lng } : null,

    // What the phone believed when the tech hit send. 007_radon_field.sql turns
    // this into a readable exception when the phone turns out to have been wrong.
    source: qa.captured_offline ? 'field_offline' : 'field_online',
    device_believed_sequence: qa.believed_sequence ?? null,
    device_synced_at: qa.device_synced_at || null,
    queued_at: qa.queued_at || sub.captured_at || null,

    primary: {
      equipment_id: payload.primary_device || null,
      placement_floor: payload.placement_floor || null,
      placement_room: payload.placement_room || null,
      tamper_seal_number: payload.tamper_seal_number || null,
      photo_ref: ref('placement_photo'),
    },
    duplicate: payload.duplicate_device
      ? {
          equipment_id: payload.duplicate_device,
          placement_floor: payload.placement_floor || null,
          distance_inches: payload.duplicate_distance ?? null,
          tamper_seal_number: payload.duplicate_seal || null,
          photo_ref: ref('duplicate_photo'),
        }
      : null,
  };
}
