-- 0080: the Reports queue gets a badge, counting what the page itself shows.
--
-- Three of the four notification badges were wired - Action Center, Report a
-- Problem, Stock Orders. Reports was not, so the one queue where waiting work
-- means a radiologist's report has not been written was the only one with
-- nothing on it. Earlier today that queue was also the one holding items
-- nobody knew were outstanding.
--
-- The count is exactly what the page lists: reports still pending. Not visits
-- that might need one, not reports that were raised and finished - the number
-- on the badge and the number of rows on the page have to be the same figure,
-- or the badge teaches people to ignore it.
--
-- Stock orders keeps its existing meaning, which is the same principle already
-- applied: orders waiting to be reviewed, sent or delivered, plus item
-- requests waiting on somebody. Both are queue counts, not inbox counts.

create or replace function notification_counts() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_employee uuid;
  v_bugs int := 0;
  v_orders int := 0;
  v_actions int := 0;
  v_reports int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('bug_reports', 0, 'stock_orders', 0, 'action_center', 0, 'reports', 0);
  end if;

  select (role = 'admin') into v_is_admin from staff_profiles where id = v_uid;
  v_is_admin := coalesce(v_is_admin, false);

  select e.id into v_employee
    from employees e
    join staff_profiles sp on lower(sp.email) = lower(e.staff_account_email)
   where sp.id = v_uid
   limit 1;

  if v_is_admin then
    select count(*) into v_bugs from bug_reports where status in ('open', 'in_progress');
  else
    select count(*) into v_bugs
      from bug_reports
     where reporter_id = v_uid
       and replied_at is not null
       and (reply_seen_at is null or reply_seen_at < replied_at);
  end if;

  select count(*) into v_orders
    from dental_orders
   where status in ('placed', 'confirmed', 'reviewed', 'assigned', 'in_transit');

  v_orders := v_orders + (select count(*) from stock_item_requests where status = 'pending');

  -- REPORTS. The same figure the page shows when it opens on Pending.
  select count(*) into v_reports from reports where status = 'pending';

  if v_is_admin then
    select
      (select count(*) from expense_transactions where status = 'pending')
      + (select count(*) from excuse_submissions where status = 'pending')
      + (select count(*) from visit_edit_requests where status = 'pending')
      into v_actions;
  else
    select
      coalesce((select count(*) from expense_transactions
                 where status = 'pending' and type = 'cash_transfer'
                   and to_employee_id = v_employee), 0)
      + coalesce((select count(*) from tasks
                   where status = 'pending' and assigned_to_id = v_uid), 0)
      into v_actions;
  end if;

  return jsonb_build_object(
    'bug_reports', coalesce(v_bugs, 0),
    'stock_orders', coalesce(v_orders, 0),
    'action_center', coalesce(v_actions, 0),
    'reports', coalesce(v_reports, 0)
  );
end;
$$;
