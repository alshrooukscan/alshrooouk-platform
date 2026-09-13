-- =====================================================================
-- 0092 · Attribute scans and reports to a person, not to a string
--
-- visits records who scanned and who reported as scanned_by_name and
-- report_done_by_name, plain text. That has held up only because no two
-- employees currently share a name. Commission and report bonuses cannot
-- rest on that: renaming an employee would silently rewrite who earned
-- what, and a second "Ahmed" would split one person's pay in two.
-- =====================================================================

ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS scanned_by_employee_id uuid REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS raw_data_uploaded_by_employee_id uuid REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS report_done_by_employee_id uuid REFERENCES public.employees(id);

CREATE INDEX IF NOT EXISTS idx_visits_scanned_by_emp
  ON public.visits (scanned_by_employee_id, scanned_at);
CREATE INDEX IF NOT EXISTS idx_visits_report_by_emp
  ON public.visits (report_done_by_employee_id, report_done_at);

-- Resolve the name to a person whenever one is written. Names that do not
-- match an employee are left null rather than guessed: "Mohamed Said" on
-- four visits is the owner, not staff, and inventing an id for him would
-- put commission on someone who is not on payroll.
CREATE OR REPLACE FUNCTION public.visits_resolve_step_actors()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.scanned_by_name IS DISTINCT FROM OLD.scanned_by_name OR NEW.scanned_by_employee_id IS NULL THEN
    SELECT e.id INTO NEW.scanned_by_employee_id FROM employees e
     WHERE lower(btrim(e.name)) = lower(btrim(NEW.scanned_by_name)) LIMIT 1;
  END IF;
  IF NEW.raw_data_uploaded_by_name IS DISTINCT FROM OLD.raw_data_uploaded_by_name OR NEW.raw_data_uploaded_by_employee_id IS NULL THEN
    SELECT e.id INTO NEW.raw_data_uploaded_by_employee_id FROM employees e
     WHERE lower(btrim(e.name)) = lower(btrim(NEW.raw_data_uploaded_by_name)) LIMIT 1;
  END IF;
  IF NEW.report_done_by_name IS DISTINCT FROM OLD.report_done_by_name OR NEW.report_done_by_employee_id IS NULL THEN
    SELECT e.id INTO NEW.report_done_by_employee_id FROM employees e
     WHERE lower(btrim(e.name)) = lower(btrim(NEW.report_done_by_name)) LIMIT 1;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_visits_resolve_actors ON public.visits;
CREATE TRIGGER trg_visits_resolve_actors
  BEFORE INSERT OR UPDATE OF scanned_by_name, raw_data_uploaded_by_name, report_done_by_name
  ON public.visits FOR EACH ROW EXECUTE FUNCTION public.visits_resolve_step_actors();

-- Backfill what already exists.
UPDATE public.visits v SET scanned_by_employee_id = e.id
  FROM public.employees e
 WHERE v.scanned_by_employee_id IS NULL AND v.scanned_by_name IS NOT NULL
   AND lower(btrim(e.name)) = lower(btrim(v.scanned_by_name));

UPDATE public.visits v SET raw_data_uploaded_by_employee_id = e.id
  FROM public.employees e
 WHERE v.raw_data_uploaded_by_employee_id IS NULL AND v.raw_data_uploaded_by_name IS NOT NULL
   AND lower(btrim(e.name)) = lower(btrim(v.raw_data_uploaded_by_name));

UPDATE public.visits v SET report_done_by_employee_id = e.id
  FROM public.employees e
 WHERE v.report_done_by_employee_id IS NULL AND v.report_done_by_name IS NOT NULL
   AND lower(btrim(e.name)) = lower(btrim(v.report_done_by_name));
