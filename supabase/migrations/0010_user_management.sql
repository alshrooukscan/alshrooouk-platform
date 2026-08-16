-- Admin-only User Management: staff_profiles with per-module permissions

create table if not exists staff_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  email text,
  role text not null default 'staff' check (role in ('admin','staff')),
  permissions jsonb not null default '{"dashboard":false,"patients":false,"doctors":false,"stock":false,"hr":false,"settings":false}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table staff_profiles enable row level security;

create or replace function is_admin() returns boolean as $$
  select exists(select 1 from staff_profiles where id = auth.uid() and role = 'admin' and is_active = true);
$$ language sql security definer stable;

drop policy if exists self_or_admin_select on staff_profiles;
create policy self_or_admin_select on staff_profiles for select to authenticated
  using (id = auth.uid() or is_admin());

drop policy if exists admin_insert on staff_profiles;
create policy admin_insert on staff_profiles for insert to authenticated with check (is_admin());

drop policy if exists admin_update on staff_profiles;
create policy admin_update on staff_profiles for update to authenticated using (is_admin());

drop policy if exists admin_delete on staff_profiles;
create policy admin_delete on staff_profiles for delete to authenticated using (is_admin());

-- Bootstrap the CEO's existing login as the first admin, full access
insert into staff_profiles (id, name, email, role, permissions, is_active)
select id, 'Moamen Said', email, 'admin',
  '{"dashboard":true,"patients":true,"doctors":true,"stock":true,"hr":true,"settings":true}'::jsonb, true
from auth.users where email = 'moamen@i-gamify.net'
on conflict (id) do update set role = 'admin', permissions = excluded.permissions, is_active = true;
