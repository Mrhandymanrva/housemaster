/** ISN sync: status, a manual pull, and the phone's job list. */
import { Router } from 'express';
import { q, tx } from '../lib/db.js';
import { wrap, bad } from '../lib/http.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { syncOnce, probe, getMe, extractList, unwrap, refreshUsers, listedByIsn, describeShape,
  recheckSoon }
  from '../integrations/isn.js';
import { isnScheduleState } from '../isnSchedule.js';
import { officeRanges, periodRange } from '../lib/zone.js';
import { revenueCheck } from '../lib/revenueCheck.js';
import { pullEvents, pullAvailability } from '../integrations/isnCalendar.js';
import { isnGet } from '../integrations/isn.js';
import { statusCensus, setStatusRule } from '../lib/orderStatus.js';

const r = Router();

/**
 * Re-read the whole near-term schedule now, rather than a slice per sync.
 *
 * For when somebody is looking at a grid that disagrees with ISN and wants it
 * right this minute. It costs a call per order in the window, which is why the
 * scheduled sync takes it a slice at a time and this is a button.
 */
r.post('/recheck', requireAuth, requireRole('office'), wrap(async (_req, res) => {
  const c = (await q('SELECT * FROM isn_connection LIMIT 1')).rows[0];
  if (!c?.enabled) throw bad('ISN sync is switched off.');

  const before = (await q(
    `SELECT isn_order_id, scheduled_start, employee_id, order_status FROM isn_orders
      WHERE scheduled_start >= now() - interval '45 days'
        AND scheduled_start < now() + interval '45 days'`)).rows;

  const counts = { orders: 0, sets: 0, deleted: 0, skippedOffice: 0 };
  const failures = [];
  const looked = await recheckSoon(c, counts, failures, 2000);

  // What actually moved. Named rather than counted: the office is comparing
  // this against ISN's own board, and "9 corrected" cannot be checked while
  // "23662 moved to the 19th" can.
  const after = new Map((await q(
    `SELECT isn_order_id, order_number, scheduled_start, employee_id, order_status,
            property_address
       FROM isn_orders`)).rows.map((x) => [x.isn_order_id, x]));

  const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
  const moved = [];
  for (const b of before) {
    const a = after.get(b.isn_order_id);
    if (!a) continue;
    const what = [];
    if (day(a.scheduled_start) !== day(b.scheduled_start)) {
      what.push(`moved to ${day(a.scheduled_start) || 'no date'}`);
    } else if (String(a.scheduled_start) !== String(b.scheduled_start)) {
      what.push('time changed');
    }
    if (String(a.employee_id) !== String(b.employee_id)) what.push('different inspector');
    if (String(a.order_status) !== String(b.order_status)) {
      what.push(`now ${a.order_status || 'no status'}`);
    }
    if (what.length) {
      moved.push({ orderNumber: a.order_number, address: a.property_address, what: what.join(', ') });
    }
  }

  res.json({
    looked,
    changed: moved.length,
    moved: moved.slice(0, 25),
    failures: failures.slice(0, 5),
    failureCount: failures.length,
  });
}));

/**
 * What ISN calls things, and what the app does about each one.
 *
 * Open to anyone signed in to read — it explains why a job is or is not on a
 * screen — but only the office can change it, because that decides what the
 * whole branch sees on the schedule.
 */
r.get('/statuses', requireAuth, wrap(async (_req, res) => {
  res.json({ statuses: await statusCensus({ query: q }) });
}));

r.patch('/statuses', requireAuth, requireRole('office'), wrap(async (req, res) => {
  const { status, countsAsWork } = req.body || {};
  if (typeof status !== 'string') throw bad('Which status?');
  if (typeof countsAsWork !== 'boolean') throw bad('Say true or false for whether it is work.');
  const saved = await setStatusRule({ query: q }, status, countsAsWork);
  res.json({ ...saved, statuses: await statusCensus({ query: q }) });
}));

