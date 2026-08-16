import { Router } from 'express';
import { q, tx } from '../lib/db.js';
import { wrap, bad, notFound, forbidden } from '../lib/http.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { getEntity, bustCatalog } from '../catalog/sync.js';
import { createRadonSet, radonSetFromSubmission } from '../radonIntake.js';
import { absorbPayloadImages, relinkAttachments } from '../attachments.js';
import { OFFICE_ZONE, officeRanges, periodRange, PERIODS } from '../lib/zone.js';
import { planClaim, changesAnything } from '../lib/kitClaim.js';
import { moneyReport } from '../lib/money.js';
import { weekBoard } from '../lib/weekBoard.js';
import { calendarMonth, unscheduledOrders } from '../lib/calendar.js';
import { realWork, countsAsRevenue } from '../lib/orderStatus.js';

/**
 * Some records are more than a row.
 *
 * Most submissions map answers onto columns and that is the whole job. A radon
 * set is a test, its monitors, and a custody event for each — and a trigger
 * that decides whether it may reach Deployed. Entities that need that kind of
 * assembly name a builder here; everything else takes the generic path.
 */
const INTAKE = {
  radon_tests: async (c, sub) => {
    const { test } = await createRadonSet(c, radonSetFromSubmission(sub, sub.payload || {}));
    return test.id;
  },
};

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

// The office runs on one clock — see server/lib/zone.js. Counting a 7pm radon
// placement as tomorrow's work because the server thinks in UTC would make
// every evening set wrong.
const ZONE = OFFICE_ZONE;

/**
 * How each job type is recognised. ISN spells its services however the office
 * set them up, so match loosely — the same approach as hasRadon().
 *
 * Knowing how to spot a sewer scope is a fact about the trade and belongs in
 * code. Whether Richmond sells one is a fact about the business, and lives in
 * the `job_kind` list where the office can switch it on the day they start.
 */
const JOB_PATTERNS = {
  mold: ['mold', 'air quality', 'iaq'],
  sewer: ['sewer', 'scope'],
  termite: ['termite', 'wdi', 'wood destroying'],
  well_septic: ['well', 'septic', 'water test'],
  pool: ['pool', 'spa'],
};

async function jobKinds() {
  const { rows } = await q(
    `SELECT value, label FROM lookup_values
      WHERE list_key = 'job_kind' AND active ORDER BY sort, label`
  );
  return rows
    .filter((r) => JOB_PATTERNS[r.value])
    .map((r) => ({ key: r.value, label: r.label, patterns: JOB_PATTERNS[r.value] }));
}

/**
 * The screen an inspector opens first thing.
 *
 * Two questions: what is coming due against me, and what have I done today and
 * this week. Radon comes from our own sets, which are true whether or not
 * anything else is connected. Job counts come from ISN, and when that link is
 * off the screen says so rather than showing a confident zero.
 */
