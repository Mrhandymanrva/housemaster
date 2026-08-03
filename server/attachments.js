/**
 * Where photos actually live.
 *
 * The `attachments` table was written for an object store that does not exist,
 * so the bytes go in Postgres — which on this deployment is the only thing with
 * a volume behind it. That is a real tradeoff and not the end state: a few
 * hundred kilobytes per set is nothing, a few years of them is a database
 * nobody wants to restore. `storage_key` keeps its meaning (`db:<id>` now, an
 * object key later), and the bytes sit in their own table so no ordinary query
 * ever drags an image along by accident.
 *
 * What this buys today is a chain of custody that holds: the photo is a row
 * with a size, a checksum and an uploader, referenced by the custody event,
 * and it cannot quietly diverge from the record that points at it.
 */
import { createHash } from 'node:crypto';

/** A phone photo is ~150KB. Anything past this is not a photo of a monitor. */
export const MAX_BYTES = 5 * 1024 * 1024;

const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i;

/** Pull a data URL apart, or return null if it is not one. */
export function parseDataUrl(value) {
  if (typeof value !== 'string') return null;
  const m = DATA_URL.exec(value);
  if (!m) return null;
  const bytes = Buffer.from(m[2], 'base64');
  if (!bytes.length) return null;
  return { mime: m[1].toLowerCase(), bytes };
}

export const isAttachmentRef = (v) => typeof v === 'string' && v.startsWith('attachment:');
export const refToId = (v) => (isAttachmentRef(v) ? v.slice('attachment:'.length) : null);

const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic',
};

/**
 * Store one image and return its reference. Identical bytes against the same
 * record are stored once — a tech who taps send twice does not get two photos.
 */
export async function storeImage(c, { mime, bytes, entity, entityId, kind = 'Photo', name, uploadedBy }) {
  if (bytes.length > MAX_BYTES) {
    throw new Error(`That photo is ${Math.round(bytes.length / 1024)}KB — too large to file.`);
  }
  const sha = createHash('sha256').update(bytes).digest('hex');

  const existing = await c.query(
    `SELECT id FROM attachments WHERE entity = $1 AND entity_id = $2 AND checksum = $3 LIMIT 1`,
    [entity, entityId, sha]
  );
  if (existing.rows[0]) return `attachment:${existing.rows[0].id}`;

  const { rows } = await c.query(
    `INSERT INTO attachments
       (entity, entity_id, kind, filename, mime_type, byte_size, storage_key, checksum, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8) RETURNING id`,
    [entity, entityId, kind, `${name}.${EXT[mime] || 'bin'}`, mime, bytes.length, sha, uploadedBy || null]
  );
  const id = rows[0].id;

  await c.query(`INSERT INTO attachment_blobs (attachment_id, bytes) VALUES ($1, $2)`, [id, bytes]);
  await c.query(`UPDATE attachments SET storage_key = $2 WHERE id = $1`, [id, `db:${id}`]);
  return `attachment:${id}`;
}

/**
 * Take every photo out of a submission's payload and file it, leaving a
 * reference behind. Runs before anything reads the payload, so whatever a
 * record ends up pointing at is already a real attachment rather than several
 * thousand characters of base64 sitting in a jsonb column.
 */
export async function absorbPayloadImages(c, sub) {
  const payload = sub.payload || {};
  const out = { ...payload };
  let found = 0;

  for (const [key, value] of Object.entries(payload)) {
    const img = parseDataUrl(value);
    if (!img) continue;
    out[key] = await storeImage(c, {
      ...img,
      entity: 'field_submissions',
      entityId: sub.id,
      name: key,
      uploadedBy: sub.employee_id,
    });
    found++;
  }

  if (found) {
    await c.query(`UPDATE field_submissions SET payload = $2 WHERE id = $1`,
      [sub.id, JSON.stringify(out)]);
  }
  return out;
}

/**
 * Re-file a submission's photos against the record it became, so they show up
 * on the radon set rather than only on the paperwork that created it.
 */
export async function relinkAttachments(c, submissionId, entity, entityId) {
  if (!entity || !entityId) return;
  await c.query(
    `UPDATE attachments SET entity = $2, entity_id = $3
      WHERE entity = 'field_submissions' AND entity_id = $1`,
    [submissionId, entity, entityId]
  );
}
