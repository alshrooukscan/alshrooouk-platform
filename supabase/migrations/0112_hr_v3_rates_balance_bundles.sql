-- 0112 HR v3, part A (additive). Client voice notes 5 and 6 Oct 2026.
-- Nothing existing calls these objects until part B switches the payslip over.

-- 1. Attendance and bonus settings, one row, editable by an admin.
ALTER TABLE payroll_settings
  ADD COLUMN IF NOT EXISTS late_grace_minutes       integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS late_multiplier          numeric NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS early_leave_multiplier   numeric NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS early_leave_grace_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS absence_day_multiplier   numeric NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS overtime_min_minutes     integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS overtime_multiplier      numeric NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS extra_day_multiplier     numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS early_credit_cap_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS stay_credit_cap_minutes  integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS early_min_minutes        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grace_reduces_overtime   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS balance_mode             text    NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS partial_makeup_daily     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pay_unverified_days      boolean NOT NULL DEFAULT true;
DO $$ BEGIN
  ALTER TABLE payroll_settings ADD CONSTRAINT payroll_settings_balance_mode_chk
    CHECK (balance_mode IN ('monthly','daily'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Scan types carry their bonus behaviour and default rates.
ALTER TABLE exam_types
  ADD COLUMN IF NOT EXISTS counts_in_report_baseline boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS standalone_bonus          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_report_bonus      numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_raw_bonus         numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS name_aliases              text[]  NOT NULL DEFAULT '{}';

UPDATE exam_types SET counts_in_report_baseline = true, default_report_bonus = r, default_raw_bonus = r
FROM (VALUES ('3D CBCT Both Arch',100),('3D CBCT One Arch',50),('3D CBCT Quadrant',25),('3D CBCT Endo One Tooth',25),
             ('3D Sinus',50),('3D TMJ Both Sides Open & Closed',50),('3D TMJ Both Sides Open or Closed',50),
             ('3D TMJ One Side Open & Closed',50),('3D TMJ One Side Open or Closed',50)) v(n,r)
WHERE exam_types.name = v.n;
UPDATE exam_types SET standalone_bonus = true, default_report_bonus = 50, default_raw_bonus = 50
WHERE name = 'Dental Photography';
-- External client reports arrive typed by hand ("cbct q").
UPDATE exam_types SET name_aliases = ARRAY['cbct q','cbct quadrant','quadrant'] WHERE name = '3D CBCT Quadrant';

-- 3. Per-employee rate overrides (client: "each employee profile holds its own pricing").
CREATE TABLE IF NOT EXISTS employee_bonus_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  exam_type_id uuid NOT NULL REFERENCES exam_types(id) ON DELETE CASCADE,
  report_rate numeric CHECK (report_rate IS NULL OR report_rate >= 0),
  raw_rate numeric CHECK (raw_rate IS NULL OR raw_rate >= 0),
  updated_by_name text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, exam_type_id)
);
ALTER TABLE employee_bonus_rates ENABLE ROW LEVEL SECURITY;

