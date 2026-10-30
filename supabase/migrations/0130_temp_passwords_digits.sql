-- 0130: temporary passwords are 10 digits (Mohamed Said, 30 Oct 2026).
-- WhatsApp turns a run of digits into a tappable number, so the person can
-- tap the password and copy it on its own, exactly like the username (which
-- is their phone number). The old one mixed letters and digits (6035690a3f)
-- and stayed plain text, so copying it meant copying the whole message.
-- It is only ever a one-time password: the portal forces a change at first
-- login, and it is stored as a bcrypt hash like before.
CREATE OR REPLACE FUNCTION public.generate_temp_password()
 RETURNS text LANGUAGE sql VOLATILE AS $function$
  SELECT (floor(random() * 9) + 1)::int::text || lpad(floor(random() * 1000000000)::bigint::text, 9, '0');
$function$;
REVOKE ALL ON FUNCTION public.generate_temp_password() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_temp_password() TO authenticated, service_role;
