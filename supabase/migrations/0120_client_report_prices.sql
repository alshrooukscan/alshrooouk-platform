-- 0120: report prices for external clients (Mohamed Said, 30 Oct 2026).
-- A client (another centre) sends scans for reporting. Their reports were never
-- priced anywhere: 36 reports for "Image" and nothing recorded against them.
-- Each client gets its own price per scan type; a default per scan type covers
-- clients with no price of their own. Nothing is charged automatically: the
-- client page shows reports x price per month, so the bill can be checked.

CREATE TABLE IF NOT EXISTS client_report_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  exam_type_id uuid NOT NULL REFERENCES exam_types(id) ON DELETE CASCADE,
  price numeric(12,2) NOT NULL CHECK (price >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_name text,
  UNIQUE (client_id, exam_type_id)
);
ALTER TABLE client_report_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_all ON client_report_prices;
CREATE POLICY staff_all ON client_report_prices FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE exam_types ADD COLUMN IF NOT EXISTS default_client_report_price numeric(12,2);

-- "cbctq" (no space) was typed for one report and matched nothing.
UPDATE exam_types SET name_aliases = array_append(name_aliases, 'cbctq')
 WHERE name = '3D CBCT Quadrant' AND NOT ('cbctq' = ANY(name_aliases));

-- One client's reports in a date range, each with the scan type it resolves to
-- and its price: the client's own, else the scan type's default for clients.
CREATE OR REPLACE FUNCTION public.client_reports_priced(p_client_id uuid, p_from date, p_to date)
 RETURNS TABLE(report_id uuid, scan_name text, exam_type_id uuid, exam_type_name text, status text,
               created_at timestamptz, completed_at timestamptz, price numeric, price_source text)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT r.id, r.scan_name, et.id, et.name, r.status, r.created_at, r.completed_at,
         coalesce(crp.price, et.default_client_report_price),
         CASE WHEN crp.price IS NOT NULL THEN 'client' WHEN et.default_client_report_price IS NOT NULL THEN 'default' ELSE 'none' END
  FROM reports r
  LEFT JOIN LATERAL (SELECT (public.hr_exam_type_by_name(r.scan_name)).*) et ON true
  LEFT JOIN client_report_prices crp ON crp.client_id = r.client_id AND crp.exam_type_id = et.id
  WHERE r.client_id = p_client_id AND r.source_type = 'client'
    AND (r.created_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN p_from AND p_to
  ORDER BY r.created_at
$function$;
GRANT EXECUTE ON FUNCTION public.client_reports_priced(uuid, date, date) TO authenticated, service_role;