-- 4. Bundles: a bundle is a fixed quantity of existing scan types.
CREATE TABLE IF NOT EXISTS exam_type_bundle_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_exam_type_id uuid NOT NULL REFERENCES exam_types(id) ON DELETE CASCADE,
  component_exam_type_id uuid NOT NULL REFERENCES exam_types(id),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  UNIQUE (bundle_exam_type_id, component_exam_type_id)
);
ALTER TABLE exam_type_bundle_items ENABLE ROW LEVEL SECURITY;
INSERT INTO exam_type_bundle_items (bundle_exam_type_id, component_exam_type_id, quantity)
SELECT b.id, c.id, v.q
FROM (VALUES
  ('2D Panoramic + Ceph Image','Panoramic Adult Full Arch',1),
  ('2D Panoramic + Ceph Image','Ceph Image (2D Cephalometry)',1),
  ('Ceph Profile (Orthodontic Study)','Panoramic Adult Full Arch',1),
  ('Ceph Profile (Orthodontic Study)','Ceph Image (2D Cephalometry)',1),
  ('Ceph Profile (Orthodontic Study)','Ceph Analysis (Tracing)',1),
  ('Ceph Profile (Orthodontic Study)','Dental Photography',1),
  ('Ceph Profile (Complete Orthodontic Study)','Panoramic Adult Full Arch',1),
  ('Ceph Profile (Complete Orthodontic Study)','Ceph Image (2D Cephalometry)',2),
  ('Ceph Profile (Complete Orthodontic Study)','Ceph Analysis (Tracing)',1),
  ('Ceph Profile (Complete Orthodontic Study)','Dental Photography',1),
  ('Ceph Profile (Complete Orthodontic Study)','Photo Analysis',1),
  ('Package: CBCT + 2 Panoramic Adult Full Arch','Panoramic Adult Full Arch',2),
  ('Package: CBCT + 2 Panoramic Adult Full Arch','3D CBCT Both Arch',1)
) v(b,c,q)
JOIN exam_types b ON b.name = v.b JOIN exam_types c ON c.name = v.c
ON CONFLICT (bundle_exam_type_id, component_exam_type_id) DO UPDATE SET quantity = EXCLUDED.quantity;

-- 5. Work done per bundle component, so each part's bonus goes to whoever did it.
--    Empty until the workflow screen records parts; until then the visit-level
--    uploader is credited for every component.
CREATE TABLE IF NOT EXISTS visit_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  exam_type_id uuid NOT NULL REFERENCES exam_types(id),
  unit_no integer NOT NULL DEFAULT 1,
  raw_data_uploaded_at timestamptz,
  raw_data_uploaded_by_employee_id uuid REFERENCES employees(id),
  raw_data_uploaded_by_name text,
  report_done_at timestamptz,
  report_done_by_employee_id uuid REFERENCES employees(id),
  report_done_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (visit_id, exam_type_id, unit_no)
);
ALTER TABLE visit_components ENABLE ROW LEVEL SECURITY;

-- 6. Name -> scan type, tolerant of case and the hand-typed aliases.
CREATE OR REPLACE FUNCTION public.hr_exam_type_by_name(p_name text)
RETURNS exam_types LANGUAGE sql STABLE AS $$
  SELECT * FROM exam_types
  WHERE lower(btrim(name)) = lower(btrim(p_name)) OR lower(btrim(p_name)) = ANY(name_aliases)
  ORDER BY (lower(btrim(name)) = lower(btrim(p_name))) DESC, is_active DESC
  LIMIT 1
$$;

-- 7. Every bonus line for one employee and month (raw data and reports).
CREATE OR REPLACE FUNCTION public.employee_bonus_lines(p_employee_id uuid, p_period text)
RETURNS TABLE(kind text, visit_id uuid, report_id uuid, done_at timestamptz, work_date date,
              visit_time timestamp, scan_type text, from_bundle text, source text,
              eligible boolean, standalone boolean, on_shift boolean, seq integer,
              status text, rate numeric, amount numeric)
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v_period text := public.payroll_period_normalize(p_period);
  v_from date := to_date(v_period||'-01','YYYY-MM-DD');
  v_to date := (to_date(v_period||'-01','YYYY-MM-DD') + interval '1 month - 1 day')::date;
  v_thr int; v_name text;
