-- 0075: steps are defined per scan type, with a target time for each.
--
-- Every visit shows the same five rows: Paid, Scanned, Raw Data Uploaded,
-- Report Done, Invoice Generated. Paid and Invoice Generated are genuinely
-- fixed - one is the money arriving and the other is the document leaving -
-- but the work between them is not the same for every scan, and the clinic
-- cannot name its own stages or say how long each should take.
--
-- exam_type_steps holds the middle of the timeline, per scan type, in order,
-- each with a target in minutes. Paid and Invoice Generated stay where they
-- are and are not stored here; they are not the clinic's to rename.
--
-- The three existing stages are seeded for every scan type so nothing changes
-- on screen until somebody edits them, and they keep their legacy_field link
-- to the visits columns that already hold years of history. A step with a
-- legacy_field reads and writes that column; a step without one is new and
-- lives in visit_step_progress. That way renaming or adding a stage never
-- orphans a completed one, and Report Done still only appears where the scan
-- type requires a report.

create table if not exists exam_type_steps (
  id uuid primary key default gen_random_uuid(),
  exam_type_id uuid not null references exam_types(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  target_minutes int,
  legacy_field text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_ets_exam_type on exam_type_steps(exam_type_id, sort_order);

create table if not exists visit_step_progress (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visits(id) on delete cascade,
  step_id uuid references exam_type_steps(id) on delete cascade,
  step_name text not null,
  done boolean not null default false,
  done_at timestamptz,
  done_by_id uuid,
  done_by_name text,
  created_at timestamptz not null default now(),
  unique (visit_id, step_id)
);

create index if not exists idx_vsp_visit on visit_step_progress(visit_id);

alter table exam_type_steps enable row level security;
alter table visit_step_progress enable row level security;

drop policy if exists staff_all on exam_type_steps;
drop policy if exists staff_all on visit_step_progress;
create policy staff_all on exam_type_steps for all to authenticated using (true) with check (true);
create policy staff_all on visit_step_progress for all to authenticated using (true) with check (true);

-- seed what every visit already shows, so today looks identical
insert into exam_type_steps (exam_type_id, name, sort_order, legacy_field, target_minutes)
select et.id, 'Scanned', 1, 'scanned', 30
from exam_types et
where not exists (select 1 from exam_type_steps s where s.exam_type_id = et.id and s.legacy_field = 'scanned');

insert into exam_type_steps (exam_type_id, name, sort_order, legacy_field, target_minutes)
select et.id, 'Raw Data Uploaded', 2, 'raw_data_uploaded', 60
from exam_types et
where not exists (select 1 from exam_type_steps s where s.exam_type_id = et.id and s.legacy_field = 'raw_data_uploaded');

insert into exam_type_steps (exam_type_id, name, sort_order, legacy_field, target_minutes)
select et.id, 'Report Done', 3, 'report_done', 1440
from exam_types et
where et.requires_report = true
  and not exists (select 1 from exam_type_steps s where s.exam_type_id = et.id and s.legacy_field = 'report_done');
