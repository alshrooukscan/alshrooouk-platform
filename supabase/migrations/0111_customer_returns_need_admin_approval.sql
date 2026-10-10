-- 0111: a doctor can return items from a sale, and an admin approves it.
--
-- Asked on 10 Oct 2026: a doctor took an order and returned it, or returned
-- one item of several. There was no way to record it. A delivered portal
-- order could not be cancelled, a counter sale had no cancel at all, and the
-- only workaround (raising the stock count) left the clinic still owing for
-- what it gave back.
--
-- Staff record the return against the sale: which items, how many, why. It
-- waits in the Action Center. Only an admin's approval moves anything:
--   stock     the units go back on the shelf, as their own batch
--   on account the clinic's balance comes down by the returned value
--   paid       held as credit on the clinic's account, or refunded in cash
--              out of the refunding employee's cash in hand
--   staff tab  the employee's tab comes down
-- A return is valued at the price on the sale, less any discount the sale had.

create table if not exists sale_returns (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('counter_sale', 'dental_order')),
  source_id uuid not null,
  brand text not null,
  receipt_no text,
  customer_label text,
  reason text not null,
  total_value numeric(12,2) not null check (total_value >= 0),
  refund_mode text not null check (refund_mode in ('account', 'credit', 'cash', 'tab')),
  refund_employee_id uuid references employees(id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by_id uuid,
  requested_by_name text,
  requested_at timestamptz not null default now(),
  decided_by_id uuid,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  ar_ledger_id uuid,
  cash_tx_id uuid,
  tab_ledger_id uuid
);
create index if not exists sale_returns_source_idx on sale_returns (source_type, source_id);
create index if not exists sale_returns_pending_idx on sale_returns (status, requested_at desc);

create table if not exists sale_return_lines (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references sale_returns(id) on delete cascade,
  stock_item_id uuid not null references stock_items(id),
  item_name text not null,
  qty numeric(12,2) not null check (qty > 0),
  unit_price numeric(12,2) not null,
  batch_id uuid references stock_batches(id)
);
create index if not exists sale_return_lines_return_idx on sale_return_lines (return_id);

alter table sale_returns enable row level security;
alter table sale_return_lines enable row level security;
drop policy if exists staff_read on sale_returns;
create policy staff_read on sale_returns for select to authenticated using (true);
drop policy if exists staff_read on sale_return_lines;
create policy staff_read on sale_return_lines for select to authenticated using (true);

alter table customer_ar_ledger drop constraint if exists customer_ar_ledger_reference_type_check;

