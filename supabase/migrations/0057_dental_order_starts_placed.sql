-- A doctor's order was showing as "Delivered" and "Unpaid" the moment it was
-- placed - and one of them as "Delivered" while its item was out of stock,
-- which is not a state that can exist.
--
-- Two faults stacked. dental_orders.status defaults to 'confirmed', a leftover
-- from before this table had a review-and-deliver workflow, and
-- place_dental_order never sets a status, so every new order took that default.
-- The dashboard then mapped 'confirmed' to a green "Delivered" badge. Nothing
-- had been delivered: delivered_at was null, no one was recorded as delivering
-- it, and stock had not been deducted.
--
-- Worse than a wrong label: no action in the panel handled 'confirmed', so
-- those orders were stranded - shown as finished, with Cancel as the only
-- thing anyone could do to them.
--
-- 'placed' is the real starting state: the order exists and is waiting to be
-- reviewed. 'confirmed' stays in the allowed list only so the two existing
-- rows can be read; nothing writes it any more.
alter table dental_orders alter column status set default 'placed';

update dental_orders
   set status = 'placed'
 where status = 'confirmed'
   and delivered_at is null
   and stock_deducted = false;
