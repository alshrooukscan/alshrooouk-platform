-- =====================================================================
-- Cash Management  ·  Stage 3  ·  Debt collection and postponed charges
--
-- Money operations are database functions, not application logic, so the
-- ledger row, the cash custody row and the receipt number are written in
-- one transaction or not at all. This follows settle_dental_order.
--
-- Client decisions implemented:
--   A18/A19  credit limit per customer, blocking new postponed charges
--            once exceeded unless an admin overrides
--   A20      collection restricted at the API layer to permitted roles
--   A22      receipt number issued from the correct series per business
--   A24      partial payments allowed, remaining balance returned
--   §5       cash acknowledgment is mandatory on a cash collection
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Debt collected in cash enters the collector's custody, so
--    'debt_collection' must credit employee_cash_balances.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.employee_cash_balances AS
SELECT employee_id, brand, sum(delta)::numeric(12,2) AS balance
FROM (
    SELECT et.to_employee_id, et.brand, et.amount
    FROM expense_transactions et
    WHERE et.status = 'confirmed'
      AND et.type = ANY (ARRAY['visit_collection'::text,'stock_sale'::text,
                               'cash_transfer'::text,'debt_collection'::text])
      AND et.payment_method = 'cash'
      AND et.to_employee_id IS NOT NULL
    UNION ALL
    SELECT et.from_employee_id, et.brand, - et.amount
    FROM expense_transactions et
    WHERE et.status = 'confirmed'
      AND et.type = ANY (ARRAY['cash_transfer'::text,'cash_collection'::text])
      AND et.from_employee_id IS NOT NULL
    UNION ALL
    SELECT et.from_employee_id, et.brand, - et.amount
    FROM expense_transactions et
    WHERE et.status = 'confirmed'
      AND et.type = 'cash_out'
      AND et.payment_method = 'cash'
      AND et.from_employee_id IS NOT NULL
) t(employee_id, brand, delta)
GROUP BY employee_id, brand;

-- ---------------------------------------------------------------------
-- 2. Current outstanding balance for one customer, optionally per business
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_outstanding(
    p_customer_type text,
    p_customer_id   uuid,
    p_brand         text DEFAULT NULL
) RETURNS numeric
LANGUAGE sql STABLE AS $$
    SELECT coalesce(sum(
        CASE direction WHEN 'charge' THEN amount ELSE -amount END
    ), 0)::numeric(12,2)
    FROM public.customer_ar_ledger
    WHERE customer_type = p_customer_type
      AND customer_id   = p_customer_id
      AND (p_brand IS NULL OR brand = p_brand);
$$;

-- ---------------------------------------------------------------------
-- 3. Raise a postponed charge, enforcing the customer's credit limit
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_ar_charge(
    p_customer_type   text,
    p_customer_id     uuid,
    p_brand           text,
    p_amount          numeric,
    p_reference_type  text DEFAULT NULL,
    p_reference_id    uuid DEFAULT NULL,
    p_note            text DEFAULT NULL,
    p_staff_id        uuid DEFAULT NULL,
    p_staff_name      text DEFAULT NULL,
    p_override_limit  boolean DEFAULT false
) RETURNS json
LANGUAGE plpgsql AS $$
DECLARE
    v_enabled   boolean := false;
    v_limit     numeric := 0;
    v_current   numeric := 0;
    v_projected numeric := 0;
    v_id        uuid;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Charge amount must be greater than zero.';
    END IF;

    IF p_customer_type = 'doctor' THEN
        SELECT credit_limit_enabled, credit_limit INTO v_enabled, v_limit
        FROM public.doctors WHERE id = p_customer_id;
    ELSIF p_customer_type = 'client' THEN
        SELECT credit_limit_enabled, credit_limit INTO v_enabled, v_limit
        FROM public.clients WHERE id = p_customer_id;
    END IF;

    v_current   := public.customer_outstanding(p_customer_type, p_customer_id, NULL);
    v_projected := v_current + p_amount;

    -- A19: no approval needed inside the limit; above it, an admin override.
    IF v_enabled AND NOT p_override_limit AND v_projected > v_limit THEN
        RAISE EXCEPTION
          'Credit limit exceeded. Owes % now, this order would take them to % against a limit of %. An admin can approve it.',
          to_char(v_current,'FM999999990.00'),
          to_char(v_projected,'FM999999990.00'),
          to_char(v_limit,'FM999999990.00');
    END IF;

    INSERT INTO public.customer_ar_ledger (
        customer_type, customer_id, brand, direction, amount,
        reference_type, reference_id, note, created_by_id, created_by_name
    ) VALUES (
        p_customer_type, p_customer_id, p_brand, 'charge', p_amount,
        p_reference_type, p_reference_id, p_note, p_staff_id, p_staff_name
    ) RETURNING id INTO v_id;

    RETURN json_build_object(
        'ledger_id', v_id,
        'outstanding', public.customer_outstanding(p_customer_type, p_customer_id, NULL),
        'limit_overridden', (v_enabled AND p_override_limit AND v_projected > v_limit)
    );
