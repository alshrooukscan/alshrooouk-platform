-- 0098: duplicate stock counts removed and prevented; stock value changes need
-- an admin.
--
-- Two problems, both about the same thing: numbers that decide money changing
-- without anybody checking.
--
-- 1. The same count was being written several times. All bond universal has
--    five identical rows one second apart on 7 September and four on the 9th -
--    a save button pressed repeatedly, not nine separate losses. Under the
--    stock deduction rule at sale price that would have charged Doaa 93,480
--    EGP for an item short by at most five units, worth 11,400. Roughly two
--    years of her salary for one bottle of bonding agent.
--
--    The duplicates are collapsed to one row per item per count, keeping the
--    earliest, and a trigger stops an identical count being written twice
--    inside a minute. A genuine recount a minute later still records.
--
-- 2. Quantity, purchase price and sale price now go through an approval. These
--    three decide what stock is worth, what a shortfall costs an employee, and
--    what a clinic is charged. They were editable in place by anyone with
--    stock access, and the only trace was an activity log entry nobody reads.

create table if not exists stock_counts_duplicates_backup_0098 as
select * from stock_counts where false;

with ranked as (
  select id, item_id, physical_qty, expected_qty, counted_at,
         row_number() over (
           partition by item_id, physical_qty, expected_qty, date_trunc('minute', counted_at)
           order by counted_at
         ) as rn
  from stock_counts
)
insert into stock_counts_duplicates_backup_0098
select c.* from stock_counts c join ranked r on r.id = c.id where r.rn > 1;

delete from stock_counts c
using stock_counts_duplicates_backup_0098 b
where c.id = b.id;

-- Identical count, same minute, already recorded: the second press is the same
-- fact stated twice, not a new one.
create or replace function stock_count_not_a_repeat()
returns trigger
language plpgsql as $$
begin
  if exists (
    select 1 from stock_counts c
    where c.item_id = new.item_id
      and c.physical_qty is not distinct from new.physical_qty
      and c.expected_qty is not distinct from new.expected_qty
      and c.counted_at > now() - interval '1 minute'
  ) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stock_count_not_a_repeat on stock_counts;
create trigger trg_stock_count_not_a_repeat
  before insert on stock_counts
  for each row execute function stock_count_not_a_repeat();

-- Proposed changes to the three numbers that decide money.
create table if not exists stock_change_requests (
  id uuid primary key default gen_random_uuid(),
  stock_item_id uuid not null references stock_items(id) on delete cascade,
  field text not null check (field in ('qty_remaining','purchase_price','sale_price')),
  old_value numeric,
  new_value numeric,
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by_id uuid,
  requested_by_name text,
  requested_at timestamptz not null default now(),
  decided_by_id uuid,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text
);

create index if not exists stock_change_requests_pending_idx
  on stock_change_requests (status, requested_at desc);

create or replace function request_stock_change(
  p_item_id uuid, p_field text, p_new_value numeric,
  p_by_id uuid, p_by_name text, p_reason text default null
) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old numeric; v_reserved numeric; v_id uuid;
begin
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
  if coalesce(v_old, -1) = p_new_value then
    raise exception 'That is already the value.';
  end if;

  -- Checked when it is proposed as well as when it is applied, so somebody is
  -- told now rather than after waiting for an approval that cannot work.
  if p_field = 'qty_remaining' and p_new_value < v_reserved then
    raise exception 'That item has % unit(s) reserved for orders already placed, so the count cannot go below that.', v_reserved;
  end if;

  insert into stock_change_requests
    (stock_item_id, field, old_value, new_value, reason, requested_by_id, requested_by_name)
  values (p_item_id, p_field, v_old, p_new_value, p_reason, p_by_id, p_by_name)
  returning id into v_id;

  return json_build_object('id', v_id, 'old_value', v_old, 'new_value', p_new_value, 'status', 'pending');
end;
$$;

create or replace function decide_stock_change(
  p_id uuid, p_status text, p_by_id uuid, p_by_name text, p_note text default null
) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare r stock_change_requests; v_reserved numeric;
begin
  if p_status not in ('approved','rejected') then
    raise exception 'A change is either approved or rejected.';
  end if;
  if coalesce(p_by_name,'') = '' then
    raise exception 'A decision must carry the name of the person making it.';
  end if;

  select * into r from stock_change_requests where id = p_id;
  if r is null then raise exception 'That request no longer exists.'; end if;
  if r.status <> 'pending' then raise exception 'That was already %.', r.status; end if;

  if p_status = 'approved' then
    -- Re-checked at the moment of approval: an order placed while this sat
    -- waiting could have reserved units that were free when it was proposed.
    select coalesce(qty_reserved,0) into v_reserved from stock_items where id = r.stock_item_id;
    if r.field = 'qty_remaining' and r.new_value < v_reserved then
      raise exception 'Since this was requested, % unit(s) have been reserved for orders. The count cannot go below that.', v_reserved;
    end if;
    execute format('update stock_items set %I = $1 where id = $2', r.field)
      using r.new_value, r.stock_item_id;
  end if;

  update stock_change_requests
     set status = p_status, decided_by_id = p_by_id, decided_by_name = p_by_name,
         decided_at = now(), decision_note = p_note
   where id = p_id;

  select * into r from stock_change_requests where id = p_id;
  return to_json(r);
end;
$$;
-- 0098b: the dedupe window was a minute, and the repeated presses straddled a
-- minute boundary - 12:32:59 and 12:33:05 - so one survivor per minute was
-- kept instead of one per count. Collapsed per day instead.
--
-- Same item, same shelf count, same expected figure, same day is one fact
-- however many times it was saved. A recount later that day finding the same
-- numbers adds nothing, and a recount finding different numbers has a
-- different physical_qty and is kept.

with ranked as (
  select id, row_number() over (
           partition by item_id, physical_qty, expected_qty, counted_at::date
           order by counted_at
         ) as rn
  from stock_counts
)
insert into stock_counts_duplicates_backup_0098
select c.* from stock_counts c join ranked r on r.id = c.id where r.rn > 1;

delete from stock_counts c
using stock_counts_duplicates_backup_0098 b
where c.id = b.id;

create or replace function stock_count_not_a_repeat()
returns trigger
language plpgsql as $$
begin
  if exists (
    select 1 from stock_counts c
    where c.item_id = new.item_id
      and c.physical_qty is not distinct from new.physical_qty
      and c.expected_qty is not distinct from new.expected_qty
      and c.counted_at::date = coalesce(new.counted_at, now())::date
  ) then
    return null;
  end if;
  return new;
end;
$$;
