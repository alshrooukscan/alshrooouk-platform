-- =====================================================================
-- 0093 · Scan commission and report bonus  (client answers Q3, Q4)
--
--   "The commission of the scan is assigned to the staff performing the
--    scan recorded in the scan step, reports are having a separate bonus
--    plan ... an option of adding a specific rate/report done after 5th
--    report required during the day if complete or any report that was
--    done off shift either online or on need basis."
--
-- Two mechanics, not one. Commission follows the scan. The report bonus is
-- a flat rate per report with two triggers, and it is what replaces the
-- remote and on-call pay models the original specification asked for.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Commission, per day, on scans this person performed.
--
-- Base is the amount after the patient discount, not the list price: the
-- clinic cannot pay a share of money it never charged. It accrues when the
-- visit is paid, not when it is scanned, so commission never runs ahead of
-- the cash that funds it.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.employee_scan_commission_days(p_employee_id uuid, p_period text)
RETURNS TABLE(d date, scans int, net_base numeric, commission numeric)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_period text := public.payroll_period_normalize(p_period);
  v_from date := to_date(v_period||'-01','YYYY-MM-DD');
  v_to date; v_pct numeric;
BEGIN
  v_to := (v_from + interval '1 month - 1 day')::date;
  SELECT coalesce(scan_commission_percentage,0) INTO v_pct
    FROM employees WHERE id = p_employee_id AND enable_hybrid_variable_pay;
  IF v_pct IS NULL OR v_pct = 0 THEN RETURN; END IF;

  RETURN QUERY
  SELECT coalesce(v.paid_at, v.scanned_at)::date,
         count(*)::int,
         round(sum(v.amount_due * (1 - coalesce(v.discount_pct,0)/100.0)), 2),
         round(sum(v.amount_due * (1 - coalesce(v.discount_pct,0)/100.0)) * v_pct / 100.0, 2)
  FROM visits v
  WHERE v.scanned_by_employee_id = p_employee_id
    AND v.payment_status = 'paid'
    AND coalesce(v.paid_at, v.scanned_at)::date BETWEEN v_from AND v_to
  GROUP BY 1;
END; $$;

-- ---------------------------------------------------------------------
-- Report bonus. A report earns the rate when it is beyond the daily count
-- the clinic expects, or when it was finished outside the scheduled shift,
-- whichever applies first. A report is never counted twice.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.employee_report_bonus(p_employee_id uuid, p_period text)
RETURNS TABLE(reports_total int, beyond_threshold int, off_shift int,
              qualifying int, rate numeric, bonus numeric)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_period text := public.payroll_period_normalize(p_period);
  v_from date := to_date(v_period||'-01','YYYY-MM-DD');
  v_to date; v_rate numeric; v_thr int;
BEGIN
  v_to := (v_from + interval '1 month - 1 day')::date;
  SELECT coalesce(report_bonus_rate,0), coalesce(report_daily_threshold,5)
    INTO v_rate, v_thr FROM employees WHERE id = p_employee_id;
  IF coalesce(v_rate,0) = 0 THEN
    RETURN QUERY SELECT 0,0,0,0,0::numeric,0::numeric; RETURN;
  END IF;

  RETURN QUERY
  WITH done AS (
    SELECT v.id, v.report_done_at,
           v.report_done_at::date AS d,
           row_number() OVER (PARTITION BY v.report_done_at::date ORDER BY v.report_done_at) AS rn
    FROM visits v
    WHERE v.report_done_by_employee_id = p_employee_id
      AND v.report_done_at::date BETWEEN v_from AND v_to
  ), judged AS (
    SELECT dn.id, dn.rn > v_thr AS beyond,
           NOT EXISTS (
             SELECT 1 FROM employee_schedule_days s
             WHERE s.employee_id = p_employee_id
               AND s.work_date = dn.d
               AND s.is_day_off = false
               AND dn.report_done_at::time >= s.start_time
               AND (dn.report_done_at::time <= s.end_time
                    OR s.end_time <= s.start_time)   -- shift crossing midnight
           ) AS offshift
    FROM done dn
  )
  SELECT (SELECT count(*)::int FROM done),
         count(*) FILTER (WHERE beyond)::int,
         count(*) FILTER (WHERE offshift)::int,
         count(*) FILTER (WHERE beyond OR offshift)::int,
         v_rate,
         round(count(*) FILTER (WHERE beyond OR offshift) * v_rate, 2)
  FROM judged;