r.get('/field/today', requireAuth, wrap(async (req, res) => {
  const employeeId = req.user.employee_id || null;

  // An owner runs the branch, so their phone shows the branch: everyone's
  // work, everyone's deadlines, and who did what today. ?scope=me narrows it
  // back to their own.
  const maySeeAll = ['owner', 'admin'].includes(req.user.role);
  const seeAll = maySeeAll && req.query.scope !== 'me';
  const who = seeAll ? null : employeeId;

  const R = officeRanges();
  const KINDS = await jobKinds();
  // Only the column aliases are written into the SQL, and those come from a
  // fixed set in this file. The patterns go across as parameters like every
  // other value in this codebase.
  const kindCounts = KINDS
    .map((k, i) => `COUNT(*) FILTER (WHERE o.sold_services::text ILIKE ANY($${i + 6})) AS ${k.key}`)
    .join(', ');
  const kindParams = KINDS.map((k) => k.patterns.map((p) => `%${p}%`));

  const nobody = !seeAll && !employeeId;

  const [deadlines, ceu, sets, jobs, isn, byPerson, radonByPerson, money] = await Promise.all([
    nobody ? { rows: [] } : q(
      `SELECT id, category, title, subject, due_date, days_out, state, priority, responsible_name
         FROM compliance_horizon
        WHERE completed_date IS NULL
          AND due_date <= CURRENT_DATE + 90
          AND ($1::uuid IS NULL OR responsible_id = $1)
        ORDER BY due_date LIMIT 60`, [who]),

    employeeId
      ? q(`SELECT ceu_hours_required::float AS required,
                  ceu_hours_completed::float AS completed
             FROM inspector_readiness WHERE employee_id = $1`, [employeeId])
      : { rows: [] },

    // What has actually been placed, as opposed to what is booked. The tile
    // shows the booking, like every other service; this is the follow-through.
    nobody ? { rows: [{ day: 0, week: 0 }] } : q(
      `SELECT
         COUNT(*) FILTER (WHERE deployed_at >= $2 AND deployed_at < $3) AS day,
         COUNT(*) FILTER (WHERE deployed_at >= $4 AND deployed_at < $5) AS week
       FROM radon_tests
      WHERE deployed_at IS NOT NULL AND ($1::uuid IS NULL OR inspector_id = $1)`,
      [who, R.dayStart, R.dayEnd, R.weekStart, R.weekEnd]),

    nobody ? { rows: [] } : q(
      `SELECT
         CASE WHEN o.scheduled_start >= $2 AND o.scheduled_start < $3
              THEN 'day' ELSE 'week' END AS bucket,
         COUNT(*) AS inspections,
         COUNT(*) FILTER (WHERE o.has_radon) AS radon${kindCounts ? ', ' + kindCounts : ''}
       FROM isn_orders o
      WHERE ($1::uuid IS NULL OR $1 = ANY(o.crew_employee_ids))
        AND o.scheduled_start >= $4 AND o.scheduled_start < $5
        AND ${realWork('o')}
      GROUP BY 1`, [who, R.dayStart, R.dayEnd, R.weekStart, R.weekEnd, ...kindParams]),

    q(`SELECT enabled, last_sync_at FROM isn_connection LIMIT 1`),

    // Who did what — only worth asking when looking at the whole branch.
    seeAll ? q(
      `SELECT e.id, e.full_name,
              COUNT(*) FILTER (WHERE o.scheduled_start >= $1 AND o.scheduled_start < $2)::int AS day,
              COUNT(*)::int AS week,
              COUNT(*) FILTER (WHERE o.has_radon)::int AS radon_week
         FROM isn_orders o
         CROSS JOIN LATERAL unnest(o.crew_employee_ids) AS x(employee_id)
         JOIN employees e ON e.id = x.employee_id
        WHERE o.scheduled_start >= $3 AND o.scheduled_start < $4
          AND ${realWork('o')}
        GROUP BY e.id, e.full_name`,
      [R.dayStart, R.dayEnd, R.weekStart, R.weekEnd]) : { rows: [] },

    seeAll ? q(
      `SELECT e.id, e.full_name,
              COUNT(*) FILTER (WHERE t.deployed_at >= $1 AND t.deployed_at < $2)::int AS day,
              COUNT(*)::int AS week
         FROM radon_tests t JOIN employees e ON e.id = t.inspector_id
        WHERE t.deployed_at >= $3 AND t.deployed_at < $4
        GROUP BY e.id, e.full_name`,
      [R.dayStart, R.dayEnd, R.weekStart, R.weekEnd]) : { rows: [] },

    // What the work was booked at. Whoever runs the branch asks this; a tech
    // does not, and should not have to look at it.
    seeAll ? q(
      `SELECT
         COALESCE(SUM(total_fee) FILTER (
           WHERE scheduled_start >= $1 AND scheduled_start < $2), 0) AS week,
         COALESCE(SUM(total_fee) FILTER (
           WHERE scheduled_start >= $3 AND scheduled_start < $4), 0) AS month,
         COALESCE(SUM(total_fee) FILTER (
           WHERE scheduled_start >= $3 AND scheduled_start < $4 AND NOT paid), 0) AS month_unpaid
       FROM isn_orders
      WHERE total_fee IS NOT NULL
        AND ${countsAsRevenue('')}`,
      [R.weekStart, R.weekEnd, R.monthStart, R.monthEnd]) : { rows: [] },
  ]);

  // "This week" includes today; the query buckets them apart, so add them back.
  const zero = () => ({ inspections: 0, radon: 0, ...Object.fromEntries(KINDS.map((k) => [k.key, 0])) });
  const day = zero();
  const week = zero();
  for (const row of jobs.rows) {
    for (const field of Object.keys(zero())) {
      const n = Number(row[field]) || 0;
      week[field] += n;
      if (row.bucket === 'day') day[field] += n;
    }
  }

  // One row per person: jobs booked, radon booked, and radon actually placed.
  // Radon has to mean the same thing here as in the tile above it — booked —
  // or the two disagree with each other on the same screen.
  const crew = new Map();
  const seat = (r0) => {
    const e = crew.get(r0.id)
      || { id: r0.id, name: r0.full_name, jobsDay: 0, jobsWeek: 0, radonWeek: 0, placedWeek: 0 };
    crew.set(r0.id, e);
    return e;
  };
  for (const r0 of byPerson.rows) {
    const e = seat(r0);
    e.jobsDay = r0.day;
    e.jobsWeek = r0.week;
    e.radonWeek = r0.radon_week;
  }
  for (const r0 of radonByPerson.rows) seat(r0).placedWeek = r0.week;

  const readiness = ceu.rows[0] || null;
  res.json({
    linked: Boolean(employeeId),
    scope: seeAll ? 'branch' : 'me',
    maySeeAll,
    deadlines: deadlines.rows,
    ceu: readiness && Number(readiness.required) > 0
      ? {
          required: Number(readiness.required),
          completed: Number(readiness.completed),
          short: Math.max(0, Number(readiness.required) - Number(readiness.completed)),
        }
      : null,
    today: day,
    week: week,
    placed: { day: Number(sets.rows[0]?.day || 0), week: Number(sets.rows[0]?.week || 0) },
    kinds: KINDS.map(({ key, label }) => ({ key, label })),
    crew: [...crew.values()].sort((a, b) => b.jobsWeek - a.jobsWeek || b.radonWeek - a.radonWeek),
    revenue: money.rows[0] ? {
      week: Number(money.rows[0].week),
      month: Number(money.rows[0].month),
      monthUnpaid: Number(money.rows[0].month_unpaid),
    } : null,
    isn: { connected: Boolean(isn.rows[0]?.enabled), lastSyncAt: isn.rows[0]?.last_sync_at || null },
  });
}));

