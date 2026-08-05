-- =====================================================================
-- 025_radon_form_pickers.sql — pick the monitor and the job, do not hunt.
--
-- "Monitor placed" listed every asset the company owns: ladders, drones,
-- tablets. A tech standing in a basement scrolls past all of it to find a
-- CRM. There is already a view of exactly the radon monitors — the same one
-- the duplicate rule reads — so the field points at that.
--
-- "Property address" was a free-text box, which means typing an address that
-- ISN already knows, differently. It becomes the inspector's own scheduled
-- radon placements, which also lets the set link back to the order it came
-- from instead of floating loose.
-- =====================================================================
BEGIN;

ALTER TABLE field_form_fields
  DROP CONSTRAINT IF EXISTS field_form_fields_input_type_check;

ALTER TABLE field_form_fields
  ADD CONSTRAINT field_form_fields_input_type_check CHECK (input_type IN (
    'text','textarea','number','integer','currency','date','time',
    'toggle','select','multiselect','photo','signature','barcode',
    'gps','rating','ref_employee','ref_vehicle','ref_equipment',
    'ref_supply','ref_vendor','section',
    -- only the radon monitors, and only this inspector's radon jobs
    'radon_device','radon_job'));

UPDATE field_form_fields ff
   SET input_type = 'radon_device'
  FROM field_forms f
  JOIN field_modules m ON m.id = f.module_id
 WHERE ff.form_id = f.id
   AND m.key = 'radon_deploy'
   AND ff.key IN ('primary_device', 'duplicate_device');

UPDATE field_form_fields ff
   SET input_type = 'radon_job',
       label = 'Which job',
       help_text = 'Your radon placements. Picking one ties the set to the order.'
  FROM field_forms f
  JOIN field_modules m ON m.id = f.module_id
 WHERE ff.form_id = f.id
   AND m.key = 'radon_deploy'
   AND ff.key = 'address';

COMMIT;
