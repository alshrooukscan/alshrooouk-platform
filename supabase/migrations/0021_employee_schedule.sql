-- Real calendar-date schedule, distinct from the existing weekly day-of-week template.
-- One row per specific date, so HR can set a genuine month, then repeat it forward.

create table if not exists employee_schedule_days (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  work_date date not null,
  start_time time,
  end_time time,
  is_day_off boolean not null default false,
  created_at timestamptz not null default now(),
  unique(employee_id, work_date)
);

alter table employee_schedule_days enable row level security;
drop policy if exists staff_all on public.employee_schedule_days;
create policy staff_all on public.employee_schedule_days for all to authenticated using (true) with check (true);
