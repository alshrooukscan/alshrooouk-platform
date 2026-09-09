-- A patient was charged 480 and paid 480, then the same 480 was recorded a
-- second time three minutes later by someone who could not see the first
-- payment. The visit ended up showing 960 collected against a 600 charge, and
-- 480 EGP of cash appeared in the custody figures that nobody was holding.
--
-- Nothing anywhere refused it. The edit form, the registration form and the
-- API all insert into visit_payments directly, so a rule in any one of them
-- would only cover that one route. It belongs here, where every route has to
-- pass through it.

create or replace function public.check_visit_not_overpaid()
returns trigger language plpgsql as $$
declare
  v_due numeric;
  v_paid numeric;
  v_name text;
begin
  select v.amount_due, p.name into v_due, v_name
  from visits v left join patients p on p.id = v.patient_id
  where v.id = new.visit_id;

  -- A visit with no amount set yet cannot be judged - it is not necessarily
  -- free, the figure simply is not known. Blocking payment there would stop
  -- staff taking money they are entitled to take.
  if v_due is null or v_due <= 0 then
    return new;
  end if;

  select coalesce(sum(amount), 0) into v_paid
  from visit_payments
  where visit_id = new.visit_id
    and (tg_op = 'INSERT' or id <> new.id);

  -- Half a piastre of tolerance, so a legitimate final payment is never
  -- rejected by a rounding difference.
  if v_paid + new.amount > v_due + 0.005 then
    raise exception
      'This visit is charged % EGP and % EGP has already been received. Taking % EGP more would collect % EGP too much. Check the payments already recorded before adding another.',
      trim(to_char(v_due, 'FM999999990.00')),
      trim(to_char(v_paid, 'FM999999990.00')),
      trim(to_char(new.amount, 'FM999999990.00')),
      trim(to_char(v_paid + new.amount - v_due, 'FM999999990.00'))
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_visit_payment_not_overpaid on visit_payments;
create trigger trg_visit_payment_not_overpaid
  before insert or update of amount on visit_payments
  for each row execute function check_visit_not_overpaid();

-- Reducing the charge below what has already been received creates the same
-- overpayment from the other direction - applying a discount after the patient
-- has paid in full, for instance. That is a real situation (it means a refund
-- is owed) rather than a mistake to block, so it is recorded rather than
-- refused, and the visit can be found afterwards.
create or replace function public.flag_visit_charge_below_paid()
returns trigger language plpgsql as $$
begin
  if new.amount_due is not null
     and coalesce(new.amount_paid, 0) > new.amount_due + 0.005
     and coalesce(old.amount_due, 0) is distinct from new.amount_due then
    insert into activity_log (actor_name, actor_type, action, entity_type, entity_id, details)
    values ('system', 'system', 'visit_charge_below_amount_paid', 'visit', new.id,
            jsonb_build_object('amount_due', new.amount_due, 'amount_paid', new.amount_paid,
                               'refund_owed', new.amount_paid - new.amount_due));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_visit_charge_below_paid on visits;
create trigger trg_visit_charge_below_paid
  after update of amount_due on visits
  for each row execute function flag_visit_charge_below_paid();
