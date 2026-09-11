-- 0077: split the multi-scan visits recorded since go-live.
--
-- Only visits entered in the platform. The 275 that came across in the 29
-- August import are left exactly as they are: that work is finished, paid and
-- reported, and re-cutting it into new records would reallocate settled
-- payments for no operational gain. Go-live is the boundary, as it was for
-- the reports backfill.
--
-- Six visits, all from the first fortnight of use. The original keeps the
-- first scan and the rest become visits of their own, tied to it by
-- visit_group_id. Charges and payments divide by list price so each scan
-- carries its own worth with the same discount, and the parts add back to the
-- original totals exactly.

create table if not exists visit_split_backup_0077 as
  select v.*, now() as backed_up_at from visits v where false;

insert into visit_split_backup_0077
select v.*, now() from visits v
where array_length(v.scan_types, 1) > 1
  and v.created_at > timestamptz '2026-08-29 10:23:18+00';

do $$
declare r record;
begin
  for r in
    select id from visits
     where array_length(scan_types, 1) > 1
       and created_at > timestamptz '2026-08-29 10:23:18+00'
     order by exam_date
  loop
    perform split_visit(r.id, null, 'Split at go-live cleanup');
  end loop;
end $$;
