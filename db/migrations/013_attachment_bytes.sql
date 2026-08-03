-- =====================================================================
-- 013_attachment_bytes.sql — photos become records instead of strings.
--
-- The attachments table was written for an object store that was never wired,
-- so phone photos ended up inside submission payloads and the radon custody
-- events pointed at "the photo in that submission" rather than at a photo.
--
-- The bytes live in their own table, not on `attachments`, so nothing that
-- lists attachments ever drags an image along with it. `storage_key` keeps its
-- meaning: 'db:<id>' today, an object key the day there is somewhere to put it.
-- =====================================================================
BEGIN;

ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS checksum text;

-- Same bytes filed twice against the same record is one photo, not two.
CREATE UNIQUE INDEX IF NOT EXISTS attachments_one_per_checksum
  ON attachments (entity, entity_id, checksum) WHERE checksum IS NOT NULL;

CREATE TABLE IF NOT EXISTS attachment_blobs (
  attachment_id uuid PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
  bytes         bytea NOT NULL
);

-- ---------------------------------------------------------------------
-- Everything already captured moves too. A chain of custody that only holds
-- for photos taken after today is not a chain of custody.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  s    record;
  k    text;
  v    text;
  aid  uuid;
  mime text;
  raw  bytea;
BEGIN
  FOR s IN SELECT id, employee_id, payload FROM field_submissions LOOP
    FOR k, v IN SELECT key, value FROM jsonb_each_text(s.payload) LOOP
      CONTINUE WHEN v IS NULL OR v NOT LIKE 'data:image/%;base64,%';

      mime := split_part(split_part(v, ':', 2), ';', 1);
      raw  := decode(split_part(v, ',', 2), 'base64');
      CONTINUE WHEN octet_length(raw) = 0;

      INSERT INTO attachments
        (entity, entity_id, kind, filename, mime_type, byte_size, storage_key, checksum, uploaded_by)
      VALUES ('field_submissions', s.id, 'Photo',
              k || '.' || COALESCE(NULLIF(split_part(mime, '/', 2), ''), 'bin'),
              mime, octet_length(raw), 'pending', encode(digest(raw, 'sha256'), 'hex'), s.employee_id)
      ON CONFLICT DO NOTHING
      RETURNING id INTO aid;

      CONTINUE WHEN aid IS NULL;   -- already filed on a previous run

      INSERT INTO attachment_blobs (attachment_id, bytes) VALUES (aid, raw);
      UPDATE attachments SET storage_key = 'db:' || aid WHERE id = aid;

      -- the payload keeps a reference where the image used to be
      UPDATE field_submissions
         SET payload = jsonb_set(payload, ARRAY[k], to_jsonb('attachment:' || aid))
       WHERE id = s.id;

      -- and any custody event that pointed into the submission now points at the photo
      UPDATE radon_custody_events
         SET photo_ref = 'attachment:' || aid
       WHERE photo_ref = 'field_submission:' || s.id || '#' || k;
    END LOOP;
  END LOOP;
END $$;

COMMIT;
