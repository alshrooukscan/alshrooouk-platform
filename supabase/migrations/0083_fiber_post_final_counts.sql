-- 0083: the fiber post family, final counts from the client's team.
--
--   27  fiber post            -> 1   (never on the sheet; drifted by one unit)
--   28  fiber post china      -> 0   (sheet said 1; the team has since re-counted)
--   29  fiber post kit turkey -> 0   (already 0; recorded so the set is settled)
--
-- Code 28 is a correction to the original sheet rather than a new count, which
-- is why it is applied explicitly instead of skipped as unchanged: a later
-- count from the people standing at the shelf outranks an earlier one.
--
-- These three names sit next to each other and are easy to confuse, so each is
-- matched on its code AND its exact name; a mismatch aborts rather than
-- correcting the wrong shelf.

create table if not exists stock_count_backup_0083 (
  stock_item_id uuid primary key,
  item_name text,
  qty_before numeric,
  ledger_before numeric,
  counted numeric,
  applied_at timestamptz not null default now()
);

do $$
declare
  r record;
  v_id uuid;
begin
  for r in
    select * from (values
      ('27', 'fiber post', 1::numeric),
      ('28', 'fiber post china', 0::numeric),
      ('29', 'fiber post kit turkey', 0::numeric)
    ) as t(code, nm, counted)
  loop
    select id into v_id from stock_items
     where category = 'dental' and item_code::text = r.code and name = r.nm;

    if v_id is null then
      raise exception 'No dental item with code % named "%" - nothing applied.', r.code, r.nm;
    end if;

    insert into stock_count_backup_0083 (stock_item_id, item_name, qty_before, ledger_before, counted)
    select v_id, r.nm, si.qty_remaining,
           coalesce((select sum(b.qty_remaining) from stock_batches b where b.stock_item_id = si.id), 0),
           r.counted
      from stock_items si where si.id = v_id
    on conflict (stock_item_id) do nothing;

    perform apply_stock_count(v_id, r.counted, 'Physical count, September 2026 - final confirmation');
  end loop;
end $$;
