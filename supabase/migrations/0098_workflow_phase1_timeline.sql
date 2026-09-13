-- =====================================================================
-- 0098 · Section 7, Phase 1 · honest timers
--
-- Deliberately a view, not a table.
--
-- Every completion is already recorded somewhere: the three built-in steps
-- on visits, everything the clinic has added in visit_step_progress. A
-- step's start is the previous step's finish. Nothing here needs to be
-- written, so nothing here can drift out of step with the visit, and no
-- existing behaviour changes at all.
--
-- Pausing and resuming do need a real table. That is Phase 3, and it
-- should only be built once these timers show it is actually needed.
-- =====================================================================

CREATE OR REPLACE VIEW public.visit_step_timeline AS
WITH steps AS (
  -- The steps this visit actually goes through, taken from the scan types on
  -- it. A visit with two scan types shows the union of their steps, each
  -- named once, exactly as the patient screen already decides it.
  SELECT v.id AS visit_id, v.patient_id, v.exam_date,
         -- When the work actually began, not when the row was typed. Only 94
         -- of 304 recent visits were created on their exam date, the rest
         -- entered on average 275 hours later, so visit creation measures
         -- back-entry and would have made every first step look overdue.
         coalesce(v.exam_date + coalesce(v.exam_time, time '00:00'), v.created_at) AS visit_created_at,
         s.id AS step_id, s.name AS step_name,
         coalesce(s.canonical_name, s.name) AS records,
         s.legacy_field, s.sort_order, s.target_minutes,
         row_number() OVER (PARTITION BY v.id, coalesce(s.legacy_field, lower(s.name))
                            ORDER BY s.sort_order, s.name) AS dedupe
  FROM visits v
  JOIN exam_type_steps s ON s.exam_type_id = ANY (v.exam_type_ids) AND s.is_active
), one AS (
  SELECT * FROM steps WHERE dedupe = 1
), resolved AS (
  SELECT o.*,
         CASE o.legacy_field
           WHEN 'scanned' THEN v.scanned_at
           WHEN 'raw_data_uploaded' THEN v.raw_data_uploaded_at
           WHEN 'report_done' THEN v.report_done_at
           ELSE p.done_at
         END AS completed_at,
         CASE o.legacy_field
           WHEN 'scanned' THEN v.scanned_by_name
           WHEN 'raw_data_uploaded' THEN v.raw_data_uploaded_by_name
           WHEN 'report_done' THEN v.report_done_by_name
           ELSE p.done_by_name
         END AS completed_by_name,
         CASE o.legacy_field
           WHEN 'scanned' THEN v.scanned_by_employee_id
           WHEN 'raw_data_uploaded' THEN v.raw_data_uploaded_by_employee_id
           WHEN 'report_done' THEN v.report_done_by_employee_id
           ELSE p.done_by_id
         END AS completed_by_employee_id
  FROM one o
  JOIN visits v ON v.id = o.visit_id
  LEFT JOIN visit_step_progress p ON p.visit_id = o.visit_id AND p.step_id = o.step_id AND p.done
), chained AS (
  SELECT r.*,
         -- The first step starts when the visit is created. Every later step
         -- starts when the one before it finished, which is the only start
         -- time the data actually contains.
         coalesce(
           lag(r.completed_at) OVER (PARTITION BY r.visit_id ORDER BY r.sort_order, r.step_name),
           r.visit_created_at) AS started_at
  FROM resolved r
)
SELECT
  c.visit_id, c.patient_id, c.exam_date, c.step_id, c.step_name, c.records,
  c.sort_order, c.target_minutes,
  c.started_at, c.completed_at, c.completed_by_name, c.completed_by_employee_id,
  CASE WHEN c.target_minutes IS NULL THEN NULL
       ELSE c.started_at + make_interval(mins => c.target_minutes) END AS due_at,
  CASE WHEN c.completed_at IS NOT NULL THEN 'done'
       WHEN c.started_at IS NULL THEN 'not_started'
       ELSE 'open' END AS status,
  CASE WHEN c.completed_at IS NOT NULL
       THEN round((EXTRACT(EPOCH FROM (c.completed_at - c.started_at))/60)::numeric, 1)
       ELSE round((EXTRACT(EPOCH FROM (now() - c.started_at))/60)::numeric, 1) END AS minutes_elapsed,
  CASE
    WHEN c.target_minutes IS NULL THEN false
    WHEN c.completed_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (c.completed_at - c.started_at))/60 > c.target_minutes
    ELSE EXTRACT(EPOCH FROM (now() - c.started_at))/60 > c.target_minutes
  END AS breached,
  -- A step ticked within a minute of the one before it was not timed, it was
  -- recorded in the same action. 65 of 87 scan and raw-upload pairs land
  -- inside a minute and 43 are identical to the second, so this flag is what
  -- says whether a duration means anything at all.
  (c.completed_at IS NOT NULL AND c.started_at IS NOT NULL
     AND c.sort_order > 1
     AND EXTRACT(EPOCH FROM (c.completed_at - c.started_at)) < 60) AS ticked_together,
  CASE
    WHEN c.target_minutes IS NULL THEN NULL
    ELSE round(greatest(
      (EXTRACT(EPOCH FROM (coalesce(c.completed_at, now()) - c.started_at))/60) - c.target_minutes, 0)::numeric, 1)
  END AS minutes_over
FROM chained c;

COMMENT ON VIEW public.visit_step_timeline IS
  'Section 7 Phase 1. Derived, never written. A step starts when the one '
  'before it finished; the first starts when the visit was created. Read-only '
  'by construction, so it cannot disagree with the visit it describes.';

-- ---------------------------------------------------------------------
-- What the board reads. Open work first, worst breach at the top, because
-- a board that has to be sorted before it is useful does not get looked at.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workflow_board(p_days integer DEFAULT 14)
RETURNS TABLE(
  visit_id uuid, patient_name text, exam_date date,
  step_name text, records text, sort_order int, target_minutes int,
  status text, started_at timestamptz, due_at timestamptz,
  minutes_elapsed numeric, minutes_over numeric, breached boolean,
  completed_by_name text)
LANGUAGE sql STABLE AS $$
  SELECT t.visit_id, p.name, t.exam_date, t.step_name, t.records, t.sort_order,
         t.target_minutes, t.status, t.started_at, t.due_at,
         t.minutes_elapsed, t.minutes_over, t.breached, t.completed_by_name
  FROM public.visit_step_timeline t
  JOIN patients p ON p.id = t.patient_id
  WHERE t.exam_date >= CURRENT_DATE - p_days
  ORDER BY (t.status = 'open') DESC, t.breached DESC,
           coalesce(t.minutes_over, 0) DESC, t.exam_date DESC, t.sort_order;
$$;

-- ---------------------------------------------------------------------
-- How each step is really performing against the target set for it. This
-- is the number that decides whether the targets are worth keeping.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workflow_sla_summary(p_days integer DEFAULT 30)
RETURNS TABLE(
  records text, target_minutes int, completed int, breached int,
  breach_rate numeric, median_minutes numeric, p90_minutes numeric, worst_minutes numeric,
  ticked_together int, measurable_rate numeric)
LANGUAGE sql STABLE AS $$
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
  GROUP BY t.records
  ORDER BY 5 DESC NULLS LAST;
$$;

REVOKE ALL ON public.visit_step_timeline FROM anon;
GRANT SELECT ON public.visit_step_timeline TO service_role, authenticated;
REVOKE EXECUTE ON FUNCTION public.workflow_board(integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.workflow_sla_summary(integer) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.workflow_board(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.workflow_sla_summary(integer) TO service_role;
