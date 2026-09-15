-- 0090: white-label clients - a logo of their own, and a password reset that
-- is a deliberate act rather than a side effect.
--
-- A client is a medical centre that sends scans here to be read and shows the
-- results to its own patients. So its portal carrying the Al Shrooouk mark is
-- wrong: the patient on the other side is the client's patient, not ours.
--
-- Two things are added.
--
-- 1. logo_url on clients, filled at creation or later, shown in place of our
--    mark on that client's portal.
--
-- 2. reset_client_password(), separate from create_client_credentials().
--    Today one function does both jobs: it sets a username and issues a new
--    password every time it is called. That is right when an account is being
--    made and wrong afterwards, because resending a portal link would silently
--    invalidate the password the client is already using. Creating an account
--    and resetting a password are different decisions and now have different
--    functions. The same flaw exists on doctors, where the Greeting button
--    calls create_doctor_credentials and resets the password on every send;
--    that is reported rather than changed here, since it is not what was asked
--    for and deserves its own decision.

alter table clients add column if not exists logo_url text;

-- issue a new password for an account that already exists. It will not create
-- one: if there is no username, the account has not been set up yet and the
-- caller should be creating it, not resetting it.
create or replace function reset_client_password(p_client_id uuid)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pwd text;
  v_username text;
begin
  select username into v_username from clients where id = p_client_id;
  if v_username is null then
    raise exception 'This client has no login yet. Create the account first.';
  end if;

  pwd := generate_temp_password();
  update clients
     set password_hash = crypt(pwd, gen_salt('bf')),
         must_change_password = true
   where id = p_client_id;
  return pwd;
end;
$$;

-- a public bucket: a logo is shown to the client's own patients on a page that
-- requires no login, so there is nothing here to protect.
insert into storage.buckets (id, name, public)
values ('client-logos', 'client-logos', true)
on conflict (id) do nothing;
-- staff upload and replace a client's logo; anyone may read it, since it is
-- shown on a portal page the client's patients reach without logging in.
drop policy if exists "client logos readable" on storage.objects;
create policy "client logos readable" on storage.objects
  for select using (bucket_id = 'client-logos');

drop policy if exists "client logos writable by staff" on storage.objects;
create policy "client logos writable by staff" on storage.objects
  for insert with check (bucket_id = 'client-logos' and auth.role() = 'authenticated');

drop policy if exists "client logos replaceable by staff" on storage.objects;
create policy "client logos replaceable by staff" on storage.objects
  for update using (bucket_id = 'client-logos' and auth.role() = 'authenticated');