r.get('/status', requireAuth, wrap(async (_req, res) => {
  const [conn, runs, gaps, cached, services, why] = await Promise.all([
    q('SELECT * FROM isn_connection LIMIT 1'),
    q('SELECT * FROM isn_sync_log ORDER BY started_at DESC LIMIT 10'),
    q('SELECT count(*)::int AS n FROM isn_radon_orders_without_sets'),
    q(`SELECT count(*)::int AS orders,
              count(*) FILTER (WHERE order_status NOT IN
                ('Canceled','Deleted','Unscheduled'))::int AS counted,
              count(*) FILTER (WHERE order_status = 'Unscheduled')::int AS unscheduled,
              count(*) FILTER (WHERE order_status = 'Deleted')::int AS deleted,
              count(*) FILTER (WHERE order_status = 'Canceled')::int AS canceled,
              count(*) FILTER (WHERE has_radon)::int AS with_radon,
              count(DISTINCT isn_office_id)::int AS offices,
              count(*) FILTER (WHERE employee_id IS NULL)::int AS unassigned
         FROM isn_orders`),
    // What the office actually calls things. Service names are not personal
    // data, and seeing them is the only way to tell whether "has radon" is
    // matching what it should.
    q(`SELECT COALESCE(s->>'name', s->>'service_name', s#>>'{}') AS name,
              count(*)::int AS orders,
              count(*) FILTER (WHERE (s->>'amount')::numeric > 0)::int AS charged
         FROM isn_orders o, jsonb_array_elements(o.services) s
        GROUP BY 1 ORDER BY 2 DESC LIMIT 20`),
    q(`SELECT radon_reason, count(*)::int AS orders
         FROM isn_orders WHERE has_radon AND radon_reason IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
  ]);
  const c = conn.rows[0] || null;
  res.json({
    connection: c && { ...c, credential_env_var: c.credential_env_var },
    credentialsPresent: !!(process.env.ISN_ACCESS_KEY && process.env.ISN_SECRET_ACCESS_KEY),
    runs: runs.rows,
    schedule: isnScheduleState(),
    cached: cached.rows[0],
    services: services.rows,
    radonReasons: why.rows,
    radonOrdersWithoutSets: gaps.rows[0].n,
  });
}));

/**
 * What ISN actually answers with.
 *
 * Field names and shapes only — an order carries a client's name, phone and
 * address, and none of that is needed to work out which envelope is in use.
 */
r.get('/probe', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  // Anything the office types goes to ISN with our keys, so it has to be a
  // path on ISN and not a way to point those keys at somebody else's host.
  const asked = String(req.query.path || '').trim();
  if (asked) {
    if (!asked.startsWith('/') || asked.startsWith('//') || /^\/*[a-z][a-z0-9+.-]*:/i.test(asked)) {
      throw bad('Give it a path on ISN, starting with a slash — like /events or /event/33398.');
    }
    return res.json({ probes: [await probe(asked)] });
  }

  const probes = [];
  // The last four are not used by the sync. The week grid on Home needs to
  // know when somebody is blocked off, and in ISN that is an Event — a thing
  // with a title, a creator and an id of its own. Whether the API will hand
  // one over is a question, so it gets asked rather than assumed.
  for (const path of ['/me', '/users', '/orders', '/orders/footprints',
                      // '/event/33398' answers 404, and ISN's convention is
                      // plural for a collection and singular for one of them —
                      // so the collection is still worth asking for. '/' is
                      // there because a REST root often lists what it has, and
                      // one index beats guessing nouns one round trip at a time.
                      '/', '/calendar', '/events', '/calendar/events',
                      '/calendar/availableslots', '/availableslots']) {
    probes.push(await probe(path));
  }
  res.json({ probes });
}));

/**
 * Why is this job not showing?
 *
 * Given the order number off ISN's calendar, say what we hold and what each
 * filter makes of it. Guessing at a missing job from the outside costs a
 * deploy per hypothesis; this answers it in one.
 */
/**
 * Why doesn't the total match ISN's?
 *
 * A revenue figure that disagrees with the one the office already trusts puts
 * every other number on the screen under suspicion, and the cause is usually a
 * definition rather than a bug — both sides adding up real jobs, just not the
 * same ones, or the same ones on different days.
 *
 * Pass the figure ISN is showing and this says which way of counting produces
 * it. Everything comes from orders already stored, so it costs no API calls.
 */
/**
 * Read ISN's calendar for time somebody has blocked off.
 *
 * Separate from the order sync and allowed to fail on its own: the week grid
 * losing its grey blocks is a worse screen, while the order sync failing is a
 * branch that cannot see its work. One must not take the other down.
 */
r.post('/events/pull', requireAuth, requireRole('office'), wrap(async (_req, res) => {
  const events = await pullEvents({ query: q },
    { get: isnGet, list: extractList, describe: describeShape, force: true });
  // Availability is the only thing ISN's calendar really offers, so it is
  // asked for whether or not events turned anything up.
  let availability = null;
  try {
    availability = await pullAvailability({ query: q }, { get: isnGet });
  } catch (e) {
    availability = { error: e.message };
  }
  res.json({ ...events, availability });
}));

r.get('/revenue-check', requireAuth, requireRole('office'), wrap(async (req, res) => {
  const target = req.query.target === undefined || req.query.target === ''
    ? null
    : Number(String(req.query.target).replace(/[$,\s]/g, ''));
  if (target !== null && !Number.isFinite(target)) {
    throw bad('That does not read as an amount. Put in what ISN shows, like 49331 or $49,331.00.');
  }
  res.json(await revenueCheck({ query: q }, periodRange(req.query.period, new Date()), { target }));
}));

r.get('/order-lookup', requireAuth, requireRole('office'), wrap(async (req, res) => {
  const number = String(req.query.number || '').trim();
  if (!number) throw bad('Which order number?');

  const R = officeRanges();
  const [found, conn, lastRun] = await Promise.all([
    q(`SELECT o.*,
              (SELECT array_agg(e.full_name) FROM employees e
                WHERE e.id = ANY(o.crew_employee_ids)) AS crew_names
         FROM isn_orders o
        WHERE o.order_number = $1 OR o.isn_order_id = $1
        LIMIT 1`, [number]),
    q('SELECT isn_office_id, pull_window_days FROM isn_connection LIMIT 1'),
    q(`SELECT started_at, status, footprints_seen, orders_upserted, detail
         FROM isn_sync_log ORDER BY started_at DESC LIMIT 1`),
  ]);

  const o = found.rows[0] || null;
  const c = conn.rows[0] || {};
  const run = lastRun.rows[0] || null;

  if (!o) {
    // Not holding it is only half an answer. Ask ISN the same question the
    // sync asks and see whether the order is in the reply at all — that
    // settles "we dropped it" against "we were never offered it" without
    // another deploy.
    const live = await listedByIsn(number).catch((e) => ({ error: e.message }));

    return res.json({
      number,
      cached: false,
      lastPull: run && {
        at: run.started_at, status: run.status,
        ordersListed: run.detail?.listed ?? null,
        ordersSaved: run.orders_upserted,
        footprintsSeen: run.footprints_seen,
        lookbackDays: run.detail?.lookback ?? null,
      },
      live,
      verdict: live?.error
        ? `Not in our copy, and asking ISN failed: ${live.error}`
        : live?.present
          ? 'ISN lists this order, so the pull is dropping it rather than missing it.'
          : live?.canMatchByNumber === false
            ? `Not in our copy yet. ISN's order list is ${live.listed} stubs carrying only `
              + `id, show and modified — no order number — so it cannot say whether this one `
              + `is among them. Every unread order costs its own call; the pull reads the `
              + `most recently changed first and works back, so give it a pull or two.`
            : `Not in our copy, and ISN's list of ${live?.listed ?? 0} does not include it.`,
    });
  }

  const reasons = [];
  if (['Canceled', 'Deleted', 'Unscheduled'].includes(o.order_status)) {
    reasons.push(`Its status here is ${o.order_status}, which is left out of every count.`);
  }
  if (!o.scheduled_start) reasons.push('It has no scheduled time on it.');
  if (c.isn_office_id && o.isn_office_id && o.isn_office_id !== c.isn_office_id) {
    reasons.push('It belongs to a different office than the one you picked.');
  }
  if (!o.crew_employee_ids?.length) {
    reasons.push(o.inspector_isn_id
      ? 'Nobody here is matched to the inspector on it, so it counts for no one.'
      : 'It has no inspector on it at all.');
  }
  if (o.scheduled_start && !(new Date(o.scheduled_start) >= R.dayStart
                             && new Date(o.scheduled_start) < R.dayEnd)) {
    reasons.push('It is not scheduled for today.');
  }

  res.json({
    number,
    cached: true,
    order: {
      isn_order_id: o.isn_order_id,
      order_number: o.order_number,
      status: o.order_status,
      scheduled_start: o.scheduled_start,
      address: o.property_address,
      client: o.client_name,
      office: o.isn_office_id,
      inspector_isn_id: o.inspector_isn_id,
      inspector_name: o.inspector_name,
      crew_isn_ids: o.crew_isn_ids,
      crew_names: o.crew_names || [],
      has_radon: o.has_radon,
      radon_reason: o.radon_reason,
      last_pulled_at: o.last_pulled_at,
    },
    today: { from: R.dayStart, to: R.dayEnd },
    reasons,
    verdict: reasons.length ? reasons.join(' ') : 'Nothing here would keep it off a phone.',
  });
}));