END; $$;

-- ---------------------------------------------------------------------
-- Gross, now covering the hybrid model.
--
-- On hybrid, a confirmed shift pays the baseline plus whatever commission
-- that day's paid scans earned. The optional floor is applied per shift,
-- not per month, because that is where a quiet day actually hurts: a floor
-- averaged over a month would let one busy day hide four empty ones.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payslip_gross_v2(p_employee_id uuid, p_period text)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_period text := public.payroll_period_normalize(p_period);
  v_from date; v_to date; emp employees; h record;
  v_total numeric := 0; v_floor numeric; v_orphan numeric := 0;
BEGIN
  SELECT * INTO emp FROM employees WHERE id = p_employee_id;
  IF emp IS NULL THEN RETURN 0; END IF;

  IF emp.enable_hybrid_variable_pay THEN
    v_from := to_date(v_period||'-01','YYYY-MM-DD');
    v_to := (v_from + interval '1 month - 1 day')::date;
    v_floor := emp.minimum_shift_earning;

    SELECT coalesce(sum(greatest(
             coalesce(emp.shift_baseline_value,0) + coalesce(c.commission,0),
             coalesce(v_floor, 0))), 0)
      INTO v_total
    FROM employee_schedule_days s
    LEFT JOIN public.employee_scan_commission_days(p_employee_id, v_period) c ON c.d = s.work_date
    WHERE s.employee_id = p_employee_id AND s.is_day_off = false
      AND s.work_date BETWEEN v_from AND v_to
      AND EXISTS (SELECT 1 FROM timeclock_events t WHERE t.employee_id=p_employee_id
                    AND t.event_type='login' AND t.event_time::date = s.work_date)
      AND EXISTS (SELECT 1 FROM timeclock_events t WHERE t.employee_id=p_employee_id
                    AND t.event_type='logout' AND t.event_time::date = s.work_date);

    -- Commission earned on a day with no confirmed shift is still earned.
    -- It is paid without the floor, because there was no shift to protect.
    SELECT coalesce(sum(c.commission),0) INTO v_orphan
    FROM public.employee_scan_commission_days(p_employee_id, v_period) c
    WHERE NOT EXISTS (
      SELECT 1 FROM employee_schedule_days s
      WHERE s.employee_id=p_employee_id AND s.work_date=c.d AND s.is_day_off=false
        AND EXISTS (SELECT 1 FROM timeclock_events t WHERE t.employee_id=p_employee_id
                      AND t.event_type='login' AND t.event_time::date=s.work_date)
        AND EXISTS (SELECT 1 FROM timeclock_events t WHERE t.employee_id=p_employee_id
                      AND t.event_type='logout' AND t.event_time::date=s.work_date));

    RETURN round(v_total + v_orphan, 2);
  END IF;

  IF coalesce(emp.hourly_rate,0) > 0 THEN
    SELECT * INTO h FROM public.payslip_hours(p_employee_id, v_period);
    RETURN round((h.scheduled_paid + h.unscheduled_paid) * emp.hourly_rate, 2);
  END IF;

  RETURN round(coalesce(emp.fixed_salary,0)+coalesce(emp.variable_salary,0),2);
END; $$;

REVOKE EXECUTE ON FUNCTION public.employee_scan_commission_days(uuid,text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.employee_report_bonus(uuid,text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_scan_commission_days(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.employee_report_bonus(uuid,text) TO service_role;