/**
 * The jobs behind a number.
 *
 * A count nobody can open is a number to be taken on trust. Tapping a tile
 * asks this: the actual jobs, in time order, with whose day each one is on —
 * which is also the fastest way to spot that a count is wrong.
 */
r.get('/field/jobs', requireAuth, wrap(async (req, res) => {
  const employeeId = req.user.employee_id || null;
  const maySeeAll = ['owner', 'admin'].includes(req.user.role);
  const seeAll = maySeeAll && req.query.scope !== 'me';
  const who = seeAll ? null : employeeId;
  if (!seeAll && !employeeId) return res.json({ jobs: [], kind: null });

  const kind = String(req.query.kind || 'inspections');
  const period = req.query.period === 'day' ? 'day' : 'week';

  let filter = 'TRUE';
  const params = [who, ZONE];
  if (kind === 'radon') {
    filter = 'o.has_radon';
  } else if (kind !== 'inspections') {
    const KINDS = await jobKinds();
    const k = KINDS.find((x) => x.key === kind);
    if (!k) throw bad('No such job type.');
    params.push(k.patterns.map((p) => `%${p}%`));
    filter = `o.sold_services::text ILIKE ANY($${params.length})`;
  }

  const when = period === 'day'
    ? `(o.scheduled_start AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date`
    : `o.scheduled_start >= date_trunc('week', now() AT TIME ZONE $2)`;

  const { rows } = await q(
    `SELECT o.id, o.order_number, o.scheduled_start, o.property_address, o.property_city,
            o.client_name, o.has_radon, o.order_status, o.order_url,
            COALESCE(e.full_name, o.inspector_name, 'Nobody here yet') AS inspector,
            o.employee_id,
            -- everyone on it, so a two-inspector job says so rather than
            -- looking like it belongs to whoever was listed first
            COALESCE((SELECT array_agg(c.full_name ORDER BY c.full_name)
                        FROM employees c
                       WHERE c.id = ANY(o.crew_employee_ids)), '{}') AS crew
       FROM isn_orders o
       LEFT JOIN employees e ON e.id = o.employee_id
      WHERE ($1::uuid IS NULL OR $1 = ANY(o.crew_employee_ids))
        AND ${realWork('o')}
        AND ${when}
        AND ${filter}
      ORDER BY o.scheduled_start NULLS LAST
      LIMIT 200`,
    params
  );

  res.json({ jobs: rows, kind, period, scope: seeAll ? 'branch' : 'me' });
}));

