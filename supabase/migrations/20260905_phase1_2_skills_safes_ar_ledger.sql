-- =====================================================================
-- Cash Management  ·  Phase 1 (Foundations) + Phase 2 (A/R data layer)
--
-- Client decisions implemented here:
--   R3/R5/R6  permissions are SKILLS attached to any profile, not titles
--   R6        one cash keeper skill per business stream
--   A25       role-based cash thresholds (Receptionist 10k, others 5k)
--   A10       per-employee staff purchase discount
--   A9        per-employee F&B tab eligibility switch
--   A4/R6     one safe per internal division, with a custodian
--   A18       credit limit per doctor/client, default 5,000 EGP, toggleable
--   A22       three receipt series: RCPS scan, RCPM material, RCPA F&B
--   R1        the static gross-salary cap (old A8) is NOT implemented;
--             the accrued rule alone governs, so no static cap column.
--
-- RLS follows the existing house pattern on this database (authenticated,
-- USING true). Access control lives in column grants and app permissions,
-- not RLS. Diverging for these tables alone would break the app clients.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. SKILLS  (R3, R5, R6)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.skills (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key         text UNIQUE NOT NULL,
    label       text NOT NULL,
    category    text NOT NULL DEFAULT 'general',
    description text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.skills IS
  'Capabilities attached to an employee independently of their job title. '
  'The client was explicit: a skill added to any title, not a title itself, '
  'so the same permission can move as the team grows.';

CREATE TABLE IF NOT EXISTS public.employee_skills (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id    uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    skill_id       uuid NOT NULL REFERENCES public.skills(id)    ON DELETE CASCADE,
    granted_by_id   uuid,
    granted_by_name text,
    granted_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (employee_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_skills_employee ON public.employee_skills(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_skills_skill    ON public.employee_skills(skill_id);

INSERT INTO public.skills (key, label, category, description) VALUES
  ('cash_keeper_scan',     'Cash Keeper - Scan',          'cash',
   'May hold Scan Center cash. Exempt from the automatic payroll cash sweep.'),
  ('cash_keeper_material', 'Cash Keeper - Dental Supply', 'cash',
   'May hold Dental Supply cash. Exempt from the automatic payroll cash sweep.'),
  ('cash_keeper_fnb',      'Cash Keeper - El3awama F&B',  'cash',
   'May hold El3awama F&B cash. Exempt from the automatic payroll cash sweep.'),
  ('material_admin',       'Material Admin',              'operations',
   'Receives automatic assignment of Dental Supply delivery orders.'),
  ('debt_collector',       'Debt Collector',              'operations',
   'May record debt payments from customers and issue receipts.')
ON CONFLICT (key) DO NOTHING;

-- Convenience view: which streams may each employee hold cash for
CREATE OR REPLACE VIEW public.employee_cash_keeper_streams AS
SELECT es.employee_id,
       CASE s.key
         WHEN 'cash_keeper_scan'     THEN 'scan'
         WHEN 'cash_keeper_material' THEN 'dental_stock'
         WHEN 'cash_keeper_fnb'      THEN 'el3awama_stock'
       END AS brand,
       s.key AS skill_key
FROM public.employee_skills es
JOIN public.skills s ON s.id = es.skill_id
WHERE s.key IN ('cash_keeper_scan', 'cash_keeper_material', 'cash_keeper_fnb');

COMMENT ON VIEW public.employee_cash_keeper_streams IS
  'Maps cash keeper skills onto the brand keys used by employee_cash_balances, '
  'so the payroll sweep can ask "may this employee hold cash for this brand".';

-- ---------------------------------------------------------------------
-- 2. EMPLOYEE FIELDS  (A25, A10, A9)
-- ---------------------------------------------------------------------
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS max_cash_threshold     numeric(12,2),
  ADD COLUMN IF NOT EXISTS staff_discount_percent numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fnb_tab_enabled        boolean      NOT NULL DEFAULT true;

COMMENT ON COLUMN public.employees.max_cash_threshold IS
  'Total cash across all three businesses before Yellow/Red status. Defaults '
  'by role: 10,000 Receptionist, 5,000 everyone else. Overridable per person.';
COMMENT ON COLUMN public.employees.staff_discount_percent IS
  'Extra discount on staff purchases, given as a benefit. 0 = customer price.';

-- role-based defaults, only where not already set
UPDATE public.employees
   SET max_cash_threshold = CASE
         WHEN role ILIKE '%receptionist%' THEN 10000
         ELSE 5000
       END
 WHERE max_cash_threshold IS NULL;

-- ---------------------------------------------------------------------
-- 3. SAFES  (A4, R6)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.safes (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key                   text UNIQUE NOT NULL,
    label                 text NOT NULL,
    brand                 text NOT NULL,
    custodian_employee_id uuid REFERENCES public.employees(id),
    branch_id             uuid REFERENCES public.branches(id),
    is_active             boolean NOT NULL DEFAULT true,
    created_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.safes IS
  'One safe per internal division. Cash Collection settles into the safe of '
  'the business the money belongs to, never a single shared pot.';

INSERT INTO public.safes (key, label, brand) VALUES
  ('safe_scan',     'Scan Center Safe',   'scan'),
  ('safe_material', 'Dental Supply Safe', 'dental_stock'),
  ('safe_fnb',      'El3awama F&B Safe',  'el3awama_stock')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 4. CUSTOMER CREDIT LIMITS  (A18)
-- ---------------------------------------------------------------------
ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS credit_limit_enabled boolean       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS credit_limit         numeric(12,2) NOT NULL DEFAULT 5000;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS credit_limit_enabled boolean       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS credit_limit         numeric(12,2) NOT NULL DEFAULT 5000;

COMMENT ON COLUMN public.doctors.credit_limit IS
  'Ceiling on unpaid postponed orders. Enforced only when credit_limit_enabled.';

-- ---------------------------------------------------------------------
-- 5. CUSTOMER A/R LEDGER  (Phase 2 core)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_ar_ledger (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_type     text NOT NULL CHECK (customer_type IN ('doctor','client','internal')),
    customer_id       uuid,
    internal_brand    text,           -- set when customer_type = 'internal'
    brand             text NOT NULL,  -- which business is owed the money
    direction         text NOT NULL CHECK (direction IN ('charge','payment','adjustment')),
    amount            numeric(12,2) NOT NULL CHECK (amount >= 0),
    payment_method    text,
    reference_type    text,
    reference_id      uuid,
    receipt_no        text,
    note              text,
    entry_date        date NOT NULL DEFAULT CURRENT_DATE,
    is_opening_balance boolean NOT NULL DEFAULT false,
    collected_by_employee_id uuid REFERENCES public.employees(id),
    cash_acknowledged boolean NOT NULL DEFAULT false,
    created_by_id     uuid,
    created_by_name   text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ar_customer_identified CHECK (
        (customer_type = 'internal' AND internal_brand IS NOT NULL)
     OR (customer_type <> 'internal' AND customer_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_ar_customer ON public.customer_ar_ledger(customer_type, customer_id);
CREATE INDEX IF NOT EXISTS idx_ar_brand    ON public.customer_ar_ledger(brand);
CREATE INDEX IF NOT EXISTS idx_ar_date     ON public.customer_ar_ledger(entry_date);

COMMENT ON TABLE public.customer_ar_ledger IS
  'Append-only accounts receivable. A charge increases what a customer owes, '
  'a payment reduces it. Opening balances imported at go-live carry '
  'is_opening_balance = true so they can always be told apart from trading.';

CREATE OR REPLACE VIEW public.customer_ar_balances AS
SELECT customer_type,
       customer_id,
       internal_brand,
       brand,
       sum(CASE direction
             WHEN 'charge'     THEN amount
             WHEN 'payment'    THEN -amount
             WHEN 'adjustment' THEN -amount
           END)::numeric(12,2) AS balance
FROM public.customer_ar_ledger
GROUP BY customer_type, customer_id, internal_brand, brand;

-- ---------------------------------------------------------------------
-- 6. RECEIPT SERIES  (A22)
-- Database sequences, not application counters. An application-side
-- counter on this project has already had to be repaired once.
-- ---------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.receipt_seq_scan     START 1;
CREATE SEQUENCE IF NOT EXISTS public.receipt_seq_material START 1;
CREATE SEQUENCE IF NOT EXISTS public.receipt_seq_fnb      START 1;

CREATE OR REPLACE FUNCTION public.next_receipt_no(p_brand text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    v_prefix text;
    v_num    bigint;
BEGIN
    CASE p_brand
        WHEN 'scan'           THEN v_prefix := 'RCPS'; v_num := nextval('public.receipt_seq_scan');
        WHEN 'dental_stock'   THEN v_prefix := 'RCPM'; v_num := nextval('public.receipt_seq_material');
        WHEN 'el3awama_stock' THEN v_prefix := 'RCPA'; v_num := nextval('public.receipt_seq_fnb');
        ELSE RAISE EXCEPTION 'Unknown brand for receipt series: %', p_brand;
    END CASE;

    RETURN v_prefix || '-' || to_char(CURRENT_DATE, 'YYYY') || '-'
           || lpad(v_num::text, 5, '0');
END;
$$;

COMMENT ON FUNCTION public.next_receipt_no(text) IS
  'Issues the next receipt number for a business: RCPS scan, RCPM dental '
  'material, RCPA El3awama F&B. Format PREFIX-YYYY-NNNNN.';

-- ---------------------------------------------------------------------
-- 7. RLS  (matching the existing house pattern on this database)
-- ---------------------------------------------------------------------
ALTER TABLE public.skills              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_skills     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_ar_ledger  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_all ON public.skills;
DROP POLICY IF EXISTS staff_all ON public.employee_skills;
DROP POLICY IF EXISTS staff_all ON public.safes;
DROP POLICY IF EXISTS staff_all ON public.customer_ar_ledger;

CREATE POLICY staff_all ON public.skills             FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY staff_all ON public.employee_skills    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY staff_all ON public.safes              FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY staff_all ON public.customer_ar_ledger FOR ALL TO authenticated USING (true) WITH CHECK (true);
