-- 0118: switch for whether external client reports count toward the daily free reports.
-- Mohamed Said, 30 Oct 2026: keep it a toggle in case the rule changes later.
-- Off by default = the 0117 rule (external reports outside the count).
-- On = external reports are numbered with clinic reports, as before 0117.

ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS external_reports_in_baseline boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN payroll_settings.external_reports_in_baseline IS 'When true, external client reports count toward each employee''s daily free reports (report_daily_threshold). Off since 30 Oct 2026.';

CREATE OR REPLACE FUNCTION public.employee_bonus_lines(p_employee_id uuid, p_period text)
 RETURNS TABLE(kind text, visit_id uuid, report_id uuid, done_at timestamp with time zone, work_date date, visit_time timestamp without time zone, scan_type text, from_bundle text, source text, eligible boolean, standalone boolean, on_shift boolean, seq integer, status text, rate numeric, amount numeric)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_period text := public.payroll_period_normalize(p_period);
  v_from date := to_date(v_period||'-01','YYYY-MM-DD');
  v_to date := (to_date(v_period||'-01','YYYY-MM-DD') + interval '1 month - 1 day')::date;
  v_thr int; v_name text; v_ext boolean;
BEGIN
  SELECT coalesce(report_daily_threshold,5), name INTO v_thr, v_name FROM employees WHERE id = p_employee_id;
  -- switch on HR Rules: do external client reports count toward the daily free reports?
  SELECT coalesce(external_reports_in_baseline,false) INTO v_ext FROM payroll_settings WHERE id;
  RETURN QUERY
  WITH units AS (
    -- one row per scan unit; bundles expanded into their parts
    SELECT v.id AS vid, st.name AS sname, st.ord,
           coalesce(bi.cname, st.name) AS cname, CASE WHEN bi.cname IS NULL THEN NULL ELSE st.name END AS bname,
           coalesce(bi.unit,1) AS unit_no, v.*
    FROM visits v
    CROSS JOIN LATERAL unnest(coalesce(v.scan_types,'{}'::text[])) WITH ORDINALITY st(name, ord)
    LEFT JOIN LATERAL (
      SELECT c.name AS cname, g.unit
      FROM exam_type_bundle_items i
      JOIN exam_types b ON b.id = i.bundle_exam_type_id
      JOIN exam_types c ON c.id = i.component_exam_type_id
      CROSS JOIN LATERAL generate_series(1, i.quantity) g(unit)
      WHERE b.id = (public.hr_exam_type_by_name(st.name)).id
    ) bi ON true
    WHERE (v.raw_data_uploaded_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN v_from AND v_to
       OR (v.report_done_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN v_from AND v_to
       OR EXISTS (SELECT 1 FROM visit_components vc WHERE vc.visit_id = v.id
                  AND ((vc.raw_data_uploaded_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN v_from AND v_to
                    OR (vc.report_done_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN v_from AND v_to))
  ), credited AS (
    SELECT u.*, et.id AS et_id, et.counts_in_report_baseline AS elig, et.standalone_bonus AS stand,
           et.default_report_bonus AS d_rep, et.default_raw_bonus AS d_raw,
           coalesce(vc.raw_data_uploaded_by_employee_id, u.raw_data_uploaded_by_employee_id) AS raw_emp,
           coalesce(vc.raw_data_uploaded_at, u.raw_data_uploaded_at) AS raw_at,
           coalesce(vc.report_done_by_employee_id, u.report_done_by_employee_id) AS rep_emp,
           coalesce(vc.report_done_at, u.report_done_at) AS rep_at,
           CASE WHEN u.exam_date IS NULL OR u.exam_date < date '2000-01-01'
                THEN (u.created_at AT TIME ZONE 'Africa/Cairo')
                ELSE u.exam_date + coalesce(u.exam_time, (u.created_at AT TIME ZONE 'Africa/Cairo')::time) END AS vtime
    FROM units u
    LEFT JOIN LATERAL (SELECT (public.hr_exam_type_by_name(u.cname)).*) et ON true
    LEFT JOIN visit_components vc ON vc.visit_id = u.vid AND vc.exam_type_id = et.id AND vc.unit_no = u.unit_no
  ), lines AS (
    SELECT 'raw_data'::text AS k, c.vid, NULL::uuid AS rid, c.raw_at AS at, c.vtime, c.cname, c.bname,
           'Clinic visit'::text AS src, coalesce(c.elig,false) AS elig, coalesce(c.stand,false) AS stand, c.et_id,
           c.d_rep, c.d_raw, c.ord, c.unit_no
    FROM credited c
    WHERE c.raw_emp = p_employee_id AND (c.raw_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN v_from AND v_to
    UNION ALL
    SELECT 'report', c.vid, NULL, c.rep_at, c.vtime, c.cname, c.bname, 'Clinic visit',
           coalesce(c.elig,false), coalesce(c.stand,false), c.et_id, c.d_rep, c.d_raw, c.ord, c.unit_no
    FROM credited c
    WHERE c.rep_emp = p_employee_id AND (c.rep_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN v_from AND v_to
    UNION ALL
    SELECT 'report', NULL, r.id, r.completed_at, (r.created_at AT TIME ZONE 'Africa/Cairo'),
           coalesce(et.name, r.scan_name), NULL, 'External client',
           coalesce(et.counts_in_report_baseline,false), coalesce(et.standalone_bonus,false), et.id,
           et.default_report_bonus, et.default_raw_bonus, 1, 1
    FROM reports r
    LEFT JOIN LATERAL (SELECT (public.hr_exam_type_by_name(r.scan_name)).*) et ON true
    -- external reports are assigned by staff-profile id, so the name is the reliable link
    WHERE r.source_type = 'client'
      AND (r.assigned_to_employee_id = p_employee_id OR lower(btrim(r.assigned_to_name)) = lower(btrim(v_name)))
      AND r.completed_at IS NOT NULL
      AND (r.completed_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN v_from AND v_to
  ), sequenced AS (
    SELECT l.*, (l.at AT TIME ZONE 'Africa/Cairo')::date AS wd,
           EXISTS (SELECT 1 FROM employee_schedule_days s WHERE s.employee_id = p_employee_id
                   AND s.is_day_off = false AND s.work_date = (l.at AT TIME ZONE 'Africa/Cairo')::date) AS shift_day,
           -- external client reports count toward the daily free reports only when
           -- payroll_settings.external_reports_in_baseline is on (off since 30 Oct 2026)
           CASE WHEN l.k = 'report' AND l.elig AND NOT l.stand AND (v_ext OR l.src <> 'External client') THEN
             row_number() OVER (PARTITION BY l.k, (l.elig AND NOT l.stand AND (v_ext OR l.src <> 'External client')), (l.at AT TIME ZONE 'Africa/Cairo')::date
                                ORDER BY l.vtime, l.at, l.ord, l.unit_no)::int
           ELSE 0 END AS sq,
           CASE WHEN l.k='report' AND l.src='External client'
                -- external client reports have their own price (Mohamed, 29 Oct 2026; default 0)
                THEN coalesce(ebr.external_rate, (SELECT et2.default_external_bonus FROM exam_types et2 WHERE et2.id = l.et_id), 0)
                ELSE coalesce(CASE WHEN l.k='report' THEN ebr.report_rate ELSE ebr.raw_rate END,
                              CASE WHEN l.k='report' THEN l.d_rep ELSE l.d_raw END, 0) END AS rt
    FROM lines l
    LEFT JOIN employee_bonus_rates ebr ON ebr.employee_id = p_employee_id AND ebr.exam_type_id = l.et_id
  )
  SELECT s.k, s.vid, s.rid, s.at, s.wd, s.vtime, s.cname, s.bname, s.src, s.elig, s.stand, s.shift_day, s.sq,
         CASE WHEN s.stand THEN 'standalone'
              WHEN NOT s.elig THEN 'not_eligible'
              WHEN s.k = 'raw_data' THEN 'paid'
              WHEN s.src = 'External client' AND NOT v_ext THEN 'external'
              WHEN s.shift_day AND s.sq <= v_thr THEN 'baseline'
              ELSE 'extra' END,
         s.rt,
         CASE WHEN s.stand OR (s.elig AND (s.k='raw_data' OR (s.src='External client' AND NOT v_ext) OR NOT s.shift_day OR s.sq > v_thr)) THEN s.rt ELSE 0 END
  FROM sequenced s
  ORDER BY s.k, s.wd, s.vtime, s.at;
END $function$;
