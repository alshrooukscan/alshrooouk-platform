-- 0086: nobody can hand over cash they are not holding.
--
-- Doaa Tarek Mohamed holds 6,070 EGP for Scan and has 26,040 EGP of transfers
-- waiting to be confirmed - 19,970 more than exists. Nothing stopped her
-- creating them, because employee_cash_balances counts confirmed rows only, so
-- a pending transfer does not reduce the balance it is drawn against. Three
-- transfers of 6,000 each would every one of them look affordable on their own.
--
-- The check is against what is genuinely available: the confirmed balance less
-- anything already pending out. Pending rows have to count, or the gap simply
-- reappears the moment somebody logs two at once.
--
-- Checked twice. At creation, so the mistake is caught while the person is
-- still looking at the screen and can correct it. And again when a transfer is
-- confirmed, because a row raised this morning may no longer be affordable by
-- the time it is approved this afternoon.
--
-- Only cash leaves a hand. A cash_out settled by card or InstaPay moves no
-- notes, so it is not counted here.

create or replace function cash_out_must_be_held() returns trigger
language plpgsql as $$
declare
  v_balance numeric;
  v_pending numeric;
  v_available numeric;
  v_name text;
  v_takes_cash boolean;
begin
  v_takes_cash :=
    new.from_employee_id is not null
    and (
      new.type in ('cash_transfer', 'cash_collection')
      or (new.type = 'cash_out' and new.payment_method = 'cash')
    );

  if not v_takes_cash then return new; end if;

  -- only when the row is being raised, or is becoming confirmed
  if TG_OP = 'UPDATE' and not (new.status = 'confirmed' and old.status is distinct from 'confirmed') then
    return new;
  end if;
  if TG_OP = 'INSERT' and new.status not in ('pending', 'confirmed') then
    return new;
  end if;

  select coalesce(balance, 0) into v_balance
    from employee_cash_balances
   where employee_id = new.from_employee_id and brand = new.brand;

  -- When a row is being RAISED, everything already waiting counts against the
  -- balance, otherwise three transfers of 6,000 each look affordable on their
  -- own and together empty a hand holding 6,070.
  --
  -- When a row is being CONFIRMED, only the confirmed balance matters. The
  -- other pending rows have not happened and may never happen - counting them
  -- here would let one mistaken 20,000 transfer block a perfectly good 4,480
  -- beside it, which is the opposite of helpful. Each is checked in turn as it
  -- is confirmed, and the balance moves as each one lands.
  if TG_OP = 'INSERT' then
    select coalesce(sum(amount), 0) into v_pending
      from expense_transactions
     where from_employee_id = new.from_employee_id
       and brand = new.brand
       and status = 'pending'
       and id is distinct from new.id
       and (type in ('cash_transfer', 'cash_collection')
            or (type = 'cash_out' and payment_method = 'cash'));
  else
    v_pending := 0;
  end if;

  v_available := coalesce(v_balance, 0) - v_pending;

  if new.amount > v_available then
    select name into v_name from employees where id = new.from_employee_id;
    -- RAISE only substitutes %, so every number is formatted before it gets
    -- here; '%.2f' would print a literal '.2f' beside the value.
    if v_pending > 0 then
      raise exception
        '% is holding % EGP and already has % EGP waiting to be confirmed, so only % EGP is free. This % of % EGP is more than that. Confirm or reject what is already waiting first.',
        coalesce(v_name, 'That employee'),
        to_char(coalesce(v_balance, 0), 'FM999,999,990.00'),
        to_char(v_pending, 'FM999,999,990.00'),
        to_char(v_available, 'FM999,999,990.00'),
        replace(new.type, '_', ' '),
        to_char(new.amount, 'FM999,999,990.00')
        using errcode = 'check_violation';
    else
      raise exception
        '% is holding % EGP. This % of % EGP is more than that.',
        coalesce(v_name, 'That employee'),
        to_char(coalesce(v_balance, 0), 'FM999,999,990.00'),
        replace(new.type, '_', ' '),
        to_char(new.amount, 'FM999,999,990.00')
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_cash_out_must_be_held on expense_transactions;
create trigger trg_cash_out_must_be_held
  before insert or update on expense_transactions
  for each row execute function cash_out_must_be_held();
