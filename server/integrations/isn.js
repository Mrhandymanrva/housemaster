/**
 * Inspection Support Network.
 *
 * ISN gives every account its own sandboxed REST endpoint, built from the
 * service domain plus the company key plus /rest — so a company key of
 * "acme" on inspectionsupport.net answers at
 * https://inspectionsupport.net/acme/rest. If the domain is unknown, the
 * separate admin API at isnadmin.com/rest resolves it from the company key.
 *
 * Auth is HTTP basic. ISN accepts a user's own login but asks integrations
 * to use an access key / secret access key pair instead, because a user can
 * revoke keys without changing their password. We use the pair, from the
 * environment, belonging to a dedicated integration user.
 *
 * ── The important mechanic ──────────────────────────────────────────────
 * ISN's change feed is "footprints": stubs pointing at upcoming orders for
 * the authenticating user. You GET them, follow each to the real order, and
 * then you MUST DELETE the footprint or it sits there. That makes the read
 * destructive, with two consequences this file is built around:
 *
 *   1. Nothing is deleted until the order is committed locally. A crash
 *      mid-run leaves the footprint for the next pass. Duplicated work is
 *      free here; lost work is not.
 *   2. Footprints belong to the user whose credentials made the call. Using
 *      a person's login would consume notifications that person — or another
 *      integration on the same account — still needed. Hence the dedicated
 *      user.
 *
 * Endpoint paths below follow ISN's documented shape. Confirm the exact
 * field names against the live endpoint list at api.inspectionsupport.net
 * before the first production run; the response shapes are the part most
 * likely to have moved.
 */
import { q, tx } from '../lib/db.js';

const ADMIN_API = 'https://isnadmin.com/rest';

const conn = async () => (await q('SELECT * FROM isn_connection LIMIT 1')).rows[0];

const auth = () => {
  const key = process.env.ISN_ACCESS_KEY;
  const secret = process.env.ISN_SECRET_ACCESS_KEY;
  if (!key || !secret) {
    throw new Error('ISN credentials are not set. Put ISN_ACCESS_KEY and '
      + 'ISN_SECRET_ACCESS_KEY in the environment — they are never stored in the database.');
  }
  return 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64');
};

/** Ask the admin API where this company's ISN lives, and remember it. */
export async function resolveEndpoint(force = false) {
  const c = await conn();
  if (!c) throw new Error('No ISN connection row.');
  if (c.rest_url && !force) return c.rest_url;

  let url;
  if (c.service_domain && c.company_key) {
    url = `https://${c.service_domain}/${c.company_key}/rest`;
  } else {
    const res = await fetch(`${ADMIN_API}/isn/url?companykey=${encodeURIComponent(c.company_key)}`,
      { headers: { Authorization: auth() } });
    if (!res.ok) throw new Error(`ISN admin API said ${res.status}`);
    const body = await res.json();
    if (body.status !== 'ok') throw new Error(`ISN admin API: ${body.status}`);
    url = `${body.url.replace(/\/$/, '')}/${c.company_key}/rest`;
  }

  await q('UPDATE isn_connection SET rest_url = $1, updated_at = now()', [url]);
  return url;
}

async function call(path, { method = 'GET', body } = {}) {
  const base = await resolveEndpoint();
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: auth(),
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ISN ${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

/**
 * Describe a payload without printing it.
 *
 * When a response is not the shape we expected, the useful thing is its
 * shape — not its contents, which are client names and addresses. This goes
 * into the sync log, so the error a person reads says what arrived rather than
 * that something was "not iterable".
 */
export function describeShape(v, depth = 0) {
  if (v === null) return 'null';
  if (Array.isArray(v)) {
    return depth > 1 ? `array(${v.length})`
      : `array(${v.length})${v.length ? ' of ' + describeShape(v[0], depth + 1) : ''}`;
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (depth > 1) return `object{${keys.slice(0, 8).join(', ')}}`;
    return `object{ ${keys.slice(0, 12).map((k) => `${k}: ${describeShape(v[k], depth + 1)}`).join(', ')}${
      keys.length > 12 ? ', …' : ''} }`;
  }
  return typeof v;
}

/**
 * Find the list in a response.
 *
 * ISN wraps its collections, and not always the same way. Rather than assume
 * one envelope, look for a list where a list should be — and if there is not
 * one, say what did arrive instead of failing on `not iterable` three frames
 * later.
 */
export function extractList(payload, what) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    // an envelope naming the thing: { footprints: [...] } / { data: [...] }
    for (const key of [what, 'data', 'results', 'items', 'records', 'rows', 'result']) {
      if (Array.isArray(payload[key])) return payload[key];
    }
    // an envelope with exactly one array in it, whatever it is called
    const arrays = Object.values(payload).filter(Array.isArray);
    if (arrays.length === 1) return arrays[0];
    // keyed by id: { "123": {...}, "124": {...} }
    const values = Object.values(payload);
    if (values.length && values.every((v) => v && typeof v === 'object' && !Array.isArray(v))) {
      return values;
    }
    // an empty envelope is an empty list, not a failure
    if (!values.length) return [];
    if (payload.status && Object.keys(payload).length <= 2) return [];
  }
  throw new Error(
    `ISN returned something that is not a list of ${what}. It sent: ${describeShape(payload)}`
  );
}

