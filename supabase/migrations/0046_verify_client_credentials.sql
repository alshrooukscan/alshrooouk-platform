create or replace function verify_client_credentials(p_username text, p_password text)
returns uuid
language plpgsql
security definer
as $$
declare
  rec record;
begin
  select id, password_hash into rec from clients where username = p_username and is_pseudo = false;
  if rec.password_hash is null then return null; end if;
  if crypt(p_password, rec.password_hash) = rec.password_hash then
    return rec.id;
  end if;
  return null;
end;
$$;
