-- Vacations/leave requests + IP capture on time clock events

alter table timeclock_events add column if not exists ip_address text;

create table if not exists leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid,
  created_at timestamptz not null default now()
);

alter table leave_requests enable row level security;
drop policy if exists staff_all on public.leave_requests;
create policy staff_all on public.leave_requests for all to authenticated using (true) with check (true);
