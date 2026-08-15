-- Portal auth: credential verification functions, callable by anon (portal users aren't Supabase Auth users)

create or replace function verify_patient_credentials(p_username text, p_password text)
returns uuid as $$
declare
  rec record;
begin
  select patient_id, password_hash into rec from patient_auth where username = p_username;
  if rec.password_hash is null then return null; end if;
  if crypt(p_password, rec.password_hash) = rec.password_hash then
    return rec.patient_id;
  end if;
  return null;
end;
$$ language plpgsql security definer;

create or replace function verify_doctor_credentials(p_username text, p_password text)
returns uuid as $$
declare
  rec record;
begin
  select id, password_hash into rec from doctors where username = p_username;
  if rec.password_hash is null then return null; end if;
  if crypt(p_password, rec.password_hash) = rec.password_hash then
    return rec.id;
  end if;
  return null;
end;
$$ language plpgsql security definer;

create or replace function verify_employee_credentials(p_username text, p_password text)
returns uuid as $$
declare
  rec record;
begin
  select id, password_hash into rec from employees where username = p_username;
  if rec.password_hash is null then return null; end if;
  if crypt(p_password, rec.password_hash) = rec.password_hash then
    return rec.id;
  end if;
  return null;
end;
$$ language plpgsql security definer;

grant execute on function verify_patient_credentials(text,text) to anon, authenticated;
grant execute on function verify_doctor_credentials(text,text) to anon, authenticated;
grant execute on function verify_employee_credentials(text,text) to anon, authenticated;