-- What was sold on one sale, per item, and how much of it can still go back.
-- Pending returns count as already gone, so two people cannot return the
-- same unit while the first is waiting.
create or replace function _sale_lines(p_source_type text, p_source_id uuid)
returns table (stock_item_id uuid, item_name text, sold numeric, unit_price numeric, returned numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with sold as (
    select stock_item_id, max(item_name) item_name, sum(quantity) sold,
           round(sum(line_total) / nullif(sum(quantity), 0), 2) unit_price
      from counter_sale_items where p_source_type = 'counter_sale' and sale_id = p_source_id
     group by stock_item_id
    union all
    select stock_item_id, max(item_name), sum(quantity),
           round(sum(line_total) / nullif(sum(quantity), 0), 2)
      from dental_order_items where p_source_type = 'dental_order' and order_id = p_source_id
     group by stock_item_id
  ),
  back as (
    select l.stock_item_id, sum(l.qty) returned
      from sale_return_lines l join sale_returns r on r.id = l.return_id
     where r.source_type = p_source_type and r.source_id = p_source_id and r.status in ('pending', 'approved')
     group by l.stock_item_id
  )
  select s.stock_item_id, s.item_name, s.sold, s.unit_price, coalesce(b.returned, 0)
    from sold s left join back b using (stock_item_id);
$$;

-- Everything the Returns screen needs about one sale, found by receipt number
-- or by id.
create or replace function get_returnable_sale(p_receipt text default null, p_source_type text default null, p_source_id uuid default null)
returns json
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me record; v_type text := p_source_type; v_id uuid := p_source_id; s counter_sales; o dental_orders;
        v_on_account boolean; v_label text; v_brand text; v_date date; v_receipt text; v_method text; v_disc numeric := 0;
begin
  me := require_staff();
  if coalesce(btrim(p_receipt), '') <> '' then
    select * into s from counter_sales where upper(receipt_no) = upper(btrim(p_receipt));
    if s.id is null then raise exception 'No sale with receipt number %.', btrim(p_receipt); end if;
    v_type := 'counter_sale'; v_id := s.id;
  end if;

  if v_type = 'counter_sale' then
    if s.id is null then select * into s from counter_sales where id = v_id; end if;
    if s.id is null then raise exception 'That sale was not found.'; end if;
    v_brand := s.brand; v_date := s.entry_date; v_receipt := s.receipt_no; v_method := s.payment_method;
    v_disc := coalesce(s.discount_percent, 0);
    select coalesce(d.name, e.name, s.customer_type) into v_label
      from (select 1) x left join doctors d on s.customer_type = 'doctor' and d.id = s.customer_id
      left join employees e on e.id = s.employee_id;
  elsif v_type = 'dental_order' then
    select * into o from dental_orders where id = v_id;
    if o.id is null then raise exception 'That order was not found.'; end if;
    if not coalesce(o.stock_deducted, false) then
      raise exception 'This order has not been delivered yet. Cancel it from Stock Orders instead.';
    end if;
    v_brand := 'dental_stock'; v_date := coalesce(o.delivered_at, o.created_at)::date; v_method := o.payment_method;
    select name into v_label from doctors where id = o.doctor_id;
  else
    raise exception 'Give a receipt number.';
  end if;

  v_on_account := exists (select 1 from customer_ar_ledger where reference_type = v_type and reference_id = v_id and direction = 'charge');

  return json_build_object(
    'source_type', v_type, 'source_id', v_id, 'brand', v_brand, 'receipt_no', v_receipt,
    'date', v_date, 'customer', v_label, 'payment_method', v_method, 'discount_percent', v_disc,
    'on_account', v_on_account, 'staff_tab', v_method = 'staff_tab',
    'lines', coalesce((select json_agg(json_build_object('stock_item_id', l.stock_item_id, 'item_name', l.item_name,
                        'sold', l.sold, 'returned', l.returned, 'returnable', l.sold - l.returned, 'unit_price', l.unit_price)
                        order by l.item_name) from _sale_lines(v_type, v_id) l), '[]'::json),
    'returns', coalesce((select json_agg(json_build_object('id', r.id, 'status', r.status, 'total_value', r.total_value,
                        'requested_at', r.requested_at, 'requested_by_name', r.requested_by_name, 'decided_by_name', r.decided_by_name)
                        order by r.requested_at) from sale_returns r where r.source_type = v_type and r.source_id = v_id), '[]'::json)
  );
end $$;

-- Staff record a return. Nothing moves until an admin approves it.
-- p_lines: [{stock_item_id, qty}]
create or replace function request_sale_return(
  p_source_type text, p_source_id uuid, p_lines jsonb, p_reason text,
  p_refund_mode text default null, p_refund_employee_id uuid default null
) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; info json; l jsonb; v_line record; v_qty numeric; v_total numeric := 0; v_id uuid; v_mode text; v_disc numeric;
begin
  me := require_staff();
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give the reason for the return.'; end if;
  if coalesce(jsonb_array_length(p_lines), 0) = 0 then raise exception 'Choose at least one item to return.'; end if;
  info := get_returnable_sale(null, p_source_type, p_source_id);
  v_disc := coalesce((info->>'discount_percent')::numeric, 0);

  -- Where the money goes is decided by how the sale was paid, not chosen
  -- freely: a sale on account can only come off the account.
  if (info->>'on_account')::boolean then v_mode := 'account';
  elsif (info->>'staff_tab')::boolean then v_mode := 'tab';
  else
    v_mode := coalesce(p_refund_mode, 'credit');
    if v_mode not in ('credit', 'cash') then raise exception 'Choose credit on the account or a cash refund.'; end if;
    if v_mode = 'cash' and p_refund_employee_id is null then raise exception 'Choose who is handing the cash back.'; end if;
  end if;

  insert into sale_returns (source_type, source_id, brand, receipt_no, customer_label, reason, total_value, refund_mode,
                            refund_employee_id, requested_by_id, requested_by_name)
  values (p_source_type, p_source_id, info->>'brand', info->>'receipt_no', info->>'customer', btrim(p_reason), 0, v_mode,
          case when v_mode = 'cash' then p_refund_employee_id end, me.id, me.name)
  returning id into v_id;

  for l in select * from jsonb_array_elements(p_lines) loop
    v_qty := (l->>'qty')::numeric;
    continue when v_qty is null or v_qty = 0;
    if v_qty < 0 then raise exception 'A quantity cannot be negative.'; end if;
    select * into v_line from _sale_lines(p_source_type, p_source_id) where stock_item_id = (l->>'stock_item_id')::uuid;
    if v_line.stock_item_id is null then raise exception 'One of the items is not on this sale.'; end if;
    -- the row inserted above has no lines yet, so returned counts only earlier returns
    if v_qty > v_line.sold - v_line.returned then
      raise exception 'Only % of % can still be returned from this sale.', v_line.sold - v_line.returned, v_line.item_name;
    end if;
    insert into sale_return_lines (return_id, stock_item_id, item_name, qty, unit_price)
    values (v_id, v_line.stock_item_id, v_line.item_name, v_qty, v_line.unit_price);
    v_total := v_total + v_qty * v_line.unit_price;
  end loop;

  if not exists (select 1 from sale_return_lines where return_id = v_id) then
    raise exception 'Choose at least one item to return.';
  end if;
  update sale_returns set total_value = round(v_total * (1 - v_disc / 100.0), 2) where id = v_id;
  return json_build_object('id', v_id, 'total_value', round(v_total * (1 - v_disc / 100.0), 2), 'refund_mode', v_mode, 'status', 'pending');
end $$;

create or replace function decide_sale_return(p_id uuid, p_status text, p_note text default null) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; r sale_returns; ln record; v_line record; v_item stock_items; v_batch uuid;
        v_cust_type text; v_cust_id uuid; v_doc uuid; v_emp uuid; v_ar uuid; v_tx uuid; v_tab uuid; v_label text;
begin
  me := require_staff();
  if not me.is_admin then raise exception 'Only an admin can approve or reject a return.'; end if;
  if p_status not in ('approved', 'rejected') then raise exception 'A return is either approved or rejected.'; end if;
  select * into r from sale_returns where id = p_id for update;
  if r.id is null then raise exception 'That return no longer exists.'; end if;
  if r.status <> 'pending' then raise exception 'That return was already %.', r.status; end if;

  if p_status = 'rejected' then
    update sale_returns set status = 'rejected', decided_by_id = me.id, decided_by_name = me.name, decided_at = now(),
           decision_note = p_note where id = p_id;
    return json_build_object('id', p_id, 'status', 'rejected');
  end if;

  v_label := 'Return on ' || coalesce(r.receipt_no, case when r.source_type = 'dental_order' then 'portal order' else 'sale' end);

  -- Stock back on the shelf, as its own batch at the item's cost.
  for ln in select * from sale_return_lines where return_id = p_id loop
    select * into v_item from stock_items where id = ln.stock_item_id for update;
    insert into stock_batches (stock_item_id, po_number, supplier_name, purchase_price, sale_price, qty_in, qty_remaining,
                               received_date, note)
    values (ln.stock_item_id, 'RETURN', 'Returned by customer', coalesce(v_item.purchase_price, 0), v_item.sale_price,
            ln.qty, ln.qty, cairo_today(), v_label || ': ' || r.reason)
    returning id into v_batch;
    perform set_config('app.batch_handled', 'on', true);
    update stock_items set qty_remaining = coalesce(qty_remaining, 0) + ln.qty where id = ln.stock_item_id;
    perform set_config('app.batch_handled', '', true);
    update sale_return_lines set batch_id = v_batch where id = ln.id;
  end loop;

  -- The money.
  if r.refund_mode = 'account' then
    select customer_type, customer_id into v_cust_type, v_cust_id from customer_ar_ledger
     where reference_type = r.source_type and reference_id = r.source_id and direction = 'charge' limit 1;
  elsif r.refund_mode = 'credit' then
    if r.source_type = 'counter_sale' then
      select case when customer_type = 'doctor' then customer_id end, customer_type, customer_id
        into v_doc, v_cust_type, v_cust_id from counter_sales where id = r.source_id;
    else
      select doctor_id into v_doc from dental_orders where id = r.source_id;
      v_cust_type := 'doctor';
    end if;
    if v_doc is not null then
      select a.customer_type, a.customer_id into v_cust_type, v_cust_id from ar_customer_for_doctor(v_doc) a;
    end if;
    if v_cust_id is null then raise exception 'This sale has no customer account to credit. Reject it and record a cash refund instead.'; end if;
  end if;

  if r.refund_mode in ('account', 'credit') then
    insert into customer_ar_ledger (customer_type, customer_id, brand, direction, amount, reference_type, reference_id,
                                    receipt_no, note, entry_date, created_by_id, created_by_name)
    values (v_cust_type, v_cust_id, r.brand, 'adjustment', r.total_value, 'sale_return', r.id, r.receipt_no,
            v_label || ': ' || r.reason, cairo_today(), me.id, me.name)
    returning id into v_ar;
  elsif r.refund_mode = 'cash' then
    -- Leaves the refunding employee's cash in hand. The cash-out guard refuses
    -- it if they are not holding that much.
    insert into expense_transactions (type, brand, amount, payment_method, from_employee_id, category, note, entry_date,
                                      status, confirmed_by_id, confirmed_by_name, confirmed_at, created_by_id, created_by_name)
    values ('cash_out', r.brand, r.total_value, 'cash', r.refund_employee_id, 'customer_refund',
            'Refund: ' || v_label || coalesce(' (' || r.customer_label || ')', ''), cairo_today(),
            'confirmed', me.id, me.name, now(), me.id, me.name)
    returning id into v_tx;
  elsif r.refund_mode = 'tab' then
    select employee_id into v_emp from counter_sales where id = r.source_id;
    insert into employee_tab_ledger (employee_id, direction, amount, reference_type, reference_id, note, created_by_id, created_by_name)
    values (v_emp, 'adjustment', r.total_value, 'sale_return', r.id, v_label || ': ' || r.reason, me.id, me.name)
    returning id into v_tab;
  end if;

  update sale_returns
     set status = 'approved', decided_by_id = me.id, decided_by_name = me.name, decided_at = now(), decision_note = p_note,
         ar_ledger_id = v_ar, cash_tx_id = v_tx, tab_ledger_id = v_tab
   where id = p_id;
  return json_build_object('id', p_id, 'status', 'approved', 'total_value', r.total_value);
end $$;

revoke all on function _sale_lines(text, uuid) from public, anon, authenticated;
grant execute on function get_returnable_sale(text, text, uuid) to authenticated;
grant execute on function request_sale_return(text, uuid, jsonb, text, text, uuid) to authenticated;
grant execute on function decide_sale_return(uuid, text, text) to authenticated;

-- The Action Center badge never counted stock quantity/price requests, so
-- admins only found them by opening the page. Returns are added alongside.
create or replace function notification_counts() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_is_admin boolean := false; v_employee uuid;
        v_bugs int := 0; v_orders int := 0; v_actions int := 0; v_reports int := 0;
begin
  if v_uid is null then return jsonb_build_object('bug_reports', 0, 'stock_orders', 0, 'action_center', 0, 'reports', 0); end if;
  select (role = 'admin') into v_is_admin from staff_profiles where id = v_uid;
  v_is_admin := coalesce(v_is_admin, false);
  select e.id into v_employee from employees e join staff_profiles sp on lower(sp.email) = lower(e.staff_account_email)
   where sp.id = v_uid limit 1;
  if v_is_admin then
    select count(*) into v_bugs from bug_reports where status in ('open', 'in_progress');
  else
    select count(*) into v_bugs from bug_reports where reporter_id = v_uid and replied_at is not null
       and (reply_seen_at is null or reply_seen_at < replied_at);
  end if;
  select count(*) into v_orders from dental_orders where status in ('placed', 'confirmed', 'reviewed', 'assigned', 'in_transit');
  v_orders := v_orders + (select count(*) from stock_item_requests where status = 'pending');
  select count(*) into v_reports from reports where status = 'pending';
  if v_is_admin then
    select (select count(*) from expense_transactions where status = 'pending')
         + (select count(*) from excuse_submissions where status = 'pending')
         + (select count(*) from visit_edit_requests where status = 'pending')
         + (select count(*) from stock_change_requests where status = 'pending')
         + (select count(*) from sale_returns where status = 'pending')
      into v_actions;
  else
    select coalesce((select count(*) from expense_transactions where status = 'pending' and type = 'cash_transfer' and to_employee_id = v_employee), 0)
         + coalesce((select count(*) from tasks where status = 'pending' and assigned_to_id = v_uid), 0)
      into v_actions;
  end if;
  return jsonb_build_object('bug_reports', coalesce(v_bugs, 0), 'stock_orders', coalesce(v_orders, 0),
                            'action_center', coalesce(v_actions, 0), 'reports', coalesce(v_reports, 0));
end $$;