/**
 * What does this endpoint actually answer with?
 *
 * Returns the shape and the field names, never the values — an order carries a
 * client's name, phone and address, and none of that is needed to work out
 * which envelope ISN is using.
 */
export async function probe(path) {
  const base = await resolveEndpoint();
  const started = Date.now();
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      headers: { Authorization: auth(), Accept: 'application/json' },
    });
  } catch (err) {
    return { path, url: `${base}${path}`, reachable: false, error: err.message };
  }

  const text = await res.text().catch(() => '');
  const out = {
    path,
    url: `${base}${path}`,
    reachable: true,
    status: res.status,
    contentType: res.headers.get('content-type'),
    bytes: text.length,
    ms: Date.now() - started,
  };

  try {
    const body = JSON.parse(text);
    out.shape = describeShape(body);
    const list = Array.isArray(body) ? body
      : (body && typeof body === 'object'
          ? Object.values(body).find(Array.isArray) || null
          : null);
    if (list?.length && list[0] && typeof list[0] === 'object') {
      out.itemFields = Object.keys(list[0]);
    } else if (body && typeof body === 'object' && !Array.isArray(body)) {
      out.topLevelFields = Object.keys(body);
    }
  } catch {
    // not JSON — say what it looks like without echoing it back
    out.shape = 'not JSON';
    out.startsWith = text.slice(0, 40).replace(/\s+/g, ' ');
  }
  return out;
}

/**
 * Footprints, for the whole company.
 *
 * Without `all` these are only the authenticating user's upcoming jobs, and an
 * office account that never takes inspections has none. With it, ISN also
 * fills in who each one belongs to — the inspector fields are documented as
 * appearing only under that parameter, which is precisely what one set of
 * office keys needs.
 */
export const getFootprints = () => call('/orders/footprints?all=true');
export const dropFootprint = (id) => call(`/orders/footprint/${id}`, { method: 'DELETE' });
export const getOrder = (id) => call(`/order/${id}`);
export const getClient = (id) => call(`/client/${id}`);
export const getAgent = (id) => call(`/agent/${id}`);
export const getUser = (id) => call(`/user/${id}`);

/** Whose keys are these? */
export const getMe = () => call('/me');

/** Every user on the ISN — inspectors, office, owners. */
export const getUsers = () => call('/users');

/** The branches on this ISN. A shared ISN has several; a single one has one. */
export const getOffices = () => call('/offices');

/**
 * Refresh the office list and return it.
 *
 * Offices come back whole rather than as stubs, so this is one call.
 */
export async function refreshOffices() {
  const offices = extractList(await getOffices(), 'offices');
  for (const o of offices) {
    if (!o?.id) continue;
    await q(
      `INSERT INTO isn_offices (isn_office_id, name, slug, city, state, manager, visible, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now())
       ON CONFLICT (isn_office_id) DO UPDATE SET
         name = EXCLUDED.name, slug = EXCLUDED.slug, city = EXCLUDED.city,
         state = EXCLUDED.state, manager = EXCLUDED.manager,
         visible = EXCLUDED.visible, last_seen_at = now()`,
      [String(o.id), blank(o.name), blank(o.slug), blank(o.city), blank(o.state),
       blank(o.manager), bool(o.show, true)]
    );
  }
  return offices.length;
}

