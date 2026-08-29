-- Any employee can propose an edit to a visit; it doesn't take effect until
-- an admin approves it. Both the values as they stood when the request was
-- made and the proposed new values are stored, so Action Center can show a
-- clear before/after diff rather than admin having to guess what changed.
-- An admin editing a visit directly bypasses this table entirely and writes
-- straight to visits - requiring admin to approve their own edit would be a
-- circular, pointless step.
create table if not exists visit_edit_requests (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visits(id) on delete cascade,
  previous_values jsonb not null,
  requested_values jsonb not null,
  requested_by_id uuid,
  requested_by_name text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by_id uuid,
  reviewed_by_name text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists visit_edit_requests_visit_idx on visit_edit_requests (visit_id);
create index if not exists visit_edit_requests_status_idx on visit_edit_requests (status);
alter table visit_edit_requests enable row level security;
drop policy if exists staff_all on public.visit_edit_requests;
create policy staff_all on public.visit_edit_requests for all to authenticated using (true) with check (true);
