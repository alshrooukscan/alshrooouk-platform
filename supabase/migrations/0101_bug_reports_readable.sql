-- 0101: live updates on the support queue could never arrive.
--
-- bug_reports is watched for realtime updates by the support page and by the
-- sidebar badge, but the table has row level security on with no policy.
-- Realtime respects row level security, so no event was ever delivered: the
-- badge and the page only moved on a manual reload, and a ticket raised while
-- somebody had the page open stayed invisible.
--
-- The same shape as the stock approval queue an hour ago, and the reason the
-- whole audit was worth running.
--
-- Reading is opened to signed-in staff. Writing is left closed: the page
-- already goes through a function to update a report, with a comment saying
-- exactly that, so opening writes here would loosen something that is
-- deliberately tight.

alter table bug_reports enable row level security;

drop policy if exists "staff read bug reports" on bug_reports;
create policy "staff read bug reports" on bug_reports
  for select to authenticated using (true);