/**
 * Refresh the local copy of the ISN user list.
 *
 * /users answers with stubs — id, show, modified — so every name, email and
 * inspector flag costs its own call. Anyone whose `modified` has not moved
 * since we last read them is skipped, which makes the second refresh cheap
 * even when the first one is 250 calls.
 */
export async function refreshUsers({ force = false, concurrency = 6, includeDeleted = false,
                                     limit = 500 } = {}) {
  await refreshOffices().catch(() => 0);
  const c = await conn();
  const ours = c?.isn_office_id || null;

  const stubs = extractList(await getUsers(), 'users');

  const known = new Map(
    (await q(`SELECT isn_user_id, isn_modified, detail_pulled_at, office FROM isn_users`)).rows
      .map((r) => [r.isn_user_id, r])
  );

  const seen = [];
  const wanted = [];
  let deleted = 0;
  let elsewhere = 0;
  for (const s of stubs) {
    const id = String(s.id ?? '');
    if (!id) continue;
    seen.push(id);

    // ISN keeps everyone who ever had an account. `show: false` is a deleted
    // user, and reading their details costs a call to learn the name of
    // somebody who left years ago.
    const visible = bool(s.show, true);
    if (!visible && !includeDeleted) {
      deleted += 1;
      await q(
        `INSERT INTO isn_users (isn_user_id, visible, isn_modified, last_seen_at)
         VALUES ($1, false, $2, now())
         ON CONFLICT (isn_user_id) DO UPDATE SET visible = false, last_seen_at = now()`,
        [id, s.modified || null]
      );
      continue;
    }

    const mine = known.get(id);

    // The stub does not say which office somebody belongs to, so the first run
    // has to read everyone to find out. Once it is known, people at other
    // branches are left alone.
    if (ours && mine?.detail_pulled_at && mine.office && mine.office !== ours && !force) {
      elsewhere += 1;
      continue;
    }

    const unchanged = mine?.detail_pulled_at
      && String(mine.isn_modified?.toISOString?.() ?? mine.isn_modified ?? '') === String(s.modified ?? '');
    if (force || !unchanged) wanted.push({ id, modified: s.modified ?? null, visible });
  }

  // Newest first, so a run that hits the ceiling has read the people most
  // likely to still be working here.
  wanted.sort((a, b) => String(b.modified ?? '').localeCompare(String(a.modified ?? '')));
  const remaining = Math.max(0, wanted.length - limit);
  wanted.length = Math.min(wanted.length, limit);

  let pulled = 0;
  const failures = [];
  for (let i = 0; i < wanted.length; i += concurrency) {
    const batch = wanted.slice(i, i + concurrency);
    await Promise.all(batch.map(async (w) => {
      let u = null;
      try {
        u = unwrap(await getUser(w.id), 'user');
      } catch (err) {
        failures.push({ id: w.id, error: String(err.message || err).slice(0, 200) });
      }
      await q(
        `INSERT INTO isn_users
           (isn_user_id, display_name, first_name, last_name, email, phone,
            is_inspector, is_owner, office, visible, isn_modified, detail_pulled_at, raw, last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb, now())
         ON CONFLICT (isn_user_id) DO UPDATE SET
           display_name = EXCLUDED.display_name, first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name, email = EXCLUDED.email, phone = EXCLUDED.phone,
           is_inspector = EXCLUDED.is_inspector, is_owner = EXCLUDED.is_owner,
           office = EXCLUDED.office, visible = EXCLUDED.visible,
           isn_modified = EXCLUDED.isn_modified,
           detail_pulled_at = COALESCE(EXCLUDED.detail_pulled_at, isn_users.detail_pulled_at),
           raw = COALESCE(EXCLUDED.raw, isn_users.raw),
           last_seen_at = now()`,
        [
          w.id,
          u ? (u.displayname || [u.firstname, u.lastname].filter(Boolean).join(' ') || null) : null,
          u?.firstname ?? null, u?.lastname ?? null,
          u?.emailaddress ?? null, u?.mobile ?? u?.phone ?? null,
          bool(u?.inspector), bool(u?.owner), blank(u?.office),
          w.visible, w.modified || null,
          u ? new Date() : null,
          u ? JSON.stringify(u) : null,
        ]
      );
      if (u) pulled += 1;
    }));
  }

  // Anyone ISN no longer lists is hidden rather than deleted — an order from
  // last month may still point at them.
  if (seen.length) {
    await q(`UPDATE isn_users SET visible = false WHERE isn_user_id <> ALL($1::text[])`, [seen]);
  }

  await q(
    `UPDATE isn_users u SET office_name = o.name
       FROM isn_offices o WHERE o.isn_office_id = u.office AND u.office_name IS DISTINCT FROM o.name`
  );

  return {
    listed: stubs.length,
    deleted,
    elsewhere,
    detailed: pulled,
    unchanged: stubs.length - deleted - elsewhere - wanted.length - remaining,
    remaining,
    failures,
  };
}

