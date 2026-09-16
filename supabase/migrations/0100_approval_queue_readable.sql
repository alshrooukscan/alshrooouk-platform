-- 0100: the approval queue could be written but never read.
--
-- stock_change_requests was created with row level security on and no policy,
-- which denies everything. Doaa's change saved correctly - the request is
-- there, air water 2 to 3 - and request_stock_change is security definer so
-- the write went through. But the Action Center reads the table as the signed
-- in user, and with no policy it read nothing. The screen said "sent for
-- approval" and the admin saw an empty list, which is the worst of both: the
-- person believes it is waiting for someone, and nobody can act on it.
--
-- Reading is opened to signed-in staff. Writing deliberately is not: both
-- functions are security definer, so a request is created and decided only
-- through them, and no browser can approve its own change by writing the row
-- directly.

alter table stock_change_requests enable row level security;

drop policy if exists "staff read stock change requests" on stock_change_requests;
create policy "staff read stock change requests" on stock_change_requests
  for select to authenticated using (true);

-- overtime_approvals carries the same fault, created the same way in the same
-- hour. It has no screen yet, so nobody has hit it - which is exactly why it
-- is worth closing now rather than discovering it the day the screen ships.
alter table overtime_approvals enable row level security;

drop policy if exists "staff read overtime approvals" on overtime_approvals;
create policy "staff read overtime approvals" on overtime_approvals
  for select to authenticated using (true);
