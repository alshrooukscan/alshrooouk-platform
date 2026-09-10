-- 0069: a delivered order must land on the account the clinic is billed under.
--
-- Delivering a postponed order raised the charge against the DOCTOR
-- (customer_type 'doctor'), while every other part of the system keeps this
-- debt against the CLINIC - the nine opening balances carried over in the
-- migration, 13,938 EGP, are all clinic rows, and the doctor portal totals
-- clinic rows to show what the practice owes.
--
-- So the charge was written correctly and then never seen. Mohamed delivered
-- an order for D.wael Hayyan, 460 EGP postponed, and the clinic's balance did
-- not move: the money sat on a doctor row that nothing totals.
--
-- Deliveries now bill the clinic where the doctor's clinic_code resolves to
-- one. It often does not - only 59 of 166 doctors currently resolve - so where
-- it cannot, the charge still goes to the doctor rather than being lost, and
-- the portal is taught to count both. Between the two changes the amount is
-- always visible to somebody.
--
-- The 460 already recorded is moved onto Global Clinic, the practice it
-- belongs to.

create or replace function ar_customer_for_doctor(p_doctor_id uuid)
returns table (customer_type text, customer_id uuid)
language sql stable as $$
  select case when c.id is not null then 'clinic' else 'doctor' end,
         coalesce(c.id, d.id)
  from doctors d
  left join clinics c on c.code = d.clinic_code
  where d.id = p_doctor_id;
$$;

create or replace function verify_delivery_otp(p_order_id uuid, p_code text, p_staff_id uuid default null, p_staff_name text default null)
returns json language plpgsql as $$
DECLARE
    v_order dental_orders;
    v_charge json := NULL;
    v_ctype text; v_cid uuid;
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
        SELECT a.customer_type, a.customer_id INTO v_ctype, v_cid
          FROM ar_customer_for_doctor(v_order.doctor_id) a;
        v_charge := public.record_ar_charge(
            coalesce(v_ctype,'doctor'), coalesce(v_cid, v_order.doctor_id), 'dental_stock',
            coalesce(v_order.total_amount,0) - coalesce(v_order.amount_paid,0),
            'dental_order', p_order_id, 'Postponed on delivery',
            p_staff_id, p_staff_name, false);
    END IF;

    RETURN json_build_object('order_id', p_order_id, 'status', 'delivered',
                             'verified', true, 'ar_charge', v_charge);
END;
$$;

-- the charge already raised belongs to the clinic, not the doctor
update customer_ar_ledger a
   set customer_type = x.customer_type, customer_id = x.customer_id
  from dental_orders o
  join lateral ar_customer_for_doctor(o.doctor_id) x on true
 where a.reference_type = 'dental_order'
   and a.reference_id = o.id
   and a.customer_type = 'doctor'
   and x.customer_type = 'clinic';
