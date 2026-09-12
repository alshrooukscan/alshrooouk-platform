-- 0080  Paymob card verification
--
-- The clinic's card machine reports into Paymob, not into this platform, so a
-- payment recorded as "Visa" was only ever a claim. This adds the proof: the
-- Paymob charge behind each card payment, and a mirror of the gateway's own
-- transaction list to check against.
--
-- It also settles the historical data. Before the platform went live, every
-- payment came in through a bulk import with no method recorded (4,615 rows
-- reading "Unknown"), so the clinic could not say how any of its 2023-2026
-- revenue was collected.
--
-- Two things made the historical pass possible and one thing limited it:
--   * visit_payments.paid_at is NOT a real payment time on imported rows -
--     it is the import timestamp, shared by thousands of rows. visits.exam_time
--     is the real clock time and is what the matching used.
--   * Paymob returns Cairo local time with no offset; this platform stores UTC.
--     Every comparison converts (+3h) or evening payments land on the wrong day.
--   * Paymob's history only reaches back to Feb 2025. Payments before that
--     cannot be verified by anyone, at any effort.
--
-- Applied to production on 2026-09-12. Recorded here so the schema history is
-- accurate; the data statements are written to be safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Rollback point. 4,696 rows as they stood before any reclassification.
-- ---------------------------------------------------------------------------
create table if not exists visit_payments_backup_paymob_0080 as
  select * from visit_payments;

comment on table visit_payments_backup_paymob_0080 is
  'Full snapshot of visit_payments before Paymob historical reclassification (migration 0080). Do not drop without checking with MO Said.';

-- ---------------------------------------------------------------------------
-- 2. Proof columns on the payment itself.
--
-- payment_verification is the important one. Its values carry different
-- weights and must not be treated as interchangeable:
--   verified_paymob             - matched against the scan terminal, live traffic
--   verified_paymob_historical  - matched in the one-off historical pass
--   assumed_pre_launch          - pre-launch, no card charge found, recorded as cash
--   NULL                        - no verdict yet (a fresh card payment, or one
--                                 that needs a human look)
--
-- An unproven card payment is deliberately NOT converted to cash. Doing that
-- would invent cash that no employee is holding, and the cash ledger is
-- balanced against real people's pockets every day.
-- ---------------------------------------------------------------------------
alter table visit_payments
  add column if not exists payment_verification text,
  add column if not exists paymob_transaction_id bigint,
  add column if not exists paymob_terminal_id text,
  add column if not exists paymob_card_brand text,
  add column if not exists paymob_card_last4 text,
  add column if not exists paymob_fees numeric,
  add column if not exists paymob_match_gap_minutes integer,
  add column if not exists paymob_matched_at timestamptz;

-- One card charge can only ever pay for one payment row. Without this, a
-- retry or a loose match could let a single tap be counted as two collections.
create unique index if not exists uq_visit_payments_paymob_tx
  on visit_payments(paymob_transaction_id)
  where paymob_transaction_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Mirror of the gateway's transactions.
--
-- Kept for every terminal on the merchant account, not just the scan one, so
-- the history can be audited - but live verification only ever reads the scan
-- terminal. The dental supply store runs on the same merchant account with
-- much larger tickets, and a store charge must never be claimed as a
-- patient's scan payment.
--
-- Both gross and net are stored: the patient paid the gross, the clinic banks
-- the net, and reconciliation needs to see the fee between them.
-- ---------------------------------------------------------------------------
create table if not exists paymob_transactions (
  id bigint primary key,                    -- Paymob's own transaction id
  order_id bigint,
  terminal_id text,
  integration_id bigint,
  amount numeric not null,                  -- gross, what the patient paid
  fees numeric,
  net_amount numeric,                       -- what the clinic actually banks
  currency text default 'EGP',
  success boolean not null,                 -- declines are kept, for audit
  is_voided boolean default false,
  is_refunded boolean default false,
  is_settled boolean default false,         -- changes later, at the bank's pace
  source_type text,                         -- card / wallet
  card_brand text,
  card_last4 text,
  api_source text,                          -- MPOS for the physical terminal
  created_at_paymob timestamp not null,     -- CAIRO LOCAL TIME, no offset
  matched_payment_id uuid unique references visit_payments(id),
  matched_at timestamptz,
  review_status text default 'unreviewed',  -- unreviewed | matched | dismissed
  raw jsonb,
  synced_at timestamptz default now()
);

create index if not exists ix_paymob_tx_created on paymob_transactions(created_at_paymob desc);
create index if not exists ix_paymob_tx_lookup on paymob_transactions(terminal_id, amount, created_at_paymob);
create index if not exists ix_paymob_tx_unmatched on paymob_transactions(review_status)
  where matched_payment_id is null;

comment on table paymob_transactions is
  'Mirror of Paymob card/wallet transactions used to verify visit payments. Synced from the Paymob API; never edited by hand.';

-- ---------------------------------------------------------------------------
-- 4. Totals for the reconciliation screen.
-- ---------------------------------------------------------------------------
create or replace function paymob_reconciliation_totals()
returns json language sql stable security definer set search_path = public as $$
select json_build_object(
  'verified_visa_count',    (select count(*) from visit_payments where payment_verification in ('verified_paymob','verified_paymob_historical')),
  'verified_visa_amount',   (select coalesce(sum(amount),0) from visit_payments where payment_verification in ('verified_paymob','verified_paymob_historical')),
  'verified_fees',          (select coalesce(sum(paymob_fees),0) from visit_payments where paymob_fees is not null),
  'unverified_card_count',  (select count(*) from visit_payments where payment_method in ('Visa','Wallet') and payment_verification is null and paid_at >= '2026-08-29'),
  'unverified_card_amount', (select coalesce(sum(amount),0) from visit_payments where payment_method in ('Visa','Wallet') and payment_verification is null and paid_at >= '2026-08-29'),
  'unclaimed_charge_count', (select count(*) from paymob_transactions where terminal_id = '1002156' and success and not is_voided and matched_payment_id is null and review_status <> 'dismissed' and created_at_paymob >= '2026-08-29'),
  'unclaimed_charge_amount',(select coalesce(sum(amount),0) from paymob_transactions where terminal_id = '1002156' and success and not is_voided and matched_payment_id is null and review_status <> 'dismissed' and created_at_paymob >= '2026-08-29'),
  'assumed_cash_count',     (select count(*) from visit_payments where payment_verification = 'assumed_pre_launch'),
  'assumed_cash_amount',    (select coalesce(sum(amount),0) from visit_payments where payment_verification = 'assumed_pre_launch')
)$$;

-- ---------------------------------------------------------------------------
-- 5. What the historical pass produced, for the record.
--
--   Visa, verified historical      823 payments    EGP   667,845
--   Visa, verified live             14 payments    EGP    12,410
--   Visa, unproven (kept as Visa)   19 payments    EGP    15,970
--   Cash, assumed pre-launch     3,792 payments    EGP 2,431,234
--
-- Nothing in this migration touched an amount, a visit link, a payment date,
-- or expense_transactions. No historical payment was linked into the cash
-- ledger (source_payment_id was null on all of them), so no employee's cash
-- balance moved - which is the only reason a reclassification of this size was
-- safe to run at all.
-- ---------------------------------------------------------------------------
