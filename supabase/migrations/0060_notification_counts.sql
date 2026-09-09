-- Sidebar work counters. One function, called once per page load, returning
-- every count for the person signed in - the sidebar mounts on every dashboard
-- page, so a dozen separate queries from it would be a dozen round trips on
-- every navigation.
--
-- Deliberately a QUEUE, not an inbox: the number is what is still waiting to be
-- done, and it only falls when the work is actually done. Opening a page does
-- not clear it. Someone who looks at four orders and walks away still sees
-- four, which is the entire point.
--
-- The one exception is a reply to your own bug report, which IS news rather
-- than work: it should stop nagging once you have read it.
alter table bug_reports add column if not exists reply_seen_at timestamptz;
alter table bug_reports add column if not exists replied_at timestamptz;

-- Stamped whenever a triager writes or changes the reply, so "answered since I
-- last looked" can be told apart from "answered and I have read it".
create or replace function public.stamp_bug_reply()
returns trigger language plpgsql as $$
begin
  if new.admin_notes is distinct from old.admin_notes and coalesce(new.admin_notes, '') <> '' then
    new.replied_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_stamp_bug_reply on bug_reports;
create trigger trg_stamp_bug_reply before update on bug_reports
  for each row execute function stamp_bug_reply();

create or replace function public.notification_counts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_employee uuid;
  v_bugs int := 0;
  v_orders int := 0;
  v_actions int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('bug_reports', 0, 'stock_orders', 0, 'action_center', 0);
  end if;

  select (role = 'admin') into v_is_admin from staff_profiles where id = v_uid;
  v_is_admin := coalesce(v_is_admin, false);

  -- The employee record behind this login, if any. Everything person-scoped
  -- below hangs off it, and an unlinked login simply counts nothing rather
  -- than falling back to someone else's work.
  select e.id into v_employee
    from employees e
    join staff_profiles sp on lower(sp.email) = lower(e.staff_account_email)
   where sp.id = v_uid
   limit 1;

  -- BUG REPORTS. An admin is being asked to answer tickets; a member of staff
  -- is being told their own ticket was answered. Two different counts behind
  -- one badge, because they are the same question from either side: is there
  -- something here for me?
  if v_is_admin then
    select count(*) into v_bugs from bug_reports where status in ('open', 'in_progress');
  else
    select count(*) into v_bugs
      from bug_reports
     where reporter_id = v_uid
       and replied_at is not null
       and (reply_seen_at is null or reply_seen_at < replied_at);
  end if;

  -- STOCK ORDERS. Orders waiting to be reviewed or delivered, plus doctors'
  -- requests for items not in the catalogue. Backordered orders are counted
  -- too: they are waiting on somebody to chase stock.
  select count(*) into v_orders
    from dental_orders
   where status in ('placed', 'confirmed', 'reviewed', 'assigned', 'in_transit')
     and (v_is_admin or assigned_to_employee_id = v_employee);

  if v_is_admin then
    v_orders := v_orders + (select count(*) from stock_item_requests where status = 'pending');
  end if;

  -- ACTION CENTRE. An admin sees every approval waiting platform-wide. Anyone
  -- else sees only what is waiting on them personally - cash someone is trying
  -- to hand them, and their own assigned tasks. Showing the admin figure to a
  -- receptionist would be a badge that lies about whose work it is.
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
      -- tasks.assigned_to_id is the staff_profiles id, not the employee id -
      -- the two are different keys for the same person and mixing them counts
      -- nothing at all, silently.
      + coalesce((select count(*) from tasks
                   where status = 'pending' and assigned_to_id = v_uid), 0)
      into v_actions;
  end if;

  return jsonb_build_object(
    'bug_reports', coalesce(v_bugs, 0),
    'stock_orders', coalesce(v_orders, 0),
    'action_center', coalesce(v_actions, 0)
  );
end;
$$;

revoke all on function public.notification_counts() from public;
grant execute on function public.notification_counts() to authenticated;

-- bug_reports has RLS enabled and no policies at all, so a staff client cannot
-- write to it - the mark-as-read update would have silently changed nothing
-- and the badge would have stuck on forever. This does the write with definer
-- rights, and only ever for the caller's own reports.
create or replace function public.mark_bug_replies_seen()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if auth.uid() is null then return 0; end if;
  update bug_reports
     set reply_seen_at = now()
   where reporter_id = auth.uid()
     and replied_at is not null
     and (reply_seen_at is null or reply_seen_at < replied_at);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.mark_bug_replies_seen() from public;
grant execute on function public.mark_bug_replies_seen() to authenticated;
