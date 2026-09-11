-- 0079: hold the split until the end of the transaction.
--
-- 0078 split the moment the visit row landed, which broke registration. The
-- registration function writes the visit and then its payment, so the split
-- ran first, cut the charge from 2040 to 1560, and the payment of 2040 that
-- followed was refused by the over-collection guard - correctly, since by then
-- the visit really was only charged 1560. A patient having two scans could not
-- be registered at all.
--
-- A deferred constraint trigger runs at commit instead, by which time the
-- payment is attached and split_visit can divide it across the new visits the
-- way it was always meant to.

drop trigger if exists trg_split_multi_scan_visit on visits;

create constraint trigger trg_split_multi_scan_visit
  after insert on visits
  deferrable initially deferred
  for each row
  when (coalesce(array_length(new.scan_types, 1), 0) > 1)
  execute function split_multi_scan_visit();
