-- 0088: the workflow board starts at go-live, not at the start of the data.
--
-- Both functions windowed on exam_date alone, so a 90-day view reached back to
-- mid-June and swept in 539 imported visits against 94 real ones - 85 percent
-- of the board describing work that never passed through the platform. Those
-- visits have no step completions because nobody ticked steps in 2026 on a
-- paper form, so every one of them reads as open and overdue, and the ninety
-- four visits the board exists to show are buried under them.
--
-- The boundary is the visit's created_at, not its exam_date. Imported visits
-- carry exam dates going back years but were all written in one run on 29
-- August, so exam_date cannot separate them - the reports backfill and the
-- visit split both turned on the same distinction.
--
-- Given a name rather than repeated as a literal: it is now used in four
-- places across the platform and each one has to mean the same instant.

create or replace function platform_golive_at() returns timestamptz
language sql immutable as $$ select timestamptz '2026-08-29 10:23:18+00' $$;

create or replace function workflow_board(p_days int default 14)
returns table (
  visit_id uuid, patient_name text, exam_date date, step_name text, records text,
  sort_order int, target_minutes int, status text, started_at timestamptz,
  due_at timestamptz, minutes_elapsed numeric, minutes_over numeric,
  breached boolean, completed_by_name text
)
language sql stable as $$
  SELECT t.visit_id, p.name, t.exam_date, t.step_name, t.records, t.sort_order,
         t.target_minutes, t.status, t.started_at, t.due_at,
         t.minutes_elapsed, t.minutes_over, t.breached, t.completed_by_name
  FROM public.visit_step_timeline t
  JOIN patients p ON p.id = t.patient_id
  JOIN visits v ON v.id = t.visit_id
  WHERE t.exam_date >= CURRENT_DATE - p_days
    AND v.created_at > public.platform_golive_at()
  ORDER BY (t.status = 'open') DESC, t.breached DESC,
           coalesce(t.minutes_over, 0) DESC, t.exam_date DESC, t.sort_order;
$$;
CREATE OR REPLACE FUNCTION public.workflow_sla_summary(p_days integer DEFAULT 30)
 RETURNS TABLE(records text, target_minutes integer, completed integer, breached integer, breach_rate numeric, median_minutes numeric, p90_minutes numeric, worst_minutes numeric, ticked_together integer, measurable_rate numeric)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT t.records, max(t.target_minutes)::int,
         count(*)::int,
         count(*) FILTER (WHERE t.breached)::int,
         round(100.0 * count(*) FILTER (WHERE t.breached) / nullif(count(*),0), 1),
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY t.minutes_elapsed)::numeric, 1),
         round(percentile_cont(0.9) WITHIN GROUP (ORDER BY t.minutes_elapsed)::numeric, 1),
         round(max(t.minutes_elapsed), 1),
         count(*) FILTER (WHERE t.ticked_together)::int,
         round(100.0 * count(*) FILTER (WHERE NOT t.ticked_together) / nullif(count(*),0), 1)
  FROM public.visit_step_timeline t
  WHERE t.status = 'done' AND t.exam_date >= CURRENT_DATE - p_days
    AND EXISTS (SELECT 1 FROM public.visits v WHERE v.id = t.visit_id AND v.created_at > public.platform_golive_at())
  GROUP BY t.records
  ORDER BY 5 DESC NULLS LAST;
$function$
;