-- =====================================================================
-- 011_radon_field_keys.sql
--
-- field/qa-guard.js is the duplicate rule, shared by the phone, the service
-- worker and the tests. It reads the placed monitor as `primary_device`.
-- The seeded deployment form called the same question `device`, so the guard
-- could never see an answer to it.
--
-- Renaming the question is the honest direction: the guard is the authority
-- on the rule, and the duplicate it pairs with is already `duplicate_device`.
-- =====================================================================
BEGIN;

UPDATE field_form_fields ff
   SET key = 'primary_device',
       label = 'Monitor placed'
  FROM field_forms f
  JOIN field_modules m ON m.id = f.module_id
 WHERE ff.form_id = f.id
   AND m.key = 'radon_deploy'
   AND ff.key = 'device'
   AND NOT EXISTS (
     SELECT 1 FROM field_form_fields x WHERE x.form_id = f.id AND x.key = 'primary_device'
   );

-- Any submission already captured under the old key keeps its answer.
UPDATE field_submissions s
   SET payload = (s.payload - 'device') || jsonb_build_object('primary_device', s.payload->'device')
  FROM field_modules m
 WHERE m.id = s.module_id
   AND m.key = 'radon_deploy'
   AND s.payload ? 'device'
   AND NOT s.payload ? 'primary_device';

COMMIT;