BEGIN
  SELECT coalesce(report_daily_threshold,5), name INTO v_thr, v_name FROM employees WHERE id = p_employee_id;
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
           CASE WHEN l.k = 'report' AND l.elig AND NOT l.stand THEN
             row_number() OVER (PARTITION BY l.k, (l.elig AND NOT l.stand), (l.at AT TIME ZONE 'Africa/Cairo')::date
                                ORDER BY l.vtime, l.at, l.ord, l.unit_no)::int
           ELSE 0 END AS sq,
           coalesce(CASE WHEN l.k='report' THEN ebr.report_rate ELSE ebr.raw_rate END,
                    CASE WHEN l.k='report' THEN l.d_rep ELSE l.d_raw END, 0) AS rt
    FROM lines l
    LEFT JOIN employee_bonus_rates ebr ON ebr.employee_id = p_employee_id AND ebr.exam_type_id = l.et_id
  )
  SELECT s.k, s.vid, s.rid, s.at, s.wd, s.vtime, s.cname, s.bname, s.src, s.elig, s.stand, s.shift_day, s.sq,
         CASE WHEN s.stand THEN 'standalone'
              WHEN NOT s.elig THEN 'not_eligible'
              WHEN s.k = 'raw_data' THEN 'paid'
              WHEN s.shift_day AND s.sq <= v_thr THEN 'baseline'
              ELSE 'extra' END,
         s.rt,
         CASE WHEN s.stand OR (s.elig AND (s.k='raw_data' OR NOT s.shift_day OR s.sq > v_thr)) THEN s.rt ELSE 0 END
  FROM sequenced s
  ORDER BY s.k, s.wd, s.vtime, s.at;
END $fn$;

-- 8. Attendance, one row per scheduled day and per unscheduled day worked (Cairo time).
CREATE OR REPLACE FUNCTION public.attendance_days(p_employee_id uuid, p_from date, p_to date)
RETURNS TABLE(work_date date, status text, shift_start time, shift_end time, shift_minutes integer,
              signed_in timestamp, signed_out timestamp, late_raw integer, early_raw integer,
              after_raw integer, left_early integer, early_leave_excused boolean,
              day_value numeric, minute_rate numeric, note text)
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  emp employees; v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
  v_created date; v_has_clock boolean; v_sched_days int; v_month_from date;
