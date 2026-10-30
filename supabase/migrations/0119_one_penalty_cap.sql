-- 0119: one penalty cap everywhere.
-- Merna, Oct 2026 (Mohamed Said, 30 Oct): the Payslips page showed 60, her HR page
-- and portal 682.50, and generating the payslip would have paid 910. The payslip
-- generator applies the cap per item (a deduction that does not fit moves whole to
-- next month); the trial run took a partial slice and the preview ignored the cap.
-- payroll_penalty_split mirrors the generator and is now used by both.

CREATE OR REPLACE FUNCTION public.payroll_penalty_split(p_employee_id uuid, p_period text, p_earned numeric, p_rules numeric)
 RETURNS TABLE(applied numeric, deferred numeric)
 LANGUAGE plpgsql
 STABLE
AS $function$
-- Mirrors step 3 of generate_payslip exactly: approved deductions, oldest first,
-- each applied whole if it fits under the cap, otherwise moved whole to next month.
DECLARE v_period text := public.payroll_period_normalize(p_period);
        v_pct numeric; v_cap numeric; v_pen numeric := coalesce(p_rules,0); a record;
BEGIN
  applied := 0; deferred := 0;
  SELECT coalesce(penalty_cap_percent,25) INTO v_pct FROM payroll_settings WHERE id;
  v_cap := round(coalesce(p_earned,0) * v_pct / 100.0, 2);
  FOR a IN SELECT amount FROM payroll_adjustments
            WHERE employee_id = p_employee_id AND kind = 'deduction' AND status = 'approved'
              AND public.payroll_period_normalize(period) = v_period
            ORDER BY coalesce(occurred_on, created_at::date), created_at
  LOOP
    IF v_pen + a.amount <= v_cap THEN v_pen := v_pen + a.amount; applied := applied + a.amount;
    ELSE deferred := deferred + a.amount; END IF;
  END LOOP;
  RETURN NEXT;
