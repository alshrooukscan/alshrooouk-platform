create or replace function create_doctor_credentials(p_doctor_id uuid, p_username text)
returns text as $$
declare
  pwd text;
begin
  pwd := generate_temp_password();
  update doctors set username = p_username, password_hash = crypt(pwd, gen_salt('bf')) where id = p_doctor_id;
  return pwd;
end;
$$ language plpgsql security definer;

grant execute on function create_doctor_credentials(uuid, text) to authenticated;