/** ISN unwraps most things into { status, <name>: … }. */
export const unwrap = (payload, key) =>
  (payload && typeof payload === 'object' && payload[key] !== undefined ? payload[key] : payload);

/**
 * Every order, not just the ones belonging to whoever owns the keys.
 *
 * Footprints are a per-user change feed: ISN's own documentation says they are
 * the upcoming inspections of "the inspector whom logged in". A single set of
 * office keys would therefore see one person's work, or none at all if that
 * account is never assigned an inspection. /orders is company-wide, which is
 * what a back office actually needs.
 */
export const getOrders = (after) =>
  call(`/orders${after ? `?after=${encodeURIComponent(after)}` : ''}`);

// --------------------------------------------------------------- mapping

/**
 * Was radon actually sold on this job?
 *
 * Two things here could match every order.
 *
 * An empty string in the match list matches everything, because ''.includes()
 * is always true — one blank entry and the whole company has radon. Blanks are
 * dropped now, and an empty list matches nothing rather than everything.
 *
 * And an ISN order commonly carries the office's whole price list as fee lines,
 * most of them at zero. A radon line at nothing is a price on a menu, not a
 * sale. So a booked service counts on its own; a fee only counts if it was
 * actually charged.
 *
 * Returns why it matched, so a wrong answer can be read rather than guessed at.
 */
export function radonMatch(order, patterns) {
  const pats = (patterns || [])
    .map((p) => String(p ?? '').trim().toLowerCase())
    .filter(Boolean);
  if (!pats.length) return { has: false, why: null };

  const hit = (name) => {
    const n = String(name ?? '').trim().toLowerCase();
    return n ? pats.some((p) => n.includes(p)) : false;
  };
  const nameOf = (x) => x?.name ?? x?.service_name ?? (typeof x === 'string' ? x : null);

  for (const s of order?.services || []) {
    const name = nameOf(s);
    if (hit(name)) return { has: true, why: `booked service "${name}"` };
  }

  for (const f of order?.fees || []) {
    const name = nameOf(f);
    if (!hit(name)) continue;
    const amount = Number(f?.amount ?? f?.price ?? f?.fee);
    if (Number.isFinite(amount) && amount > 0) {
      return { has: true, why: `fee "${name}" charged at ${amount}` };
    }
  }

  return { has: false, why: null };
}

/** The older call shape: one flat list of service-ish things. */
export function hasRadon(services, patterns) {
  return radonMatch({ services: services || [] }, patterns).has;
}

/**
 * What was actually sold on this job.
 *
 * The same distinction radon needs, for every other service too: an order
 * carries the office's whole fee schedule, most lines at zero, so asking
 * "does this order mention mold" answers yes for every order in the company.
 * A booked service is a sale; a fee is a sale only if it was charged.
 *
 * Counting reads this rather than the full list, so every job type gets the
 * answer radon gets.
 */
export function soldServices(order) {
  const sold = [];
  for (const s of order?.services || []) {
    const name = s?.name ?? s?.service_name ?? (typeof s === 'string' ? s : null);
    if (name) sold.push({ name, from: 'service' });
  }
  for (const f of order?.fees || []) {
    const name = f?.name ?? f?.service_name ?? null;
    const amount = Number(f?.amount ?? f?.price ?? f?.fee);
    if (name && Number.isFinite(amount) && amount > 0) {
      sold.push({ name, from: 'fee', amount });
    }
  }
  return sold;
}

/**
 * What radon was charged at.
 *
 * A booked service is {uuid, name} and carries no money; the fee entry beside
 * it is where the amount lives. Both are named the same thing, so take the
 * first radon line that actually has a price rather than the first one at all.
 */
