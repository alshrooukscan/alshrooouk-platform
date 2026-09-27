-- 0108: purchase orders carry their stock, payments carry who paid, and a
-- quantity approval moves stock by a difference instead of overwriting it.
--
-- Found on توبيكال جيل مصرى, 27 Sep 2026. Doaa asked to take the item from 42
-- to 22 to remove a purchase entered twice. Thirty minutes later, before the
-- approval, PO-117 added 150 units. Approving "set to 22" then erased those
-- 150 units, because an approval wrote an absolute number over whatever the
-- shelf had become. A request now stores the change (-20), and approving it
-- applies -20 to the quantity as it stands at that moment.
--
-- The PO screen wrote stock straight from the browser: read the quantity, add,
-- write it back, then create the PO. No link from a PO to the stock it added
-- (every batch said "AUTO"), items only as free text, no way to cancel a
-- duplicate, and nothing recorded about who paid a supplier or how. A cash
-- payment never left anybody's cash in hand, so Doaa's balance showed 8,730
-- EGP while she held 280.
--
-- Everything here is additive and safe with the screens as they are today.
-- The lock that stops the browser writing stock directly comes in 0109, after
-- the new screens are live (code first, then the lock).

-- ── Structure ──────────────────────────────────────────────────────────────

alter table purchase_orders drop constraint if exists purchase_orders_entry_type_check;
alter table purchase_orders add constraint purchase_orders_entry_type_check
  check (entry_type in ('purchase', 'payment', 'return'));

alter table purchase_orders
  add column if not exists status text not null default 'active',
  add column if not exists void_reason text,
  add column if not exists voided_by_id uuid,
  add column if not exists voided_by_name text,
  add column if not exists voided_at timestamptz,
  add column if not exists replaced_by_id uuid,
  add column if not exists created_by_id uuid,
  add column if not exists created_by_name text,
  add column if not exists date_reason text,
  add column if not exists payment_method text,
  add column if not exists paid_by_employee_id uuid references employees(id),
  add column if not exists paid_by_name text,
  add column if not exists cash_brand text,
  add column if not exists cash_tx_id uuid,
  add column if not exists related_po_id uuid,
  add column if not exists is_consolidated boolean not null default false;

alter table purchase_orders drop constraint if exists purchase_orders_status_check;
alter table purchase_orders add constraint purchase_orders_status_check
  check (status in ('active', 'void'));
alter table purchase_orders drop constraint if exists purchase_orders_payment_method_check;
alter table purchase_orders add constraint purchase_orders_payment_method_check
  check (payment_method is null or payment_method in ('cash', 'instapay', 'visa', 'wallet'));

comment on column purchase_orders.paid_by_name is
  'Who paid the supplier. Shown to admins only. A cash payment by an employee also leaves that employee''s cash in hand (cash_tx_id).';

create table if not exists purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  stock_item_id uuid not null references stock_items(id),
  item_name text not null,
  qty numeric(12,2) not null check (qty > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) generated always as (round(qty * unit_price, 2)) stored,
  batch_id uuid references stock_batches(id),
  qty_returned numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists purchase_order_lines_po_idx on purchase_order_lines(po_id);
create index if not exists purchase_order_lines_item_idx on purchase_order_lines(stock_item_id);
alter table purchase_order_lines enable row level security;
drop policy if exists staff_read on purchase_order_lines;
create policy staff_read on purchase_order_lines for select to authenticated using (true);

alter table stock_batches add column if not exists po_id uuid references purchase_orders(id);
alter table supplier_returns add column if not exists po_line_id uuid references purchase_order_lines(id);

alter table stock_change_requests
  add column if not exists delta numeric,
  add column if not exists qty_at_decision numeric,
  add column if not exists qty_after numeric;
comment on column stock_change_requests.delta is
  'For quantity requests: the change asked for (+ or -). Approval applies this to the quantity as it stands then, so movements that land while a request waits are kept.';

-- ── Helpers ────────────────────────────────────────────────────────────────

create or replace function cairo_today() returns date
language sql stable as $$ select (now() at time zone 'Africa/Cairo')::date $$;

