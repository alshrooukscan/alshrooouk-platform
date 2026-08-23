-- Phase 1 of feedback batch 2: assignment, branch geo/drive, activity log foundation

-- Item 11: scan assignment to employee
alter table visits add column if not exists assigned_employee_id uuid references employees(id) on delete set null;
alter table visits add column if not exists assigned_at timestamptz;

-- Item 8: branch-level Drive folder + GPS geofence
alter table branches add column if not exists drive_folder_id text;
alter table branches add column if not exists latitude numeric(10,7);
alter table branches add column if not exists longitude numeric(10,7);
alter table branches add column if not exists geofence_radius_m integer default 150;

-- Item 12: general activity log (actor + action + timestamp on any tracked action)
create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in ('employee','admin','system')),
  actor_id uuid,
  actor_name text not null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_log_entity_idx on activity_log (entity_type, entity_id);
create index if not exists activity_log_actor_idx on activity_log (actor_id, created_at desc);
alter table activity_log enable row level security;
drop policy if exists staff_all on public.activity_log;
create policy staff_all on public.activity_log for all to authenticated using (true) with check (true);
