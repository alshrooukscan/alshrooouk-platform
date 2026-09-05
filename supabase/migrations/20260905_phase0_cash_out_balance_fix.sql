-- =====================================================================
-- Phase 0 / DEFECT-1
-- employee_cash_balances did not subtract cash_out, so petty expenses
-- paid out of an employee's custody left their balance untouched.
--
-- Two corrections:
--   1. cash_out is now a debit against from_employee_id.
--   2. Custody movements are restricted to payment_method = 'cash'.
--      A cash_out settled on a company card never leaves the employee's
--      pocket, so it must not reduce their physical custody.
--
-- cash_collection is deliberately debited regardless of payment method:
-- once an employee settles to the owner, the cash has left them either
-- way. That is existing intended behaviour, not part of this fix.
--
-- Safe to apply: there are zero cash_out rows at time of writing, so
-- existing balances are unchanged by this migration.
-- =====================================================================

CREATE OR REPLACE VIEW public.employee_cash_balances AS
SELECT employee_id,
       brand,
       sum(delta)::numeric(12,2) AS balance
FROM (
    -- CREDITS: cash physically taken in by an employee
    SELECT et.to_employee_id AS employee_id,
           et.brand,
           et.amount AS delta
    FROM expense_transactions et
    WHERE et.status = 'confirmed'
      AND et.type = ANY (ARRAY['visit_collection'::text,
                               'stock_sale'::text,
                               'cash_transfer'::text])
      AND et.payment_method = 'cash'
      AND et.to_employee_id IS NOT NULL

    UNION ALL

    -- DEBITS: cash handed on to someone else
    SELECT et.from_employee_id AS employee_id,
           et.brand,
           - et.amount AS delta
    FROM expense_transactions et
    WHERE et.status = 'confirmed'
      AND et.type = ANY (ARRAY['cash_transfer'::text,
                               'cash_collection'::text])
      AND et.from_employee_id IS NOT NULL

    UNION ALL

    -- DEBITS: cash spent out of custody on an expense
    SELECT et.from_employee_id AS employee_id,
           et.brand,
           - et.amount AS delta
    FROM expense_transactions et
    WHERE et.status = 'confirmed'
      AND et.type = 'cash_out'
      AND et.payment_method = 'cash'
      AND et.from_employee_id IS NOT NULL
) t
GROUP BY employee_id, brand;

COMMENT ON VIEW public.employee_cash_balances IS
  'Per-employee, per-brand physical cash custody. Credits: cash collections '
  'and inbound transfers. Debits: outbound transfers, settlements to owner, '
  'and cash spent on expenses. Only payment_method = cash affects custody, '
  'except cash_collection which debits on any method. Rebuilt Phase 0.';
