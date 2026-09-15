-- 0091: a shift that has not happened yet is not an absence.
--
-- payslip_hours counted absences across the whole month regardless of today,
-- so every scheduled day still to come was reported as a day missed. On 15
-- September Nourhan had 26 scheduled days with 13 in the future, and her page
-- showed exactly 13 absences against 13 days attended - three numbers that
-- could not all be true. Every employee was overstated the same way, and any
-- absence-based deduction built on this would have taken real money for days
-- nobody had missed.
--
-- Absence and needs-review now stop at today. Paid and unscheduled days are
-- driven by actual clock events, so they never looked forward and are
-- unchanged. For a month already finished least() leaves the month end alone,
-- so a final payslip for a past period computes exactly as before.
--
-- Shift swaps need no handling here: approving a swap reassigns employee_id on
-- the schedule row itself, so employee_schedule_days is the single source of
-- truth and payroll already reads the post-swap roster. Verified rather than
-- assumed, though there are no swaps in the system yet to confirm it live.

CREATE OR REPLACE FUNCTION public.payslip_hours(p_employee_id uuid, p_period text)
 RETURNS TABLE(scheduled_paid numeric, unscheduled_paid numeric, overtime_pending numeric, paid_days integer, unscheduled_days integer, needs_review integer, absent_days integer)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_period text := public.payroll_period_normalize(p_period);
  v_from date := to_date(v_period||'-01','YYYY-MM-DD');
  v_to date; v_seen_to date;
BEGIN
  v_to := (v_from + interval '1 month - 1 day')::date;

  -- A shift that has not happened yet is not an absence. The window ran to the
  -- end of the month regardless of today's date, so every remaining scheduled
  -- day counted as a day missed: on 15 September Nourhan had 26 scheduled days,
  -- 13 of them still in the future, and the page reported exactly 13 absences.
  -- Capped at today, so absence means a day that has been and gone. For a
  -- period already finished, least() leaves the month end untouched and the
  -- final payslip is unchanged.
  v_seen_to := least(v_to, current_date);
  RETURN QUERY
  WITH clocked AS (
    SELECT t.event_time::date AS d,
           min(t.event_time) FILTER (WHERE t.event_type='login')  AS in_t,
           max(t.event_time) FILTER (WHERE t.event_type='logout') AS out_t
    FROM timeclock_events t
    WHERE t.employee_id = p_employee_id AND t.event_time::date BETWEEN v_from AND v_to
    GROUP BY 1
  ), c AS (
    SELECT d, EXTRACT(EPOCH FROM (out_t - in_t))/3600.0 AS hrs
    FROM clocked WHERE in_t IS NOT NULL AND out_t IS NOT NULL AND out_t > in_t
  ), s AS (
    SELECT d.work_date,
           EXTRACT(EPOCH FROM (CASE WHEN d.end_time <= d.start_time
             THEN (d.end_time + interval '24 hours') - d.start_time
             ELSE d.end_time - d.start_time END))/3600.0 AS hrs
    FROM employee_schedule_days d
    WHERE d.employee_id = p_employee_id AND d.is_day_off = false
      AND d.work_date BETWEEN v_from AND v_to
  )
  SELECT
    coalesce((SELECT sum(s.hrs) FROM s JOIN c ON c.d = s.work_date),0),
    coalesce((SELECT sum(c.hrs) FROM c WHERE NOT EXISTS
              (SELECT 1 FROM s WHERE s.work_date = c.d)),0),
    coalesce((SELECT sum(greatest(c.hrs - s.hrs,0)) FROM s JOIN c ON c.d = s.work_date),0),
    coalesce((SELECT count(*)::int FROM s JOIN c ON c.d = s.work_date),0),
    coalesce((SELECT count(*)::int FROM c WHERE NOT EXISTS
              (SELECT 1 FROM s WHERE s.work_date = c.d)),0),
    coalesce((SELECT count(*)::int FROM s WHERE s.work_date <= v_seen_to
              AND EXISTS (SELECT 1 FROM timeclock_events t
              WHERE t.employee_id=p_employee_id AND t.event_type='login' AND t.event_time::date=s.work_date)
              AND NOT EXISTS (SELECT 1 FROM c WHERE c.d = s.work_date)),0),
    coalesce((SELECT count(*)::int FROM s WHERE s.work_date <= v_seen_to
              AND NOT EXISTS (SELECT 1 FROM timeclock_events t
              WHERE t.employee_id=p_employee_id AND t.event_time::date=s.work_date)),0);
END; $function$
;