export function radonFee(services) {
  const named = (services || []).filter((s) =>
    String(s?.name ?? s?.service_name ?? '').toLowerCase().includes('radon'));
  for (const s of named) {
    const raw = s?.amount ?? s?.price ?? s?.fee;
    if (raw != null && raw !== '' && Number.isFinite(Number(raw))) return Number(raw);
  }
  return null;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : null;
};
const blank = (v) => (v === '' || v == null ? null : v);

/**
 * A date, or nothing.
 *
 * ISN writes an absent date several ways — an empty string, the literal text
 * "null", a zero date. Any of those left as a string reads as a real value
 * downstream, so an order nobody has scheduled shows up in today's work.
 */
export function asDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  if (!s || /^(null|undefined|none|0)$/i.test(s)) return null;
  if (/^0{4}-0{2}-0{2}/.test(s)) return null;          // 0000-00-00, the MySQL zero date
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
/**
 * ISN returns booleans as the strings "yes" and "no" — and `!!"no"` is true,
 * which is how every user came back flagged as both an inspector and an owner.
 * Anything genuinely unset stays unset rather than defaulting to true.
 */
export function bool(v, fallback = false) {
  if (v === true || v === false) return v;
  if (v == null || v === '') return fallback;
  const s = String(v).trim().toLowerCase();
  if (['yes', 'true', '1', 'y'].includes(s)) return true;
  if (['no', 'false', '0', 'n'].includes(s)) return false;
  return fallback;
}
const yes = (v) => bool(v);

/** A person's name, however this endpoint spells it. */
const personName = (p) =>
  blank(p?.display) ?? blank(p?.displayname) ??
  ([p?.first ?? p?.firstname, p?.last ?? p?.lastname].filter(Boolean).join(' ') || null);

/**
 * An ISN order, in our words.
 *
 * Field names follow ISN's published schema: an inspection is `datetime`, the
 * street is `address1`, and the inspector is `inspector1` — of ten slots, since
 * an order can carry a whole crew. The first is the one whose day this job is
 * on, and the rest are along for it.
 */
export function normalizeOrder(order, extras = {}) {
  // An order that has not been scheduled yet still has a datetime field —
  // ISN's own schema calls it "Order datetime or literal string 'null'". Left
  // as a string that is not a date, it reads as scheduled and gets counted.
  //
  // There is no fallback to `scheduleddatetime`: despite the name, the schema
  // describes it as the id of the user who did the scheduling.
  const start = asDate(order.datetime);
  const minutes = num(order.duration);
  const crew = Array.from({ length: 10 }, (_, i) => blank(order[`inspector${i + 1}`]))
    .filter(Boolean);

  return {
    isn_order_id: String(order.id),
    order_number: blank(order.oid) != null ? String(order.oid) : blank(order.reportnumber),
    order_url: blank(order.mapurl),
    scheduled_start: start,
    scheduled_end: start && minutes ? new Date(start.getTime() + minutes * 60000) : null,

    // The lead inspector. extras.inspector fills in the name, because the
    // order only ever carries ids.
    inspector_isn_id: crew[0] ?? null,
    inspector_name: personName(extras.inspector) ?? blank(extras.inspectorName),

    property_address: [blank(order.address1), blank(order.address2)].filter(Boolean).join(' ') || null,
    property_city: blank(order.city),
    property_state: blank(order.stateabbreviation) ?? blank(order.state),
    isn_office_id: blank(order.office),
    property_zip: blank(order.zip),
    square_feet: num(order.squarefeet),
    year_built: num(order.yearbuilt),
    foundation_type: blank(order.foundation),

    client_name: personName(extras.client),
    client_phone: blank(extras.client?.mobilephone) ?? blank(extras.client?.homephone)
      ?? blank(extras.client?.workphone),
    client_email: blank(extras.client?.email),
    agent_name: personName(extras.agent),
    agent_email: blank(extras.agent?.email),

    // Services are what was booked; fees are what it costs. Radon can be
    // written up as either, so keep both and let the matcher look at all of it.
    services: [...(order.services || []), ...(order.fees || [])],

    // `show` is ISN's deleted flag — "yes or no ... if the order has been
    // deleted". A deleted order is not a job and must not be counted as one.
    order_status: !bool(order.show, true) ? 'Deleted'
      : yes(order.canceled) ? 'Canceled'
      : yes(order.complete) ? 'Complete'
      : start ? 'Scheduled' : 'Unscheduled',

    crew,
  };
}

