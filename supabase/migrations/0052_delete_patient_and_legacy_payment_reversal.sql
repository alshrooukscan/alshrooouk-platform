-- Two related faults, both about money surviving the record that justified it.
--
-- 1. Deleting a visit tried to find its cash entry by GUESSING - matching on
--    amount, method, date and who logged it - and deliberately did nothing when
--    more than one row matched. A patient logged twice therefore produced two
--    identical entries, the guess found both, and the money stayed on the books
--    after the duplicate visit was removed. That is exactly the 480 EGP still
--    inflating the Scan cash screen.
--
--    Migration 0050 gave new payments a real link (source_payment_id). This
--    extends the reversal to payments recorded before that link existed, using
--    the same match but only when it is unambiguous - so a duplicate is left
--    alone rather than the wrong row being deleted.
--
-- 2. Deleting a PATIENT could not work at all: visits.patient_id is NO ACTION,
--    so the delete failed on a foreign key for anyone who had ever had a visit.
--    Their payments therefore stayed too.

create or replace function public.remove_visit_payment_from_expenses()
returns trigger language plpgsql security definer as $$
declare
  v_method text;
  v_count int;
  v_id uuid;
begin
  -- The precise path: this mirror row exists because of this payment.
  delete from expense_transactions where source_payment_id = old.id;
  if found then return old; end if;

  -- Legacy fallback for payments recorded before source_payment_id existed.
  v_method := lower(regexp_replace(coalesce(old.payment_method, 'cash'), '\s+', '_', 'g'));
  if v_method = 'vodafone_cash' then v_method := 'wallet'; end if;
  if v_method not in ('cash', 'visa', 'instapay', 'wallet') then v_method := 'cash'; end if;

  -- uuid has no min(), so the count and the id are read separately.
  select count(*) into v_count
  from expense_transactions
  where type = 'visit_collection'
    and note = 'Auto-logged from a visit payment'
    and source_payment_id is null
    and amount = old.amount
    and payment_method = v_method
    and entry_date = (old.paid_at at time zone 'utc')::date
    and created_by_id is not distinct from old.created_by_id;

  select id into v_id
  from expense_transactions
  where type = 'visit_collection'
    and note = 'Auto-logged from a visit payment'
    and source_payment_id is null
    and amount = old.amount
    and payment_method = v_method
    and entry_date = (old.paid_at at time zone 'utc')::date
    and created_by_id is not distinct from old.created_by_id
  limit 1;

  -- Only when there is exactly one candidate. Two identical legacy entries
  -- cannot be told apart, and removing the wrong one is worse than leaving
  -- both for a person to look at.
  if v_count = 1 then
    delete from expense_transactions where id = v_id;
  end if;

  return old;
end;
$$;

-- Deleting a patient has to take everything that only existed because of them.
-- Done in the database so every route gets the same behaviour and the whole
-- thing is one transaction: either the patient and all their money go, or
-- nothing does.
create or replace function public.delete_patient_cascade(p_patient_id uuid)
returns void language plpgsql security definer as $$
declare
  v_visit uuid;
begin
  for v_visit in select id from visits where patient_id = p_patient_id loop
    -- Nothing references these once the visit is gone, and they describe an
    -- event that is being removed as a mistake.
    delete from invoices where visit_id = v_visit;
    delete from whatsapp_log where visit_id = v_visit;
    -- A report has its own uploaded file and its own life. It is unlinked, not
    -- destroyed, so a real radiology report is never lost as a side effect.
    update reports set visit_id = null where visit_id = v_visit;
    -- Cascades to visit_payments, which fires the reversal trigger above and
    -- takes the cash entries with it.
    delete from visits where id = v_visit;
  end loop;

  update reports set patient_id = null where patient_id = p_patient_id;
  delete from patients where id = p_patient_id;
end;
$$;
