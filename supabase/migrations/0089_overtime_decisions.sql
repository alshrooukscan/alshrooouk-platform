-- =====================================================================
-- 0089 · Overtime decisions (CEO decision: option A)
--
-- Overtime is never paid automatically and never discarded. Each balance
-- is decided by a named admin, once per employee per period, and the
-- amount is whatever that admin enters. The client has their own way of
-- valuing it, so the system records the decision rather than imposing a
-- rate or a statutory premium.
--
-- An approval becomes an ordinary payroll_adjustments bonus, so it flows
-- through the same single engine and is frozen at the moment it is made.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.overtime_decisions (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id    uuid NOT NULL REFERENCES public.employees(id),
    period         text NOT NULL,
    hours_observed numeric(10,2) NOT NULL,
    hours_approved numeric(10,2) NOT NULL DEFAULT 0,
    amount         numeric(12,2) NOT NULL DEFAULT 0,
    status         text NOT NULL CHECK (status IN ('approved','waived')),
    adjustment_id  uuid REFERENCES public.payroll_adjustments(id) ON DELETE SET NULL,
    note           text,
    decided_by_id  uuid,
    decided_by_name text NOT NULL,
    decided_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_overtime_decision
  ON public.overtime_decisions (employee_id, period);

COMMENT ON TABLE public.overtime_decisions IS
  'One decision per employee per period. status=waived records that the '
  'overtime was seen and deliberately not paid, so an unpaid balance is '
  'always an explicit decision by a named person, never silence.';

ALTER TABLE public.overtime_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_all ON public.overtime_decisions;
CREATE POLICY staff_all ON public.overtime_decisions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.overtime_decide(
    p_employee_id uuid,
    p_period      text,
    p_status      text,
    p_hours       numeric,
    p_amount      numeric,
    p_note        text,
    p_by_id       uuid,
    p_by_name     text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_period text := public.payroll_period_normalize(p_period);
  h record; emp employees; v_adj uuid; v_id uuid;
BEGIN
  IF p_status NOT IN ('approved','waived') THEN
    RAISE EXCEPTION 'A decision is either approved or waived.';
  END IF;
  IF coalesce(p_by_name,'') = '' THEN
    RAISE EXCEPTION 'An overtime decision must carry the name of the person who made it.';
  END IF;

  SELECT * INTO emp FROM employees WHERE id = p_employee_id;
  IF emp IS NULL THEN RAISE EXCEPTION 'Employee not found.'; END IF;

  -- Once the payslip is committed the period is closed. Paying overtime
  -- into an issued payslip would change a figure someone has already been
  -- told is final.
  IF EXISTS (SELECT 1 FROM payroll_runs
             WHERE employee_id = p_employee_id
               AND public.payroll_period_normalize(period) = v_period) THEN
    RAISE EXCEPTION 'The payslip for % is already issued. Overtime for a closed period is a manual adjustment.', v_period;
  END IF;

  IF EXISTS (SELECT 1 FROM overtime_decisions
             WHERE employee_id = p_employee_id AND period = v_period) THEN
    RAISE EXCEPTION 'Overtime for % has already been decided for this employee.', v_period;
  END IF;

  SELECT * INTO h FROM public.payslip_hours(p_employee_id, v_period);

  IF p_status = 'approved' THEN
    IF coalesce(p_amount,0) <= 0 THEN
      RAISE EXCEPTION 'Approving overtime needs an amount. Enter what it is worth, or waive it instead.';
    END IF;
    IF coalesce(p_hours,0) > round(h.overtime_pending,2) THEN
      RAISE EXCEPTION 'Only %.2f overtime hours were recorded for this period.', h.overtime_pending;
    END IF;

    INSERT INTO payroll_adjustments (employee_id, period, kind, label, amount, note,
                                     created_by_id, created_by_name)
    VALUES (p_employee_id, v_period, 'bonus',
            'Overtime ' || to_char(coalesce(p_hours,0),'FM9990.00') || ' h',
            round(p_amount,2),
            coalesce(p_note, 'Approved by ' || p_by_name),
            p_by_id, p_by_name)
    RETURNING id INTO v_adj;
  END IF;

  INSERT INTO overtime_decisions (employee_id, period, hours_observed, hours_approved,
                                  amount, status, adjustment_id, note, decided_by_id, decided_by_name)
  VALUES (p_employee_id, v_period, round(h.overtime_pending,2),
          CASE WHEN p_status='approved' THEN coalesce(p_hours,0) ELSE 0 END,
          CASE WHEN p_status='approved' THEN round(p_amount,2) ELSE 0 END,
          p_status, v_adj, p_note, p_by_id, p_by_name)
  RETURNING id INTO v_id;

  RETURN json_build_object('id', v_id, 'status', p_status, 'period', v_period,
                           'hours_observed', round(h.overtime_pending,2),
                           'hours_approved', CASE WHEN p_status='approved' THEN coalesce(p_hours,0) ELSE 0 END,
                           'amount', CASE WHEN p_status='approved' THEN round(p_amount,2) ELSE 0 END,
                           'adjustment_id', v_adj);
END; $$;

-- Undo, while the period is still open.
CREATE OR REPLACE FUNCTION public.overtime_undecide(p_employee_id uuid, p_period text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_period text := public.payroll_period_normalize(p_period); d record;
BEGIN
  IF EXISTS (SELECT 1 FROM payroll_runs WHERE employee_id=p_employee_id
             AND public.payroll_period_normalize(period)=v_period) THEN
    RAISE EXCEPTION 'The payslip for % is already issued.', v_period;
  END IF;
  SELECT * INTO d FROM overtime_decisions
   WHERE employee_id=p_employee_id AND period=v_period;
  IF d IS NULL THEN RETURN false; END IF;
  IF d.adjustment_id IS NOT NULL THEN
    DELETE FROM payroll_adjustments WHERE id = d.adjustment_id;
  END IF;
  DELETE FROM overtime_decisions WHERE id = d.id;
  RETURN true;
END; $$;

REVOKE EXECUTE ON FUNCTION public.overtime_decide(uuid,text,text,numeric,numeric,text,uuid,text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.overtime_undecide(uuid,text) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.overtime_decide(uuid,text,text,numeric,numeric,text,uuid,text) TO service_role;
GRANT  EXECUTE ON FUNCTION public.overtime_undecide(uuid,text) TO service_role;