/**
 * The radon placements this inspector is due to make.
 *
 * Straight off the orders rather than off drafted sets, so a job counts as
 * theirs if they are anywhere on its crew and shows up whether or not the
 * office has drafted the set yet. Picking one on the phone is what ties the
 * placement back to the order it was sold on.
 */
r.get('/field/radon-jobs', requireAuth, wrap(async (req, res) => {
  const employeeId = req.user.employee_id || null;
  const maySeeAll = ['owner', 'admin'].includes(req.user.role);
  const seeAll = maySeeAll && req.query.scope !== 'me';
  const who = seeAll ? null : employeeId;
  if (!seeAll && !employeeId) return res.json({ jobs: [] });

  const { rows } = await q(
    `SELECT o.id, o.order_number, o.scheduled_start,
            o.property_address, o.property_city, o.property_state, o.property_zip,
            o.client_name, o.foundation_type,
            t.id AS radon_test_id, t.status AS radon_status,
            COALESCE(e.full_name, o.inspector_name) AS inspector
       FROM isn_orders o
       LEFT JOIN radon_tests t
              ON t.isn_order_uuid = o.id AND t.status <> 'Voided'
       LEFT JOIN employees e ON e.id = o.employee_id
      WHERE o.has_radon
        AND ${realWork('o')}
        AND ($1::uuid IS NULL OR $1 = ANY(o.crew_employee_ids))
        -- yesterday through the week ahead: a set placed this morning may still
        -- be being written up, and techs pick up work further out than a day
        AND o.scheduled_start >= now() - interval '1 day'
        AND o.scheduled_start <  now() + interval '7 days'
      ORDER BY o.scheduled_start
      LIMIT 60`, [who]);

  res.json({ jobs: rows, scope: seeAll ? 'branch' : 'me' });
}));

/**
 * The kit signed out to this person.
 *
 * A tech knows a ladder is bent the moment they pick it up, and the office
 * finds out when somebody needs it. This is the shortest path between those
 * two: what you are carrying, and one tap to say something is wrong with it.
 */
r.get('/field/equipment', requireAuth, wrap(async (req, res) => {
  const employeeId = req.user.employee_id || null;
  const maySeeAll = ['owner', 'admin'].includes(req.user.role);
  const seeAll = maySeeAll && req.query.scope !== 'me';
  const who = seeAll ? null : employeeId;
  if (!seeAll && !employeeId) return res.json({ equipment: [], statuses: [], conditions: [] });

  const [kit, statuses, conditions] = await Promise.all([
    q(`SELECT e.id, e.name, e.asset_category, e.serial_number, e.asset_tag,
              e.make, e.model, e.status, e.condition, e.current_location,
              e.requires_calibration, e.next_calibration_due,
              (e.next_calibration_due - CURRENT_DATE) AS calibration_days,
              v.unit_number AS on_vehicle,
              p.full_name AS assigned_to
         FROM equipment e
         LEFT JOIN vehicles v ON v.id = e.assigned_vehicle_id
         LEFT JOIN employees p ON p.id = e.assigned_employee_id
        WHERE e.status <> 'Retired'
          AND ($1::uuid IS NULL OR e.assigned_employee_id = $1)
        ORDER BY e.name`, [who]),
    q(`SELECT value, label, color FROM lookup_values
        WHERE list_key = 'asset_status' AND active ORDER BY sort, label`),
    q(`SELECT value, label FROM lookup_values
        WHERE list_key = 'asset_condition' AND active ORDER BY sort, label`),
  ]);

  res.json({
    equipment: kit.rows,
    statuses: statuses.rows,
    conditions: conditions.rows,
    scope: seeAll ? 'branch' : 'me',
  });
}));

