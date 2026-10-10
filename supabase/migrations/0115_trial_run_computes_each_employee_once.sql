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
           least(b.pen, greatest(round((b.g+b.rbonus+b.bon)*v_cap_pct/100.0,2) - b.rules, 0)) AS pen_applied
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
END; $function$

;
