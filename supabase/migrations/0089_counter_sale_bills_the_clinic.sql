-- 0089: a counter sale bills the clinic, like every other charge.
--
-- Doaa reported that clinic 237 placed an order and it never reached their
-- account. It did reach an account - just not one anything totals. Two counter
-- sales, 2,780 and 540 EGP, were charged to Dr. Ahmad Mamon personally, while
-- the clinic's own opening balance of 6,600 EGP sits against clinic 237. The
-- doctor's page shows the clinic's balance, so the charges were invisible.
--
-- This is the same fault fixed in 0069 and 0070 for the two delivery paths,
-- in a third place nobody looked: the counter sale. The page sends
-- customer_type 'doctor' outright whenever a doctor is chosen.
--
-- Resolved in the function rather than the page, so every caller gets it - the
-- counter sale screen, anything built on the RPC later. Where the doctor's
-- clinic_code matches a clinic the charge goes to the clinic; where it does
-- not, it stays with the doctor rather than being lost. Only 59 of 166 doctors
-- resolve today, so that fallback is not a rare case.
--
-- The two existing charges are moved onto clinic 237, which is what Doaa was
-- looking for.

CREATE OR REPLACE FUNCTION public.record_ar_charge(p_customer_type text, p_customer_id uuid, p_brand text, p_amount numeric, p_reference_type text DEFAULT NULL::text, p_reference_id uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text, p_staff_id uuid DEFAULT NULL::uuid, p_staff_name text DEFAULT NULL::text, p_override_limit boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

    -- A doctor who belongs to a clinic is billed as that clinic. Placed after
    -- the credit-limit check on purpose: the limit is set against the doctor,
    -- so swapping earlier would quietly stop enforcing it. The two delivery
    -- paths were corrected in 0069 and 0070; the counter sale was missed, which
    -- is how clinic 237's orders landed on a doctor's account nothing totals.
    -- Doing it here means no caller has to remember.
    IF p_customer_type = 'doctor' AND p_customer_id IS NOT NULL THEN
        SELECT a.customer_type, a.customer_id
          INTO p_customer_type, p_customer_id
          FROM public.ar_customer_for_doctor(p_customer_id) a;
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
$function$
;

-- move what was already charged to a doctor who belongs to a clinic
create table if not exists ar_reassigned_backup_0089 as
  select a.*, now() as moved_at from customer_ar_ledger a where false;

insert into ar_reassigned_backup_0089
select a.*, now() from customer_ar_ledger a
where a.customer_type = 'doctor'
  and exists (select 1 from doctors d join clinics c on c.code = d.clinic_code where d.id = a.customer_id);

update customer_ar_ledger a
   set customer_type = 'clinic', customer_id = c.id
  from doctors d
  join clinics c on c.code = d.clinic_code
 where a.customer_type = 'doctor' and d.id = a.customer_id;