/**
 * Say something about a piece of kit.
 *
 * The status change lands straight away rather than queueing for review: a
 * ladder somebody has just reported bent should stop being usable now, not
 * when the office next opens the inbox. Notes are added to, never replaced —
 * what was wrong with it in March is part of the story of the thing.
 */
r.patch('/field/equipment/:id', requireAuth, wrap(async (req, res) => {
  const { status, condition, note } = req.body || {};
  const maySeeAll = ['owner', 'admin'].includes(req.user.role);

  const owned = await q(
    `SELECT id, name, assigned_employee_id, notes FROM equipment WHERE id = $1`, [req.params.id]);
  const item = owned.rows[0];
  if (!item) throw notFound('No such equipment.');
  if (!maySeeAll && item.assigned_employee_id !== req.user.employee_id) {
    throw forbidden('That is not signed out to you.');
  }

  const sets = [];
  const vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (status) add('status', status);
  if (condition) add('condition', condition);

  if (note?.trim()) {
    const stamp = new Date().toLocaleDateString('en-US', { timeZone: OFFICE_ZONE });
    const line = `${stamp} — ${req.user.name || 'Field'}: ${note.trim()}`;
    add('notes', item.notes ? `${line}\n\n${item.notes}` : line);
  }
  if (!sets.length) throw bad('Nothing to change.');

  vals.push(item.id);
  const { rows } = await q(
    `UPDATE equipment SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);

  await q(
    `INSERT INTO audit_log (user_id, entity, entity_id, action, diff)
     VALUES ($1,'equipment',$2,'field_update',$3)`,
    [req.user.id, item.id, JSON.stringify({ status, condition, note: note || null })]
  );
  await q('SELECT refresh_compliance()');

  res.json({ equipment: rows[0] });
}));

/**
 * Claim your kit — everything claimable, and what this person is holding now.
 *
 * The office builds the equipment list from purchase records and calibration
 * certificates, because that is where the serial numbers are. What it cannot
 * know is which of those forty things is on which van this morning, and any
 * answer it guesses is wrong within a week. So the list is created at a desk
 * and assigned from a driveway.
 *
 * Everything not retired comes back, not only what is unassigned: kit moves
 * between people without paperwork, and a screen that could not show "I have
 * Bobby's ladder" would be a screen that quietly stays wrong.
 */
r.get('/field/kit-claim', requireAuth, wrap(async (req, res) => {
  const me = req.user.employee_id || null;
  if (!me) {
    throw bad('Your login is not linked to a person yet, so there is nobody to sign kit out to. '
      + 'The office does that under ISN link, or on your employee record.');
  }

  const [items, vehicles, conditions, who] = await Promise.all([
    q(`SELECT e.id, e.name, e.asset_category, e.serial_number, e.asset_tag,
              e.make, e.model, e.status, e.condition,
              e.assigned_employee_id, e.assigned_vehicle_id,
              p.full_name AS holder_name,
              v.unit_number AS on_vehicle
         FROM equipment e
         LEFT JOIN employees p ON p.id = e.assigned_employee_id
         LEFT JOIN vehicles v ON v.id = e.assigned_vehicle_id
        WHERE e.status <> 'Retired'
        ORDER BY e.asset_category NULLS LAST, e.name`),
    q(`SELECT id, unit_number, make, model FROM vehicles
        WHERE status IS DISTINCT FROM 'Out of Service' ORDER BY unit_number`),
    q(`SELECT value, label FROM lookup_values
        WHERE list_key = 'asset_condition' AND active ORDER BY sort, label`),
    q(`SELECT kit_confirmed_at FROM employees WHERE id = $1`, [me]),
  ]);

  // Whichever van most of their kit is already on, so the picker starts on the
  // right answer instead of making them find it every time.
  const vans = {};
  for (const i of items.rows) {
    if (i.assigned_employee_id === me && i.assigned_vehicle_id) {
      vans[i.assigned_vehicle_id] = (vans[i.assigned_vehicle_id] || 0) + 1;
    }
  }
  const usual = Object.entries(vans).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  res.json({
    me,
    vehicle_id: usual,
    vehicles: vehicles.rows,
    conditions: conditions.rows,
    confirmed_at: who.rows[0]?.kit_confirmed_at || null,
    items: items.rows.map((i) => ({
      id: i.id, name: i.name, asset_category: i.asset_category,
      serial_number: i.serial_number, asset_tag: i.asset_tag,
      make: i.make, model: i.model, status: i.status, condition: i.condition,
      on_vehicle: i.on_vehicle,
      mine: i.assigned_employee_id === me,
      holder_name: i.assigned_employee_id === me ? null : i.holder_name,
    })),
  });
}));

/**
 * Sign for it.
 *
 * Ticked and not yours becomes yours; ticked and already yours stays put;
 * unticked and yours is handed back. Anything unticked that was never yours is
 * left completely alone — a tech scrolling past somebody else's kit has not
 * said anything about it, and treating silence as a hand-back would empty the
 * shop the first time anyone used this.
 */
r.post('/field/kit-claim', requireAuth, wrap(async (req, res) => {
  const me = req.user.employee_id || null;
  if (!me) throw bad('Your login is not linked to a person yet.');

  const { vehicle_id = null, items = [] } = req.body || {};
  if (!Array.isArray(items)) throw bad('Expected a list of what you have.');

  const current = await q(
    `SELECT e.id, e.name, e.condition, e.assigned_employee_id, e.assigned_vehicle_id,
            p.full_name AS holder_name
       FROM equipment e
       LEFT JOIN employees p ON p.id = e.assigned_employee_id
      WHERE e.status <> 'Retired'`);

  if (vehicle_id) {
    const van = await q(`SELECT id FROM vehicles WHERE id = $1`, [vehicle_id]);
    if (!van.rows[0]) throw bad('That van is not on file.');
  }

  const plan = planClaim({ me, items: current.rows, claimed: items, vehicleId: vehicle_id });

  if (changesAnything(plan)) {
    await tx(async (c) => {
      const stamp = new Date().toLocaleDateString('en-US', { timeZone: OFFICE_ZONE });
      const signer = req.user.name || 'Field';

      for (const item of [...plan.take, ...plan.update]) {
        await c.query(
          `UPDATE equipment
              SET assigned_employee_id = $2,
                  assigned_vehicle_id = $3,
                  condition = COALESCE($4, condition)
            WHERE id = $1`,
          [item.id, me, plan.vehicleId, item.condition || null]);
      }

      // Taking something off a colleague is worth a line in the item's own
      // history, where the next person to wonder will actually look.
      for (const item of plan.take.filter((x) => x.from)) {
        await c.query(
          `UPDATE equipment
              SET notes = CASE WHEN notes IS NULL OR notes = '' THEN $2
                               ELSE $2 || E'\\n\\n' || notes END
            WHERE id = $1`,
          [item.id, `${stamp} — ${signer}: took this over from ${item.fromName || 'someone else'}.`]);
      }

      for (const item of plan.release) {
        await c.query(
          `UPDATE equipment SET assigned_employee_id = NULL, assigned_vehicle_id = NULL
            WHERE id = $1 AND assigned_employee_id = $2`, [item.id, me]);
      }

      for (const [action, list] of [['claimed', plan.take], ['moved', plan.update], ['released', plan.release]]) {
        for (const item of list) {
          await c.query(
            `INSERT INTO audit_log (user_id, entity, entity_id, action, diff)
             VALUES ($1,'equipment',$2,'field_kit',$3)`,
            [req.user.id, item.id,
             JSON.stringify({ what: action, vehicle_id: plan.vehicleId,
               condition: item.condition || null, from: item.fromName || null })]);
        }
      }
    });
  }

  // Stamped even when nothing changed: "I looked, it is all still right" is
  // the answer this asks for as much as any correction, and it is the whole
  // point of asking again in three months.
  await q(`UPDATE employees SET kit_confirmed_at = now() WHERE id = $1`, [me]);

  res.json({
    holding: plan.holding,
    claimed: plan.take.length,
    released: plan.release.length,
    moved: plan.update.length,
    takenFrom: plan.take.filter((x) => x.fromName).map((x) => x.fromName),
  });
}));

/**
 * The money.
 *
 * Gated to whoever runs the branch, the same way the revenue line on the phone
 * is. A tech has no reason to see the receivables list and every reason not to
 * be handed their colleagues' numbers.
 */
/**
 * The week Home opens on: who is working, when, and where the holes are.
 *
 * Open to everybody, because a schedule is not a secret and a tech looking at
 * Home should see the same week the office does. What money it carries is
 * another matter — that is stripped for anyone below admin, the same rule the
 * phone follows.
 */
r.get('/week', requireAuth, wrap(async (req, res) => {
  const board = await weekBoard({ query: q }, periodRange('week', new Date()));
  if (['owner', 'admin'].includes(req.user.role)) return res.json({ ...board, money: true });

  // Not a filter over the top of the numbers — the numbers do not go out.
  const strip = (slot) => { const { fee, paid, ...rest } = slot; return rest; };
  res.json({
    ...board,
    money: false,
    days: board.days.map(({ booked, ...d }) => d),
    inspectors: board.inspectors.map(({ booked, ...i }) => ({
      ...i,
      days: Object.fromEntries(Object.entries(i.days).map(([d, xs]) => [d, xs.map(strip)])),
    })),
    totals: (({ booked, unbilled, ...t }) => t)(board.totals),
  });
}));

/**
 * A month of the schedule, out of the orders already synced.
 *
 * Same rule as the week: the schedule is open, the money on it is not.
 */
r.get('/calendar', requireAuth, wrap(async (req, res) => {
  const cal = await calendarMonth({ query: q }, req.query.month);
  if (['owner', 'admin'].includes(req.user.role)) return res.json({ ...cal, money: true });

  const strip = (it) => { const { fee, paid, ...rest } = it; return rest; };
  res.json({
    ...cal,
    money: false,
    weeks: cal.weeks.map((w) => w.map(({ booked, ...c }) => ({
      ...c,
      items: c.items.map(strip),
      byInspector: c.byInspector.map(({ booked: _b, ...p }) => p),
    }))),
    inspectors: cal.inspectors.map(({ booked, ...p }) => p),
    totals: (({ booked, ...t }) => t)(cal.totals),
  });
}));

/**
 * Orders with no day on them — work waiting to be booked.
 *
 * Its own route rather than part of the month, because it belongs to no month.
 * Stepping to September must not make August's unbooked work disappear.
 */
r.get('/unscheduled', requireAuth, wrap(async (req, res) => {
  const out = await unscheduledOrders({ query: q });
  if (['owner', 'admin'].includes(req.user.role)) return res.json({ ...out, money: true });
  res.json({ ...out, money: false, items: out.items.map(({ fee, ...i }) => i) });
}));

r.get('/money', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  const range = periodRange(req.query.period, new Date());
  res.json(await moneyReport({ query: q }, range, { kinds: await jobKinds() }));
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

  // The submission is already saved. If turning it into a record fails — a
  // duplicate the database refuses, a monitor that has since been retired —
  // that is not the phone's problem to retry: re-sending would only fail the
  // same way, and the tech has driven off. It stays pending with the reason on
  // it, in front of the office, and the phone is told it arrived.
  let applied = null;
  let couldNotApply = null;
  if (mod.auto_apply) {
    try {
      applied = await applySubmission(ins.rows[0].id, req.user.id);
    } catch (err) {
      couldNotApply = err.message;
      await q(`UPDATE field_submissions SET review_note = $2 WHERE id = $1`,
        [ins.rows[0].id, `Could not be filed automatically: ${err.message}`]);
    }
  }
  res.status(201).json({ submission: applied || ins.rows[0], couldNotApply });
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

    // File the photos first. Everything below reads the payload, and what it
    // should find there is a reference to a stored image, not the image.
    sub.payload = await absorbPayloadImages(c, sub);

    let wroteTo = sub.target_id;

    const build = INTAKE[sub.target_entity];
    if (build && !sub.target_id) {
      wroteTo = await build(c, sub);
      await c.query(`UPDATE field_submissions SET target_id = $2 WHERE id = $1`, [id, wroteTo]);
    } else if (sub.target_entity) {
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
    // The photos belong to the record now, not to the paperwork that made it,
    // so they appear on the radon set or the vehicle rather than only here.
    await relinkAttachments(c, id, sub.target_entity, wroteTo);

    await c.query('SELECT refresh_compliance()');
    // A set opened from a phone has its own dates to keep — closed-house hours,
    // retrieval due — and the desktop route refreshes these for the same reason.
    if (build) await c.query('SELECT refresh_compliance_radon()');
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
