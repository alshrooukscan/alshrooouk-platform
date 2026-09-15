-- 0094: an employee can confirm it is really them, without a username.
--
-- The pay figures in the employee portal are hidden until the person enters
-- their own password. verify_employee_credentials takes a username and a
-- password, which is right for logging in and wrong here: the session already
-- says who this is, and asking the browser to send a username back invites it
-- being sent for somebody else. This checks the password against one known
-- employee id and nothing else.
--
-- Returns a plain boolean and never says why. A caller learns only whether the
-- password matched, so this cannot be used to discover which accounts exist or
-- whether one is inactive.

create or replace function verify_employee_password(p_employee_id uuid, p_password text)
returns boolean
-- extensions is on the path because crypt() lives there, not in public. The
-- existing verify_*_credentials functions set no search_path at all and pick it
-- up from the session; naming it here keeps the function safe to call from
-- anywhere without depending on how the caller is configured.
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_hash text; v_active boolean;
begin
  if p_employee_id is null or coalesce(p_password,'') = '' then
    return false;
  end if;

  select password_hash, is_active into v_hash, v_active
    from employees where id = p_employee_id;

  if v_hash is null or v_active is not true then
    return false;
  end if;

  return v_hash = crypt(p_password, v_hash);
end;
$$;
