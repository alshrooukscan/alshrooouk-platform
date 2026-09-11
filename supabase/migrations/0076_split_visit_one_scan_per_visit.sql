-- 0076: a visit holds one scan. Several scans mean several visits.
--
-- A patient having a CBCT and a panoramic in one sitting was recorded as a
-- single visit carrying both, so the two shared one set of steps, one report
-- row and one charge. Each scan is its own piece of work with its own stages
-- and its own timing, and the steps added in 0075 made that plain: a visit
-- with two scan types showed one merged timeline for two different jobs.
--
-- Split visits stay tied together by visit_group_id, so the patient record can
-- still show them as the one sitting they were, and so a single payment can be
-- traced across the records it was divided between.
--
-- The money follows the scans. Each new visit is charged its own share of the
-- original, in proportion to the list prices, which preserves whatever
-- discount was applied to the whole. Payments are divided the same way and
-- the last visit absorbs the rounding, so the parts always add back to exactly
-- what was charged and exactly what was taken - never a piaster more or less.
--
-- Files stay with the first visit. They were uploaded against the sitting, not
-- against one scan, and moving them would break the Drive links already sent.

alter table visits add column if not exists visit_group_id uuid;
create index if not exists idx_visits_group on visits(visit_group_id);

create or replace function split_visit(p_visit_id uuid, p_staff_id uuid default null, p_staff_name text default null)
returns table (visit_id uuid, scan_name text, amount_due numeric)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v visits;
  v_names text[];
  v_count int;
  v_group uuid;
  v_total_list numeric := 0;
  v_prices numeric[] := '{}';
  v_price numeric;
  v_new_id uuid;
  v_share numeric;
  v_allocated numeric := 0;
  v_pay record;
  v_pay_alloc numeric;
  v_pay_share numeric;
  i int;
begin
  select * into v from visits where id = p_visit_id for update;
  if v.id is null then raise exception 'That visit no longer exists.'; end if;

  v_names := v.scan_types;
  v_count := coalesce(array_length(v_names, 1), 0);
  if v_count < 2 then
    return query select v.id, v_names[1], v.amount_due;
    return;
  end if;

  -- list prices decide the shares, so the split mirrors what each scan is worth
  for i in 1 .. v_count loop
    select et.price into v_price
      from exam_types et
     where et.name = v_names[i]
       and (et.branch_id is null or v.branch_id is null or et.branch_id = v.branch_id)
     limit 1;
    v_price := coalesce(v_price, 0);
    v_prices := v_prices || v_price;
    v_total_list := v_total_list + v_price;
  end loop;

  -- no usable prices: divide evenly rather than refuse or invent a number
  if v_total_list = 0 then
    v_prices := '{}';
    for i in 1 .. v_count loop v_prices := v_prices || 1::numeric; end loop;
    v_total_list := v_count;
  end if;

  v_group := coalesce(v.visit_group_id, gen_random_uuid());

  for i in 2 .. v_count loop
    v_share := round(coalesce(v.amount_due, 0) * v_prices[i] / v_total_list, 2);

    insert into visits (
      patient_id, doctor_id, branch_id, scan_types, exam_type_ids,
      exam_date, exam_time, amount_due, discount_pct, discount_reason, notes,
      visit_group_id, created_at
    )
    select v.patient_id, v.doctor_id, v.branch_id,
           array[v_names[i]],
           case when v.exam_type_ids is not null and array_length(v.exam_type_ids,1) >= i
                then array[v.exam_type_ids[i]] else null end,
           v.exam_date, v.exam_time, v_share, v.discount_pct, v.discount_reason, v.notes,
           v_group, v.created_at
    returning id into v_new_id;

    v_allocated := v_allocated + v_share;

    -- each payment is divided across the same shares
    for v_pay in select * from visit_payments where visit_payments.visit_id = p_visit_id loop
      v_pay_share := round(v_pay.amount * v_prices[i] / v_total_list, 2);
      if v_pay_share > 0 then
        insert into visit_payments (visit_id, amount, payment_method, paid_at, created_by_id, created_by_name)
        values (v_new_id, v_pay_share, v_pay.payment_method, v_pay.paid_at, v_pay.created_by_id, v_pay.created_by_name);
      end if;
    end loop;

    return query select v_new_id, v_names[i], v_share;
  end loop;

  -- the first visit keeps the remainder, so the parts add back exactly
  update visits
     set scan_types = array[v_names[1]],
         exam_type_ids = case when v.exam_type_ids is not null and array_length(v.exam_type_ids,1) >= 1
                              then array[v.exam_type_ids[1]] else null end,
         amount_due = coalesce(v.amount_due, 0) - v_allocated,
         visit_group_id = v_group
   where id = p_visit_id;

  for v_pay in select * from visit_payments where visit_payments.visit_id = p_visit_id loop
    select coalesce(sum(p2.amount), 0) into v_pay_alloc
      from visit_payments p2
      join visits v2 on v2.id = p2.visit_id
     where v2.visit_group_id = v_group and v2.id <> p_visit_id
       and p2.paid_at = v_pay.paid_at and p2.payment_method = v_pay.payment_method;
    update visit_payments set amount = v_pay.amount - v_pay_alloc where id = v_pay.id;
  end loop;

  return query
    select v.id, v_names[1], (select vs.amount_due from visits vs where vs.id = p_visit_id);
end;
$$;
