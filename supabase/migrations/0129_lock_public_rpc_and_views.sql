-- 0129_lock_public_rpc_and_views (30 Oct 2026)
-- Security fix: the public anon key (shipped in every browser) could run 27 SECURITY DEFINER
-- functions with no sign-in (patient delete, password resets that return the new password,
-- sales/stock/debt writes) and read 13 SECURITY DEFINER financial views.
-- Staff sign in with Supabase Auth (every auth user is a staff_profiles row), portals and
-- server routes use the service role, so nothing legitimate runs as anon.

-- 1) Guards that also let the server (service role) through
create or replace function public.assert_staff_or_service() returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then return; end if;
  perform public.require_staff();
end $$;

create or replace function public.assert_admin_or_service() returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then return; end if;
  if not public.is_admin() then raise exception 'Only an admin can do this.'; end if;
end $$;

revoke execute on function public.assert_staff_or_service() from public, anon;
revoke execute on function public.assert_admin_or_service() from public, anon;
grant execute on function public.assert_staff_or_service() to authenticated, service_role;
grant execute on function public.assert_admin_or_service() to authenticated, service_role;

-- 2) Staff-screen functions: add the guard (delete_patient_cascade: admin only, as in the UI)
CREATE OR REPLACE FUNCTION public.create_client_credentials(p_client_id uuid, p_username text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  pwd text;
begin
  perform public.assert_staff_or_service();  -- 0129: staff only, never the public key
  pwd := generate_temp_password();
  update clients
     set username = p_username,
         password_hash = crypt(pwd, gen_salt('bf')),
         must_change_password = true
   where id = p_client_id;
  return pwd;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_doctor_credentials(p_doctor_id uuid, p_username text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  pwd text;
begin
  perform public.assert_staff_or_service();  -- 0129: staff only, never the public key
  pwd := generate_temp_password();
  update doctors
     set username = p_username,
         password_hash = crypt(pwd, gen_salt('bf')),
         must_change_password = true
   where id = p_doctor_id;
  return pwd;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_employee_credentials(p_employee_id uuid, p_username text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  pwd text;
begin
  perform public.assert_staff_or_service();  -- 0129: staff only, never the public key
  pwd := generate_temp_password();
  update employees
     set username = p_username,
         password_hash = crypt(pwd, gen_salt('bf')),
         must_change_password = true
   where id = p_employee_id;
  return pwd;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_patient_credentials(p_patient_id uuid, p_username text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  pwd text;
begin
  perform public.assert_staff_or_service();  -- 0129: staff only, never the public key
  pwd := generate_temp_password();
  insert into patient_auth (patient_id, username, password_hash, must_change_password)
  values (p_patient_id, p_username, crypt(pwd, gen_salt('bf')), true)
  on conflict (patient_id) do update
    set password_hash = excluded.password_hash,
        username = excluded.username,
        must_change_password = true;
  return pwd;
end;
$function$;

CREATE OR REPLACE FUNCTION public.decide_stock_change(p_id uuid, p_status text, p_by_id uuid, p_by_name text, p_note text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare r stock_change_requests; v_reserved numeric; v_now numeric; v_after numeric; v_delta numeric;
begin
  perform public.assert_staff_or_service();  -- 0129: staff only, never the public key
  if p_status not in ('approved','rejected') then raise exception 'A change is either approved or rejected.'; end if;
  if coalesce(p_by_name,'') = '' then raise exception 'A decision must carry the name of the person making it.'; end if;

  select * into r from stock_change_requests where id = p_id for update;
  if r is null then raise exception 'That request no longer exists.'; end if;
  if r.status <> 'pending' then raise exception 'That was already %.', r.status; end if;

  if p_status = 'approved' then
    if r.field = 'qty_remaining' then
      select qty_remaining, coalesce(qty_reserved,0) into v_now, v_reserved
        from stock_items where id = r.stock_item_id for update;
      v_delta := coalesce(r.delta, r.new_value - r.old_value);
      v_after := coalesce(v_now, 0) + v_delta;
      if v_after < 0 then
        raise exception 'This takes % off, but only % are in stock now. Reject it and ask for a new count.', abs(v_delta), v_now;
      end if;
      if v_after < v_reserved then
        raise exception '% unit(s) are reserved for orders, so the quantity cannot go to %.', v_reserved, v_after;
      end if;
      perform set_config('app.stock_source', 'approved_adjustment', true);
      update stock_items set qty_remaining = v_after where id = r.stock_item_id;
      update stock_change_requests set qty_at_decision = v_now, qty_after = v_after where id = p_id;
    else
      execute format('update stock_items set %I = $1 where id = $2', r.field) using r.new_value, r.stock_item_id;
    end if;
  end if;

  update stock_change_requests
     set status = p_status, decided_by_id = p_by_id, decided_by_name = p_by_name,
         decided_at = now(), decision_note = p_note
   where id = p_id;
  select * into r from stock_change_requests where id = p_id;
  return to_json(r);
end $function$;

CREATE OR REPLACE FUNCTION public.delete_patient_cascade(p_patient_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare v_visit uuid;
begin
  perform public.assert_admin_or_service();  -- 0129: staff only, never the public key
  for v_visit in select id from visits where patient_id = p_patient_id loop
    delete from invoices where visit_id = v_visit;
    delete from whatsapp_log where visit_id = v_visit;
    -- An unfinished report with nothing uploaded goes with its visit; one
    -- with a file, or completed, is kept and unlinked so it is never lost.
    delete from reports
     where visit_id = v_visit and status <> 'completed'
       and report_file_url is null and client_uploaded_file_url is null;
    update reports set visit_id = null where visit_id = v_visit;
    delete from visits where id = v_visit;
  end loop;
  update reports set patient_id = null where patient_id = p_patient_id;
  delete from patients where id = p_patient_id;
end $function$;

CREATE OR REPLACE FUNCTION public.record_internal_purchase(p_buyer_brand text, p_seller_brand text, p_amount numeric, p_payment_method text, p_employee_id uuid DEFAULT NULL::uuid, p_cost_amount numeric DEFAULT NULL::numeric, p_note text DEFAULT NULL::text, p_staff_id uuid DEFAULT NULL::uuid, p_staff_name text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_id      uuid;
    v_held    numeric;
    v_method  text;
BEGIN
  perform public.assert_staff_or_service();  -- 0129: staff only, never the public key
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Enter the amount of the purchase.';
    END IF;
    IF p_buyer_brand = p_seller_brand THEN
        RAISE EXCEPTION 'A business cannot buy from itself.';
    END IF;

    v_method := lower(coalesce(p_payment_method,'cash'));
    IF v_method NOT IN ('cash','postponed') THEN
        RAISE EXCEPTION 'Internal purchases are cash or postponed only.';
    END IF;

    IF v_method = 'cash' THEN
        IF p_employee_id IS NULL THEN
            RAISE EXCEPTION 'Who is handling the cash for this purchase?';
        END IF;
        -- The employee must actually be holding enough of the buying
        -- business's cash, otherwise the shift would invent money.
        SELECT coalesce(balance,0) INTO v_held
        FROM public.employee_cash_balances
        WHERE employee_id = p_employee_id AND brand = p_buyer_brand;

        IF coalesce(v_held,0) < p_amount THEN
            RAISE EXCEPTION
              'They are only holding % of %s cash, which is less than %.',
              to_char(coalesce(v_held,0),'FM999999990.00'), p_buyer_brand,
              to_char(p_amount,'FM999999990.00');
        END IF;
    END IF;

    INSERT INTO public.internal_purchases (
        buyer_brand, seller_brand, amount, cost_amount, payment_method,
        handled_by_employee_id, note, created_by_id, created_by_name)
    VALUES (p_buyer_brand, p_seller_brand, p_amount, p_cost_amount, v_method,
        CASE WHEN v_method = 'cash' THEN p_employee_id END,
        p_note, p_staff_id, p_staff_name)
    RETURNING id INTO v_id;

    IF v_method = 'cash' THEN
        -- THE DUAL-ROLE SHIFT (spec section 4).
        -- Same person, same physical notes. The money simply stops belonging
        -- to the buying business and starts belonging to the selling one.
        INSERT INTO public.expense_transactions (
            type, brand, amount, payment_method, from_employee_id, status,
            note, confirmed_by_id, confirmed_by_name, confirmed_at,
            created_by_id, created_by_name)
        VALUES ('cash_out', p_buyer_brand, p_amount, 'cash', p_employee_id, 'confirmed',
            'Internal purchase from ' || p_seller_brand, p_staff_id, p_staff_name, now(),
            p_staff_id, p_staff_name);

        INSERT INTO public.expense_transactions (
            type, brand, amount, payment_method, to_employee_id, status,
            note, confirmed_by_id, confirmed_by_name, confirmed_at,
            created_by_id, created_by_name)
        VALUES ('stock_sale', p_seller_brand, p_amount, 'cash', p_employee_id, 'confirmed',
            'Internal sale to ' || p_buyer_brand, p_staff_id, p_staff_name, now(),
            p_staff_id, p_staff_name);
    ELSE
        -- Postponed: the buying business owes the selling one.
        INSERT INTO public.customer_ar_ledger (
            customer_type, internal_brand, brand, direction, amount,
            reference_type, reference_id, note, created_by_id, created_by_name)
        VALUES ('internal', p_buyer_brand, p_seller_brand, 'charge', p_amount,
            'internal_purchase', v_id, p_note, p_staff_id, p_staff_name);
    END IF;

    RETURN json_build_object('purchase_id', v_id, 'method', v_method, 'amount', p_amount);
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_stock_count(p_item_id uuid, p_physical_qty numeric)
 RETURNS stock_counts
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  result stock_counts;
  expected numeric;
begin
  perform public.assert_staff_or_service();  -- 0129: staff only, never the public key
  select qty_remaining into expected from stock_items where id = p_item_id;
  insert into stock_counts (item_id, physical_qty, expected_qty, variance)
  values (p_item_id, p_physical_qty, expected, p_physical_qty - expected)
  returning * into result;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_stock_transaction(p_item_id uuid, p_type text, p_qty numeric, p_unit_price numeric, p_amount_paid numeric DEFAULT NULL::numeric, p_payment_status text DEFAULT 'paid'::text)
 RETURNS stock_items
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare result stock_items; v_total numeric; v_paid numeric;
begin
  perform public.assert_staff_or_service();  -- 0129: staff only, never the public key
  v_total := p_qty * p_unit_price;
  v_paid := coalesce(p_amount_paid, v_total);
  insert into stock_transactions (item_id, type, qty, unit_price, total, amount_paid, payment_status)
  values (p_item_id, p_type, p_qty, p_unit_price, v_total, v_paid, p_payment_status);
  perform set_config('app.stock_source', p_type, true);
  if p_type = 'purchase' then
    update stock_items set qty_remaining = coalesce(qty_remaining,0) + p_qty, purchase_price = p_unit_price where id = p_item_id;
  elsif p_type = 'sale' then
    update stock_items set qty_remaining = coalesce(qty_remaining,0) - p_qty where id = p_item_id;
  end if;
  select * into result from stock_items where id = p_item_id;
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.record_stock_transaction(p_item_id uuid, p_type text, p_qty numeric, p_unit_price numeric, p_amount_paid numeric DEFAULT NULL::numeric, p_payment_status text DEFAULT 'paid'::text, p_payment_method text DEFAULT 'cash'::text)
 RETURNS stock_items
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare result stock_items; v_total numeric; v_paid numeric; v_category text; v_brand text;
begin
  perform public.assert_staff_or_service();  -- 0129: staff only, never the public key
  v_total := p_qty * p_unit_price;
  v_paid := coalesce(p_amount_paid, v_total);
  insert into stock_transactions (item_id, type, qty, unit_price, total, amount_paid, payment_status, payment_method)
  values (p_item_id, p_type, p_qty, p_unit_price, v_total, v_paid, p_payment_status, p_payment_method);
  perform set_config('app.stock_source', p_type, true);
  if p_type = 'purchase' then
    update stock_items set qty_remaining = coalesce(qty_remaining,0) + p_qty, purchase_price = p_unit_price where id = p_item_id;
  elsif p_type = 'sale' then
    update stock_items set qty_remaining = coalesce(qty_remaining,0) - p_qty where id = p_item_id;
    select category into v_category from stock_items where id = p_item_id;
    v_brand := case v_category when 'dental' then 'dental_stock' when 'el3awama' then 'el3awama_stock' else null end;
    if v_brand is not null and v_paid > 0 then
      insert into expense_transactions (type, brand, amount, payment_method, entry_date, status, note)
      values ('stock_sale', v_brand, v_paid, p_payment_method, current_date, 'confirmed', 'Stock sale, item ' || p_item_id);
    end if;
  end if;
  select * into result from stock_items where id = p_item_id;
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.register_patient_visit(p_patient_id uuid, p_name text, p_mobile text, p_dob date, p_email text, p_preferred_contact text, p_doctor_id uuid, p_branch_id uuid, p_scan_types text[], p_exam_type_ids uuid[], p_amount_due numeric, p_discount_pct numeric, p_discount_reason text, p_notes text, p_amount_paid numeric, p_payment_method text, p_created_by_id uuid, p_created_by_name text)
 RETURNS TABLE(patient_id uuid, visit_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_patient uuid := p_patient_id;
  v_visit uuid;
begin
  perform public.assert_staff_or_service();  -- 0129: staff only, never the public key
  if v_patient is null then
    if coalesce(trim(p_name), '') = '' then
      raise exception 'A patient needs a name.';
    end if;
    insert into patients (name, mobile, dob, email, preferred_contact)
    values (p_name, p_mobile, p_dob, p_email, p_preferred_contact)
    returning id into v_patient;
  end if;

  insert into visits (patient_id, doctor_id, branch_id, scan_types, exam_type_ids,
                      amount_due, discount_pct, discount_reason, notes)
  values (v_patient, p_doctor_id, p_branch_id, p_scan_types, p_exam_type_ids,
          p_amount_due, p_discount_pct, p_discount_reason, p_notes)
  returning id into v_visit;

  if coalesce(p_amount_paid, 0) > 0 then
    insert into visit_payments (visit_id, amount, payment_method, created_by_id, created_by_name)
    values (v_visit, p_amount_paid, p_payment_method, p_created_by_id, p_created_by_name);
  end if;

  update patients p
     set last_visit_date = greatest(coalesce(p.last_visit_date, '1900-01-01'::date), current_date)
   where p.id = v_patient;

  return query select v_patient, v_visit;
end;
$function$;

CREATE OR REPLACE FUNCTION public.request_stock_change(p_item_id uuid, p_field text, p_new_value numeric, p_by_id uuid, p_by_name text, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_old numeric; v_reserved numeric; v_id uuid; v_delta numeric;
begin
  perform public.assert_staff_or_service();  -- 0129: staff only, never the public key
  if p_field not in ('qty_remaining','purchase_price','sale_price') then
    raise exception 'That field is not one that needs approval.';
  end if;
  if p_new_value is null or p_new_value < 0 then
    raise exception 'That needs to be a number, and not negative.';
  end if;
  execute format('select %I, coalesce(qty_reserved,0) from stock_items where id = $1', p_field)
    into v_old, v_reserved using p_item_id;
  if v_old is null and not exists (select 1 from stock_items where id = p_item_id) then
    raise exception 'That item no longer exists.';
  end if;
  if coalesce(v_old, -1) = p_new_value then raise exception 'That is already the value.'; end if;
  if p_field = 'qty_remaining' then
    if p_new_value < v_reserved then
      raise exception 'That item has % unit(s) reserved for orders already placed, so the count cannot go below that.', v_reserved;
    end if;
    v_delta := p_new_value - coalesce(v_old, 0);
  end if;

  insert into stock_change_requests
    (stock_item_id, field, old_value, new_value, delta, reason, requested_by_id, requested_by_name)
  values (p_item_id, p_field, v_old, p_new_value, v_delta, p_reason, p_by_id, p_by_name)
  returning id into v_id;
  return json_build_object('id', v_id, 'old_value', v_old, 'new_value', p_new_value, 'delta', v_delta, 'status', 'pending');
end $function$;

-- 3) Staff-screen functions: signed-in users and the server only
do $r$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('create_client_credentials','create_doctor_credentials','create_employee_credentials','create_patient_credentials','decide_stock_change','record_internal_purchase','record_stock_count','record_stock_transaction','register_patient_visit','request_stock_change','delete_patient_cascade') loop
    execute format('revoke execute on function %s from public, anon', f); execute format('grant execute on function %s to authenticated, service_role', f);
  end loop; end $r$;

-- 4) Server-only functions (portal login, dental orders, counter sales, debt collection, unused): server only
do $r$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('cancel_dental_order','fulfill_dental_order','settle_dental_order','paymob_reconciliation_totals','place_dental_order','record_counter_sale','record_debt_payment','verify_client_credentials','verify_doctor_credentials','verify_employee_credentials','verify_employee_password','verify_patient_credentials','reset_client_password','apply_stock_count','split_visit') loop
    execute format('revoke execute on function %s from public, anon, authenticated', f); execute format('grant execute on function %s to service_role', f);
  end loop; end $r$;

-- 5) Functions that already require staff: close them to the public key too
--    (is_admin, current_staff, require_staff stay callable: RLS policies use them and they return nothing for anon)
do $r$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('correct_payment_method','create_purchase_order','decide_sale_return','edit_purchase_order','get_returnable_sale','mark_bug_replies_seen','notification_counts','record_ar_charge','record_cash_conversion','record_supplier_payment','request_sale_return','return_to_supplier','void_purchase_order','void_supplier_payment') loop
    execute format('revoke execute on function %s from public, anon', f); execute format('grant execute on function %s to authenticated, service_role', f);
  end loop; end $r$;

-- 6) Financial views: never readable with the public key
revoke all on public.brand_transfer_totals from anon;
revoke all on public.cash_handover_prompts from anon;
revoke all on public.customer_ar_balances from anon;
revoke all on public.daily_revenue_by_channel from anon;
revoke all on public.employee_cash_balances from anon;
revoke all on public.employee_cash_keeper_streams from anon;
revoke all on public.employee_tab_balances from anon;
revoke all on public.internal_ar_positions from anon;
revoke all on public.internal_netting from anon;
revoke all on public.internal_profit_elimination from anon;
revoke all on public.staff_custody_monitor from anon;
revoke all on public.stock_available from anon;
revoke all on public.supplier_credit_balances from anon;

-- 7) New functions from now on are not callable by the public key unless granted on purpose
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;
