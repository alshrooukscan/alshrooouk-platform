-- 0065: a report that cannot find its branch must still be raised.
--
-- auto_create_report_for_visit looks up the pseudo-client belonging to the
-- visit's branch and, finding none, returns without creating anything. A visit
-- saved without a branch always fails that lookup, so its report is never
-- raised and never appears in the queue. Nobody is told. A radiologist's work
-- simply goes missing.
--
-- It is not rare: 11 of the 68 visits since 29 August carry no branch, about
-- one in six, and the most recent affected visit was 2 September.
--
-- A report the team can see and reassign is far better than one that was never
-- created, so an unresolved branch now falls back to a holding client rather
-- than being dropped.

insert into clients (name, is_pseudo, branch_id)
select 'Unassigned Branch', true, null
where not exists (select 1 from clients where name = 'Unassigned Branch' and is_pseudo);

create or replace function auto_create_report_for_visit() returns trigger
language plpgsql as $$
declare
  v_branch_client_id uuid;
  v_requiring_scans text[];
begin
  if new.scan_types is null or array_length(new.scan_types, 1) is null then
    return new;
  end if;

  select array_agg(distinct name) into v_requiring_scans
  from exam_types
  where name = any(new.scan_types)
    and requires_report = true
    and (new.branch_id is null or branch_id is null or branch_id = new.branch_id);

  if v_requiring_scans is null or array_length(v_requiring_scans, 1) is null then
    return new;
  end if;

  select id into v_branch_client_id
  from clients where branch_id = new.branch_id and is_pseudo = true limit 1;

  -- Fall back rather than give up. This is the line that used to lose reports.
  if v_branch_client_id is null then
    select id into v_branch_client_id
    from clients where name = 'Unassigned Branch' and is_pseudo = true limit 1;
  end if;
  if v_branch_client_id is null then
    return new;
  end if;

  insert into reports (source_type, client_id, patient_id, visit_id, scan_name, date_required)
  values ('internal', v_branch_client_id, new.patient_id, new.id,
          array_to_string(v_requiring_scans, ', '), coalesce(new.exam_date, current_date));

  return new;
end;
$$;
