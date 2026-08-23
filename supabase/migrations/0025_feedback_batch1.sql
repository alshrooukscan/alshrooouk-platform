alter table visits add column if not exists paid_at timestamptz;
alter table visits add column if not exists scanned_at timestamptz;
alter table visits add column if not exists raw_data_uploaded_at timestamptz;
alter table visits add column if not exists report_done_at timestamptz;

-- Backfill: for visits already marked paid/scanned/etc from earlier work, use a
-- reasonable real timestamp (their exam_date) rather than leaving it null forever.
update visits set paid_at = created_at where payment_status = 'paid' and paid_at is null;
update visits set scanned_at = created_at where scanned = true and scanned_at is null;
update visits set raw_data_uploaded_at = created_at where raw_data_uploaded = true and raw_data_uploaded_at is null;
update visits set report_done_at = created_at where report_done = true and report_done_at is null;

-- File uploads: classify type and capture who uploaded it.
create table if not exists patient_files (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  visit_id uuid references visits(id) on delete set null,
  drive_file_id text not null,
  file_name text not null,
  file_type text not null check (file_type in ('raw_data','report','other')),
  uploaded_by_email text,
  uploaded_by_name text,
  created_at timestamptz not null default now()
);
alter table patient_files enable row level security;
drop policy if exists staff_all on public.patient_files;
create policy staff_all on public.patient_files for all to authenticated using (true) with check (true);
