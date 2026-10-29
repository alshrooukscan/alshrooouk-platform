-- 0116: payroll rules agreed with Mohamed Said, 29 Oct 2026.
--
-- GUIDING PRINCIPLE: each person is paid what is EXPECTED (the fixed salary in
-- full, or the roster hours x the hourly rate). Every plus or minus is SHOWN
-- and reaches the payslip only once an admin approves it. Exception: the
-- report bonus stays automatic.
--   * time balance = early arrival + staying late (max 60 min each a day)
--     + minutes worked on days off the roster - every late minute (no grace)
--     - every unexcused early-leave minute; netted over the month
--   * positive -> overtime, negative -> time deduction, both at 2x
--   * absence = 2 days of pay, or 1 day when an approved permission covers it
--   * perfect attendance = no late minute, no early minute, no absence ->
--     10% of the fixed salary / roster pay after manual deductions
--   * external client reports priced separately per employee (default 0)
--   * attendance-exempt staff (no clock) get their base, no attendance items
-- Also fixes: approved deductions and approved overtime were stored as
-- 'pending' and never counted; generate_payslip counted pending items.

-- ---------------------------------------------------------------- schema
ALTER TABLE employees ADD COLUMN IF NOT EXISTS attendance_exempt boolean NOT NULL DEFAULT false;
UPDATE employees SET attendance_exempt = true WHERE name = 'Fatma Mahmoud Ali';

ALTER TABLE excuse_submissions ADD COLUMN IF NOT EXISTS excuse_date date;
UPDATE excuse_submissions SET excuse_date = DATE '2026-10-18'
 WHERE id IN ('a2507673-cd5a-409c-a959-f373986cfa2e','af707335-ee47-4cf6-8004-172f867c1c9a') AND excuse_date IS NULL;
INSERT INTO excuse_rules (name, rule_type, value)
SELECT 'Full-day absence', 'fixed', NULL
WHERE NOT EXISTS (SELECT 1 FROM excuse_rules WHERE name = 'Full-day absence');

ALTER TABLE employee_bonus_rates ADD COLUMN IF NOT EXISTS external_rate numeric;
ALTER TABLE exam_types ADD COLUMN IF NOT EXISTS default_external_bonus numeric NOT NULL DEFAULT 0;

ALTER TABLE payroll_adjustments ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
-- rows written by the engine, not typed by a person
UPDATE payroll_adjustments SET source = 'overtime' WHERE label ILIKE '%overtime%' AND source = 'manual';

-- approved decisions that were left 'pending' by the old decide functions
UPDATE payroll_adjustments a SET status = 'approved', source = 'deduction:'||d.kind,
       decided_by_name = d.approved_by_name, decided_at = d.approved_at
  FROM payroll_deductions d WHERE d.adjustment_id = a.id AND d.status = 'approved' AND a.status = 'pending';
UPDATE payroll_adjustments a SET status = 'approved', decided_by_name = o.decided_by_name, decided_at = o.decided_at
  FROM overtime_decisions o WHERE o.adjustment_id = a.id AND o.status = 'approved' AND a.status = 'pending';

-- September was paid outside the system (Mohamed, 29 Oct): nothing left over may reach a later payslip
UPDATE payroll_deductions SET status = 'rejected', approved_by_name = 'System',
       approved_at = now(), decision_note = 'September 2026 was settled outside the system (Mohamed Said, 29 Oct 2026).'
 WHERE period = '2026-09' AND status = 'pending';
UPDATE payroll_adjustments SET status = 'rejected', decided_by_name = 'System', decided_at = now(),
       decision_note = 'September 2026 was settled outside the system (Mohamed Said, 29 Oct 2026).'
 WHERE public.payroll_period_normalize(period) = '2026-09' AND status = 'pending';

