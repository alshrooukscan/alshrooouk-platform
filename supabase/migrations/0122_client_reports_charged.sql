-- 0122: client reports are charged to the client's account (Mohamed Said, 30 Oct 2026).
--  - client_reports_priced no longer calls hr_exam_type_by_name, which staff
--    (authenticated) may not execute: the call failed and the client page read
--    "No reports from Image this month" over 24 reports. It was also callable
--    by anon; now staff and the service role only.
--  - A finished client report is charged to the client's account (brand scan)
--    at its report price, once, the moment it is completed. A report finished
--    with no price yet stays uncharged until a price exists and staff charge it.
--  - reports.request_note keeps the client's own "What is this for?" text next
--    to the scan type they choose.

ALTER TABLE reports ADD COLUMN IF NOT EXISTS request_note text;

CREATE OR REPLACE FUNCTION public.client_report_type(p_name text)
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT id FROM exam_types
   WHERE lower(btrim(name)) = lower(btrim(p_name)) OR lower(btrim(p_name)) = ANY(name_aliases)
   ORDER BY (lower(btrim(name)) = lower(btrim(p_name))) DESC, is_active DESC LIMIT 1
$f$;

DROP FUNCTION IF EXISTS public.client_reports_priced(uuid, date, date);
CREATE FUNCTION public.client_reports_priced(p_client_id uuid, p_from date, p_to date)
 RETURNS TABLE(report_id uuid, scan_name text, request_note text, exam_type_id uuid, exam_type_name text, status text,
               created_at timestamptz, completed_at timestamptz, price numeric, price_source text,
               charged boolean, charged_amount numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT r.id, r.scan_name, r.request_note, et.id, et.name, r.status, r.created_at, r.completed_at,
         coalesce(crp.price, et.default_client_report_price),
         CASE WHEN crp.price IS NOT NULL THEN 'client' WHEN et.default_client_report_price IS NOT NULL THEN 'default' ELSE 'none' END,
         (l.id IS NOT NULL), l.amount
  FROM reports r
  LEFT JOIN exam_types et ON et.id = public.client_report_type(r.scan_name)
  LEFT JOIN client_report_prices crp ON crp.client_id = r.client_id AND crp.exam_type_id = et.id
  LEFT JOIN LATERAL (SELECT x.id, x.amount FROM customer_ar_ledger x
                      WHERE x.reference_type = 'client_report' AND x.reference_id = r.id AND x.direction = 'charge' LIMIT 1) l ON true
  WHERE r.client_id = p_client_id AND r.source_type = 'client'
    AND (r.created_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN p_from AND p_to
  ORDER BY r.created_at
$f$;

-- Charge one finished client report, once. Returns the amount charged, 0 when
-- nothing was charged (not finished, no price, or already charged).
CREATE OR REPLACE FUNCTION public.client_report_charge(p_report_id uuid, p_by text DEFAULT 'System')
 RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE r reports; v_type uuid; v_name text; v_price numeric;
BEGIN
  SELECT * INTO r FROM reports WHERE id = p_report_id;
  IF r.id IS NULL OR r.source_type <> 'client' OR r.client_id IS NULL OR r.status <> 'completed' THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM customer_ar_ledger WHERE reference_type = 'client_report' AND reference_id = r.id AND direction = 'charge') THEN RETURN 0; END IF;
  v_type := public.client_report_type(r.scan_name);
  SELECT et.name, coalesce(crp.price, et.default_client_report_price) INTO v_name, v_price
    FROM exam_types et LEFT JOIN client_report_prices crp ON crp.client_id = r.client_id AND crp.exam_type_id = et.id
   WHERE et.id = v_type;
  IF v_price IS NULL OR v_price <= 0 THEN RETURN 0; END IF;
  INSERT INTO customer_ar_ledger (customer_type, customer_id, brand, direction, amount, reference_type, reference_id, note, entry_date, created_by_name)
  VALUES ('client', r.client_id, 'scan', 'charge', v_price, 'client_report', r.id,
          'Report: ' || coalesce(v_name, r.scan_name) || coalesce(' · ' || nullif(r.client_uploaded_file_name, ''), ''),
          coalesce((r.completed_at AT TIME ZONE 'Africa/Cairo')::date, (now() AT TIME ZONE 'Africa/Cairo')::date), p_by);
  RETURN v_price;
END $f$;

-- Charge everything finished and priced but not yet charged, for one client.
CREATE OR REPLACE FUNCTION public.client_charge_uncharged(p_client_id uuid, p_by text DEFAULT 'Staff')
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE x record; n int := 0; total numeric := 0; amt numeric;
BEGIN
  FOR x IN SELECT id FROM reports WHERE client_id = p_client_id AND source_type = 'client' AND status = 'completed' ORDER BY completed_at NULLS LAST, created_at LOOP
    amt := public.client_report_charge(x.id, p_by);
    IF amt > 0 THEN n := n + 1; total := total + amt; END IF;
  END LOOP;
  RETURN json_build_object('count', n, 'amount', total);
END $f$;

CREATE OR REPLACE FUNCTION public.trg_client_report_charge() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF NEW.source_type = 'client' AND NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed') THEN
    PERFORM public.client_report_charge(NEW.id, 'System (report completed)');
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS client_report_charge ON reports;
CREATE TRIGGER client_report_charge AFTER INSERT OR UPDATE OF status ON reports
  FOR EACH ROW EXECUTE FUNCTION public.trg_client_report_charge();

REVOKE ALL ON FUNCTION public.client_report_type(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.client_reports_priced(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.client_report_charge(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.client_charge_uncharged(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_report_type(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_reports_priced(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_report_charge(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.client_charge_uncharged(uuid, text) TO authenticated, service_role;