END;
$$;

-- ---------------------------------------------------------------------
-- 4. Record a debt payment, issue the receipt, move cash into custody
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_debt_payment(
    p_customer_type     text,
    p_customer_id       uuid,
    p_brand             text,
    p_amount            numeric,
    p_payment_method    text,
    p_staff_id          uuid    DEFAULT NULL,
    p_staff_name        text    DEFAULT NULL,
    p_employee_id       uuid    DEFAULT NULL,
    p_cash_acknowledged boolean DEFAULT false,
    p_note              text    DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql AS $$
DECLARE
    v_method  text;
    v_owed    numeric;
    v_receipt text;
    v_id      uuid;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Enter the amount collected.';
    END IF;

    v_method := lower(regexp_replace(coalesce(p_payment_method,'cash'), '\s+', '_', 'g'));
    IF v_method = 'vodafone_cash' THEN v_method := 'wallet'; END IF;
    IF v_method NOT IN ('cash','visa','instapay','wallet') THEN v_method := 'cash'; END IF;

    v_owed := public.customer_outstanding(p_customer_type, p_customer_id, NULL);
    IF v_owed <= 0 THEN
        RAISE EXCEPTION 'This customer has nothing outstanding.';
    END IF;
    IF p_amount > v_owed THEN
        RAISE EXCEPTION 'Payment of % is more than the % outstanding.',
          to_char(p_amount,'FM999999990.00'), to_char(v_owed,'FM999999990.00');
    END IF;

    -- Cash physically enters someone's custody, so we must know whose, and
    -- the collector must confirm they are holding it.
    IF v_method = 'cash' THEN
        IF p_employee_id IS NULL THEN
            RAISE EXCEPTION 'Cash collections must be attributed to an employee.';
        END IF;
        IF NOT p_cash_acknowledged THEN
            RAISE EXCEPTION 'The collector must acknowledge receiving the cash.';
        END IF;
    END IF;

    v_receipt := public.next_receipt_no(p_brand);

    INSERT INTO public.customer_ar_ledger (
        customer_type, customer_id, brand, direction, amount, payment_method,
        receipt_no, note, collected_by_employee_id, cash_acknowledged,
        created_by_id, created_by_name
    ) VALUES (
        p_customer_type, p_customer_id, p_brand, 'payment', p_amount, v_method,
        v_receipt, p_note, p_employee_id, (v_method = 'cash' AND p_cash_acknowledged),
        p_staff_id, p_staff_name
    ) RETURNING id INTO v_id;

    -- Only cash affects physical custody. Card, InstaPay and wallet never
    -- pass through a pocket.
    IF v_method = 'cash' THEN
        INSERT INTO public.expense_transactions (
            type, brand, amount, payment_method, to_employee_id, status,
            note, confirmed_by_id, confirmed_by_name, confirmed_at,
            created_by_id, created_by_name
        ) VALUES (
            'debt_collection', p_brand, p_amount, 'cash', p_employee_id, 'confirmed',
            'Debt payment ' || v_receipt, p_staff_id, p_staff_name, now(),
            p_staff_id, p_staff_name
        );
    END IF;

    RETURN json_build_object(
        'ledger_id',   v_id,
        'receipt_no',  v_receipt,
        'amount',      p_amount,
        'method',      v_method,
        'outstanding', public.customer_outstanding(p_customer_type, p_customer_id, NULL)
    );
END;
$$;

COMMENT ON FUNCTION public.record_debt_payment IS
  'Records a customer debt payment atomically: ledger row, receipt number '
  'from the right series, and a cash custody credit when paid in cash.';

-- Applied separately during Stage 3: the type check constraint predated
-- debt_collection and rejected the custody credit row.
ALTER TABLE public.expense_transactions DROP CONSTRAINT IF EXISTS expense_transactions_type_check;
ALTER TABLE public.expense_transactions ADD CONSTRAINT expense_transactions_type_check
  CHECK (type = ANY (ARRAY['cash_out','cash_transfer','cash_collection',
                           'brand_transfer','stock_sale','visit_collection',
                           'debt_collection']));
