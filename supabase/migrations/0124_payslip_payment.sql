-- 0124: confirming that an issued payslip was paid, and how (Mohamed Said, 30 Oct 2026).
ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_method text,
  ADD COLUMN IF NOT EXISTS paid_by_name text,
  ADD COLUMN IF NOT EXISTS paid_note text;
ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_paid_method_check;
ALTER TABLE payroll_runs ADD CONSTRAINT payroll_runs_paid_method_check
  CHECK (paid_method IS NULL OR paid_method IN ('cash', 'instapay', 'wallet', 'bank_transfer', 'visa'));
