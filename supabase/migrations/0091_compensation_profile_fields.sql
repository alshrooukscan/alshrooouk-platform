-- =====================================================================
-- 0091 · Compensation fields on the employee profile
--
-- Straight from the client's own answers:
--
--   Q4  "200 was an example not the actual number but we expect to have an
--        editable field in employee profile to define the baseline and
--        commission% if the employee want to follow this schema"
--   Q3  "reports are having a separate bonus plan ... a specific rate per
--        report done after 5th report required during the day ... or any
--        report that was done off shift either online or on need basis"
--   Q7  "it's a fixed rate per staff member according to the criticality and
--        effect on business ... add an editable field in employee profile to
--        define short notice leave deduction ratio and I can change accordingly"
--
-- Nothing here is a model or a tier engine. They are settings a human turns,
-- which is what he asked for. Every one defaults to the behaviour already in
-- production, so adding them changes nobody's pay until someone edits a value.
-- =====================================================================

ALTER TABLE public.employees
  -- Hybrid pay, opt-in per person. Off by default: an existing employee keeps
  -- being paid exactly as they are paid today.
  ADD COLUMN IF NOT EXISTS enable_hybrid_variable_pay boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shift_baseline_value numeric(12,2),
  ADD COLUMN IF NOT EXISTS scan_commission_percentage numeric(6,2),

  -- Not requested. Offered. TAREK's point was that a quiet shift on the hybrid
  -- model can pay a fraction of a normal one, and the client answered by
  -- setting the numbers himself rather than accepting a fixed floor. This lets
  -- him set a floor per person if he ever wants one, and does nothing while it
  -- is empty.
  ADD COLUMN IF NOT EXISTS minimum_shift_earning numeric(12,2),

  -- Report bonus. The same rate covers both triggers the client described:
  -- reports beyond the daily threshold, and any report finished off shift.
  ADD COLUMN IF NOT EXISTS report_bonus_rate numeric(12,2),
  ADD COLUMN IF NOT EXISTS report_daily_threshold integer NOT NULL DEFAULT 5,

  -- Short-notice leave. A judgement call per person, raised by hand when the
  -- behaviour repeats. 2 means a day taken at short notice costs two days.
  ADD COLUMN IF NOT EXISTS short_notice_leave_ratio numeric(5,2) NOT NULL DEFAULT 2;

COMMENT ON COLUMN public.employees.enable_hybrid_variable_pay IS
  'Opt-in. When true the shift pays shift_baseline_value plus scan_commission_percentage of the scans this person performed.';
COMMENT ON COLUMN public.employees.minimum_shift_earning IS
  'Optional floor on a hybrid shift, baseline plus commission combined. Empty means no floor.';
COMMENT ON COLUMN public.employees.report_daily_threshold IS
  'Reports expected within a normal day. The bonus rate applies beyond this, and to any report finished off shift.';
COMMENT ON COLUMN public.employees.short_notice_leave_ratio IS
  'Deduction multiplier for leave taken at short notice. Set per person by business criticality, raised by hand if the behaviour repeats.';

-- A hybrid profile that is switched on but left blank would silently pay zero.
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS hybrid_pay_needs_its_numbers;
ALTER TABLE public.employees ADD CONSTRAINT hybrid_pay_needs_its_numbers CHECK (
  enable_hybrid_variable_pay = false
  OR (shift_baseline_value IS NOT NULL AND scan_commission_percentage IS NOT NULL)
);

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS commission_percentage_is_a_percentage;
ALTER TABLE public.employees ADD CONSTRAINT commission_percentage_is_a_percentage CHECK (
  scan_commission_percentage IS NULL
  OR (scan_commission_percentage >= 0 AND scan_commission_percentage <= 100)
);

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS short_notice_ratio_is_sane;
ALTER TABLE public.employees ADD CONSTRAINT short_notice_ratio_is_sane CHECK (
  short_notice_leave_ratio >= 1 AND short_notice_leave_ratio <= 10
);
