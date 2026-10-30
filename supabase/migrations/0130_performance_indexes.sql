-- 0130_performance_indexes (30 Oct 2026): performance review P-05 / P-10.
create extension if not exists pg_trgm with schema extensions;
create index if not exists idx_patients_name_trgm   on public.patients using gin (name extensions.gin_trgm_ops);
create index if not exists idx_patients_mobile_trgm on public.patients using gin (mobile extensions.gin_trgm_ops);
create index if not exists idx_timeclock_employee_time on public.timeclock_events (employee_id, event_time desc);
create index if not exists idx_leave_requests_employee on public.leave_requests (employee_id, created_at desc);
create index if not exists idx_payroll_runs_employee_period on public.payroll_runs (employee_id, period);
create index if not exists idx_visit_payments_paid_at on public.visit_payments (paid_at);
create index if not exists idx_patients_drive_folder on public.patients (drive_folder_id) where drive_folder_id is not null;