// ------------------------------------------------------------------ sync

/**
 * One pass over the footprint queue.
 *
 * Per footprint: pull the order, pull its client and agent, write it locally,
 * draft the radon set if the order has radon on it, commit — and only then
 * tell ISN it can drop the footprint.
 */
export async function syncOnce({ source = 'schedule' } = {}) {
  const c = await conn();
  if (!c?.enabled) return { skipped: 'ISN sync is switched off.' };

  const run = (await q(
    `INSERT INTO isn_sync_log (trigger_source) VALUES ($1) RETURNING id`, [source]
  )).rows[0];

  const counts = { footprints: 0, orders: 0, sets: 0, deleted: 0 };
  const failures = [];

  try {
    // Two sources, on purpose.
    //
    // /orders is company-wide, which is what the office needs: one set of keys
    // sees every inspector's work. Footprints are ISN's change feed and are
    // scoped to whoever owns the keys — useful, but on their own they would
    // show one person's day, or nobody's if that account never takes jobs.
    //
    // Footprints are still consumed and deleted, because ISN expects that and
    // they pile up otherwise.
    const window = Number(c.pull_window_days || 14);
    const after = new Date(Date.now() - window * 86400000).toISOString();

    const [everyOrder, footprints] = await Promise.all([
      getOrders(after).then((x) => extractList(x, 'orders')).catch((e) => {
        failures.push({ stage: 'orders', error: e.message });
        return [];
      }),
      getFootprints().then((x) => extractList(x, 'footprints')).catch((e) => {
        failures.push({ stage: 'footprints', error: e.message });
        return [];
      }),
    ]);
    counts.footprints = footprints.length;

    const withinWindow = (when) => {
      if (!when) return true;                    // no date on the stub — decide from the order
      const days = (new Date(when) - Date.now()) / 86400000;
      return days >= -window && days <= window;
    };

    // One pass per order, whichever source named it. A footprint points at its
    // order through `order`; an order names itself through `id`.
    // On a shared ISN most of these orders belong to other branches. Skipping
    // them here saves a call each, and there is no point caching another
    // office's clients.
    const ours = c.isn_office_id || null;
    const mine = (o) => !ours || !o?.office || String(o.office) === ours;

    const work = new Map();
    for (const o of everyOrder) {
      if (o?.id && withinWindow(o.datetime) && mine(o)) work.set(String(o.id), null);
    }
    for (const fp of footprints) {
      if (fp?.order) work.set(String(fp.order), fp.id ?? null);
    }

    for (const [orderId, footprintId] of work) {
      try {
        const order = unwrap(await getOrder(orderId), 'order');
        const leadInspector = Array.from({ length: 10 }, (_, i) => order[`inspector${i + 1}`])
          .find((x) => x);
        const [client, agent, inspector] = await Promise.all([
          order.client ? getClient(order.client).then((x) => unwrap(x, 'client')).catch(() => null) : null,
          order.buyersagent ? getAgent(order.buyersagent).then((x) => unwrap(x, 'agent')).catch(() => null) : null,
          leadInspector ? getUser(leadInspector).then((x) => unwrap(x, 'user')).catch(() => null) : null,
        ]);

        const o = normalizeOrder(order, { client, agent, inspector });
        // Against the raw order, which still has services and fees apart —
        // a booked service is a sale, a zero fee line is a price list.
        const { has: radon, why: radonWhy } = radonMatch(order, c.radon_service_match);

        const saved = await tx(async (t) => {
          const row = (await t.query(
            `INSERT INTO isn_orders
               (isn_order_id, order_number, order_url, scheduled_start, scheduled_end,
                inspector_isn_id, inspector_name, employee_id,
                property_address, property_city, property_state, property_zip,
                square_feet, year_built, foundation_type,
                client_name, client_phone, client_email, agent_name, agent_email,
                services, sold_services, has_radon, radon_fee, radon_reason, order_status,
                isn_office_id, raw, last_pulled_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,
                     (SELECT id FROM employees WHERE isn_user_id = $6 LIMIT 1),
                     $8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
                     $20::jsonb,$21::jsonb,$22,$23,$24,$25,$26,$27::jsonb, now())
             ON CONFLICT (isn_order_id) DO UPDATE SET
               scheduled_start = EXCLUDED.scheduled_start,
               scheduled_end   = EXCLUDED.scheduled_end,
               inspector_isn_id= EXCLUDED.inspector_isn_id,
               inspector_name  = EXCLUDED.inspector_name,
               employee_id     = EXCLUDED.employee_id,
               property_address= EXCLUDED.property_address,
               property_city   = EXCLUDED.property_city,
               property_zip    = EXCLUDED.property_zip,
               client_name     = EXCLUDED.client_name,
               client_phone    = EXCLUDED.client_phone,
               client_email    = EXCLUDED.client_email,
               agent_name      = EXCLUDED.agent_name,
               services        = EXCLUDED.services,
               sold_services   = EXCLUDED.sold_services,
               has_radon       = EXCLUDED.has_radon,
               radon_fee       = EXCLUDED.radon_fee,
               radon_reason    = EXCLUDED.radon_reason,
               order_status    = EXCLUDED.order_status,
               isn_office_id   = EXCLUDED.isn_office_id,
               raw             = EXCLUDED.raw,
               last_pulled_at  = now()
             RETURNING id, has_radon`,
            [o.isn_order_id, o.order_number, o.order_url, o.scheduled_start, o.scheduled_end,
             o.inspector_isn_id, o.inspector_name,
             o.property_address, o.property_city, o.property_state, o.property_zip,
             o.square_feet, o.year_built, o.foundation_type,
             o.client_name, o.client_phone, o.client_email, o.agent_name, o.agent_email,
             JSON.stringify(o.services), JSON.stringify(soldServices(order)),
             radon, radonFee(o.services), radonWhy, o.order_status, o.isn_office_id,
             JSON.stringify(order)]
          )).rows[0];

          let setId = null;
          if (radon && c.auto_create_sets) {
            setId = (await t.query('SELECT isn_draft_radon_set($1) AS id', [row.id])).rows[0].id;
          } else {
            // This order used to look like radon and does not any more. Void
            // the draft nobody has touched — a set with a monitor on it or a
            // reading against it is somebody's work and is left alone.
            await t.query(
              `UPDATE radon_tests SET status = 'Voided'
                WHERE isn_order_uuid = $1 AND status = 'Scheduled'
                  AND NOT EXISTS (SELECT 1 FROM radon_deployments d
                                   WHERE d.radon_test_id = radon_tests.id)`,
              [row.id]
            );
          }
          return { orderRow: row, setId };
        });

        counts.orders += 1;
        if (saved.setId) counts.sets += 1;

        // Committed. Now, and only now, ISN may forget about it.
        if (footprintId) {
          await dropFootprint(footprintId);
          counts.deleted += 1;
        }
      } catch (err) {
        // One bad order does not stop the run, and its footprint survives.
        failures.push({ orderId, error: String(err.message || err).slice(0, 300) });
      }
    }

    const status = failures.length ? 'partial' : 'ok';
    await q(
      `UPDATE isn_sync_log SET finished_at = now(), status = $2,
              footprints_seen = $3, orders_upserted = $4, sets_created = $5,
              footprints_deleted = $6, detail = $7::jsonb WHERE id = $1`,
      [run.id, status, counts.footprints, counts.orders, counts.sets, counts.deleted,
       JSON.stringify({ failures })]
    );
    await q(
      `UPDATE isn_connection SET last_sync_at = now(), last_sync_status = $1,
              last_sync_error = $2`,
      [status, failures.length ? failures[0].error : null]
    );

    return { ...counts, status, failures };
  } catch (err) {
    await q(
      `UPDATE isn_sync_log SET finished_at = now(), status = 'failed', error = $2 WHERE id = $1`,
      [run.id, String(err.message || err).slice(0, 500)]
    );
    await q(
      `UPDATE isn_connection SET last_sync_at = now(), last_sync_status = 'failed',
              last_sync_error = $1`, [String(err.message || err).slice(0, 500)]
    );
    throw err;
  }
}

export default { syncOnce, resolveEndpoint, getFootprints, getOrder, normalizeOrder, hasRadon };
