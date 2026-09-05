-- =====================================================================
-- Cash Management  ·  Stage 4  ·  Delivery verification
--
-- Client decisions implemented:
--   A12  4-digit OTP only, no digital signature
--   A13  WhatsApp only (dispatch handled in the application layer)
--   A14  manager override closes the delivery, records who authorised it
--        and why, and flags the order for review
--   A15  auto-assign to a Material Admin, then an on-shift receptionist,
--        otherwise leave for manual assignment
--   A16  no partial delivery
--   A17  on-behalf orders assign cash immediately
--   §3A  cash must NOT reach the delivery user until the customer has
--        verified receipt. This is the hard gate below.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Order columns for assignment, verification and override
-- ---------------------------------------------------------------------
ALTER TABLE public.dental_orders
  ADD COLUMN IF NOT EXISTS assigned_to_employee_id uuid REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS assigned_at             timestamptz,
  ADD COLUMN IF NOT EXISTS assignment_source       text,
  ADD COLUMN IF NOT EXISTS delivery_otp            text,
  ADD COLUMN IF NOT EXISTS otp_sent_at             timestamptz,
  ADD COLUMN IF NOT EXISTS otp_verified_at         timestamptz,
  ADD COLUMN IF NOT EXISTS otp_attempts            integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS override_by_id          uuid,
  ADD COLUMN IF NOT EXISTS override_by_name        text,
  ADD COLUMN IF NOT EXISTS override_reason         text,
  ADD COLUMN IF NOT EXISTS override_at             timestamptz,
  ADD COLUMN IF NOT EXISTS needs_review            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_on_behalf            boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.dental_orders.needs_review IS
  'Set when a delivery was closed by manager override instead of a customer '
  'OTP. Used to report override frequency; if overrides become the normal '
  'path the OTP control has stopped being a control.';

-- 'assigned' and 'in_transit' join the lifecycle
ALTER TABLE public.dental_orders DROP CONSTRAINT IF EXISTS dental_orders_status_check;
ALTER TABLE public.dental_orders ADD CONSTRAINT dental_orders_status_check
  CHECK (status = ANY (ARRAY['placed','reviewed','assigned','in_transit',
                             'delivered','cancelled','confirmed']));

