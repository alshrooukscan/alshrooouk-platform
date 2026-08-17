-- Shift-based scheduling: HR defines a weekly shift per employee, per day of week.
-- Attendance flags (late, absent) now read from this instead of one global assumption.

alter table employees add column if not exists hourly_rate numeric(10,2);

create table if not exists employee_shifts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6), -- 0=Sunday ... 6=Saturday
  start_time time,
  end_time time,
  is_day_off boolean not null default false,
  unique (employee_id, day_of_week)
);

alter table employee_shifts enable row level security;
drop policy if exists staff_all on public.employee_shifts;
create policy staff_all on public.employee_shifts for all to authenticated using (true) with check (true);
