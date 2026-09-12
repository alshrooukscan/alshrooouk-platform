-- 0084: a new stock item gets the next code in its own stock's sequence.
--
-- The Add Item form asked staff to invent a code, offering "DEN-LD-001" as an
-- example, while every code actually in use is a plain number: dental runs
-- 1-246 and el3awama 1-59, both gapless. Left to a person at a counter that
-- sequence would not survive the week, and a typed duplicate would sit against
-- somebody else's stock line.
--
-- Done in the database rather than the form so every route gets one - the
-- modal, an import, a fix applied by hand later. Numbering is per stock,
-- because the two sequences are independent and both start at 1.
--
-- An explicitly supplied code is still honoured. This fills a blank; it does
-- not overrule somebody who knows what they are doing.

create or replace function next_stock_item_code() returns trigger
language plpgsql as $$
begin
  if coalesce(trim(new.item_code), '') = '' then
    select coalesce(max(item_code::int), 0) + 1
      into new.item_code
      from stock_items
     where category is not distinct from new.category
       and item_code ~ '^[0-9]+$';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_next_stock_item_code on stock_items;
create trigger trg_next_stock_item_code
  before insert on stock_items
  for each row execute function next_stock_item_code();
