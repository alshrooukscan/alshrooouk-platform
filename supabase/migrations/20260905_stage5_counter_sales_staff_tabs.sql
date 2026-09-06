-- =====================================================================
-- Cash Management  ·  Stage 5  ·  Counter sales, Staff Tabs, and the
--                                 accrued-earnings spending cap
--
-- Client decisions implemented:
--   A5   El3awama sells over a counter AND by delivery
--   A6   Dental Supply also sells over a counter, and the sale must record
--        which clinic it is for
--   A7   a dedicated 4-digit PIN confirms a staff tab charge
--   A9   per-employee eligibility switch for tabs
--   A10  staff pay customer price, less any per-employee benefit discount
--   R1   ONE spending rule: 50% of salary accrued so far. The old fixed
--        cap on gross salary is deliberately not implemented.
--   R2   fixed salaries accrue monthly/30 each day; hourly staff accrue
--        per hour actually worked
--   §3C  a deferred tab charge has ZERO effect on cash custody
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Staff tab PIN, stored hashed. A 4-digit PIN is low entropy, so it is
--    never held in the clear and is only ever compared, never read back.
-- ---------------------------------------------------------------------
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS tab_pin_hash text;

CREATE OR REPLACE FUNCTION public.set_tab_pin(p_employee_id uuid, p_pin text)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
    IF p_pin !~ '^[0-9]{4}$' THEN
        RAISE EXCEPTION 'The PIN must be exactly 4 digits.';
    END IF;
    UPDATE public.employees
       SET tab_pin_hash = crypt(p_pin, gen_salt('bf'))
     WHERE id = p_employee_id;
    RETURN FOUND;
END;
$$;

-- ---------------------------------------------------------------------
-- 2. Accrued earnings to date  (R2)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.employee_accrued_earnings(
    p_employee_id uuid,
    p_from date DEFAULT date_trunc('month', CURRENT_DATE)::date,
    p_to   date DEFAULT CURRENT_DATE
) RETURNS numeric
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_hourly numeric;
    v_fixed  numeric;
    v_hours  numeric := 0;
    v_days   integer;
BEGIN
    SELECT coalesce(hourly_rate,0), coalesce(fixed_salary,0)
      INTO v_hourly, v_fixed
      FROM public.employees WHERE id = p_employee_id;

    -- Hourly staff accrue per hour actually worked, paired login -> logout.
    IF v_hourly > 0 THEN
        SELECT coalesce(sum(EXTRACT(EPOCH FROM (out_time - in_time)) / 3600.0), 0)
          INTO v_hours
        FROM (
            SELECT event_time AS in_time,
                   lead(event_time) OVER (ORDER BY event_time) AS out_time,
                   event_type,
                   lead(event_type) OVER (ORDER BY event_time) AS next_type
            FROM public.timeclock_events
            WHERE employee_id = p_employee_id
              AND event_time::date BETWEEN p_from AND p_to
        ) p
        WHERE p.event_type = 'login' AND p.next_type = 'logout';
        RETURN round(v_hours * v_hourly, 2);
    END IF;

    -- Fixed salary accrues evenly across the month: monthly / 30 per day,
    -- as the client specified, including days off.
    IF v_fixed > 0 THEN
        v_days := (p_to - p_from) + 1;
        RETURN round((v_fixed / 30.0) * v_days, 2);
    END IF;

    -- Neither rate on file: nothing can be accrued, so nothing can be spent.
    RETURN 0;
END;
$$;

COMMENT ON FUNCTION public.employee_accrued_earnings IS
  'Salary earned so far in the period. Hourly staff: hours actually worked '
  'from paired clock events. Fixed salary: monthly/30 per elapsed day.';

