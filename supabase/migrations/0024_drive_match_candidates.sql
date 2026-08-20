create table if not exists drive_match_candidates (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  patient_name text not null,
  folder_name text not null,
  drive_folder_id text not null,
  similarity numeric not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);
alter table drive_match_candidates enable row level security;
drop policy if exists staff_all on public.drive_match_candidates;
create policy staff_all on public.drive_match_candidates for all to authenticated using (true) with check (true);
