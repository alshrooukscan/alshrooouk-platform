-- 0132: the employee portal's "Earned so far" grows day by day (Mohamed Said,
-- 2 Nov 2026). payroll_month's base is the whole month's roster (that is
-- what the payslip pays), so on 1 November an hourly employee saw the full
-- month (8 shifts x 10 h x 72 = 5,760) after one shift. payroll_month now
-- also returns earned_to_date: the same base counted only over the rostered
-- days already reached. The payslip itself is unchanged.
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
  v_elapsed_min numeric := 0; v_elapsed_pay numeric := 0; v_earned numeric := 0;
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
      -- days already reached, for the running "earned so far" (0132)
      IF r.status <> 'future' THEN
        v_elapsed_min := v_elapsed_min + coalesce(r.shift_minutes,0);
        v_elapsed_pay := v_elapsed_pay + coalesce(r.day_value,0);
      END IF;
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

  -- Earned so far (Mohamed Said, 2 Nov 2026): the base counted day by day as
  -- the month goes, not the whole month's roster from day one. Same rule as
  -- the base, only up to today: hourly = the shifts already reached; fixed =
  -- the salary in proportion to the rostered minutes already reached (or the
  -- calendar days passed, with no roster).
  IF v_hourly THEN
    v_earned := CASE WHEN v_no_roster THEN v_extra_pay ELSE v_elapsed_pay END;
  ELSE
    -- no roster (e.g. attendance exempt): by calendar days of the month passed
    v_earned := CASE WHEN v_sched_min > 0 THEN v_base * v_elapsed_min / v_sched_min
                     ELSE v_base * least(greatest((now() AT TIME ZONE 'Africa/Cairo')::date - v_from + 1, 0), v_to - v_from + 1)::numeric
                          / (v_to - v_from + 1) END;
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
    'earned_to_date', round(v_earned,2), 'elapsed_minutes', v_elapsed_min,
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
