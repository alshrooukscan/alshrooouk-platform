-- Phase 3: self-hosted face verification at clock in/out, single active session
-- for the employee portal. Location remains a hard block, unchanged. Face is a
-- soft signal: recorded and flagged on mismatch, never blocks a real clock-in.

alter table employees add column if not exists face_descriptor jsonb;
alter table employees add column if not exists face_photo_drive_id text;
alter table employees add column if not exists face_enrolled_at timestamptz;
alter table employees add column if not exists current_session_id uuid;

alter table timeclock_events add column if not exists face_match_status text
  check (face_match_status in ('verified','failed','not_enrolled'));
alter table timeclock_events add column if not exists face_match_distance numeric(6,4);
alter table timeclock_events add column if not exists face_capture_drive_id text;
