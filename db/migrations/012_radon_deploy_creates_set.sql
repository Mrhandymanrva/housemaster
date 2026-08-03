-- =====================================================================
-- 012_radon_deploy_creates_set.sql
--
-- A radon deployment sent from a phone used to stop at the review inbox: a
-- submission nobody could turn into a set without re-keying it. It now opens
-- the set itself, through the same code the desktop uses.
--
-- target_entity moves from equipment to radon_tests, which is what the
-- submission actually produces. It never was an edit to the monitor.
--
-- auto_apply goes on because a set has to exist from the moment it is placed.
-- The chain of custody starts in the house, not when somebody in the office
-- gets to the inbox, and the duplicate rule is already enforced twice before
-- this point — on the phone, and by the trigger that lets a set reach
-- Deployed.
-- =====================================================================
BEGIN;

UPDATE field_modules
   SET target_entity = 'radon_tests',
       auto_apply = true,
       description = 'Log placement, device and start time — opens the set'
 WHERE key = 'radon_deploy';

COMMIT;
