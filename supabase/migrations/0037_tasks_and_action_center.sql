-- Foundation for the Action Center: a simple assigned-task mechanism, since
-- nothing like this exists anywhere on the platform yet. Assigned to a staff
-- member (via their staff_profiles id, matching how Supabase Auth sessions
-- identify the current user), not an employees row - so anyone with a staff
-- login can be assigned a task, not just elevated employees.
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  assigned_to_id uuid not null,
  assigned_to_name text,
  status text not null default 'pending' check (status in ('pending','done')),
  created_by_id uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists tasks_assigned_to_idx on tasks (assigned_to_id, status);
alter table tasks enable row level security;
drop policy if exists staff_all on public.tasks;
create policy staff_all on public.tasks for all to authenticated using (true) with check (true);