BEGIN
  SELECT * INTO emp FROM employees WHERE id = p_employee_id;
  IF emp IS NULL THEN RETURN; END IF;
  v_created := (emp.created_at AT TIME ZONE 'Africa/Cairo')::date;
  v_month_from := date_trunc('month', p_from)::date;
  SELECT EXISTS (SELECT 1 FROM timeclock_events t WHERE t.employee_id = p_employee_id
                 AND (t.event_time AT TIME ZONE 'Africa/Cairo')::date BETWEEN p_from AND p_to) INTO v_has_clock;
  SELECT count(*)::int INTO v_sched_days FROM employee_schedule_days s
   WHERE s.employee_id = p_employee_id AND s.is_day_off = false
     AND s.work_date BETWEEN v_month_from AND (v_month_from + interval '1 month - 1 day')::date;

  RETURN QUERY
  WITH ev AS (
    SELECT t.event_type, (t.event_time AT TIME ZONE 'Africa/Cairo') AS lt  -- measured to the second; minutes are rounded down below, in the employee's favour
    FROM timeclock_events t
    WHERE t.employee_id = p_employee_id
      AND t.event_time >= (p_from - 1)::timestamp AT TIME ZONE 'Africa/Cairo'
      AND t.event_time <  (p_to + 2)::timestamp AT TIME ZONE 'Africa/Cairo'
  ), sched AS (
    SELECT s.work_date AS d, s.start_time AS st0, s.end_time AS et,
           -- an end before the start is an overnight shift; one longer than 14h is a data error
           -- (Doaa's Saturday stored as 23:00-21:00), read as a 10-hour shift ending at the end time
           -- (time + interval wraps at midnight in Postgres, so the length is worked out in minutes)
           CASE WHEN s.end_time <= s.start_time
                 AND EXTRACT(EPOCH FROM (s.end_time - s.start_time))/60 + 1440 > 840
                THEN (s.end_time - interval '10 hours')::time ELSE s.start_time END AS st,
           (s.end_time <= s.start_time
             AND EXTRACT(EPOCH FROM (s.end_time - s.start_time))/60 + 1440 > 840) AS bad
    FROM employee_schedule_days s
    WHERE s.employee_id = p_employee_id AND s.is_day_off = false AND s.work_date BETWEEN p_from AND p_to
  ), sd AS (
    SELECT sc.*, sc.d + sc.st AS st_ts,
           CASE WHEN sc.et <= sc.st THEN sc.d + 1 + sc.et ELSE sc.d + sc.et END AS en_ts
    FROM sched sc
  ), sdin AS (
    -- first punch of any type: an approved correction can store a sign-in as 'logout'
    SELECT x.*, (SELECT min(e.lt) FROM ev e
                  WHERE e.lt >= x.st_ts - interval '6 hours' AND e.lt < x.en_ts) AS tin
    FROM sd x
  ), sdio AS (
    SELECT x.*, (SELECT max(e.lt) FROM ev e WHERE x.tin IS NOT NULL
                  AND e.lt > x.tin + interval '2 minutes' AND e.lt <= x.en_ts + interval '6 hours') AS tout
    FROM sdin x
  ), scheduled AS (
    SELECT x.d, x.st, x.et, (EXTRACT(EPOCH FROM (x.en_ts - x.st_ts))/60)::int AS smin, x.tin, x.tout,
           x.st_ts, x.en_ts, x.bad,
           CASE WHEN x.d > v_today THEN 'future'
                WHEN NOT v_has_clock THEN 'no_clock_data'
                WHEN x.d < v_created THEN 'before_account'
                WHEN x.d = v_created THEN 'onboarding'
                WHEN x.tin IS NULL AND (
                     EXISTS (SELECT 1 FROM leave_requests l WHERE l.employee_id = p_employee_id
                             AND l.status='approved' AND x.d BETWEEN l.start_date AND l.end_date)
                  OR EXISTS (SELECT 1 FROM attendance_exceptions a WHERE a.employee_id = p_employee_id
                             AND a.status='approved' AND a.work_date = x.d)
                  OR EXISTS (SELECT 1 FROM shift_swap_requests w
                             JOIN employee_schedule_days s2 ON s2.id IN (w.requester_day_id, w.target_day_id)
                             WHERE w.status='approved' AND s2.work_date = x.d
                               AND p_employee_id IN (w.requester_id, w.target_id))) THEN 'excused'
                WHEN x.d = v_today AND x.tin IS NULL THEN 'future'
                WHEN x.tin IS NULL THEN 'absent'
                WHEN x.tout IS NULL THEN 'missing_signout'
                WHEN x.onb THEN 'onboarding'
                ELSE 'present' END AS stat
    FROM (SELECT y.*, false AS onb FROM sdio y) x
  ), extra AS (
    SELECT (e.lt)::date AS d, min(e.lt) AS tin, max(e.lt) AS tout
    FROM ev e
    WHERE e.lt::date BETWEEN p_from AND p_to
      AND NOT EXISTS (SELECT 1 FROM sd WHERE e.lt >= sd.st_ts - interval '6 hours' AND e.lt <= sd.en_ts + interval '6 hours')
      AND NOT EXISTS (SELECT 1 FROM sched sc WHERE sc.d = e.lt::date)
    GROUP BY 1
  )
  SELECT s.d, s.stat, s.st, s.et, s.smin, s.tin, s.tout,
         CASE WHEN s.tin IS NULL THEN 0 ELSE greatest(0,floor(EXTRACT(EPOCH FROM (s.tin - s.st_ts))/60)::numeric)::int END,
         CASE WHEN s.tin IS NULL THEN 0 ELSE greatest(0,floor(EXTRACT(EPOCH FROM (s.st_ts - s.tin))/60)::numeric)::int END,
         CASE WHEN s.tout IS NULL THEN 0 ELSE greatest(0,floor(EXTRACT(EPOCH FROM (s.tout - s.en_ts))/60)::numeric)::int END,
         CASE WHEN s.tout IS NULL THEN 0 ELSE greatest(0,floor(EXTRACT(EPOCH FROM (s.en_ts - s.tout))/60)::numeric)::int END,
         -- excuse_submissions carry no date of their own: an approved excuse filed on the work
         -- day or the day before covers that day's early leave (both September excuses fit this).
         EXISTS (SELECT 1 FROM excuse_submissions x WHERE x.employee_id = p_employee_id AND x.status='approved'
                 AND (x.created_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN s.d - 1 AND s.d),
         CASE WHEN coalesce(emp.hourly_rate,0) > 0 THEN round(s.smin/60.0*emp.hourly_rate,4)
              WHEN v_sched_days > 0 THEN round((coalesce(emp.fixed_salary,0)+coalesce(emp.variable_salary,0))/v_sched_days,4)
              ELSE 0 END,
         CASE WHEN coalesce(emp.hourly_rate,0) > 0 THEN emp.hourly_rate/60.0
              WHEN v_sched_days > 0 AND s.smin > 0 THEN (coalesce(emp.fixed_salary,0)+coalesce(emp.variable_salary,0))/v_sched_days/s.smin
              ELSE 0 END,
         CASE WHEN s.bad THEN 'Schedule stored as '||to_char(s.st0,'HH24:MI')||'-'||to_char(s.et,'HH24:MI')||', read as '||to_char(s.st,'HH24:MI')||'-'||to_char(s.et,'HH24:MI') END
  FROM (SELECT sc2.*, sch.st0 FROM scheduled sc2 JOIN sched sch ON sch.d = sc2.d) s
  UNION ALL
  SELECT x.d, 'extra_day', NULL, NULL, 0, x.tin, x.tout, 0, 0, 0, 0, false,
         CASE WHEN coalesce(emp.hourly_rate,0) > 0 THEN round(EXTRACT(EPOCH FROM (x.tout - x.tin))/3600.0*emp.hourly_rate,4)
              WHEN v_sched_days > 0 THEN round((coalesce(emp.fixed_salary,0)+coalesce(emp.variable_salary,0))/v_sched_days,4)
              ELSE 0 END,
         0, 'Worked on a day with no shift'
  FROM extra x WHERE x.tin IS NOT NULL AND x.tout > x.tin + interval '2 minutes'
  ORDER BY 1;
END $fn$;

-- 9. Monthly balance: lateness vs early arrival + staying late (client 5 and 6 Oct).
CREATE OR REPLACE FUNCTION public.attendance_balance(p_employee_id uuid, p_period text)
RETURNS json LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v_period text := public.payroll_period_normalize(p_period);
  v_from date := to_date(v_period||'-01','YYYY-MM-DD');
  v_to date := (to_date(v_period||'-01','YYYY-MM-DD') + interval '1 month - 1 day')::date;
  s payroll_settings; emp employees;
  L numeric:=0; G numeric:=0; Cs numeric:=0; Co numeric:=0; F numeric; U numeric; G2 numeric; OT numeric;
  v_rate numeric; v_sched_min numeric; v_days json;
  d_late_money numeric:=0; d_ot_money numeric:=0; d_ot_min numeric:=0; d_unmade numeric:=0;
  early_money numeric:=0; early_min numeric:=0; absent_days int:=0; absent_money numeric:=0;
  extra_days int:=0; extra_money numeric:=0; unverified_days int:=0; unverified_money numeric:=0;
  present_days int:=0; present_money numeric:=0; review_days int:=0; absent_dates text;
  r record; late_c int; grace int; ec int; ac int; cr int; x int; left_c int;
BEGIN
  SELECT * INTO s FROM payroll_settings WHERE id;
  SELECT * INTO emp FROM employees WHERE id = p_employee_id;
  IF emp IS NULL THEN RETURN NULL; END IF;

  FOR r IN SELECT * FROM public.attendance_days(p_employee_id, v_from, v_to) LOOP
    IF r.status = 'present' THEN
      present_days := present_days + 1; present_money := present_money + r.day_value;
      late_c := CASE WHEN r.late_raw > s.late_grace_minutes THEN r.late_raw ELSE 0 END;
      grace  := CASE WHEN r.late_raw > 0 AND r.late_raw <= s.late_grace_minutes THEN r.late_raw ELSE 0 END;
      ec := CASE WHEN r.early_raw > 0 AND r.early_raw >= s.early_min_minutes THEN least(r.early_raw, s.early_credit_cap_minutes) ELSE 0 END;
      ac := least(r.after_raw, s.stay_credit_cap_minutes);
      cr := ec + ac;
      L := L + late_c; G := G + grace;
      IF cr >= s.overtime_min_minutes THEN Co := Co + cr; ELSE Cs := Cs + cr; END IF;
      -- daily mode, kept for comparison and for balance_mode = 'daily'
      x := least(cr, late_c);
      IF x < late_c THEN
        d_unmade := d_unmade + CASE WHEN s.partial_makeup_daily THEN late_c - x ELSE late_c END;
        d_late_money := d_late_money + (CASE WHEN s.partial_makeup_daily THEN late_c - x ELSE late_c END) * s.late_multiplier * r.minute_rate;
      END IF;
      x := greatest(0, cr - x - CASE WHEN s.grace_reduces_overtime THEN grace ELSE 0 END);
      IF x >= s.overtime_min_minutes THEN
        d_ot_min := d_ot_min + x; d_ot_money := d_ot_money + x * r.minute_rate * s.overtime_multiplier;
      END IF;
      -- leaving early without an approved excuse is always judged per day
      left_c := CASE WHEN NOT r.early_leave_excused AND r.left_early > s.early_leave_grace_minutes THEN r.left_early ELSE 0 END;
      early_min := early_min + left_c; early_money := early_money + left_c * s.early_leave_multiplier * r.minute_rate;
    ELSIF r.status = 'absent' THEN
      absent_days := absent_days + 1; absent_money := absent_money + r.day_value;
      absent_dates := concat_ws(', ', absent_dates, to_char(r.work_date,'DD Mon'));
    ELSIF r.status = 'extra_day' THEN
      extra_days := extra_days + 1; extra_money := extra_money + r.day_value * s.extra_day_multiplier;
    ELSIF r.status IN ('no_clock_data','before_account','onboarding') THEN
      unverified_days := unverified_days + 1; unverified_money := unverified_money + r.day_value;
    ELSIF r.status = 'missing_signout' THEN
      review_days := review_days + 1;
    END IF;
  END LOOP;

  SELECT coalesce(sum(shift_minutes),0) INTO v_sched_min FROM public.attendance_days(p_employee_id, v_from, v_to) WHERE status <> 'extra_day';
  v_rate := CASE WHEN coalesce(emp.hourly_rate,0) > 0 THEN emp.hourly_rate/60.0
                 WHEN v_sched_min > 0 THEN (coalesce(emp.fixed_salary,0)+coalesce(emp.variable_salary,0))/v_sched_min ELSE 0 END;

  F  := greatest(0, L - Cs);
  U  := greatest(0, F - Co);
  G2 := greatest(0, G * (CASE WHEN s.grace_reduces_overtime THEN 1 ELSE 0 END) - greatest(0, Cs - L));
  OT := greatest(0, Co - F - G2);

  RETURN json_build_object(
    'period', v_period, 'mode', s.balance_mode,
    'late_counted_minutes', L, 'grace_minutes', G, 'credit_offset_minutes', Cs, 'credit_ot_day_minutes', Co,
    'uncovered_late_minutes', CASE WHEN s.balance_mode='monthly' THEN U ELSE d_unmade END,
    'overtime_minutes', CASE WHEN s.balance_mode='monthly' THEN OT ELSE d_ot_min END,
    'net_balance_minutes', Cs + Co - L - G,
    'average_minute_rate', round(v_rate,4),
    'late_deduction', round(CASE WHEN s.balance_mode='monthly' THEN U * s.late_multiplier * v_rate ELSE d_late_money END,2),
    'overtime_value', round(CASE WHEN s.balance_mode='monthly' THEN OT * v_rate * s.overtime_multiplier ELSE d_ot_money END,2),
    'early_leave_minutes', early_min, 'early_leave_deduction', round(early_money,2),
    'absent_days', absent_days, 'absent_dates', absent_dates,
    -- the absent day is already unpaid in gross, so the extra charge is (multiplier - 1) days
    'absence_deduction', round(absent_money * greatest(s.absence_day_multiplier - 1, 0),2),
    'present_days', present_days, 'present_pay', round(present_money,2),
    'unverified_days', unverified_days, 'unverified_pay', round(CASE WHEN s.pay_unverified_days THEN unverified_money ELSE 0 END,2),
    'extra_days', extra_days, 'extra_day_pay', round(extra_money,2),
    'needs_review_days', review_days
  );
END $fn$;

-- 10. Totals used by the payslip.
CREATE OR REPLACE FUNCTION public.employee_raw_data_bonus(p_employee_id uuid, p_period text)
RETURNS TABLE(uploads integer, qualifying integer, bonus numeric) LANGUAGE sql STABLE AS $$
  SELECT count(*)::int, count(*) FILTER (WHERE amount > 0)::int, coalesce(round(sum(amount),2),0)
  FROM public.employee_bonus_lines(p_employee_id, p_period) WHERE kind = 'raw_data'
$$;

CREATE OR REPLACE FUNCTION public.employee_report_bonus_v3(p_employee_id uuid, p_period text)
RETURNS TABLE(reports_total integer, beyond_threshold integer, off_shift integer, qualifying integer, rate numeric, bonus numeric)
LANGUAGE sql STABLE AS $$
  SELECT count(*)::int,
         count(*) FILTER (WHERE status='extra' AND on_shift)::int,
         count(*) FILTER (WHERE status='extra' AND NOT on_shift)::int,
         count(*) FILTER (WHERE amount > 0)::int,
         CASE WHEN count(*) FILTER (WHERE amount > 0) > 0
              THEN round(sum(amount) / count(*) FILTER (WHERE amount > 0), 2) ELSE 0 END,
         coalesce(round(sum(amount),2),0)
  FROM public.employee_bonus_lines(p_employee_id, p_period) WHERE kind = 'report'
$$;

-- 11. v3 pay for non-hybrid staff: days worked + unverified days paid + extra days.
CREATE OR REPLACE FUNCTION public.payslip_gross_v3(p_employee_id uuid, p_period text)
RETURNS numeric LANGUAGE plpgsql STABLE AS $fn$
DECLARE b json; emp employees; v_sched int;
BEGIN
  SELECT * INTO emp FROM employees WHERE id = p_employee_id;
  IF emp IS NULL THEN RETURN 0; END IF;
  IF emp.enable_hybrid_variable_pay THEN RETURN public.payslip_gross_v2(p_employee_id, p_period); END IF;
  -- salaried staff with no roster keep the existing whole-salary default
  IF coalesce(emp.hourly_rate,0) = 0 THEN
    SELECT count(*)::int INTO v_sched FROM employee_schedule_days s
     WHERE s.employee_id = p_employee_id AND s.is_day_off = false
       AND to_char(s.work_date,'YYYY-MM') = public.payroll_period_normalize(p_period);
    IF v_sched = 0 THEN RETURN public.payslip_gross_v2(p_employee_id, p_period); END IF;
  END IF;
  b := public.attendance_balance(p_employee_id, p_period);
  RETURN round((b->>'present_pay')::numeric + (b->>'unverified_pay')::numeric + (b->>'extra_day_pay')::numeric, 2);
END $fn$;