CREATE OR REPLACE FUNCTION public.attendance_balance_legacy(p_employee_id uuid, p_period text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
AS $function$
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
END $function$
;

-- ---------------------------------------------------------------- the engine
CREATE OR REPLACE FUNCTION public.payroll_month(p_employee_id uuid, p_period text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_period text := public.payroll_period_normalize(p_period);
  v_from date := to_date(v_period||'-01','YYYY-MM-DD');
  v_to date := (to_date(v_period||'-01','YYYY-MM-DD') + interval '1 month - 1 day')::date;
  s payroll_settings; emp employees;
  v_hourly boolean; v_exempt boolean;
  v_sched_days int := 0; v_sched_min numeric := 0; v_sched_pay numeric := 0;
  v_present int := 0; v_absent int := 0; v_permitted int := 0; v_future int := 0; v_review int := 0;
  v_unverified int := 0; v_extra_days int := 0; v_extra_min numeric := 0; v_extra_pay numeric := 0;
  v_credit numeric := 0; v_late numeric := 0; v_late_days int := 0; v_early numeric := 0; v_early_days int := 0;
  v_absence_amt numeric := 0; v_absent_dates text; v_review_dates text; v_extra_dates text;
  v_base numeric := 0; v_rate numeric := 0; v_net numeric := 0; v_time numeric := 0;
  v_manual numeric := 0; v_pa_pct numeric := 10; v_perfect boolean; v_pa numeric := 0;
  v_rep_int numeric := 0; v_rep_ext numeric := 0; v_raw numeric := 0; v_no_roster boolean;
  r record; v_perm boolean; v_early_any numeric := 0;
BEGIN
  SELECT * INTO s FROM payroll_settings WHERE id;
  SELECT * INTO emp FROM employees WHERE id = p_employee_id;
  IF emp IS NULL THEN RETURN NULL; END IF;
  v_hourly := coalesce(emp.hourly_rate,0) > 0;
  v_exempt := coalesce(emp.attendance_exempt,false);

  FOR r IN SELECT * FROM public.attendance_days(p_employee_id, v_from, v_to) LOOP
    IF r.status <> 'extra_day' THEN
      v_sched_days := v_sched_days + 1;
      v_sched_min := v_sched_min + coalesce(r.shift_minutes,0);
      v_sched_pay := v_sched_pay + coalesce(r.day_value,0);
    END IF;
    IF r.status = 'present' THEN
      v_present := v_present + 1;
      v_credit := v_credit + least(r.early_raw, coalesce(s.early_credit_cap_minutes,60)) + least(r.after_raw, coalesce(s.stay_credit_cap_minutes,60));
      v_late := v_late + r.late_raw;
      IF r.late_raw > 0 THEN v_late_days := v_late_days + 1; END IF;
      v_early_any := v_early_any + r.left_early;
      IF r.left_early > 0 AND NOT r.early_leave_excused THEN
        v_early := v_early + r.left_early; v_early_days := v_early_days + 1;
      END IF;
    ELSIF r.status = 'absent' THEN
      v_perm := EXISTS (SELECT 1 FROM excuse_submissions x WHERE x.employee_id = p_employee_id
                          AND x.status = 'approved' AND x.excuse_date = r.work_date);
      v_absent := v_absent + 1;
      IF v_perm THEN v_permitted := v_permitted + 1; END IF;
      v_absence_amt := v_absence_amt + coalesce(r.day_value,0) * CASE WHEN v_perm THEN 1 ELSE coalesce(s.absence_day_multiplier,2) END;
      v_absent_dates := concat_ws(', ', v_absent_dates, to_char(r.work_date,'DD Mon') || CASE WHEN v_perm THEN ' (permitted)' ELSE '' END);
    ELSIF r.status = 'extra_day' THEN
      v_extra_days := v_extra_days + 1;
      v_extra_min := v_extra_min + floor(EXTRACT(EPOCH FROM (r.signed_out - r.signed_in))/60);
      v_extra_pay := v_extra_pay + coalesce(r.day_value,0);
      v_extra_dates := concat_ws(', ', v_extra_dates, to_char(r.work_date,'DD Mon'));
    ELSIF r.status = 'future' THEN v_future := v_future + 1;
    ELSIF r.status = 'missing_signout' THEN
      v_review := v_review + 1; v_review_dates := concat_ws(', ', v_review_dates, to_char(r.work_date,'DD Mon'));
    ELSIF r.status IN ('no_clock_data','before_account','onboarding') THEN v_unverified := v_unverified + 1;
    END IF;
  END LOOP;

  v_no_roster := v_sched_days = 0;

  -- expected base
  IF v_hourly THEN
    IF v_no_roster THEN v_base := v_extra_pay;          -- no roster yet: the hours actually worked, at the normal rate
    ELSE v_base := v_sched_pay; END IF;
    v_rate := emp.hourly_rate / 60.0;
  ELSE
    v_base := coalesce(emp.fixed_salary,0) + coalesce(emp.variable_salary,0);
    v_rate := CASE WHEN v_sched_min > 0 THEN v_base / v_sched_min ELSE 0 END;
  END IF;

  IF v_exempt THEN
    v_credit := 0; v_late := 0; v_early := 0; v_extra_min := 0; v_absence_amt := 0;
  END IF;
  -- an hourly person with no roster is already paid those hours in the base
  IF v_hourly AND v_no_roster THEN v_extra_min := 0; END IF;

  v_net := v_credit - v_late - v_early + v_extra_min;
  v_time := round(v_net * v_rate * CASE WHEN v_net >= 0 THEN coalesce(s.overtime_multiplier,2) ELSE coalesce(s.late_multiplier,2) END, 2);

  -- manual items typed on the payslip page (not the engine's own)
  SELECT coalesce(sum(CASE WHEN a.kind = 'bonus' THEN a.amount ELSE -a.amount END),0) INTO v_manual
    FROM payroll_adjustments a
   WHERE a.employee_id = p_employee_id AND public.payroll_period_normalize(a.period) = v_period
     AND a.source = 'manual' AND a.status IN ('pending','approved');

  SELECT coalesce(value,10) INTO v_pa_pct FROM deduction_rules
   WHERE kind = 'bonus' AND rule_type = 'percentage' AND name ILIKE 'perfect attendance%' AND is_active LIMIT 1;
  v_pa_pct := coalesce(v_pa_pct, 10);
  -- strict: not one minute late (grace ignored) or early, even an excused one, and no absence at all
  v_perfect := NOT v_exempt AND v_present > 0 AND v_late = 0 AND v_early_any = 0 AND v_absent = 0 AND v_review = 0;
  IF v_perfect THEN v_pa := round((v_base + least(v_manual,0)) * v_pa_pct / 100.0, 2); END IF;

  SELECT coalesce(sum(amount) FILTER (WHERE kind='report' AND source <> 'External client'),0),
         coalesce(sum(amount) FILTER (WHERE kind='report' AND source = 'External client'),0),
         coalesce(sum(amount) FILTER (WHERE kind='raw_data'),0)
    INTO v_rep_int, v_rep_ext, v_raw
    FROM public.employee_bonus_lines(p_employee_id, v_period);

  RETURN json_build_object(
    'period', v_period, 'pay_basis', CASE WHEN v_hourly THEN 'hourly' ELSE 'monthly' END,
    'attendance_exempt', v_exempt, 'no_roster', v_no_roster,
    'scheduled_days', v_sched_days, 'scheduled_minutes', v_sched_min, 'scheduled_pay', round(v_sched_pay,2),
    'base', round(v_base,2), 'minute_rate', round(v_rate,4),
    'present_days', v_present, 'future_days', v_future, 'needs_review_days', v_review, 'needs_review_dates', v_review_dates,
    'unverified_days', v_unverified,
    'credit_minutes', v_credit, 'late_minutes', v_late, 'late_days', v_late_days,
    'early_leave_minutes', v_early, 'early_leave_days', v_early_days,
    'extra_days', v_extra_days, 'extra_minutes', v_extra_min, 'extra_dates', v_extra_dates,
    'net_minutes', v_net, 'time_value', v_time,
    'overtime_minutes', greatest(v_net,0), 'overtime_value', greatest(v_time,0),
    'time_deduction_minutes', greatest(-v_net,0), 'time_deduction', greatest(-v_time,0),
    'absent_days', v_absent, 'permitted_absent_days', v_permitted, 'absent_dates', v_absent_dates,
    'absence_deduction', round(v_absence_amt,2),
    'manual_adjustments', round(v_manual,2),
    'perfect_attendance', v_perfect, 'perfect_attendance_pct', v_pa_pct, 'perfect_attendance_bonus', v_pa,
    'month_complete', v_future = 0 AND (now() AT TIME ZONE 'Africa/Cairo')::date > v_to,
    'report_bonus_internal', round(v_rep_int,2), 'report_bonus_external', round(v_rep_ext,2), 'raw_data_bonus', round(v_raw,2)
  );
END $function$;

-- ---------------------------------------------------------------- balance, same keys the screens read
CREATE OR REPLACE FUNCTION public.attendance_balance(p_employee_id uuid, p_period text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE m json; emp employees; v_unv_pay numeric := 0;
BEGIN
  SELECT * INTO emp FROM employees WHERE id = p_employee_id;
  IF emp IS NULL THEN RETURN NULL; END IF;
  IF emp.enable_hybrid_variable_pay THEN RETURN public.attendance_balance_legacy(p_employee_id, p_period); END IF;
  m := public.payroll_month(p_employee_id, p_period);
  RETURN json_build_object(
    'period', m->>'period', 'mode', 'monthly',
    'late_counted_minutes', (m->>'late_minutes')::numeric, 'grace_minutes', 0,
    'credit_offset_minutes', 0, 'credit_ot_day_minutes', (m->>'credit_minutes')::numeric,
    'extra_minutes', (m->>'extra_minutes')::numeric, 'extra_dates', m->>'extra_dates',
    'uncovered_late_minutes', (m->>'time_deduction_minutes')::numeric,
    'overtime_minutes', (m->>'overtime_minutes')::numeric,
    'net_balance_minutes', (m->>'net_minutes')::numeric,
    'average_minute_rate', (m->>'minute_rate')::numeric,
    'late_deduction', (m->>'time_deduction')::numeric,
    'overtime_value', (m->>'overtime_value')::numeric,
    'early_leave_minutes', (m->>'early_leave_minutes')::numeric, 'early_leave_deduction', 0,
    'absent_days', (m->>'absent_days')::int, 'permitted_absent_days', (m->>'permitted_absent_days')::int,
    'absent_dates', m->>'absent_dates', 'absence_deduction', (m->>'absence_deduction')::numeric,
    'present_days', (m->>'present_days')::int, 'present_pay', (m->>'base')::numeric,
    'unverified_days', (m->>'unverified_days')::int, 'unverified_pay', 0,
    'extra_days', (m->>'extra_days')::int, 'extra_day_pay', 0,
    'needs_review_days', (m->>'needs_review_days')::int,
    'perfect_attendance', (m->>'perfect_attendance')::boolean,
    'perfect_attendance_bonus', (m->>'perfect_attendance_bonus')::numeric,
    'attendance_exempt', (m->>'attendance_exempt')::boolean,
    'base', (m->>'base')::numeric
  );
END $function$;

CREATE OR REPLACE FUNCTION public.payslip_gross_v3(p_employee_id uuid, p_period text)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM employees WHERE id = p_employee_id;
  IF emp IS NULL THEN RETURN 0; END IF;
  IF emp.enable_hybrid_variable_pay THEN RETURN public.payslip_gross_v2(p_employee_id, p_period); END IF;
  -- the expected pay: fixed salary in full, or the roster hours x the hourly rate
  RETURN (public.payroll_month(p_employee_id, p_period)->>'base')::numeric;
END $function$;

CREATE OR REPLACE FUNCTION public.generate_payslip(p_employee_id uuid, p_period text, p_generated_by text DEFAULT NULL::text)
 RETURNS payroll_runs
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_period text := public.payroll_period_normalize(p_period);
  emp employees; h record; result payroll_runs;
  gross numeric; affordable numeric;
  total_ded numeric := 0; total_bon numeric := 0;
  ded jsonb := '[]'::jsonb; bon jsonb := '[]'::jsonb;
  r record; adv record; a record; cash_row record;
  adv_deduction numeric; adv_remaining numeric;
  tab_balance numeric := 0; tab_take numeric := 0; cash_take numeric; sweep_err text;
  rb record; v_comm numeric := 0; rw record; v_bal json;
  v_cap numeric; v_cap_pct numeric; v_pen numeric := 0; v_deferred numeric := 0;
BEGIN
  SELECT * INTO emp FROM employees WHERE id = p_employee_id;
  IF emp IS NULL THEN RAISE EXCEPTION 'Employee not found.'; END IF;

  IF EXISTS (SELECT 1 FROM payroll_runs
              WHERE employee_id = p_employee_id
                AND public.payroll_period_normalize(period) = v_period) THEN
    RAISE EXCEPTION 'A payslip for % already exists for this employee.', v_period;
  END IF;

  gross := public.payslip_gross_v3(p_employee_id, v_period);
  v_bal := public.attendance_balance(p_employee_id, v_period);
  SELECT * INTO h FROM public.payslip_hours(p_employee_id, v_period);

  -- Commission and the report bonus are earned, not granted. They are part
  -- of the pay before anything is taken off it, so they also raise what the
  -- tab and cash sweeps can afford to clear.
  SELECT * INTO rb FROM public.employee_report_bonus(p_employee_id, v_period);
  SELECT coalesce(sum(commission),0) INTO v_comm
    FROM public.employee_scan_commission_days(p_employee_id, v_period);
  SELECT * INTO rw FROM public.employee_raw_data_bonus(p_employee_id, v_period);
  gross := gross + coalesce(rb.bonus,0) + coalesce(rw.bonus,0);

  -- 1. standing rule assignments
  FOR r IN
    SELECT era.id, dr.name, coalesce(era.amount, dr.value) AS amt,
           (era.amount IS NOT NULL) AS one_time
    FROM employee_rule_assignments era
    JOIN deduction_rules dr ON dr.id = era.deduction_rule_id
    WHERE era.employee_id = p_employee_id
      AND (era.amount IS NULL OR era.status = 'active')
  LOOP
    total_ded := total_ded + coalesce(r.amt,0);
    ded := ded || jsonb_build_object('name', r.name, 'amount', r.amt, 'source','rule');
    IF r.one_time THEN
      UPDATE employee_rule_assignments SET status='applied', applied_at=now() WHERE id=r.id;
    END IF;
  END LOOP;

  -- 2. Bonuses first, because they raise what the cap below allows.
  FOR a IN
    SELECT * FROM payroll_adjustments
    WHERE employee_id = p_employee_id
      AND public.payroll_period_normalize(period) = v_period
      AND kind = 'bonus' AND status = 'approved'
  LOOP
    total_bon := total_bon + a.amount;
    bon := bon || jsonb_build_object('name', a.label, 'amount', a.amount, 'source','adjustment');
  END LOOP;

  -- 3. Penalty deductions, under the cap.
  --
  -- No single payslip loses more than the configured share of what was
  -- earned. Anything over the line is not forgiven and not silently
  -- applied anyway: it moves to next month, interest free, and says so.
  -- Oldest first, so a backlog clears in the order it was incurred rather
  -- than the order it happens to be read in.
  SELECT penalty_cap_percent INTO v_cap_pct FROM payroll_settings WHERE id;
  v_cap := round((gross + total_bon) * coalesce(v_cap_pct,25) / 100.0, 2);
  v_pen := total_ded;   -- standing rule assignments already counted above

  FOR a IN
    SELECT * FROM payroll_adjustments
    WHERE employee_id = p_employee_id
      AND public.payroll_period_normalize(period) = v_period
      AND kind = 'deduction' AND status = 'approved'
    ORDER BY coalesce(occurred_on, created_at::date), created_at
  LOOP
    IF v_pen + a.amount <= v_cap THEN
      v_pen := v_pen + a.amount;
      total_ded := total_ded + a.amount;
      ded := ded || jsonb_build_object('name', a.label, 'amount', a.amount, 'source','adjustment');
    ELSE
      UPDATE payroll_adjustments
         SET period = to_char(to_date(v_period||'-01','YYYY-MM-DD') + interval '1 month','YYYY-MM'),
             note = coalesce(note,'') || ' [carried forward from ' || v_period ||
                    ': the ' || coalesce(v_cap_pct,25) || '% cap was reached]'
       WHERE id = a.id;
      UPDATE payroll_deductions
         SET status = 'carried_forward', carried_from_period = v_period,
             period = to_char(to_date(v_period||'-01','YYYY-MM-DD') + interval '1 month','YYYY-MM')
       WHERE adjustment_id = a.id;
      v_deferred := v_deferred + a.amount;
    END IF;
  END LOOP;

  IF v_deferred > 0 THEN
    ded := ded || jsonb_build_object('name',
             'Held back to next month (' || coalesce(v_cap_pct,25) || '% cap)',
             'amount', 0, 'source','cap', 'deferred', round(v_deferred,2));
  END IF;

  -- 4. advances
  FOR adv IN
    SELECT * FROM cash_expenses
    WHERE employee_id = p_employee_id AND category='employee_advance'
      AND advance_status='open' ORDER BY entry_date
  LOOP
    adv_remaining := adv.amount - coalesce(adv.advance_amount_deducted,0);
    CONTINUE WHEN adv_remaining <= 0;
    adv_deduction := CASE WHEN adv.advance_deduction_type='full' THEN adv_remaining
                          ELSE least(adv.advance_installment_amount, adv_remaining) END;
    total_ded := total_ded + adv_deduction;
    ded := ded || jsonb_build_object('name',
            'Advance Repayment'||coalesce(' ('||adv.note||')',''),
            'amount', adv_deduction, 'source','advance');
    UPDATE cash_expenses
       SET advance_amount_deducted = coalesce(advance_amount_deducted,0) + adv_deduction,
           advance_status = CASE WHEN (coalesce(advance_amount_deducted,0)+adv_deduction) >= amount
                                 THEN 'paid_off' ELSE 'open' END
     WHERE id = adv.id;
  END LOOP;

  -- 5. F&B staff tab (A39: only what the salary covers clears)
  SELECT coalesce(balance,0) INTO tab_balance
  FROM employee_tab_balances WHERE employee_id = p_employee_id;
  IF coalesce(tab_balance,0) > 0 THEN
    affordable := greatest(gross + total_bon - total_ded, 0);
    tab_take := least(tab_balance, affordable);
    IF tab_take > 0 THEN
      total_ded := total_ded + tab_take;
      ded := ded || jsonb_build_object('name','Staff Tab','amount',tab_take,'source','tab');
      INSERT INTO employee_tab_ledger (employee_id,direction,amount,reference_type,note,created_by_name)
      VALUES (p_employee_id,'payroll_deduction',tab_take,'payroll',
              'Settled in payroll '||v_period,'Payroll');
      INSERT INTO payroll_cash_settlements (employee_id,period,kind,amount,note)
      VALUES (p_employee_id,v_period,'tab',tab_take,
              CASE WHEN tab_take < tab_balance
                   THEN 'Partly settled; '||(tab_balance-tab_take)||' carried forward'
                   ELSE 'Settled in full' END);
    END IF;
  END IF;

  -- 6. unsettled cash, per stream, Cash Keeper exempt (A37)
  FOR cash_row IN
    SELECT b.brand, b.balance, (k.employee_id IS NOT NULL) AS exempt
    FROM employee_cash_balances b
    LEFT JOIN employee_cash_keeper_streams k
           ON k.employee_id=b.employee_id AND k.brand=b.brand
    WHERE b.employee_id = p_employee_id AND b.balance > 0
  LOOP
    IF cash_row.exempt THEN
      INSERT INTO payroll_cash_settlements (employee_id,period,brand,kind,amount,was_exempt,note)
      VALUES (p_employee_id,v_period,cash_row.brand,'cash',cash_row.balance,true,
              'Cash Keeper for this business - not deducted');
      CONTINUE;
    END IF;
    affordable := greatest(gross + total_bon - total_ded, 0);
    cash_take := least(cash_row.balance, affordable);
    CONTINUE WHEN cash_take <= 0;

    -- D5: the custody guard may refuse this sweep while transfers are
    -- still awaiting confirmation. That must block the sweep only, never
    -- the salary. The cash simply stays where it already is.
    sweep_err := public.payroll_sweep_cash(p_employee_id, v_period, cash_row.brand, cash_take);
    IF sweep_err IS NOT NULL THEN
      INSERT INTO payroll_cash_settlements (employee_id,period,brand,kind,amount,was_exempt,note)
      VALUES (p_employee_id,v_period,cash_row.brand,'cash',0,true,
              'Sweep deferred, cash still held by the employee: '||left(sweep_err,200));
      CONTINUE;
    END IF;

    total_ded := total_ded + cash_take;
    ded := ded || jsonb_build_object('name','Unsettled Cash ('||cash_row.brand||')',
                                     'amount',cash_take,'source','cash');
    INSERT INTO payroll_cash_settlements (employee_id,period,brand,kind,amount,note)
    VALUES (p_employee_id,v_period,cash_row.brand,'cash',cash_take,
            CASE WHEN cash_take < cash_row.balance
                 THEN 'Partly settled; '||(cash_row.balance-cash_take)||' still held'
                 ELSE 'Settled in full' END);
  END LOOP;

  INSERT INTO payroll_runs (employee_id, period, fixed_salary, variable_salary,
      deductions, net_total, gross_pay, bonuses, total_bonuses, total_deductions,
      pay_basis, paid_hours, overtime_pending_hours, generated_by_name,
      report_bonus, report_bonus_count, scan_commission,
      raw_data_bonus, raw_data_bonus_count, attendance_balance)
  VALUES (p_employee_id, v_period, emp.fixed_salary, emp.variable_salary,
      ded, round(gross + total_bon - total_ded, 2), gross, bon,
      round(total_bon,2), round(total_ded,2),
      CASE WHEN emp.enable_hybrid_variable_pay THEN 'hybrid'
           WHEN coalesce(emp.hourly_rate,0) > 0 THEN 'hourly' ELSE 'monthly' END,
      round(h.scheduled_paid + h.unscheduled_paid, 2),
      round(coalesce((v_bal->>'overtime_minutes')::numeric,0)/60.0, 2), p_generated_by,
      coalesce(rb.bonus,0), coalesce(rb.qualifying,0), round(v_comm,2),
      coalesce(rw.bonus,0), coalesce(rw.qualifying,0), v_bal)
  RETURNING * INTO result;

  RETURN result;
END; $function$;

CREATE OR REPLACE FUNCTION public.deduction_decide(p_id uuid, p_status text, p_note text, p_by_id uuid, p_by_name text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE d payroll_deductions; v_adj uuid; v_ack boolean;
BEGIN
  IF p_status NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'A deduction is either approved or rejected.';
  END IF;
  IF coalesce(p_by_name,'') = '' THEN
    RAISE EXCEPTION 'A deduction must carry the name of the person approving it.';
  END IF;

  SELECT * INTO d FROM payroll_deductions WHERE id = p_id;
  IF d IS NULL THEN RAISE EXCEPTION 'That deduction no longer exists.'; END IF;
  IF d.status <> 'pending' THEN
    RAISE EXCEPTION 'That deduction was already %.', d.status;
  END IF;
  IF EXISTS (SELECT 1 FROM payroll_runs WHERE employee_id = d.employee_id
             AND public.payroll_period_normalize(period) = d.period) THEN
    RAISE EXCEPTION 'The payslip for % is already issued.', d.period;
  END IF;

  SELECT acknowledgement_on_file INTO v_ack FROM employees WHERE id = d.employee_id;

  IF p_status = 'approved' THEN
    INSERT INTO payroll_adjustments (employee_id, period, kind, label, amount, note,
                                     created_by_id, created_by_name, status, source,
                                     decided_by_id, decided_by_name, decided_at)
    VALUES (d.employee_id, d.period, 'deduction',
            CASE d.kind WHEN 'visa' THEN 'Unconfirmed card payment'
                        WHEN 'stock' THEN 'Stock shortfall'
                        WHEN 'absence' THEN 'Absence'
                        WHEN 'late' THEN 'Time balance deduction'
                        WHEN 'early_leave' THEN 'Early leave'
                        ELSE 'Short-notice leave' END,
            d.amount, coalesce(p_note, d.reason), p_by_id, p_by_name, 'approved', 'deduction:'||d.kind,
            p_by_id, p_by_name, now())
    RETURNING id INTO v_adj;
  END IF;

  UPDATE payroll_deductions
     SET status = p_status, adjustment_id = v_adj, decision_note = p_note,
         approved_by_id = p_by_id, approved_by_name = p_by_name, approved_at = now(),
         acknowledgement_on_file = v_ack
   WHERE id = p_id;

  RETURN json_build_object('id', p_id, 'status', p_status, 'amount', d.amount,
                           'adjustment_id', v_adj, 'acknowledgement_on_file', v_ack);
END; $function$;

CREATE OR REPLACE FUNCTION public.employee_bonus_lines(p_employee_id uuid, p_period text)
 RETURNS TABLE(kind text, visit_id uuid, report_id uuid, done_at timestamp with time zone, work_date date, visit_time timestamp without time zone, scan_type text, from_bundle text, source text, eligible boolean, standalone boolean, on_shift boolean, seq integer, status text, rate numeric, amount numeric)
 LANGUAGE plpgsql
 STABLE
AS $function$
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
              WHEN s.shift_day AND s.sq <= v_thr THEN 'baseline'
              ELSE 'extra' END,
         s.rt,
         CASE WHEN s.stand OR (s.elig AND (s.k='raw_data' OR NOT s.shift_day OR s.sq > v_thr)) THEN s.rt ELSE 0 END
  FROM sequenced s
  ORDER BY s.k, s.wd, s.vtime, s.at;
END $function$;

CREATE OR REPLACE FUNCTION public.detect_visa_deductions()
 RETURNS TABLE(created integer, skipped_no_author integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE s payroll_settings; v_created int := 0; v_skipped int := 0; r record; v_employee uuid; v_txn record; v_n int;
BEGIN
  SELECT * INTO s FROM payroll_settings WHERE id;
  IF s.deduction_go_live IS NULL THEN
    RETURN QUERY SELECT 0,0; RETURN;
  END IF;

  FOR r IN
    SELECT p.id, p.amount, p.created_by_id, p.created_by_name, p.paid_at, p.visit_id
    FROM visit_payments p
    WHERE p.payment_method = 'Visa'
      AND p.paymob_transaction_id IS NULL
      AND coalesce(p.payment_verification,'') NOT LIKE 'verified%'
      AND p.paid_at::date >= s.deduction_go_live
      AND p.paid_at < now() - make_interval(hours => s.visa_grace_hours)
      AND NOT EXISTS (SELECT 1 FROM payroll_deductions d
                      WHERE d.kind='visa' AND d.source_id = p.id)
  LOOP
    -- created_by_id on a payment is a staff login, never an employee record -
    -- two different id spaces - so this went straight into a foreign key on
    -- employees and failed outright. The whole rule would have errored on the
    -- first day it was switched on rather than charging anybody. Resolved
    -- through the staff account email, which is the link the rest of payroll
    -- already uses.
    -- A payment recorded days after the visit (Nourhan, 19 Oct 2026) has its card
    -- transaction on the VISIT day, not the recording day. One unmatched
    -- successful transaction of the same amount that day links it instead of
    -- charging the employee.
    SELECT count(*) INTO v_n FROM paymob_transactions t JOIN visits vv ON vv.id = r.visit_id
     WHERE t.success AND NOT coalesce(t.is_voided,false) AND t.matched_payment_id IS NULL
       AND t.amount = r.amount AND t.created_at_paymob::date = vv.exam_date;
    IF v_n = 1 THEN
      SELECT t.* INTO v_txn FROM paymob_transactions t JOIN visits vv ON vv.id = r.visit_id
       WHERE t.success AND NOT coalesce(t.is_voided,false) AND t.matched_payment_id IS NULL
         AND t.amount = r.amount AND t.created_at_paymob::date = vv.exam_date;
      UPDATE visit_payments SET payment_verification = 'verified_paymob_late', paymob_transaction_id = v_txn.id,
             paymob_terminal_id = v_txn.terminal_id, paymob_card_brand = v_txn.card_brand, paymob_card_last4 = v_txn.card_last4,
             paymob_fees = v_txn.fees, paymob_matched_at = now(),
             paymob_match_gap_minutes = round(abs(EXTRACT(EPOCH FROM ((r.paid_at AT TIME ZONE 'Africa/Cairo') - v_txn.created_at_paymob::timestamp)))/60)
       WHERE id = r.id;
      UPDATE paymob_transactions SET matched_payment_id = r.id, matched_at = now(), review_status = 'matched' WHERE id = v_txn.id;
      CONTINUE;
    END IF;

    v_employee := NULL;
    IF r.created_by_id IS NOT NULL THEN
      SELECT e.id INTO v_employee
      FROM staff_profiles sp
      JOIN employees e ON e.staff_account_email = sp.email
      WHERE sp.id = r.created_by_id;
    END IF;

    -- Counted as skipped, not charged to somebody else. Three logins have no
    -- employee record behind them, and a payment taken on one of those cannot
    -- be attributed to a person without guessing.
    IF v_employee IS NULL THEN v_skipped := v_skipped + 1; CONTINUE; END IF;
    INSERT INTO payroll_deductions (employee_id, period, kind, amount, reason,
        source_table, source_id, dispute_deadline)
    VALUES (v_employee, to_char(r.paid_at,'YYYY-MM'), 'visa', r.amount,
            'Card payment of ' || r.amount || ' EGP recorded on ' ||
            to_char(r.paid_at,'DD Mon YYYY') || ' was not confirmed by the payment gateway.',
            'visit_payments', r.id, now() + make_interval(hours => s.dispute_window_hours));
    v_created := v_created + 1;
  END LOOP;
  RETURN QUERY SELECT v_created, v_skipped;
END; $function$;

-- ---------------------------------------------------------------- detector: proposes the month's minus items and the perfect-attendance bonus
-- Runs for the current month too, so everything can be approved on payday;
-- pending items refresh as the month moves, decided ones are never touched.
CREATE OR REPLACE FUNCTION public.detect_attendance_deductions(p_period text DEFAULT NULL::text)
 RETURNS TABLE(created integer, refreshed integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE s payroll_settings; v_created int := 0; v_ref int := 0; e record; m json; per text;
        k text; amt numeric; why text; existing payroll_deductions; pa payroll_adjustments;
        v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
BEGIN
  SELECT * INTO s FROM payroll_settings WHERE id;
  IF s.deduction_go_live IS NULL THEN RETURN QUERY SELECT 0,0; RETURN; END IF;
  FOR per IN
    SELECT to_char(mm,'YYYY-MM') FROM generate_series(greatest(date_trunc('month', s.deduction_go_live), date '2026-10-01'),
           date_trunc('month', v_today), interval '1 month') mm
    WHERE p_period IS NULL OR to_char(mm,'YYYY-MM') = public.payroll_period_normalize(p_period)
  LOOP
    FOR e IN SELECT id, attendance_exempt FROM employees WHERE is_active AND NOT coalesce(enable_hybrid_variable_pay,false) LOOP
      CONTINUE WHEN EXISTS (SELECT 1 FROM payroll_runs r WHERE r.employee_id = e.id
                            AND public.payroll_period_normalize(r.period) = per);
      m := public.payroll_month(e.id, per);
      FOREACH k IN ARRAY ARRAY['absence','late','early_leave'] LOOP
        amt := CASE WHEN coalesce(e.attendance_exempt,false) THEN 0
                    WHEN k = 'absence' THEN (m->>'absence_deduction')::numeric
                    WHEN k = 'late' THEN (m->>'time_deduction')::numeric
                    ELSE 0 END;   -- early leave is netted inside the time balance
        why := CASE k
          WHEN 'absence' THEN (m->>'absent_days')||' absence(s) ('||coalesce(m->>'absent_dates','')||'): 2 days of pay each, 1 day when permitted.'
          WHEN 'late' THEN 'Time balance '||(m->>'net_minutes')||' min this month (late '||(m->>'late_minutes')||', early leave '||(m->>'early_leave_minutes')
                           ||', early + stayed '||(m->>'credit_minutes')||', days off the roster '||(m->>'extra_minutes')||'), at '||s.late_multiplier||'x.'
          ELSE 'Early leave is now part of the time balance.' END;
        SELECT * INTO existing FROM payroll_deductions d
         WHERE d.employee_id = e.id AND d.period = per AND d.kind = k AND d.source_table = 'attendance_balance'
         ORDER BY d.detected_at DESC LIMIT 1;
        IF existing.id IS NULL THEN
          CONTINUE WHEN coalesce(amt,0) <= 0;
          INSERT INTO payroll_deductions (employee_id, period, kind, amount, reason, source_table, dispute_deadline)
          VALUES (e.id, per, k, round(amt,2), why, 'attendance_balance', now() + make_interval(hours => s.dispute_window_hours));
          v_created := v_created + 1;
        ELSIF existing.status = 'pending' THEN
          IF coalesce(amt,0) <= 0 THEN
            UPDATE payroll_deductions SET status = 'rejected', decision_note = 'No longer owed after attendance was recalculated', approved_by_name = 'System', approved_at = now() WHERE id = existing.id;
          ELSIF round(amt,2) <> existing.amount OR why <> existing.reason THEN
            UPDATE payroll_deductions SET amount = round(amt,2), reason = why, detected_at = now() WHERE id = existing.id;
          END IF;
          v_ref := v_ref + 1;
        END IF;
      END LOOP;

      -- perfect attendance: proposed, never paid without approval
      SELECT * INTO pa FROM payroll_adjustments a
       WHERE a.employee_id = e.id AND public.payroll_period_normalize(a.period) = per AND a.source = 'perfect_attendance'
       ORDER BY a.created_at DESC LIMIT 1;
      amt := CASE WHEN (m->>'perfect_attendance')::boolean THEN (m->>'perfect_attendance_bonus')::numeric ELSE 0 END;
      IF pa.id IS NULL THEN
        IF amt > 0 THEN
          INSERT INTO payroll_adjustments (employee_id, period, kind, label, amount, note, status, source, created_by_name)
          VALUES (e.id, per, 'bonus', 'Perfect attendance ('||(m->>'perfect_attendance_pct')||'%)', amt,
                  'No minute late or early and no absence'||CASE WHEN (m->>'month_complete')::boolean THEN '' ELSE ' so far this month' END,
                  'pending', 'perfect_attendance', 'System');
          v_created := v_created + 1;
        END IF;
      ELSIF pa.status = 'pending' THEN
        IF amt <= 0 THEN
          DELETE FROM payroll_adjustments WHERE id = pa.id;
        ELSIF amt <> pa.amount THEN
          UPDATE payroll_adjustments SET amount = amt,
                 note = 'No minute late or early and no absence'||CASE WHEN (m->>'month_complete')::boolean THEN '' ELSE ' so far this month' END
           WHERE id = pa.id;
        END IF;
        v_ref := v_ref + 1;
      END IF;
    END LOOP;
  END LOOP;
  RETURN QUERY SELECT v_created, v_ref;
END $function$;

-- ---------------------------------------------------------------- overtime: measured on the time balance, approved row counts
CREATE OR REPLACE FUNCTION public.overtime_decide(p_employee_id uuid, p_period text, p_status text, p_hours numeric, p_amount numeric, p_note text, p_by_id uuid, p_by_name text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_period text := public.payroll_period_normalize(p_period);
  emp employees; v_adj uuid; v_id uuid; v_ot_hours numeric;
BEGIN
  IF p_status NOT IN ('approved','waived') THEN
    RAISE EXCEPTION 'A decision is either approved or waived.';
  END IF;
  IF coalesce(p_by_name,'') = '' THEN
    RAISE EXCEPTION 'An overtime decision must carry the name of the person who made it.';
  END IF;
  SELECT * INTO emp FROM employees WHERE id = p_employee_id;
  IF emp IS NULL THEN RAISE EXCEPTION 'Employee not found.'; END IF;
  IF EXISTS (SELECT 1 FROM payroll_runs WHERE employee_id = p_employee_id
               AND public.payroll_period_normalize(period) = v_period) THEN
    RAISE EXCEPTION 'The payslip for % is already issued. Overtime for a closed period is a manual adjustment.', v_period;
  END IF;
  IF EXISTS (SELECT 1 FROM overtime_decisions WHERE employee_id = p_employee_id AND period = v_period) THEN
    RAISE EXCEPTION 'Overtime for % has already been decided for this employee.', v_period;
  END IF;

  v_ot_hours := round(coalesce((public.attendance_balance(p_employee_id, v_period)->>'overtime_minutes')::numeric,0)/60.0, 2);

  IF p_status = 'approved' THEN
    IF coalesce(p_amount,0) <= 0 THEN
      RAISE EXCEPTION 'Approving overtime needs an amount. Enter what it is worth, or waive it instead.';
    END IF;
    IF coalesce(p_hours,0) > v_ot_hours + 0.01 THEN
      RAISE EXCEPTION 'Only % overtime hours are in the time balance for this period.', v_ot_hours;
    END IF;
    INSERT INTO payroll_adjustments (employee_id, period, kind, label, amount, note,
                                     created_by_id, created_by_name, status, source, decided_by_id, decided_by_name, decided_at)
    VALUES (p_employee_id, v_period, 'bonus',
            'Overtime ' || to_char(coalesce(p_hours,0),'FM9990.00') || ' h', round(p_amount,2),
            coalesce(p_note, 'Approved by ' || p_by_name), p_by_id, p_by_name, 'approved', 'overtime', p_by_id, p_by_name, now())
    RETURNING id INTO v_adj;
  END IF;

  INSERT INTO overtime_decisions (employee_id, period, hours_observed, hours_approved,
                                  amount, status, adjustment_id, note, decided_by_id, decided_by_name)
  VALUES (p_employee_id, v_period, v_ot_hours,
          CASE WHEN p_status='approved' THEN coalesce(p_hours,0) ELSE 0 END,
          CASE WHEN p_status='approved' THEN round(p_amount,2) ELSE 0 END,
          p_status, v_adj, p_note, p_by_id, p_by_name)
  RETURNING id INTO v_id;

  RETURN json_build_object('id', v_id, 'status', p_status, 'period', v_period,
                           'hours_observed', v_ot_hours,
                           'hours_approved', CASE WHEN p_status='approved' THEN coalesce(p_hours,0) ELSE 0 END,
                           'amount', CASE WHEN p_status='approved' THEN round(p_amount,2) ELSE 0 END,
                           'adjustment_id', v_adj);
END; $function$;

-- ---------------------------------------------------------------- payslip preview: approved items count, pending ones are shown
CREATE OR REPLACE FUNCTION public.payslip_preview(p_employee_id uuid, p_period text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_period text := public.payroll_period_normalize(p_period);
  emp employees; h record; d record; rb record;
  v_gross numeric; v_adj json; v_ded numeric:=0; v_bon numeric:=0; v_pded numeric:=0; v_pbon numeric:=0;
  v_rules json; v_rules_total numeric:=0; v_adv numeric:=0; v_tab numeric:=0;
  v_comm numeric:=0; v_comm_days int:=0; rw record; v_bal json; v_month json; v_days json; v_pending_ded json;
BEGIN
  SELECT * INTO emp FROM employees WHERE id=p_employee_id;
  IF emp IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO h FROM public.payslip_hours(p_employee_id, v_period);
  v_gross := public.payslip_gross_v3(p_employee_id, v_period);
  SELECT * INTO rw FROM public.employee_raw_data_bonus(p_employee_id, v_period);
  v_bal := public.attendance_balance(p_employee_id, v_period);
  v_month := CASE WHEN emp.enable_hybrid_variable_pay THEN NULL ELSE public.payroll_month(p_employee_id, v_period) END;
  SELECT * INTO rb FROM public.employee_report_bonus(p_employee_id, v_period);
  SELECT coalesce(sum(commission),0), count(*)::int INTO v_comm, v_comm_days
    FROM public.employee_scan_commission_days(p_employee_id, v_period);
  SELECT * INTO d FROM overtime_decisions WHERE employee_id=p_employee_id AND period=v_period;

  SELECT coalesce(json_agg(json_build_object('id',a.id,'kind',a.kind,'label',a.label,
           'amount',a.amount,'note',a.note,'occurred_on',a.occurred_on,'status',a.status,'source',a.source,
           'created_by_name',a.created_by_name,'decided_by_name',a.decided_by_name) ORDER BY a.created_at),'[]'::json),
         coalesce(sum(a.amount) FILTER (WHERE a.kind='deduction' AND a.status='approved'),0),
         coalesce(sum(a.amount) FILTER (WHERE a.kind='bonus' AND a.status='approved'),0),
         coalesce(sum(a.amount) FILTER (WHERE a.kind='deduction' AND a.status='pending'),0),
         coalesce(sum(a.amount) FILTER (WHERE a.kind='bonus' AND a.status='pending'),0)
    INTO v_adj, v_ded, v_bon, v_pded, v_pbon
  FROM payroll_adjustments a WHERE a.employee_id=p_employee_id
    AND public.payroll_period_normalize(a.period)=v_period AND a.status <> 'rejected';

  SELECT coalesce(json_agg(json_build_object('id',x.id,'kind',x.kind,'amount',x.amount,'reason',x.reason) ORDER BY x.detected_at),'[]'::json)
    INTO v_pending_ded
  FROM payroll_deductions x WHERE x.employee_id=p_employee_id AND x.period=v_period AND x.status='pending';

  SELECT coalesce(json_agg(json_build_object('date',z.work_date,'status',z.status,'minutes',z.shift_minutes,
           'signed_in',to_char(z.signed_in,'HH24:MI'),'signed_out',to_char(z.signed_out,'HH24:MI'),
           'late',z.late_raw,'left_early',z.left_early,'early',z.early_raw,'after',z.after_raw) ORDER BY z.work_date),'[]'::json)
    INTO v_days
  FROM public.attendance_days(p_employee_id, to_date(v_period||'-01','YYYY-MM-DD'),
                              (to_date(v_period||'-01','YYYY-MM-DD') + interval '1 month - 1 day')::date) z;

  SELECT coalesce(json_agg(json_build_object('name',dr.name,'amount',coalesce(era.amount,dr.value))),'[]'::json),
         coalesce(sum(coalesce(era.amount,dr.value)),0)
    INTO v_rules, v_rules_total
  FROM employee_rule_assignments era JOIN deduction_rules dr ON dr.id=era.deduction_rule_id
  WHERE era.employee_id=p_employee_id AND (era.amount IS NULL OR era.status='active');

  SELECT coalesce(sum(amount-coalesce(advance_amount_deducted,0)),0) INTO v_adv
  FROM cash_expenses WHERE employee_id=p_employee_id
    AND category='employee_advance' AND advance_status='open';

  SELECT coalesce(balance,0) INTO v_tab FROM employee_tab_balances WHERE employee_id=p_employee_id;

  RETURN json_build_object(
    'employee', json_build_object('id',emp.id,'name',emp.name,'hr_id',emp.hr_id,
        'fixed_salary',emp.fixed_salary,'variable_salary',emp.variable_salary,
        'hourly_rate',emp.hourly_rate,'hybrid',emp.enable_hybrid_variable_pay,
        'attendance_exempt',emp.attendance_exempt,
        'shift_baseline_value',emp.shift_baseline_value,
        'scan_commission_percentage',emp.scan_commission_percentage,
        'minimum_shift_earning',emp.minimum_shift_earning,
        'report_bonus_rate',emp.report_bonus_rate,
        'report_daily_threshold',emp.report_daily_threshold),
    'period', v_period,
    'pay_basis', CASE WHEN emp.enable_hybrid_variable_pay THEN 'hybrid'
                      WHEN coalesce(emp.hourly_rate,0)>0 THEN 'hourly' ELSE 'monthly' END,
    'paid_days', h.paid_days, 'unscheduled_days', h.unscheduled_days,
    'needs_review', h.needs_review, 'absent_days', h.absent_days,
    'scheduled_hours_paid', round(h.scheduled_paid,2),
    'unscheduled_hours_paid', round(h.unscheduled_paid,2),
    'paid_hours', round(h.scheduled_paid+h.unscheduled_paid,2),
    'overtime_hours', round(coalesce((v_bal->>'overtime_minutes')::numeric,0)/60.0,2),
    'overtime_indicative_value', coalesce((v_bal->>'overtime_value')::numeric,0),
    'attendance_balance', v_bal,
    'month', v_month,
    'days', v_days,
    'pending_deductions', v_pending_ded,
    'raw_data_bonus', rw.bonus, 'raw_data_uploads', rw.uploads, 'raw_data_qualifying', rw.qualifying,
    'overtime_decision', CASE WHEN d IS NULL THEN NULL ELSE json_build_object(
        'status',d.status,'hours_approved',d.hours_approved,'amount',d.amount,
        'note',d.note,'decided_by',d.decided_by_name,'decided_at',d.decided_at) END,
    'overtime_awaiting_decision', (d IS NULL AND coalesce((v_bal->>'overtime_minutes')::numeric,0) > 0),
    'gross', v_gross,
    'scan_commission', round(v_comm,2), 'commission_days', v_comm_days,
    'report_bonus', rb.bonus, 'reports_total', rb.reports_total,
    'reports_beyond_threshold', rb.beyond_threshold, 'reports_off_shift', rb.off_shift,
    'reports_qualifying', rb.qualifying, 'report_rate', rb.rate,
    'adjustments', v_adj, 'total_bonuses', round(v_bon,2),
    'total_adjustment_deductions', round(v_ded,2),
    'pending_bonuses', round(v_pbon,2), 'pending_adjustment_deductions', round(v_pded,2),
    'rule_assignments', v_rules, 'total_rule_deductions', round(v_rules_total,2),
    'open_advances', round(v_adv,2), 'tab_balance', round(greatest(v_tab,0),2),
    'settlement', public.payroll_settlement_preview(p_employee_id),
    'already_generated', EXISTS (SELECT 1 FROM payroll_runs
        WHERE employee_id=p_employee_id AND public.payroll_period_normalize(period)=v_period),
    'indicative_net', round(v_gross + rb.bonus + coalesce(rw.bonus,0) + v_bon - v_ded - v_rules_total - v_adv,2)
  );
END; $function$;

-- ---------------------------------------------------------------- permissions
REVOKE ALL ON FUNCTION public.payroll_month(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_month(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.attendance_balance_legacy(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_balance_legacy(uuid, text) TO service_role;
-- deciding a payslip item is an admin action behind the API, never a public call
REVOKE ALL ON FUNCTION public.adjustment_decide(uuid, text, uuid, text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjustment_decide(uuid, text, uuid, text, numeric, text) TO service_role;
REVOKE ALL ON FUNCTION public.overtime_decide(uuid, text, uuid, text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.overtime_decide(uuid, text, uuid, text, numeric, text) TO service_role;
