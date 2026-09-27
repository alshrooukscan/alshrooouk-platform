-- Approving an attendance correction failed with:
--   new row for relation "timeclock_events" violates check constraint
--   "timeclock_events_face_match_status_check"
--
-- face_match_status records how the face check went when the device took the
-- punch. Three outcomes were allowed: verified, failed, not_enrolled. Later,
-- admin correction was built, and it needs to say something the device never
-- says - that a human entered this punch, and that a human overrode a failed
-- face check. Two new values were written into the code for exactly that:
--
--   manual_entry       the punch was created by an admin; no device reading
--                      exists, so it must never be read as a verified one
--   verified_by_admin  the device failed to recognise the face and an admin
--                      confirmed the person was here
--
-- The constraint was never widened to match, so every one of those writes was
-- rejected. Three separate approval paths were broken by it:
--
--   Action Center -> Attendance Corrections -> approve a missing punch
--   Action Center -> approve a "face not recognised" correction
--   Payroll -> credit a missing sign-out on an attendance exception
--
-- The first two surface the database error to the admin and roll their request
-- back to pending, so nothing was lost. The third ignored the insert error and
-- marked the exception approved anyway - see the route change alongside this
-- migration.
--
-- Widening rather than collapsing these into 'verified': an attendance record
-- feeds payroll, and a punch nobody's face was ever checked against must stay
-- visibly different from one the device verified.

alter table timeclock_events drop constraint if exists timeclock_events_face_match_status_check;

alter table timeclock_events add constraint timeclock_events_face_match_status_check
  check (face_match_status = any (array[
    'verified'::text,
    'failed'::text,
    'not_enrolled'::text,
    'manual_entry'::text,
    'verified_by_admin'::text
  ]));

comment on column timeclock_events.face_match_status is
  'How the face check resolved. verified/failed/not_enrolled come from the device at punch time. manual_entry means an admin created the punch and no face check exists. verified_by_admin means the device failed and an admin confirmed the person in the Action Center.';
