-- Patient registration failed with "permission denied for function
-- split_visit" (10 Nov 2026). 0129 locked split_visit to service_role, but it
-- is called by the visits trigger split_multi_scan_visit(), which ran with the
-- rights of the staff member registering the patient. Run the trigger as its
-- owner instead, so split_visit stays closed to direct calls.
ALTER FUNCTION public.split_multi_scan_visit() SECURITY DEFINER;
ALTER FUNCTION public.split_multi_scan_visit() SET search_path = public;