/**
 * Who this ISN says works here.
 *
 * Deriving the roster from orders only ever finds people who already have
 * work. /users is the actual list, so somebody hired last week can be given a
 * login before their first job. Matching is by email, which is the one field
 * both systems agree on; anything unmatched is offered rather than assumed.
 */
r.get('/roster', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  const c = (await q('SELECT isn_office_id FROM isn_connection LIMIT 1')).rows[0] || {};
  const scope = req.query.allOffices === 'true' ? null : (c.isn_office_id || null);

  const [cached, staff, totals, offices] = await Promise.all([
    // Inspectors first and the unmatched above the matched, because this list
    // exists to be worked through. 250 users is a lot to scroll for the four
    // who actually place radon monitors.
    q(`SELECT u.*, e.id AS employee_id, e.full_name AS employee_name
         FROM isn_users u
         LEFT JOIN employees e ON e.isn_user_id = u.isn_user_id
        WHERE u.visible
          AND ($1::boolean IS NOT TRUE OR u.is_inspector)
          AND ($2::text IS NULL OR u.office IS NULL OR u.office = $2)
        ORDER BY u.is_inspector DESC, (e.id IS NULL) DESC, u.display_name NULLS LAST
        LIMIT 400`,
      [req.query.inspectors === 'true', scope]),
    q(`SELECT id, full_name, email, job_title, isn_user_id FROM employees WHERE status = 'Active'
        ORDER BY full_name`),
    q(`SELECT count(*)::int AS listed,
              count(*) FILTER (WHERE is_inspector)::int AS inspectors,
              count(*) FILTER (WHERE detail_pulled_at IS NULL)::int AS stubs_only,
              count(*) FILTER (WHERE $1::text IS NULL OR office IS NULL OR office = $1)::int AS in_our_office,
              max(detail_pulled_at) AS last_refreshed
         FROM isn_users WHERE visible`, [scope]),
    q(`SELECT o.*, count(u.isn_user_id)::int AS people
         FROM isn_offices o LEFT JOIN isn_users u ON u.office = o.isn_office_id AND u.visible
        WHERE o.visible GROUP BY o.isn_office_id ORDER BY o.name`),
  ]);

  const byEmail = new Map(
    staff.rows.filter((e) => e.email).map((e) => [e.email.toLowerCase(), e])
  );

  const roster = cached.rows.map((u) => {
    const email = (u.email || '').toLowerCase() || null;
    const suggestion = !u.employee_id && email ? byEmail.get(email) || null : null;
    return {
      isn_user_id: u.isn_user_id,
      name: u.display_name || u.email || 'Not read yet',
      email,
      role: u.is_owner ? 'Owner' : u.is_inspector ? 'Inspector' : 'Office',
      isInspector: u.is_inspector,
      inactive: !u.visible,
      stubOnly: !u.detail_pulled_at,
      employee_id: u.employee_id,
      employee_name: u.employee_name,
      suggested_employee_id: suggestion?.id ?? null,
      suggested_employee_name: suggestion?.full_name ?? null,
    };
  });

  res.json({
    roster,
    employees: staff.rows,
    totals: totals.rows[0],
    offices: offices.rows,
    ourOffice: c.isn_office_id || null,
    unlinked: roster.filter((x) => !x.employee_id && x.isInspector).length,
  });
}));

