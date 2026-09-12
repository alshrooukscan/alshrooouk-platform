-- =====================================================================
-- 0089  ·  Close the public write path into payroll  (defect D3, P0)
--
-- generate_payslip() is SECURITY DEFINER, so it bypasses RLS by design.
-- EXECUTE was granted to PUBLIC, anon and authenticated, and the HR page
-- called it straight from the browser with the anon key, which ships
-- inside the public JavaScript bundle. Anyone holding that key could
-- commit a payslip for any employee UUID, and the function writes: it
-- marks rule assignments applied, deducts advances, writes the F&B tab
-- ledger, sweeps cash into expense_transactions and inserts payroll_runs.
--
-- The replacement server route (POST /api/hr/payroll, action "generate",
-- service role, HR permission enforced) is live in deployment
-- dpl_98kvnBW6EK39VFJviHUrUP3rh3Lf and verified in the production bundle
-- BEFORE this file runs. That order is deliberate: revoking a grant ahead
-- of the code that replaces it is what broke the HR page once already.
--
-- The read functions are revoked too. They expose salary, attendance and
-- cash custody, which no anonymous caller should ever be able to read.
-- Every legitimate caller goes through a server route on the service role.
-- =====================================================================

REVOKE EXECUTE ON FUNCTION public.generate_payslip(uuid, text)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.payslip_preview(uuid, text)           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.payslip_gross(uuid, text)             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.payslip_attendance(uuid, date, date)  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.payroll_settlement_preview(uuid)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.employee_accrued_earnings(uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.employee_spend_capacity(uuid, date, date)   FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.generate_payslip(uuid, text)          TO service_role;
GRANT EXECUTE ON FUNCTION public.payslip_preview(uuid, text)           TO service_role;
GRANT EXECUTE ON FUNCTION public.payslip_gross(uuid, text)             TO service_role;
GRANT EXECUTE ON FUNCTION public.payslip_attendance(uuid, date, date)  TO service_role;
GRANT EXECUTE ON FUNCTION public.payroll_settlement_preview(uuid)      TO service_role;
GRANT EXECUTE ON FUNCTION public.employee_accrued_earnings(uuid, date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.employee_spend_capacity(uuid, date, date)   TO service_role;

COMMENT ON FUNCTION public.generate_payslip(uuid, text) IS
  'The only function that commits a payslip. Service role only - reachable exclusively through POST /api/hr/payroll action "generate", behind the HR permission check.';
