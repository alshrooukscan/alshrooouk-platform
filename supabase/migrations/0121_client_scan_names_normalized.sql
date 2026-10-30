-- 0121: client requests typed as "cbct q", "CBCT Q" or "cbctq" are 3D CBCT
-- Quadrant (Mohamed Said, 30 Oct 2026). The alias already resolved them for
-- bonuses and prices; this stores the proper name so every screen reads it.
-- New requests choose the scan type from a list, so this does not recur.
UPDATE reports SET scan_name = '3D CBCT Quadrant'
 WHERE source_type = 'client' AND lower(btrim(scan_name)) IN ('cbct q', 'cbctq', 'cbct quadrant', 'quadrant');
