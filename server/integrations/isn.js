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

export const getFootprints = () => call('/orders/footprints');
export const dropFootprint = (id) => call(`/orders/footprint/${id}`, { method: 'DELETE' });
export const getOrder = (id) => call(`/order/${id}`);
export const getClient = (id) => call(`/client/${id}`);
export const getAgent = (id) => call(`/agent/${id}`);

// --------------------------------------------------------------- mapping

/** ISN spells its services however the office set them up. Match loosely. */
export function hasRadon(services, patterns) {
  const names = (services || []).map((s) =>
    String(s?.name ?? s?.service_name ?? s ?? '').toLowerCase());
  return names.some((n) => patterns.some((p) => n.includes(p.toLowerCase())));
}

export function radonFee(services) {
  const hit = (services || []).find((s) =>
    String(s?.name ?? s?.service_name ?? '').toLowerCase().includes('radon'));
  const raw = hit?.price ?? hit?.fee ?? hit?.amount;
  return raw == null ? null : Number(raw);
}

/** Everything ISN calls something slightly different lands here. */
export function normalizeOrder(order, extras = {}) {
  const addr = order.address || order.property || order || {};
  return {
    isn_order_id: String(order.id ?? order.order_id ?? order.orderId),
    order_number: order.order_number ?? order.orderNumber ?? null,
    order_url: order.url ?? order.order_url ?? null,
    scheduled_start: order.inspection_date ?? order.start ?? order.scheduled_start ?? null,
    scheduled_end: order.end ?? order.scheduled_end ?? null,
    inspector_isn_id: order.inspector_id ?? order.inspectorId ?? null,
    inspector_name: order.inspector_name ?? order.inspector ?? null,
    property_address: addr.address ?? addr.street ?? order.address_line ?? null,
    property_city: addr.city ?? null,
    property_state: addr.state ?? null,
    property_zip: addr.zip ?? addr.postal_code ?? null,
    square_feet: order.square_feet ?? order.sqft ?? null,
    year_built: order.year_built ?? null,
    foundation_type: order.foundation ?? order.foundation_type ?? null,
    client_name: extras.client?.name
      ?? ([extras.client?.first_name, extras.client?.last_name].filter(Boolean).join(' ') || null),
    client_phone: extras.client?.phone ?? extras.client?.mobile ?? null,
    client_email: extras.client?.email ?? null,
    agent_name: extras.agent?.name
      ?? ([extras.agent?.first_name, extras.agent?.last_name].filter(Boolean).join(' ') || null),
    agent_email: extras.agent?.email ?? null,
    services: order.services ?? order.fees ?? [],
    order_status: order.status ?? null,
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
    const footprints = await getFootprints();
    counts.footprints = footprints?.length ?? 0;

    for (const fp of footprints || []) {
      const footprintId = fp.id ?? fp.footprint_id;
      const orderId = fp.order_id ?? fp.orderId ?? fp.id;

      try {
        const order = await getOrder(orderId);
        const [client, agent] = await Promise.all([
          order.client_id ? getClient(order.client_id).catch(() => null) : null,
          order.agent_id ? getAgent(order.agent_id).catch(() => null) : null,
        ]);

        const o = normalizeOrder(order, { client, agent });
        const radon = hasRadon(o.services, c.radon_service_match);

        const saved = await tx(async (t) => {
          const row = (await t.query(
            `INSERT INTO isn_orders
               (isn_order_id, order_number, order_url, scheduled_start, scheduled_end,
                inspector_isn_id, inspector_name, employee_id,
                property_address, property_city, property_state, property_zip,
                square_feet, year_built, foundation_type,
                client_name, client_phone, client_email, agent_name, agent_email,
                services, has_radon, radon_fee, order_status, raw, last_pulled_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,
                     (SELECT id FROM employees WHERE isn_user_id = $6 LIMIT 1),
                     $8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
                     $20::jsonb,$21,$22,$23,$24::jsonb, now())
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
               has_radon       = EXCLUDED.has_radon,
               radon_fee       = EXCLUDED.radon_fee,
               order_status    = EXCLUDED.order_status,
               raw             = EXCLUDED.raw,
               last_pulled_at  = now()
             RETURNING id, has_radon`,
            [o.isn_order_id, o.order_number, o.order_url, o.scheduled_start, o.scheduled_end,
             o.inspector_isn_id, o.inspector_name,
             o.property_address, o.property_city, o.property_state, o.property_zip,
             o.square_feet, o.year_built, o.foundation_type,
             o.client_name, o.client_phone, o.client_email, o.agent_name, o.agent_email,
             JSON.stringify(o.services), radon, radonFee(o.services), o.order_status,
             JSON.stringify(order)]
          )).rows[0];

          let setId = null;
          if (radon && c.auto_create_sets) {
            setId = (await t.query('SELECT isn_draft_radon_set($1) AS id', [row.id])).rows[0].id;
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