/**
 * Read the ISN user list properly.
 *
 * Separate from loading the page because it is one call per person. Held to
 * the ones whose details actually changed, so only the first run is slow.
 */
r.post('/roster/refresh', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  const [me, out] = await Promise.all([
    getMe().then((x) => unwrap(x, 'me')).catch((e) => ({ error: e.message })),
    refreshUsers({
      force: req.body?.force === true,
      includeDeleted: req.body?.includeDeleted === true,
    }),
  ]);
  res.json({
    ...out,
    keysBelongTo: me?.error ? null
      : (me.displayname || [me.firstname, me.lastname].filter(Boolean).join(' ') || me.emailaddress || null),
    meError: me?.error ?? null,
  });
}));

/**
 * Make an ISN user a person here.
 *
 * Creating the employee record is the point: an inspector needs to exist
 * before they can hold a licence, drive a van or be given a login, and
 * retyping what ISN already knows is how the two drift apart.
 */
r.post('/roster/adopt', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  const { isn_user_id, full_name, email, employee_id } = req.body || {};
  if (!isn_user_id) throw bad('Which ISN user?');

  const out = await tx(async (c) => {
    let id = employee_id || null;

    if (!id) {
      if (!full_name?.trim()) throw bad('A person needs a name.');
      const made = await c.query(
        `INSERT INTO employees (full_name, email, role, status)
         VALUES ($1, $2, COALESCE($3, 'Inspector'), 'Active')
         ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
         RETURNING id`,
        [full_name.trim(), email || null, req.body.role || null]
      );
      id = made.rows[0].id;
    }

    await c.query(`UPDATE employees SET isn_user_id = NULL WHERE isn_user_id = $1`, [isn_user_id]);
    await c.query(`UPDATE employees SET isn_user_id = $2 WHERE id = $1`, [id, isn_user_id]);
    const touched = await c.query(
      `UPDATE isn_orders SET employee_id = $2 WHERE inspector_isn_id = $1`, [isn_user_id, id]);

    // Orders already pulled name this person by their ISN id; rebuild the crew
    // lists so the ones they are second on reach them too.
    await c.query(
      `UPDATE isn_orders o
          SET crew_employee_ids = COALESCE((
                SELECT array_agg(DISTINCT e.id)
                  FROM unnest(o.crew_isn_ids) AS x(isn_id)
                  JOIN employees e ON e.isn_user_id = x.isn_id), '{}')
        WHERE $1 = ANY(o.crew_isn_ids)`, [isn_user_id]);
    return { employeeId: id, ordersReassigned: touched.rowCount };
  });

  res.json({ ok: true, ...out });
}));

r.post('/sync', requireAuth, requireRole('office'), wrap(async (_req, res) => {
  res.json(await syncOnce({ source: 'manual' }));
}));

r.patch('/connection', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  const allowed = ['company_key', 'service_domain', 'enabled', 'pull_window_days',
                   'auto_create_sets', 'radon_service_match', 'integration_user', 'isn_office_id',
                   'sync_every_minutes'];
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

    // Orders already pulled name this person by their ISN id; rebuild the crew
    // lists so the ones they are second on reach them too.
    await c.query(
      `UPDATE isn_orders o
          SET crew_employee_ids = COALESCE((
                SELECT array_agg(DISTINCT e.id)
                  FROM unnest(o.crew_isn_ids) AS x(isn_id)
                  JOIN employees e ON e.isn_user_id = x.isn_id), '{}')
        WHERE $1 = ANY(o.crew_isn_ids)`, [isn_user_id]);
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
