-- 0063: register a patient, their visit and their payment as one act.
--
-- Registration writes three rows in sequence from the browser - patient, then
-- visit, then payment - with nothing to undo the earlier ones if a later one
-- fails. That is not hypothetical: the ReferenceError fixed earlier today
-- threw after the patient and the visit were already saved, which is exactly
-- how half-registered patients appear.
--
-- One call, one transaction. Either all three exist or none do.
--
-- The payment stays a visit_payments row rather than fields on the visit:
-- recompute_visit_payment reads it to set the visit's status, and
-- sync_visit_payment_to_expenses reads it to put the cash in the named
-- employee's hand. Writing the visit's payment fields directly would leave
-- the money invisible to both.
create or replace function register_patient_visit(
  p_patient_id uuid,            -- existing patient, or null to create one
  p_name text, p_mobile text, p_dob date, p_email text, p_preferred_contact text,
  p_doctor_id uuid, p_branch_id uuid,
  p_scan_types text[], p_exam_type_ids uuid[],
  p_amount_due numeric, p_discount_pct numeric, p_discount_reason text, p_notes text,
  p_amount_paid numeric, p_payment_method text,
  p_created_by_id uuid, p_created_by_name text
) returns table (patient_id uuid, visit_id uuid)
language plpgsql security definer as $$
declare
  v_patient uuid := p_patient_id;
  v_visit uuid;
begin
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
$$;
