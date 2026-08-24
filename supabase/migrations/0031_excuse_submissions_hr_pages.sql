-- Employees can submit an excuse (picking from the existing excuse_rules
-- catalog) for admin to review and approve/reject, the same pattern already
-- used for vacation/leave_requests.
create table if not exists excuse_submissions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  excuse_rule_id uuid references excuse_rules(id),
  note text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists excuse_submissions_employee_idx on excuse_submissions (employee_id);
create index if not exists excuse_submissions_status_idx on excuse_submissions (status);
alter table excuse_submissions enable row level security;
drop policy if exists staff_all on public.excuse_submissions;
create policy staff_all on public.excuse_submissions for all to authenticated using (true) with check (true);
