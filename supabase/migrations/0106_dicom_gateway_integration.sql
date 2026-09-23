-- Direct CBCT machine integration (Xline XDI-350 -> Orthanc gateway -> shscan.com).
-- A worklist entry is pushed to the clinic's local Orthanc server before a scan,
-- carrying the visit's real identifiers, so the study that comes back can be
-- matched deterministically instead of by patient name. These columns hold
-- those identifiers and the state of that handshake. Matched studies still
-- land through the existing patient_files/Drive path (folderProvisioning.js,
-- upload-complete/route.js) unchanged - this migration adds nothing to that
-- path, only the machinery that decides which visit a returning study belongs to.

alter table visits add column if not exists dicom_study_uid text;
alter table visits add column if not exists dicom_accession_number text;
alter table visits add column if not exists dicom_worklist_status text
  check (dicom_worklist_status in ('pending', 'worklist_created', 'matched', 'unmatched'));

-- One visit should never produce two worklist entries or collide on the
-- identifier the matcher keys on.
create unique index if not exists visits_dicom_study_uid_key on visits(dicom_study_uid) where dicom_study_uid is not null;
create unique index if not exists visits_dicom_accession_number_key on visits(dicom_accession_number) where dicom_accession_number is not null;

-- A study Orthanc received that did not match any visit by StudyInstanceUID,
-- AccessionNumber or PatientID. The raw identifiers are exactly what the
-- machine sent, kept for staff to recognise the case, never used to guess a
-- match automatically. The file itself stays in a quarantine Drive folder
-- (drive_file_id here) until a staff member resolves it in the review queue -
-- nothing gets filed against a patient on a guess.
create table if not exists unmatched_studies (
  id uuid primary key default gen_random_uuid(),
  dicom_study_uid text not null,
  dicom_accession_number text,
  dicom_patient_id_raw text,
  dicom_patient_name_raw text,
  drive_file_id text,
  file_name text,
  received_at timestamptz not null default now(),
  gateway_note text,
  resolved_visit_id uuid references visits(id),
  resolved_by_name text,
  resolved_at timestamptz
);
create unique index if not exists unmatched_studies_dicom_study_uid_key on unmatched_studies(dicom_study_uid);

alter table unmatched_studies enable row level security;
create policy staff_all on public.unmatched_studies for all to authenticated using (true) with check (true);

-- Audit trail for every worklist push, every study Orthanc received, and every
-- match attempt - needed for support (a scan that "didn't arrive" is usually
-- traceable here) and for the CISO gate this integration was built under.
create table if not exists gateway_sync_log (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in (
    'worklist_created', 'worklist_push_failed',
    'study_received', 'study_matched', 'study_unmatched',
    'unmatched_resolved'
  )),
  dicom_study_uid text,
  visit_id uuid references visits(id),
  detail text,
  created_at timestamptz not null default now()
);

alter table gateway_sync_log enable row level security;
create policy staff_read on public.gateway_sync_log for select to authenticated using (true);
-- Only the gateway's own service-role calls insert log rows; staff read but never write them by hand.
create policy service_role_write on public.gateway_sync_log for insert to service_role with check (true);

-- The gateway calls shscan.com over the internet with a single scoped API key,
-- not the platform's own service-role key - keeping that key off a PC that
-- physically sits at the clinic. This table holds that key's hash, following
-- the same pattern as patient_auth.password_hash: the plaintext key is shown
-- once at creation and never stored.
create table if not exists gateway_api_keys (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  key_hash text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table gateway_api_keys enable row level security;
create policy staff_all on public.gateway_api_keys for all to authenticated using (true) with check (true);