-- Who is calling, from the signed-in session. Null when called with the
-- service key, which only migrations and admin scripts do.
create or replace function current_staff()
returns table (id uuid, name text, is_admin boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select sp.id, sp.name, sp.role = 'admin' from staff_profiles sp
   where sp.id = auth.uid() and coalesce(sp.is_active, true);
$$;

create or replace function require_staff() returns record
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r record;
begin
  select * into r from current_staff();
  if r.id is null then raise exception 'You need to be signed in as staff to do this.'; end if;
  return r;
end $$;

-- A date can be today or earlier, never later. An earlier date needs a reason,
-- so a backdated entry always says why.
create or replace function check_entry_date(p_date date, p_reason text) returns void
language plpgsql stable as $$
begin
  if p_date is null then raise exception 'A date is required.'; end if;
  if p_date > cairo_today() then
    raise exception 'The date cannot be later than today (%).', to_char(cairo_today(), 'DD/MM/YYYY');
  end if;
  if p_date < cairo_today() and coalesce(btrim(p_reason), '') = '' then
    raise exception 'This is dated %, before today. Add the reason for the earlier date.', to_char(p_date, 'DD/MM/YYYY');
  end if;
end $$;

-- PO numbers never repeat. The sequence can sit behind numbers already used
-- (the imported history reused them), so it skips anything taken.
create or replace function next_po_number() returns integer
language plpgsql volatile as $$
declare n integer;
begin
  loop
    n := nextval('po_number_seq')::integer;
    exit when not exists (select 1 from purchase_orders where po_number = n and entry_type = 'purchase');
  end loop;
  return n;
end $$;

-- ── The ledger follows the shelf, unless the caller already moved it ───────
--
-- A PO, a return, a void or a count moves the batch ledger itself, precisely
-- (this PO's batch, at this price). They set app.batch_handled so the trigger
-- does not move the ledger a second time.

create or replace function sync_batches_to_item_qty() returns trigger
language plpgsql security definer as $$
declare
  v_delta numeric; v_left numeric; v_take numeric; v_batch record;
  v_new_batch uuid; v_cost numeric; v_source text;
begin
  if coalesce(current_setting('app.batch_handled', true), '') = 'on' then return new; end if;

  v_delta := coalesce(new.qty_remaining, 0) - coalesce(old.qty_remaining, 0);
  if v_delta = 0 then return new; end if;
  v_source := coalesce(nullif(current_setting('app.stock_source', true), ''), 'adjustment');

  if v_delta < 0 then
    v_left := -v_delta;
    for v_batch in
      select id, qty_remaining, purchase_price, sale_price from stock_batches
       where stock_item_id = new.id and qty_remaining > 0
       order by received_date nulls last, created_at
    loop
      exit when v_left <= 0;
      v_take := least(v_left, v_batch.qty_remaining);
      update stock_batches set qty_remaining = qty_remaining - v_take where id = v_batch.id;
      insert into stock_batch_consumption (batch_id, stock_item_id, source_type, qty, unit_cost, unit_sale, entry_date)
      values (v_batch.id, new.id, v_source, v_take, v_batch.purchase_price, coalesce(v_batch.sale_price, new.sale_price), cairo_today());
      v_left := v_left - v_take;
    end loop;
    if v_left > 0 then
      v_cost := coalesce(new.purchase_price, 0);
      insert into stock_batches (stock_item_id, po_number, supplier_name, purchase_price, sale_price, qty_in, qty_remaining, received_date, note)
      values (new.id, 'UNRECORDED', 'Not in purchase history', v_cost, new.sale_price, v_left, 0, cairo_today(),
              'Sold beyond what the purchase records cover. Opened so the count reconciles; the gap is real and shows here.')
      returning id into v_new_batch;
      insert into stock_batch_consumption (batch_id, stock_item_id, source_type, qty, unit_cost, unit_sale, entry_date)
      values (v_new_batch, new.id, v_source, v_left, v_cost, new.sale_price, cairo_today());
    end if;
  else
    insert into stock_batches (stock_item_id, po_number, supplier_name, purchase_price, sale_price, qty_in, qty_remaining, received_date, note)
    values (new.id, 'AUTO', 'Recorded from stock movement', coalesce(new.purchase_price, 0), new.sale_price, v_delta, v_delta, cairo_today(),
            'Opened automatically when the shelf count went up (' || v_source || ').');
  end if;
  return new;
end $$;

-- Take units out of the ledger for one item: named batch first, then oldest.
create or replace function _ledger_take(p_item uuid, p_qty numeric, p_first_batch uuid, p_source text, p_source_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_left numeric := p_qty; v_take numeric; b record;
begin
  for b in
    select id, qty_remaining, purchase_price, sale_price from stock_batches
     where stock_item_id = p_item and qty_remaining > 0
     order by (id = p_first_batch) desc, received_date nulls last, created_at
  loop
    exit when v_left <= 0;
    v_take := least(v_left, b.qty_remaining);
    update stock_batches set qty_remaining = qty_remaining - v_take where id = b.id;
    insert into stock_batch_consumption (batch_id, stock_item_id, source_type, source_id, qty, unit_cost, unit_sale, entry_date, note)
    values (b.id, p_item, p_source, p_source_id, v_take, b.purchase_price, b.sale_price, cairo_today(), p_note);
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then
    raise exception 'The purchase records for this item hold % fewer unit(s) than needed.', v_left;
  end if;
end $$;

-- ── Counts no longer write the ledger twice ────────────────────────────────
-- The item update used to fire the trigger (consuming the whole difference)
-- and then this function reconciled again, so a count wiped real PO batches
-- and booked phantom "unrecorded" sales. Now only this function moves it.
create or replace function apply_stock_count(p_item_id uuid, p_counted numeric, p_note text default null)
returns table (item_qty numeric, ledger_qty numeric)
language plpgsql security definer as $$
declare v_ledger numeric; v_diff numeric; v_take numeric; v_batch record; v_cost numeric;
begin
  if p_counted < 0 then raise exception 'A counted quantity cannot be negative.'; end if;
  perform set_config('app.batch_handled', 'on', true);
  update stock_items set qty_remaining = p_counted where id = p_item_id;
  perform set_config('app.batch_handled', '', true);

  select coalesce(sum(qty_remaining), 0) into v_ledger from stock_batches where stock_item_id = p_item_id;
  v_diff := p_counted - v_ledger;
  if v_diff < 0 then
    v_diff := -v_diff;
    for v_batch in
      select id, qty_remaining, purchase_price, sale_price from stock_batches
       where stock_item_id = p_item_id and qty_remaining > 0
       order by received_date nulls last, created_at
    loop
      exit when v_diff <= 0;
      v_take := least(v_diff, v_batch.qty_remaining);
      update stock_batches set qty_remaining = qty_remaining - v_take where id = v_batch.id;
      insert into stock_batch_consumption (batch_id, stock_item_id, source_type, qty, unit_cost, unit_sale, entry_date, note)
      values (v_batch.id, p_item_id, 'stock_count', v_take, v_batch.purchase_price, v_batch.sale_price, cairo_today(),
              coalesce(p_note, 'Written off against the physical count.'));
      v_diff := v_diff - v_take;
    end loop;
  elsif v_diff > 0 then
    select coalesce(purchase_price, 0) into v_cost from stock_items where id = p_item_id;
    insert into stock_batches (stock_item_id, po_number, supplier_name, purchase_price, sale_price, qty_in, qty_remaining, received_date, note)
    select p_item_id, 'COUNT', 'Found at the physical count', v_cost, si.sale_price, v_diff, v_diff, cairo_today(),
           coalesce(p_note, 'On the shelf but not in the purchase records. Opened at the count.')
      from stock_items si where si.id = p_item_id;
  end if;
  return query
    select si.qty_remaining, coalesce((select sum(b.qty_remaining) from stock_batches b where b.stock_item_id = si.id), 0)
      from stock_items si where si.id = p_item_id;
end $$;

-- ── Quantity approvals move by a difference ────────────────────────────────

create or replace function request_stock_change(
  p_item_id uuid, p_field text, p_new_value numeric,
  p_by_id uuid, p_by_name text, p_reason text default null
) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old numeric; v_reserved numeric; v_id uuid; v_delta numeric;
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
end $$;

create or replace function decide_stock_change(
  p_id uuid, p_status text, p_by_id uuid, p_by_name text, p_note text default null
) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare r stock_change_requests; v_reserved numeric; v_now numeric; v_after numeric; v_delta numeric;
begin
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
end $$;

-- Requests already waiting were stored as absolute values. Give them their
-- difference from the moment they were made.
update stock_change_requests
   set delta = new_value - old_value
 where field = 'qty_remaining' and delta is null and status = 'pending';

-- ── Purchase orders ────────────────────────────────────────────────────────

-- p_lines: [{stock_item_id | new_item:{name, category, sale_price}, qty, unit_price}]
create or replace function _po_create(
  p_supplier_id uuid, p_date date, p_date_reason text, p_description text, p_lines jsonb,
  p_amount numeric, p_po_number integer, p_by_id uuid, p_by_name text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_po uuid; v_no integer; v_supplier text; l jsonb; v_item uuid; v_qty numeric; v_price numeric;
  v_name text; v_sale numeric; v_batch uuid; v_total numeric := 0; v_summary text := '';
begin
  select name into v_supplier from suppliers where id = p_supplier_id;
  if v_supplier is null then raise exception 'Choose the supplier.'; end if;
  perform check_entry_date(p_date, p_date_reason);

  if coalesce(jsonb_array_length(p_lines), 0) = 0 and coalesce(p_amount, 0) <= 0 then
    raise exception 'Add at least one item, or a total amount.';
  end if;

  v_no := coalesce(p_po_number, next_po_number());
  insert into purchase_orders (supplier_id, amount, entry_type, description, entry_date, po_number,
                               status, created_by_id, created_by_name, date_reason)
  values (p_supplier_id, 0, 'purchase', p_description, p_date, v_no,
          'active', p_by_id, p_by_name, nullif(btrim(p_date_reason), ''))
  returning id into v_po;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_qty := (l->>'qty')::numeric;
    v_price := (l->>'unit_price')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Every item needs a quantity above zero.'; end if;
    if v_price is null or v_price < 0 then raise exception 'Every item needs a unit price.'; end if;

    if l ? 'new_item' then
      v_name := btrim(l->'new_item'->>'name');
      if coalesce(v_name, '') = '' then raise exception 'A new item needs a name.'; end if;
      v_sale := nullif(l->'new_item'->>'sale_price', '')::numeric;
      if v_sale is null then raise exception 'Set a sale price for %, so it can be sold.', v_name; end if;
      insert into stock_items (category, name, purchase_price, sale_price, qty_remaining)
      values (coalesce(nullif(l->'new_item'->>'category', ''), 'dental'), v_name, v_price, v_sale, 0)
      returning id into v_item;
    else
      v_item := (l->>'stock_item_id')::uuid;
      select name, sale_price into v_name, v_sale from stock_items where id = v_item for update;
      if v_name is null then raise exception 'One of the items no longer exists.'; end if;
    end if;

    insert into stock_batches (stock_item_id, po_number, supplier_name, purchase_price, sale_price,
                               qty_in, qty_remaining, received_date, note, po_id)
    values (v_item, 'PO-' || v_no, v_supplier, v_price, v_sale, v_qty, v_qty, p_date,
            'Received on PO-' || v_no, v_po)
    returning id into v_batch;

    perform set_config('app.batch_handled', 'on', true);
    update stock_items set qty_remaining = coalesce(qty_remaining, 0) + v_qty, purchase_price = v_price
     where id = v_item;
    perform set_config('app.batch_handled', '', true);

    insert into purchase_order_lines (po_id, stock_item_id, item_name, qty, unit_price, batch_id)
    values (v_po, v_item, v_name, v_qty, v_price, v_batch);

    v_total := v_total + round(v_qty * v_price, 2);
    v_summary := v_summary || case when v_summary = '' then '' else ', ' end || v_name || ' x' || trim(to_char(v_qty, 'FM999999990.##'));
  end loop;

  if v_total = 0 then v_total := p_amount; end if;
  update purchase_orders
     set amount = v_total, description = coalesce(nullif(btrim(p_description), ''), nullif(v_summary, ''))
   where id = v_po;
  return v_po;
end $$;

-- Reverse what a PO put on the shelf. p_check off lets an edit reverse and
-- re-apply in one step and check the result once at the end.
create or replace function _po_reverse(p_po uuid, p_check boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare ln record; v_need numeric; v_have numeric; v_reserved numeric; v_name text;
begin
  for ln in select * from purchase_order_lines where po_id = p_po loop
    v_need := ln.qty - ln.qty_returned;
    continue when v_need <= 0;
    select qty_remaining, coalesce(qty_reserved, 0), name into v_have, v_reserved, v_name
      from stock_items where id = ln.stock_item_id for update;
    if p_check and v_have - v_need < v_reserved then
      raise exception '% of the % units of % on this PO have already been sold or reserved. Return what is left instead, or adjust the count.',
        least(v_need, v_need - (v_have - v_reserved)), v_need, v_name;
    end if;
    perform _ledger_take(ln.stock_item_id, least(v_need, (select coalesce(sum(qty_remaining),0) from stock_batches where stock_item_id = ln.stock_item_id)),
                         ln.batch_id, 'po_void', p_po, 'Purchase order cancelled');
    perform set_config('app.batch_handled', 'on', true);
    update stock_items set qty_remaining = qty_remaining - v_need where id = ln.stock_item_id;
    perform set_config('app.batch_handled', '', true);
  end loop;
end $$;

create or replace function create_purchase_order(
  p_supplier_id uuid, p_date date, p_date_reason text, p_description text, p_lines jsonb, p_amount numeric default null
) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; v_po uuid; v_no integer;
begin
  me := require_staff();
  v_po := _po_create(p_supplier_id, p_date, p_date_reason, p_description, p_lines, p_amount, null, me.id, me.name);
  select po_number into v_no from purchase_orders where id = v_po;
  return json_build_object('id', v_po, 'po_number', v_no);
end $$;

create or replace function void_purchase_order(p_po_id uuid, p_reason text) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; po purchase_orders;
begin
  me := require_staff();
  if not me.is_admin then raise exception 'Only an admin can cancel a purchase order.'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give the reason for cancelling.'; end if;
  select * into po from purchase_orders where id = p_po_id for update;
  if po.id is null or po.entry_type <> 'purchase' then raise exception 'Purchase order not found.'; end if;
  if po.status = 'void' then raise exception 'That purchase order is already cancelled.'; end if;

  perform _po_reverse(p_po_id, true);
  update purchase_orders
     set status = 'void', void_reason = p_reason, voided_by_id = me.id, voided_by_name = me.name, voided_at = now()
   where id = p_po_id;
  -- Returns against it stop counting too.
  update purchase_orders set status = 'void', void_reason = 'Its purchase order was cancelled', voided_by_id = me.id,
         voided_by_name = me.name, voided_at = now()
   where related_po_id = p_po_id and entry_type = 'return' and status = 'active';
  return json_build_object('id', p_po_id, 'status', 'void');
end $$;

-- Editing keeps the PO number: the old version is cancelled with the reason,
-- and a new one carries the same number, so the history shows both.
create or replace function edit_purchase_order(
  p_po_id uuid, p_supplier_id uuid, p_date date, p_date_reason text, p_description text,
  p_lines jsonb, p_amount numeric, p_reason text
) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; po purchase_orders; v_new uuid; bad record;
begin
  me := require_staff();
  if not me.is_admin then raise exception 'Only an admin can edit a purchase order.'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give the reason for the edit.'; end if;
  select * into po from purchase_orders where id = p_po_id for update;
  if po.id is null or po.entry_type <> 'purchase' then raise exception 'Purchase order not found.'; end if;
  if po.status = 'void' then raise exception 'A cancelled purchase order cannot be edited.'; end if;
  if exists (select 1 from purchase_order_lines where po_id = p_po_id and qty_returned > 0) then
    raise exception 'Part of this order has been returned. Cancel the return first, or record another return.';
  end if;
  -- The date rule is checked against the date the PO already had when it has
  -- not moved, so an old PO can still have its lines corrected.
  if p_date = po.entry_date then p_date_reason := coalesce(nullif(btrim(p_date_reason), ''), po.date_reason, 'Kept from the original entry'); end if;

  perform _po_reverse(p_po_id, false);
  update purchase_orders
     set status = 'void', void_reason = 'Edited: ' || p_reason, voided_by_id = me.id, voided_by_name = me.name, voided_at = now()
   where id = p_po_id;
  v_new := _po_create(p_supplier_id, p_date, p_date_reason, p_description, p_lines, p_amount, po.po_number, me.id, me.name);
  update purchase_orders set replaced_by_id = v_new where id = p_po_id;

  select si.name, si.qty_remaining, coalesce(si.qty_reserved,0) res into bad
    from stock_items si
   where si.id in (select stock_item_id from purchase_order_lines where po_id in (p_po_id, v_new))
     and (si.qty_remaining < 0 or si.qty_remaining < coalesce(si.qty_reserved, 0))
   limit 1;
  if bad.name is not null then
    raise exception 'This edit would leave % at % in stock, but more than that has already been sold or reserved.', bad.name, bad.qty_remaining;
  end if;
  return json_build_object('id', v_new, 'po_number', po.po_number, 'replaces', p_po_id);
end $$;

-- ── Returns to the supplier ────────────────────────────────────────────────
-- From one delivery (batch). Leaves the shelf once, reduces what is owed to
-- that supplier at the price it was bought at.
create or replace function return_to_supplier(p_batch_id uuid, p_qty numeric, p_reason text, p_date date default null, p_date_reason text default null)
returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; b stock_batches; v_item stock_items; v_line purchase_order_lines; v_po purchase_orders;
        v_supplier uuid; v_ret uuid; v_value numeric; v_date date := coalesce(p_date, cairo_today());
begin
  me := require_staff();
  perform check_entry_date(v_date, p_date_reason);
  select * into b from stock_batches where id = p_batch_id for update;
  if b.id is null then raise exception 'That delivery was not found.'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter how many units are going back.'; end if;
  if p_qty > b.qty_remaining then raise exception 'Only % left from this delivery. You cannot return more than that.', b.qty_remaining; end if;
  select * into v_item from stock_items where id = b.stock_item_id for update;
  if v_item.qty_remaining - p_qty < coalesce(v_item.qty_reserved, 0) then
    raise exception '% unit(s) of % are reserved for orders, so only % can go back.', v_item.qty_reserved, v_item.name, v_item.qty_remaining - v_item.qty_reserved;
  end if;

  select * into v_line from purchase_order_lines where batch_id = b.id;
  if v_line.id is not null then
    select * into v_po from purchase_orders where id = v_line.po_id;
    if v_po.status = 'void' then raise exception 'That purchase order was cancelled.'; end if;
    v_supplier := v_po.supplier_id;
  else
    select id into v_supplier from suppliers where name = b.supplier_name;
  end if;
  v_value := round(p_qty * b.purchase_price, 2);

  insert into supplier_returns (supplier_name, stock_item_id, batch_id, po_line_id, qty, unit_cost, total_value, reason, entry_date, created_by_id, created_by_name)
  values (coalesce(b.supplier_name, 'Unknown supplier'), b.stock_item_id, b.id, v_line.id, p_qty, b.purchase_price, v_value, p_reason, v_date, me.id, me.name)
  returning id into v_ret;

  perform _ledger_take(b.stock_item_id, p_qty, b.id, 'supplier_return', v_ret, coalesce(p_reason, 'Returned to supplier'));
  perform set_config('app.batch_handled', 'on', true);
  update stock_items set qty_remaining = qty_remaining - p_qty where id = b.stock_item_id;
  perform set_config('app.batch_handled', '', true);

  if v_line.id is not null then
    update purchase_order_lines set qty_returned = qty_returned + p_qty where id = v_line.id;
  end if;
  if v_supplier is not null then
    insert into purchase_orders (supplier_id, amount, entry_type, description, entry_date, status, created_by_id, created_by_name,
                                 related_po_id, date_reason)
    values (v_supplier, -v_value, 'return', 'Returned ' || trim(to_char(p_qty, 'FM999999990.##')) || ' x ' || v_item.name ||
            coalesce(' from PO-' || v_po.po_number, '') || coalesce(': ' || nullif(btrim(p_reason), ''), ''),
            v_date, 'active', me.id, me.name, v_po.id, nullif(btrim(p_date_reason), ''));
  end if;
  return json_build_object('return_id', v_ret, 'value', v_value);
end $$;

-- ── Supplier payments ──────────────────────────────────────────────────────
create or replace function record_supplier_payment(
  p_supplier_id uuid, p_amount numeric, p_date date, p_date_reason text, p_method text,
  p_paid_by_employee_id uuid, p_paid_by_name text, p_cash_brand text default 'dental_stock', p_note text default null
) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; v_supplier text; v_tx uuid; v_pay uuid; v_payer text;
begin
  me := require_staff();
  select name into v_supplier from suppliers where id = p_supplier_id;
  if v_supplier is null then raise exception 'Choose the supplier.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount paid.'; end if;
  if p_method not in ('cash', 'instapay', 'visa', 'wallet') then raise exception 'Choose how it was paid.'; end if;
  perform check_entry_date(p_date, p_date_reason);

  if p_paid_by_employee_id is not null then
    select name into v_payer from employees where id = p_paid_by_employee_id;
  else
    v_payer := nullif(btrim(p_paid_by_name), '');
  end if;
  if v_payer is null then raise exception 'Choose who paid.'; end if;

  -- Cash from an employee leaves their cash in hand. The cash-out guard will
  -- refuse it if they are not holding that much.
  if p_method = 'cash' and p_paid_by_employee_id is not null then
    insert into expense_transactions (type, brand, amount, payment_method, from_employee_id, category, note, entry_date,
                                      status, confirmed_by_id, confirmed_by_name, confirmed_at, created_by_id, created_by_name)
    values ('cash_out', coalesce(p_cash_brand, 'dental_stock'), p_amount, 'cash', p_paid_by_employee_id, 'supplier_payment',
            'Paid to ' || v_supplier || coalesce(': ' || nullif(btrim(p_note), ''), ''), p_date,
            'confirmed', me.id, me.name, now(), me.id, me.name)
    returning id into v_tx;
  end if;

  insert into purchase_orders (supplier_id, amount, entry_type, description, entry_date, status, created_by_id, created_by_name,
                               date_reason, payment_method, paid_by_employee_id, paid_by_name, cash_brand, cash_tx_id)
  values (p_supplier_id, -p_amount, 'payment', nullif(btrim(p_note), ''), p_date, 'active', me.id, me.name,
          nullif(btrim(p_date_reason), ''), p_method, p_paid_by_employee_id, v_payer,
          case when v_tx is not null then coalesce(p_cash_brand, 'dental_stock') end, v_tx)
  returning id into v_pay;
  return json_build_object('id', v_pay, 'cash_tx_id', v_tx);
end $$;

create or replace function void_supplier_payment(p_payment_id uuid, p_reason text) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; p purchase_orders;
begin
  me := require_staff();
  if not me.is_admin then raise exception 'Only an admin can cancel a payment.'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give the reason for cancelling.'; end if;
  select * into p from purchase_orders where id = p_payment_id for update;
  if p.id is null or p.entry_type <> 'payment' then raise exception 'Payment not found.'; end if;
  if p.status = 'void' then raise exception 'That payment is already cancelled.'; end if;
  if p.cash_tx_id is not null then
    update expense_transactions set status = 'rejected', note = coalesce(note, '') || ' (cancelled: ' || p_reason || ')'
     where id = p.cash_tx_id;
  end if;
  update purchase_orders set status = 'void', void_reason = p_reason, voided_by_id = me.id, voided_by_name = me.name, voided_at = now()
   where id = p_payment_id;
  return json_build_object('id', p_payment_id, 'status', 'void');
end $$;

-- Balances ignore cancelled entries.
create or replace function get_supplier_balances()
returns table(supplier_id uuid, supplier_name text, balance numeric)
language sql stable as $$
  select s.id, s.name, coalesce(sum(po.amount) filter (where po.status = 'active'), 0)
    from suppliers s left join purchase_orders po on po.supplier_id = s.id
   group by s.id, s.name;
$$;

create or replace function get_pl_summary()
returns table(source_stream text, direction text, total numeric) as $$
  select source_stream, direction, sum(amount) as total from cash_ledger group by source_stream, direction
  union all
  select 'suppliers', 'out', abs(sum(amount)) from purchase_orders where entry_type = 'payment' and status = 'active';
$$ language sql stable;

-- ── Sales paths ────────────────────────────────────────────────────────────
-- Delivering a doctor order no longer overwrites the item's sale price (that
-- goes through an approval), and labels its stock movement.
create or replace function record_stock_transaction(p_item_id uuid, p_type text, p_qty numeric, p_unit_price numeric,
  p_amount_paid numeric default null, p_payment_status text default 'paid')
returns stock_items language plpgsql security definer as $$
declare result stock_items; v_total numeric; v_paid numeric;
begin
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
end $$;

create or replace function record_stock_transaction(p_item_id uuid, p_type text, p_qty numeric, p_unit_price numeric,
  p_amount_paid numeric default null, p_payment_status text default 'paid', p_payment_method text default 'cash')
returns stock_items language plpgsql security definer as $$
declare result stock_items; v_total numeric; v_paid numeric; v_category text; v_brand text;
begin
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
end $$;

-- ── Who may call what ──────────────────────────────────────────────────────
revoke all on function _po_create(uuid, date, text, text, jsonb, numeric, integer, uuid, text) from public, anon, authenticated;
revoke all on function _po_reverse(uuid, boolean) from public, anon, authenticated;
revoke all on function _ledger_take(uuid, numeric, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function create_purchase_order(uuid, date, text, text, jsonb, numeric) to authenticated;
grant execute on function void_purchase_order(uuid, text) to authenticated;
grant execute on function edit_purchase_order(uuid, uuid, date, text, text, jsonb, numeric, text) to authenticated;
grant execute on function return_to_supplier(uuid, numeric, text, date, text) to authenticated;
grant execute on function record_supplier_payment(uuid, numeric, date, text, text, uuid, text, text, text) to authenticated;
grant execute on function void_supplier_payment(uuid, text) to authenticated;
grant execute on function cairo_today() to authenticated;

-- ── Counter sales respect doctor reservations ──────────────────────────────
-- A counter sale checked the shelf, not the shelf minus what doctors have
-- already ordered, so it could sell units promised to an order and leave the
-- delivery short. Generated from the live function; only the availability
-- check, its message and the movement label change.
CREATE OR REPLACE FUNCTION public.record_counter_sale(p_brand text, p_sale_type text, p_items jsonb, p_payment_method text, p_customer_type text DEFAULT NULL::text, p_customer_id uuid DEFAULT NULL::uuid, p_employee_id uuid DEFAULT NULL::uuid, p_tab_pin text DEFAULT NULL::text, p_collected_by uuid DEFAULT NULL::uuid, p_staff_id uuid DEFAULT NULL::uuid, p_staff_name text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_cat      text;
    v_item     jsonb;
    v_sid      uuid;
    v_qty      numeric;
    v_price    numeric;
    v_left     numeric;
    v_name     text;
    v_gross    numeric := 0;
    v_disc     numeric := 0;
    v_net      numeric;
    v_sale     uuid;
    v_receipt  text;
    v_cap      json;
    v_ok       boolean;
BEGIN
    IF jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'Nothing has been added to the sale.';
    END IF;
    v_cat := CASE p_brand WHEN 'dental_stock' THEN 'dental' ELSE 'el3awama' END;

    -- Pass 1: validate everything before changing anything.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_sid := (v_item->>'stock_item_id')::uuid;
        v_qty := (v_item->>'quantity')::numeric;
        SELECT sale_price, qty_remaining - coalesce(qty_reserved, 0), name INTO v_price, v_left, v_name
        FROM public.stock_items WHERE id = v_sid AND category = v_cat;
        IF v_name IS NULL THEN RAISE EXCEPTION 'One of these items no longer exists.'; END IF;
        IF v_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be more than zero for %.', v_name; END IF;
        IF v_qty > v_left THEN
            RAISE EXCEPTION 'Not enough stock for % - only % free to sell (the rest is reserved for doctor orders).', v_name, v_left;
        END IF;
        v_gross := v_gross + (v_qty * v_price);
    END LOOP;

    -- A10: staff pay customer price less their benefit discount.
    IF p_sale_type = 'staff_tab' OR (p_employee_id IS NOT NULL AND p_payment_method = 'staff_tab') THEN
        SELECT coalesce(staff_discount_percent,0) INTO v_disc
        FROM public.employees WHERE id = p_employee_id;
    END IF;
    v_net := round(v_gross * (1 - coalesce(v_disc,0)/100.0), 2);

    -- Staff tab checks: eligibility, PIN, and the accrued spending cap.
    IF p_payment_method = 'staff_tab' THEN
        IF p_employee_id IS NULL THEN
            RAISE EXCEPTION 'Which employee is this going on the tab for?';
        END IF;
        SELECT fnb_tab_enabled INTO v_ok FROM public.employees WHERE id = p_employee_id;
        IF NOT coalesce(v_ok,false) THEN
            RAISE EXCEPTION 'Staff tabs are switched off for this employee.';
        END IF;

        SELECT (tab_pin_hash IS NOT NULL AND tab_pin_hash = crypt(coalesce(p_tab_pin,''), tab_pin_hash))
          INTO v_ok FROM public.employees WHERE id = p_employee_id;
        IF NOT coalesce(v_ok,false) THEN
            RAISE EXCEPTION 'That PIN is not correct.';
        END IF;

        v_cap := public.employee_spend_capacity(p_employee_id);
        IF v_net > (v_cap->>'remaining')::numeric THEN
            RAISE EXCEPTION
              'This would take them over their limit. Earned so far %, limit is 50%% of that, and % is already used. Remaining today: %.',
              (v_cap->>'accrued'), ((v_cap->>'advances')::numeric + (v_cap->>'tab_used')::numeric),
              (v_cap->>'remaining');
        END IF;
    END IF;

    -- Postponed needs a real customer to bill.
    IF p_payment_method = 'postponed' AND p_customer_id IS NULL THEN
        RAISE EXCEPTION 'A postponed sale must be assigned to a customer.';
    END IF;

    v_receipt := public.next_receipt_no(p_brand);

    INSERT INTO public.counter_sales (
        brand, sale_type, customer_type, customer_id, employee_id,
        gross_amount, discount_percent, net_amount, payment_method,
        collected_by_employee_id, receipt_no, note, created_by_id, created_by_name
    ) VALUES (
        p_brand, p_sale_type, p_customer_type, p_customer_id, p_employee_id,
        v_gross, coalesce(v_disc,0), v_net, p_payment_method,
        CASE WHEN p_payment_method = 'cash' THEN p_collected_by ELSE NULL END,
        v_receipt, p_note, p_staff_id, p_staff_name
    ) RETURNING id INTO v_sale;

    PERFORM set_config('app.stock_source', 'counter_sale', true);
    -- Pass 2: write the lines and take the stock down.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_sid := (v_item->>'stock_item_id')::uuid;
        v_qty := (v_item->>'quantity')::numeric;
        SELECT sale_price, name INTO v_price, v_name
        FROM public.stock_items WHERE id = v_sid;
        INSERT INTO public.counter_sale_items (sale_id, stock_item_id, item_name, quantity, unit_price, line_total)
        VALUES (v_sale, v_sid, v_name, v_qty, v_price, round(v_qty * v_price, 2));
        UPDATE public.stock_items SET qty_remaining = qty_remaining - v_qty WHERE id = v_sid;
    END LOOP;

    -- Where the money goes.
    IF p_payment_method = 'cash' THEN
        IF p_collected_by IS NULL THEN
            RAISE EXCEPTION 'Cash sales must record who took the money.';
        END IF;
        INSERT INTO public.expense_transactions (
            type, brand, amount, payment_method, to_employee_id, status,
            note, confirmed_by_id, confirmed_by_name, confirmed_at,
            created_by_id, created_by_name
        ) VALUES (
            'stock_sale', p_brand, v_net, 'cash', p_collected_by, 'confirmed',
            'Counter sale ' || v_receipt, p_staff_id, p_staff_name, now(),
            p_staff_id, p_staff_name);

    ELSIF p_payment_method = 'postponed' THEN
        PERFORM public.record_ar_charge(p_customer_type, p_customer_id, p_brand,
            v_net, 'counter_sale', v_sale, 'Counter sale ' || v_receipt,
            p_staff_id, p_staff_name, false);

    ELSIF p_payment_method = 'staff_tab' THEN
        -- §3C: deferred, so it must NOT touch cash custody. Only the tab.
        INSERT INTO public.employee_tab_ledger (
            employee_id, direction, amount, reference_type, reference_id,
            note, created_by_id, created_by_name)
        VALUES (p_employee_id, 'charge', v_net, 'counter_sale', v_sale,
            'Counter sale ' || v_receipt, p_staff_id, p_staff_name);
    END IF;
    -- visa / instapay / wallet: recorded on the sale, never in custody.

    RETURN json_build_object(
        'sale_id',   v_sale,
        'receipt_no', v_receipt,
        'gross',     v_gross,
        'discount_percent', coalesce(v_disc,0),
        'net',       v_net,
        'method',    p_payment_method
    );
END;
$function$;
