-- 0133: a card payment that Paymob matches later leaves the Action Center by
-- itself (Mohamed Said, 3 Nov 2026). Ahmed Hamdy's 480 EGP was matched on
-- 29 Oct (late match, card 2924) and showed Verified on his visit, but its
-- review stayed "pending" in Card Payments Awaiting Your Approval until it
-- was approved by hand. Any payment that becomes Paymob-verified now closes
-- its pending review, and the one still open (1,160 EGP) is closed here.
CREATE OR REPLACE FUNCTION public.trg_close_card_review_on_match()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF NEW.paymob_transaction_id IS NOT NULL OR coalesce(NEW.payment_verification, '') LIKE 'verified%' THEN
    UPDATE paymob_verification_reviews
       SET status = 'approved', decided_by_name = 'Paymob', decided_at = now(),
           decision_note = 'Matched on Paymob after the review was opened'
     WHERE payment_id = NEW.id AND status = 'pending';
  END IF;
  RETURN NULL;
END $f$;

DROP TRIGGER IF EXISTS visit_payment_closes_card_review ON visit_payments;
CREATE TRIGGER visit_payment_closes_card_review
  AFTER UPDATE OF payment_verification, paymob_transaction_id ON visit_payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_close_card_review_on_match();

UPDATE paymob_verification_reviews r
   SET status = 'approved', decided_by_name = 'Paymob', decided_at = now(),
       decision_note = 'Matched on Paymob after the review was opened'
  FROM visit_payments vp
 WHERE vp.id = r.payment_id AND r.status = 'pending'
   AND (vp.paymob_transaction_id IS NOT NULL OR coalesce(vp.payment_verification, '') LIKE 'verified%');
