import { Router } from 'express';
import { q } from '../lib/db.js';
import { wrap, notFound } from '../lib/http.js';
import { requireAuth } from '../lib/auth.js';

const r = Router();

/** What is on file, without the bytes. */
r.get('/:id/meta', requireAuth, wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT a.id, a.entity, a.entity_id, a.kind, a.filename, a.mime_type, a.byte_size,
            a.checksum, a.created_at, e.full_name AS uploaded_by_name
       FROM attachments a LEFT JOIN employees e ON e.id = a.uploaded_by
      WHERE a.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw notFound('No such attachment.');
  res.json({ attachment: rows[0] });
}));

/**
 * The image itself. Content-addressed by checksum, so it can be cached hard —
 * an attachment's bytes never change; a correction is a new attachment.
 */
r.get('/:id', requireAuth, wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT a.mime_type, a.filename, a.checksum, b.bytes
       FROM attachments a JOIN attachment_blobs b ON b.attachment_id = a.id
      WHERE a.id = $1`,
    [req.params.id]
  );
  const file = rows[0];
  if (!file) throw notFound('No such attachment.');

  if (file.checksum && req.headers['if-none-match'] === `"${file.checksum}"`) {
    return res.status(304).end();
  }
  res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${file.filename}"`);
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  if (file.checksum) res.setHeader('ETag', `"${file.checksum}"`);
  res.send(file.bytes);
}));

export default r;
