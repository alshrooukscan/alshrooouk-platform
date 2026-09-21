-- The workflow board listed patients by name only, so a name on the board led
-- nowhere: to check a late visit, staff had to leave the board, search the
-- patient, and hunt for the right visit by date. The board now carries
-- patient_id, so every name links straight to the patient's record, opened at
-- that exact visit (the patient page already honours ?visit=<id>).
--
-- Adding a column changes the function's return type, which Postgres will not
-- do in place, so it is dropped and recreated. The body is otherwise identical
-- to the live definition, and the grants are restored exactly as they were.

drop function if exists public.workflow_board(integer);

create function public.workflow_board(p_days integer default 14)
returns table(
  visit_id uuid,
  patient_id uuid,
  patient_name text,
  exam_date date,
  step_name text,
  records text,
  sort_order integer,
  target_minutes integer,
  status text,
  started_at timestamptz,
  due_at timestamptz,
  minutes_elapsed numeric,
  minutes_over numeric,
  breached boolean,
  completed_by_name text
)
language sql
stable
as $function$
  select t.visit_id, t.patient_id, p.name, t.exam_date, t.step_name, t.records, t.sort_order,
         t.target_minutes, t.status, t.started_at, t.due_at,
         t.minutes_elapsed, t.minutes_over, t.breached, t.completed_by_name
  from public.visit_step_timeline t
  join patients p on p.id = t.patient_id
  join visits v on v.id = t.visit_id
  where t.exam_date >= current_date - p_days
    and v.created_at > public.platform_golive_at()
  order by (t.status = 'open') desc, t.breached desc,
           coalesce(t.minutes_over, 0) desc, t.exam_date desc, t.sort_order;
$function$;

revoke all on function public.workflow_board(integer) from public;
grant execute on function public.workflow_board(integer) to authenticated, service_role;

-- Supabase's default privileges grant EXECUTE to anon on any new function in
-- public, and "revoke from public" does not undo that. The board lists patient
-- names, so the anonymous role must not be able to call it. The live function
-- before this migration had no anon grant; this restores that.
revoke execute on function public.workflow_board(integer) from anon;