END $function$;
REVOKE ALL ON FUNCTION public.payroll_penalty_split(uuid, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_penalty_split(uuid, text, numeric, numeric) TO service_role;

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
  v_comm numeric:=0; v_comm_days int:=0; v_split record; v_cap_pct numeric; rw record; v_bal json; v_month json; v_days json; v_pending_ded json;
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

  SELECT coalesce(penalty_cap_percent,25) INTO v_cap_pct FROM payroll_settings WHERE id;
  SELECT * INTO v_split FROM public.payroll_penalty_split(p_employee_id, v_period,
           v_gross + coalesce(rb.bonus,0) + coalesce(rw.bonus,0) + v_bon, v_rules_total);

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
    'penalty_cap_percent', v_cap_pct,
    'penalty_deductions_applied', round(v_split.applied,2),
    'penalty_deferred', round(v_split.deferred,2),
    -- same cap as generate_payslip: an approved deduction that does not fit under
    -- the cap moves to next month whole, so the preview pays what the payslip pays
    'indicative_net', round(v_gross + rb.bonus + coalesce(rw.bonus,0) + v_bon - v_split.applied - v_rules_total - v_adv,2)
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.payroll_trial_run(p_period text)
 RETURNS TABLE(employee_id uuid, employee_name text, hr_id text, pay_basis text, paid_days integer, unscheduled_days integer, absent_days integer, needs_review integer, paid_hours numeric, overtime_hours numeric, gross numeric, scan_commission numeric, report_bonus numeric, bonuses numeric, rule_deductions numeric, penalty_deductions numeric, penalty_cap numeric, deferred_to_next numeric, advance_taken numeric, tab_taken numeric, cash_swept numeric, still_held numeric, indicative_net numeric, flags text)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE v_period text := public.payroll_period_normalize(p_period); v_cap_pct numeric;
BEGIN
  SELECT coalesce(penalty_cap_percent,25) INTO v_cap_pct FROM payroll_settings WHERE id;
  RETURN QUERY
  -- MATERIALIZED: computed once per employee; inlining duplicated the gross and balance calls
  WITH base AS MATERIALIZED (
    SELECT e.id, e.name, e.hr_id, e.acknowledgement_on_file AS ack,
           CASE WHEN e.enable_hybrid_variable_pay THEN 'hybrid'
                WHEN coalesce(e.hourly_rate,0) > 0 THEN 'hourly' ELSE 'monthly' END AS basis,
           h.paid_days, h.unscheduled_days, h.absent_days,
           coalesce((public.attendance_balance(e.id,v_period)->>'needs_review_days')::int,0) AS needs_review,
           (SELECT count(*)::int FROM employee_schedule_days sd
             WHERE sd.employee_id = e.id AND sd.is_day_off = false
               AND sd.work_date BETWEEN to_date(v_period||'-01','YYYY-MM-DD')
                   AND (to_date(v_period||'-01','YYYY-MM-DD') + interval '1 month - 1 day')::date) AS sched_days,
           round(h.scheduled_paid + h.unscheduled_paid,2) AS hrs,
           round(coalesce((public.attendance_balance(e.id,v_period)->>'overtime_minutes')::numeric,0)/60.0,2) AS ot,
           -- payslip_gross_v2 now applies the client's rule itself - salary
           -- divided by scheduled days, times days actually signed in and out -
           -- so this view no longer prorates on its own. The calendar proration
           -- that sat here was replaced by it, and having both would have shown
           -- the employee a different number from the one their payslip pays.
           public.payslip_gross_v3(e.id,v_period) AS g,
           coalesce((SELECT sum(c.commission) FROM public.employee_scan_commission_days(e.id,v_period) c),0) AS comm,
           -- report_bonus column now carries report + raw data bonus (v3); the flag names the raw part
           coalesce((SELECT rb.bonus FROM public.employee_report_bonus(e.id,v_period) rb),0)
             + coalesce((SELECT rw.bonus FROM public.employee_raw_data_bonus(e.id,v_period) rw),0) AS rbonus,
           coalesce((SELECT rw.bonus FROM public.employee_raw_data_bonus(e.id,v_period) rw),0) AS rawb,
           -- Approved only. A bonus or a deduction is a proposal until an
           -- admin has decided on it, so a pending one must not reach the
           -- payslip nor the figure the employee sees they have earned.
           coalesce((SELECT sum(a.amount) FROM payroll_adjustments a WHERE a.employee_id=e.id
                     AND a.kind='bonus' AND a.status='approved'
                     AND public.payroll_period_normalize(a.period)=v_period),0) AS bon,
           coalesce((SELECT sum(coalesce(era.amount,dr.value)) FROM employee_rule_assignments era
                     JOIN deduction_rules dr ON dr.id=era.deduction_rule_id
                     WHERE era.employee_id=e.id AND (era.amount IS NULL OR era.status='active')),0) AS rules,
           coalesce((SELECT sum(a.amount) FROM payroll_adjustments a WHERE a.employee_id=e.id
                     AND a.kind='deduction' AND a.status='approved'
                     AND public.payroll_period_normalize(a.period)=v_period),0) AS pen,
           coalesce((SELECT sum(ce.amount-coalesce(ce.advance_amount_deducted,0)) FROM cash_expenses ce
                     WHERE ce.employee_id=e.id AND ce.category='employee_advance'
                       AND ce.advance_status='open'),0) AS adv,
           coalesce((SELECT greatest(tb.balance,0) FROM employee_tab_balances tb WHERE tb.employee_id=e.id),0) AS tab,
           coalesce((SELECT sum(b.balance) FROM employee_cash_balances b
                     WHERE b.employee_id=e.id AND b.balance>0
                       AND NOT EXISTS (SELECT 1 FROM employee_cash_keeper_streams k
                                       WHERE k.employee_id=b.employee_id AND k.brand=b.brand)),0) AS cash,
           -- The custody guard refuses a sweep outright while transfers from
           -- this person are still waiting to be confirmed. It is all or
           -- nothing, so a trial that assumes the sweep lands is wrong by the
           -- whole salary.
           coalesce((SELECT sum(x.amount) FROM expense_transactions x
                     WHERE x.from_employee_id=e.id AND x.status='pending'
                       AND (x.type IN ('cash_transfer','cash_collection')
                            OR (x.type='cash_out' AND x.payment_method='cash'))),0) AS cash_pending
    FROM employees e CROSS JOIN LATERAL public.payslip_hours(e.id,v_period) h
    WHERE e.is_active
  ), step AS (
    SELECT b.*, (b.g + b.rbonus + b.bon) AS earned,
           round((b.g + b.rbonus + b.bon) * v_cap_pct/100.0, 2) AS cap,
           (SELECT ps.applied FROM public.payroll_penalty_split(b.id, v_period, b.g+b.rbonus+b.bon, b.rules) ps) AS pen_applied
    FROM base b
  ), c1 AS (
    SELECT s.*, greatest(s.earned - s.rules - s.pen_applied - s.adv, 0) AS after_adv FROM step s
  ), c2 AS (
    SELECT c.*, least(c.tab, c.after_adv) AS tab_take FROM c1 c
  ), c3 AS (
    SELECT c.*,
           CASE WHEN least(c.cash, greatest(c.after_adv - c.tab_take, 0))
                     > greatest(c.cash - c.cash_pending, 0)
                THEN 0                              -- guard refuses it entirely
                ELSE least(c.cash, greatest(c.after_adv - c.tab_take, 0)) END AS cash_take
    FROM c2 c
  )
  SELECT c.id, c.name, c.hr_id, c.basis,
         c.paid_days, c.unscheduled_days, c.absent_days, c.needs_review, c.hrs, c.ot,
         round(c.g,2), round(c.comm,2), round(c.rbonus,2), round(c.bon,2),
         round(c.rules,2), round(c.pen_applied,2), c.cap,
         round(greatest(c.pen - c.pen_applied,0),2),
         round(c.adv,2), round(c.tab_take,2), round(c.cash_take,2),
         round((c.tab - c.tab_take) + (c.cash - c.cash_take),2),
         round(c.earned - c.rules - c.pen_applied - c.adv - c.tab_take - c.cash_take,2),
         btrim(concat_ws(' · ',
           CASE WHEN c.rawb>0 THEN 'bonus includes '||round(c.rawb,2)||' EGP raw data uploads' END,
           CASE WHEN c.needs_review>0 THEN c.needs_review||' day(s) need an attendance decision' END,
           CASE WHEN c.ot>0 THEN c.ot||' overtime hour(s) undecided' END,
           CASE WHEN c.pen>c.pen_applied THEN 'cap reached, '||round(c.pen-c.pen_applied,2)||' carries to next month' END,
           CASE WHEN c.cash_take=0 AND c.cash>0 AND c.cash_pending>0
                THEN 'cash sweep deferred, '||round(c.cash_pending,2)||' EGP of transfers still awaiting confirmation' END,
           CASE WHEN c.cash-c.cash_take>0 AND c.cash_pending=0
                THEN round(c.cash-c.cash_take,2)||' EGP cash stays with them, the payslip cannot cover it' END,
           CASE WHEN c.tab-c.tab_take>0 THEN round(c.tab-c.tab_take,2)||' EGP tab carries forward' END,
           CASE WHEN NOT c.ack THEN 'no signed acknowledgement' END,
           -- Named out loud. Without a roster the day-rate rule cannot be
           -- applied, so this person is on the whole salary by default - and
           -- nobody should read that figure as though it were calculated.
           CASE WHEN c.basis='monthly' AND c.sched_days=0
                THEN 'no shifts scheduled this month, so the whole salary is shown - enter their roster for this to be calculated' END))
  FROM c3 c ORDER BY c.name;
END; $function$;