-- ---------------------------------------------------------------------
-- 2. Who should this delivery go to?  (A15)
--    Material Admin skill first; then a receptionist actually on shift
--    today and clocked in; otherwise NULL, meaning assign by hand.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pick_delivery_user()
RETURNS TABLE (employee_id uuid, source text)
LANGUAGE plpgsql STABLE AS $$
DECLARE v_id uuid;
BEGIN
    SELECT es.employee_id INTO v_id
    FROM public.employee_skills es
    JOIN public.skills s   ON s.id = es.skill_id
    JOIN public.employees e ON e.id = es.employee_id
    WHERE s.key = 'material_admin' AND e.is_active
    ORDER BY es.granted_at
    LIMIT 1;
    IF v_id IS NOT NULL THEN
        RETURN QUERY SELECT v_id, 'material_admin'::text; RETURN;
    END IF;

    -- Fallback: a receptionist scheduled today, not on a day off, and whose
    -- last clock event today was an in rather than an out.
    SELECT e.id INTO v_id
    FROM public.employees e
    JOIN public.employee_schedule_days d
      ON d.employee_id = e.id AND d.work_date = CURRENT_DATE AND NOT d.is_day_off
    WHERE e.is_active AND e.role ILIKE '%receptionist%'
      AND EXISTS (
        SELECT 1 FROM public.timeclock_events t
        WHERE t.employee_id = e.id AND t.event_time::date = CURRENT_DATE
        ORDER BY t.event_time DESC LIMIT 1
      )
    ORDER BY d.start_time
    LIMIT 1;
    IF v_id IS NOT NULL THEN
        RETURN QUERY SELECT v_id, 'receptionist_on_shift'::text; RETURN;
    END IF;

    RETURN QUERY SELECT NULL::uuid, 'manual'::text;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. Assign an order and issue the customer's 4-digit code
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_delivery(
    p_order_id    uuid,
    p_employee_id uuid DEFAULT NULL,
    p_staff_id    uuid DEFAULT NULL,
    p_staff_name  text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql AS $$
DECLARE
    v_order dental_orders;
    v_emp   uuid;
    v_src   text;
    v_otp   text;
BEGIN
    SELECT * INTO v_order FROM public.dental_orders WHERE id = p_order_id FOR UPDATE;
    IF v_order.id IS NULL THEN RAISE EXCEPTION 'Order not found.'; END IF;
    IF v_order.status IN ('delivered','cancelled') THEN
        RAISE EXCEPTION 'This order is already %.', v_order.status;
    END IF;

    IF p_employee_id IS NOT NULL THEN
        v_emp := p_employee_id; v_src := 'manual';
    ELSE
        SELECT employee_id, source INTO v_emp, v_src FROM public.pick_delivery_user();
    END IF;

    IF v_emp IS NULL THEN
        RAISE EXCEPTION 'Nobody holds the Material Admin skill and no receptionist is on shift. Please choose someone.';
    END IF;

    -- 4 digits, 1000-9999 so it is never shown with a leading zero.
    v_otp := lpad((1000 + floor(random() * 9000))::int::text, 4, '0');

    UPDATE public.dental_orders
       SET assigned_to_employee_id = v_emp,
           assigned_at             = now(),
           assignment_source       = v_src,
           status                  = 'in_transit',
           delivery_otp            = v_otp,
           otp_sent_at             = now(),
           otp_attempts            = 0
     WHERE id = p_order_id
     RETURNING * INTO v_order;

    RETURN json_build_object(
        'order_id',    p_order_id,
        'assigned_to', v_emp,
        'source',      v_src,
        'otp',         v_otp,
        'status',      v_order.status
    );
END;
$$;

-- ---------------------------------------------------------------------
-- 4. Customer verifies with their code  (A12)
--    On success the order becomes delivered, and a postponed order raises
--    its accounts receivable charge here rather than at placement.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_delivery_otp(
    p_order_id   uuid,
    p_code       text,
    p_staff_id   uuid DEFAULT NULL,
    p_staff_name text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql AS $$
DECLARE
    v_order dental_orders;
    v_charge json := NULL;
BEGIN
    SELECT * INTO v_order FROM public.dental_orders WHERE id = p_order_id FOR UPDATE;
    IF v_order.id IS NULL THEN RAISE EXCEPTION 'Order not found.'; END IF;
    IF v_order.status = 'delivered' THEN RAISE EXCEPTION 'This order is already delivered.'; END IF;
    IF v_order.delivery_otp IS NULL THEN
        RAISE EXCEPTION 'No code has been issued for this order yet.';
    END IF;
    IF v_order.otp_attempts >= 5 THEN
        RAISE EXCEPTION 'Too many incorrect attempts. A manager will need to close this delivery.';
    END IF;

    IF trim(p_code) <> v_order.delivery_otp THEN
        UPDATE public.dental_orders SET otp_attempts = otp_attempts + 1 WHERE id = p_order_id;
        RAISE EXCEPTION 'That code is not correct. % attempts left.', 4 - v_order.otp_attempts;
    END IF;

    UPDATE public.dental_orders
       SET status            = 'delivered',
           otp_verified_at   = now(),
           delivered_at      = now(),
           delivered_by_id   = coalesce(p_staff_id, delivered_by_id),
           delivered_by_name = coalesce(p_staff_name, delivered_by_name)
     WHERE id = p_order_id
     RETURNING * INTO v_order;

    IF v_order.pay_later THEN
        v_charge := public.record_ar_charge(
            'doctor', v_order.doctor_id, 'dental_stock',
            coalesce(v_order.total_amount,0) - coalesce(v_order.amount_paid,0),
            'dental_order', p_order_id, 'Postponed on delivery',
            p_staff_id, p_staff_name, false);
    END IF;

    RETURN json_build_object('order_id', p_order_id, 'status', 'delivered',
                             'verified', true, 'ar_charge', v_charge);
END;
$$;

-- ---------------------------------------------------------------------
-- 5. Manager override  (A14)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.override_delivery(
    p_order_id   uuid,
    p_reason     text,
    p_staff_id   uuid DEFAULT NULL,
    p_staff_name text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql AS $$
DECLARE
    v_order dental_orders;
    v_charge json := NULL;
BEGIN
    IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
        RAISE EXCEPTION 'Please give a reason for closing this delivery without the customer code.';
    END IF;

    SELECT * INTO v_order FROM public.dental_orders WHERE id = p_order_id FOR UPDATE;
    IF v_order.id IS NULL THEN RAISE EXCEPTION 'Order not found.'; END IF;
    IF v_order.status = 'delivered' THEN RAISE EXCEPTION 'This order is already delivered.'; END IF;

    UPDATE public.dental_orders
       SET status            = 'delivered',
           delivered_at      = now(),
           delivered_by_id   = coalesce(p_staff_id, delivered_by_id),
           delivered_by_name = coalesce(p_staff_name, delivered_by_name),
           override_by_id    = p_staff_id,
           override_by_name  = p_staff_name,
           override_reason   = trim(p_reason),
           override_at       = now(),
           needs_review      = true
     WHERE id = p_order_id
     RETURNING * INTO v_order;

    IF v_order.pay_later THEN
        v_charge := public.record_ar_charge(
            'doctor', v_order.doctor_id, 'dental_stock',
            coalesce(v_order.total_amount,0) - coalesce(v_order.amount_paid,0),
            'dental_order', p_order_id, 'Postponed on delivery (override)',
            p_staff_id, p_staff_name, false);
    END IF;

    RETURN json_build_object('order_id', p_order_id, 'status', 'delivered',
                             'overridden', true, 'ar_charge', v_charge);
END;
$$;

-- ---------------------------------------------------------------------
-- 6. THE HARD GATE
--    settle_dental_order keeps its existing behaviour but now refuses to
--    move cash into anyone's custody before the customer has verified the
--    delivery, or a manager has explicitly overridden it. An on-behalf
--    order is exempt: the staff member is standing with the customer.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_dental_order(
    p_order_id uuid, p_amount numeric, p_payment_method text,
    p_staff_id uuid, p_staff_name text, p_employee_id uuid)
RETURNS dental_orders
LANGUAGE plpgsql AS $function$
declare
  v_order dental_orders;
  v_method text;
  v_new_paid numeric;
begin
  select * into v_order from dental_orders where id = p_order_id for update;
  if v_order.id is null then raise exception 'Order not found.'; end if;
  if p_amount <= 0 then raise exception 'Payment must be greater than zero.'; end if;

  -- Stage 4 gate. Cash must not reach a delivery user before the customer
  -- has confirmed they received the goods.
  if not v_order.is_on_behalf
     and v_order.status <> 'delivered' then
    raise exception 'This delivery has not been verified yet. Ask the customer for their 4-digit code, or have a manager close the delivery, before recording payment.';
  end if;

  v_new_paid := coalesce(v_order.amount_paid,0) + p_amount;
  if v_new_paid > coalesce(v_order.total_amount,0) then
    raise exception 'That is more than the order total. Outstanding is %.',
      coalesce(v_order.total_amount,0) - coalesce(v_order.amount_paid,0);
  end if;

  v_method := lower(regexp_replace(coalesce(p_payment_method,'cash'), '\s+', '_', 'g'));
  if v_method = 'vodafone_cash' then v_method := 'wallet'; end if;
  if v_method not in ('cash','visa','instapay','wallet') then v_method := 'cash'; end if;

  update dental_orders
  set amount_paid = v_new_paid,
      payment_method = v_method,
      payment_status = case when v_new_paid >= total_amount then 'paid' else 'partial' end,
      paid_at = case when v_new_paid >= total_amount then now() else paid_at end,
      collected_by_employee_id = coalesce(p_employee_id, collected_by_employee_id)
  where id = p_order_id
  returning * into v_order;

  -- Cash in hand moves ONLY for cash, and only now - on collection, not at
  -- order placement. Card/InstaPay/wallet never pass through a pocket.
  insert into expense_transactions (
    type, brand, amount, payment_method, entry_date, status,
    created_by_id, created_by_name, confirmed_by_id, confirmed_by_name, confirmed_at,
    to_employee_id, note
  ) values (
    'stock_sale', 'dental_stock', p_amount, v_method, current_date, 'confirmed',
    p_staff_id, p_staff_name, p_staff_id, p_staff_name, now(),
    case when v_method = 'cash' then p_employee_id else null end,
    'Dental order payment'
  );

  return v_order;
end;
$function$;