-- ---------------------------------------------------------------------
-- 3. Staff tab ledger
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_tab_ledger (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id  uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    direction    text NOT NULL CHECK (direction IN ('charge','payment','payroll_deduction','adjustment')),
    amount       numeric(12,2) NOT NULL CHECK (amount > 0),
    reference_type text,
    reference_id uuid,
    note         text,
    entry_date   date NOT NULL DEFAULT CURRENT_DATE,
    created_by_id uuid,
    created_by_name text,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tab_employee ON public.employee_tab_ledger(employee_id);
CREATE INDEX IF NOT EXISTS idx_tab_date     ON public.employee_tab_ledger(entry_date);

COMMENT ON TABLE public.employee_tab_ledger IS
  'What each employee owes for staff purchases. Deliberately separate from '
  'expense_transactions: a deferred tab charge must never touch cash custody.';

CREATE OR REPLACE VIEW public.employee_tab_balances AS
SELECT employee_id,
       sum(CASE direction WHEN 'charge' THEN amount ELSE -amount END)::numeric(12,2) AS balance
FROM public.employee_tab_ledger
GROUP BY employee_id;

-- ---------------------------------------------------------------------
-- 4. How much may this employee still put on their tab?  (R1)
--    50% of accrued earnings, less advances and tab charges already used
--    in the same period.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.employee_spend_capacity(
    p_employee_id uuid,
    p_from date DEFAULT date_trunc('month', CURRENT_DATE)::date,
    p_to   date DEFAULT CURRENT_DATE
) RETURNS json
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_accrued  numeric;
    v_cap      numeric;
    v_advances numeric;
    v_tab      numeric;
BEGIN
    v_accrued := public.employee_accrued_earnings(p_employee_id, p_from, p_to);
    v_cap     := round(v_accrued * 0.5, 2);

    SELECT coalesce(sum(amount),0) INTO v_advances
    FROM public.cash_expenses
    WHERE employee_id = p_employee_id
      AND category = 'advance'
      AND entry_date BETWEEN p_from AND p_to;

    SELECT coalesce(sum(CASE direction WHEN 'charge' THEN amount ELSE -amount END),0)
      INTO v_tab
    FROM public.employee_tab_ledger
    WHERE employee_id = p_employee_id
      AND entry_date BETWEEN p_from AND p_to;

    RETURN json_build_object(
        'accrued',   v_accrued,
        'cap',       v_cap,
        'advances',  v_advances,
        'tab_used',  v_tab,
        'remaining', greatest(v_cap - v_advances - v_tab, 0)
    );
END;
$$;

-- ---------------------------------------------------------------------
-- 5. Counter sales
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.counter_sales (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand             text NOT NULL CHECK (brand IN ('dental_stock','el3awama_stock')),
    sale_type         text NOT NULL CHECK (sale_type IN ('walk_in','staff_tab','internal')),
    -- A6: which clinic / customer the sale is for. Optional for a true
    -- anonymous walk-up, required for anything postponed.
    customer_type     text CHECK (customer_type IN ('doctor','client','internal')),
    customer_id       uuid,
    internal_brand    text,
    employee_id       uuid REFERENCES public.employees(id),
    gross_amount      numeric(12,2) NOT NULL CHECK (gross_amount > 0),
    discount_percent  numeric(5,2)  NOT NULL DEFAULT 0,
    net_amount        numeric(12,2) NOT NULL CHECK (net_amount >= 0),
    payment_method    text NOT NULL CHECK (payment_method IN
                        ('cash','visa','instapay','wallet','postponed','staff_tab')),
    collected_by_employee_id uuid REFERENCES public.employees(id),
    receipt_no        text,
    note              text,
    entry_date        date NOT NULL DEFAULT CURRENT_DATE,
    created_by_id     uuid,
    created_by_name   text,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_counter_brand ON public.counter_sales(brand, entry_date);

CREATE TABLE IF NOT EXISTS public.counter_sale_items (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id       uuid NOT NULL REFERENCES public.counter_sales(id) ON DELETE CASCADE,
    stock_item_id uuid REFERENCES public.stock_items(id),
    item_name     text NOT NULL,
    quantity      numeric(12,2) NOT NULL CHECK (quantity > 0),
    unit_price    numeric(12,2) NOT NULL,
    line_total    numeric(12,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_counter_items_sale ON public.counter_sale_items(sale_id);

ALTER TABLE public.employee_tab_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counter_sales       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counter_sale_items  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_all ON public.employee_tab_ledger;
DROP POLICY IF EXISTS staff_all ON public.counter_sales;
DROP POLICY IF EXISTS staff_all ON public.counter_sale_items;
CREATE POLICY staff_all ON public.employee_tab_ledger FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY staff_all ON public.counter_sales       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY staff_all ON public.counter_sale_items  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- 6. Record a counter sale, atomically
--    Prices and stock always come from the database, never the caller.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_counter_sale(
    p_brand           text,
    p_sale_type       text,
    p_items           jsonb,
    p_payment_method  text,
    p_customer_type   text    DEFAULT NULL,
    p_customer_id     uuid    DEFAULT NULL,
    p_employee_id     uuid    DEFAULT NULL,   -- staff buying, for a tab
    p_tab_pin         text    DEFAULT NULL,
    p_collected_by    uuid    DEFAULT NULL,   -- who took the cash
    p_staff_id        uuid    DEFAULT NULL,
    p_staff_name      text    DEFAULT NULL,
    p_note            text    DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql AS $$
DECLARE
    v_cat      text;
    v_item     jsonb;
    v_sid      uuid;
    v_qty      numeric;
    v_price    numeric;
    v_left     numeric;
    v_name     text;
    v_gross    numeric := 0;
    v_disc     numeric := 0;
    v_net      numeric;
    v_sale     uuid;
    v_receipt  text;
    v_cap      json;
    v_ok       boolean;
BEGIN
    IF jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'Nothing has been added to the sale.';
    END IF;
    v_cat := CASE p_brand WHEN 'dental_stock' THEN 'dental' ELSE 'el3awama' END;

    -- Pass 1: validate everything before changing anything.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_sid := (v_item->>'stock_item_id')::uuid;
        v_qty := (v_item->>'quantity')::numeric;
        SELECT sale_price, qty_remaining, name INTO v_price, v_left, v_name
        FROM public.stock_items WHERE id = v_sid AND category = v_cat;
        IF v_name IS NULL THEN RAISE EXCEPTION 'One of these items no longer exists.'; END IF;
        IF v_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be more than zero for %.', v_name; END IF;
        IF v_qty > v_left THEN
            RAISE EXCEPTION 'Not enough stock for % - only % left.', v_name, v_left;
        END IF;
        v_gross := v_gross + (v_qty * v_price);
    END LOOP;

    -- A10: staff pay customer price less their benefit discount.
    IF p_sale_type = 'staff_tab' OR (p_employee_id IS NOT NULL AND p_payment_method = 'staff_tab') THEN
        SELECT coalesce(staff_discount_percent,0) INTO v_disc
        FROM public.employees WHERE id = p_employee_id;
    END IF;
    v_net := round(v_gross * (1 - coalesce(v_disc,0)/100.0), 2);

    -- Staff tab checks: eligibility, PIN, and the accrued spending cap.
    IF p_payment_method = 'staff_tab' THEN
        IF p_employee_id IS NULL THEN
            RAISE EXCEPTION 'Which employee is this going on the tab for?';
        END IF;
        SELECT fnb_tab_enabled INTO v_ok FROM public.employees WHERE id = p_employee_id;
        IF NOT coalesce(v_ok,false) THEN
            RAISE EXCEPTION 'Staff tabs are switched off for this employee.';
        END IF;

        SELECT (tab_pin_hash IS NOT NULL AND tab_pin_hash = crypt(coalesce(p_tab_pin,''), tab_pin_hash))
          INTO v_ok FROM public.employees WHERE id = p_employee_id;
        IF NOT coalesce(v_ok,false) THEN
            RAISE EXCEPTION 'That PIN is not correct.';
        END IF;

        v_cap := public.employee_spend_capacity(p_employee_id);
        IF v_net > (v_cap->>'remaining')::numeric THEN
            RAISE EXCEPTION
              'This would take them over their limit. Earned so far %, limit is 50%% of that, and % is already used. Remaining today: %.',
              (v_cap->>'accrued'), ((v_cap->>'advances')::numeric + (v_cap->>'tab_used')::numeric),
              (v_cap->>'remaining');
        END IF;
    END IF;

    -- Postponed needs a real customer to bill.
    IF p_payment_method = 'postponed' AND p_customer_id IS NULL THEN
        RAISE EXCEPTION 'A postponed sale must be assigned to a customer.';
    END IF;

    v_receipt := public.next_receipt_no(p_brand);

    INSERT INTO public.counter_sales (
        brand, sale_type, customer_type, customer_id, employee_id,
        gross_amount, discount_percent, net_amount, payment_method,
        collected_by_employee_id, receipt_no, note, created_by_id, created_by_name
    ) VALUES (
        p_brand, p_sale_type, p_customer_type, p_customer_id, p_employee_id,
        v_gross, coalesce(v_disc,0), v_net, p_payment_method,
        CASE WHEN p_payment_method = 'cash' THEN p_collected_by ELSE NULL END,
        v_receipt, p_note, p_staff_id, p_staff_name
    ) RETURNING id INTO v_sale;

    -- Pass 2: write the lines and take the stock down.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_sid := (v_item->>'stock_item_id')::uuid;
        v_qty := (v_item->>'quantity')::numeric;
        SELECT sale_price, name INTO v_price, v_name
        FROM public.stock_items WHERE id = v_sid;
        INSERT INTO public.counter_sale_items (sale_id, stock_item_id, item_name, quantity, unit_price, line_total)
        VALUES (v_sale, v_sid, v_name, v_qty, v_price, round(v_qty * v_price, 2));
        UPDATE public.stock_items SET qty_remaining = qty_remaining - v_qty WHERE id = v_sid;
    END LOOP;

    -- Where the money goes.
    IF p_payment_method = 'cash' THEN
        IF p_collected_by IS NULL THEN
            RAISE EXCEPTION 'Cash sales must record who took the money.';
        END IF;
        INSERT INTO public.expense_transactions (
            type, brand, amount, payment_method, to_employee_id, status,
            note, confirmed_by_id, confirmed_by_name, confirmed_at,
            created_by_id, created_by_name
        ) VALUES (
            'stock_sale', p_brand, v_net, 'cash', p_collected_by, 'confirmed',
            'Counter sale ' || v_receipt, p_staff_id, p_staff_name, now(),
            p_staff_id, p_staff_name);

    ELSIF p_payment_method = 'postponed' THEN
        PERFORM public.record_ar_charge(p_customer_type, p_customer_id, p_brand,
            v_net, 'counter_sale', v_sale, 'Counter sale ' || v_receipt,
            p_staff_id, p_staff_name, false);

    ELSIF p_payment_method = 'staff_tab' THEN
        -- §3C: deferred, so it must NOT touch cash custody. Only the tab.
        INSERT INTO public.employee_tab_ledger (
            employee_id, direction, amount, reference_type, reference_id,
            note, created_by_id, created_by_name)
        VALUES (p_employee_id, 'charge', v_net, 'counter_sale', v_sale,
            'Counter sale ' || v_receipt, p_staff_id, p_staff_name);
    END IF;
    -- visa / instapay / wallet: recorded on the sale, never in custody.

    RETURN json_build_object(
        'sale_id',   v_sale,
        'receipt_no', v_receipt,
        'gross',     v_gross,
        'discount_percent', coalesce(v_disc,0),
        'net',       v_net,
        'method',    p_payment_method
    );
END;
$$;

COMMENT ON FUNCTION public.record_counter_sale IS
  'Counter sale for El3awama or Dental Supply. Validates stock, prices from '
  'the database, then writes the sale, its lines, the stock movement and the '
  'money in one transaction. Staff tabs never touch cash custody.';
