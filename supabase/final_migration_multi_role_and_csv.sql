
-- ============================================================
-- UE CLUBISTE — AUTHORITY MIGRATION
-- STATUS: NOT APPROVED — DO NOT RUN OR PUSH.
-- Production inspection found that this draft does not secure user_roles,
-- retains profile-role authorization, and adds policies without reconciling
-- the live permissive policies. Use only after a reviewed replacement migration
-- explicitly addresses those blockers and is validated against live metadata.
-- ============================================================

create extension if not exists pgcrypto;

-- 1) Roles catalog and many-to-many mapping
create table if not exists public.roles (
  role_name text primary key check (role_name in ('SUPERADMIN','ADMIN','TREASURER','MEMBER')),
  description text,
  created_at timestamptz not null default now()
);

insert into public.roles(role_name, description)
values
  ('SUPERADMIN', 'Unrestricted access'),
  ('ADMIN', 'Supervisor read-only access'),
  ('TREASURER', 'Membership and payment management'),
  ('MEMBER', 'Own profile and stadium access')
on conflict (role_name) do nothing;

create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role_name text not null references public.roles(role_name) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, role_name)
);

-- Backfill existing legacy roles into public.user_roles without deleting data.
insert into public.user_roles(user_id, role_name)
select id, 'SUPERADMIN'
from public.profiles
where upper(trim(coalesce(role::text,''))) = 'SUPERADMIN'
on conflict (user_id, role_name) do nothing;

insert into public.user_roles(user_id, role_name)
select id, 'ADMIN'
from public.profiles
where upper(trim(coalesce(role::text,''))) = 'ADMIN'
on conflict (user_id, role_name) do nothing;

insert into public.user_roles(user_id, role_name)
select id, 'TREASURER'
from public.profiles
where is_treasurer = true
on conflict (user_id, role_name) do nothing;

insert into public.user_roles(user_id, role_name)
select id, 'MEMBER'
from public.profiles
where upper(trim(coalesce(role::text,''))) in ('MEMBER','SUBSCRIBER')
on conflict (user_id, role_name) do nothing;

-- Keep legacy profiles.role only as compatibility. Authorization decisions
-- must use user_roles as the canonical source of truth.
alter table public.profiles
  alter column role type text using coalesce(role::text, 'SUBSCRIBER');

alter table public.profiles
  alter column role set default 'SUBSCRIBER';

alter table public.profiles
  add column if not exists is_active boolean not null default true;

alter table public.profiles
  add column if not exists is_treasurer boolean not null default false;

-- 2) Make subscription number nullable and keep one unique index for non-null values.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'subscribers' and column_name = 'numero_abonnement'
  ) then
    alter table public.subscribers alter column numero_abonnement drop not null;
  end if;
end $$;

create unique index if not exists subscribers_numero_abonnement_unique
  on public.subscribers(numero_abonnement)
  where numero_abonnement is not null;

-- 3) Canonical role helper functions
create or replace function public.user_has_role(p_user_id uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = p_user_id
      and upper(trim(ur.role_name)) = upper(trim(coalesce(p_role, '')))
  )
  or exists (
    select 1
    from public.profiles pr
    where pr.id = p_user_id
      and upper(trim(coalesce(pr.role, ''))) = upper(trim(coalesce(p_role, '')))
  );
$$;

create or replace function public.has_any_role(p_user_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = p_user_id
      and upper(trim(ur.role_name)) = any (
        select upper(trim(r))
        from unnest(coalesce(p_roles, array[]::text[])) as r
        where r is not null and trim(r) <> ''
      )
  )
  or exists (
    select 1
    from public.profiles pr
    where pr.id = p_user_id
      and upper(trim(coalesce(pr.role, ''))) = any (
        select upper(trim(r))
        from unnest(coalesce(p_roles, array[]::text[])) as r
        where r is not null and trim(r) <> ''
      )
  );
$$;

create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.is_active is not false
      and public.user_has_role(pr.id, 'SUPERADMIN')
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.is_active is not false
      and public.has_any_role(pr.id, array['ADMIN','SUPERADMIN'])
  );
$$;

create or replace function public.is_treasurer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.is_active is not false
      and (
        public.user_has_role(pr.id, 'TREASURER')
        or pr.is_treasurer = true
      )
  );
$$;

grant execute on function public.user_has_role(uuid, text) to authenticated;
grant execute on function public.has_any_role(uuid, text[]) to authenticated;
grant execute on function public.is_superadmin() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_treasurer() to authenticated;

-- 4) Protected profile fields: role/status changes must be server-side only.
create or replace function public.protect_profile_privilege_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role is distinct from new.role
     or old.is_active is distinct from new.is_active
     or old.is_treasurer is distinct from new.is_treasurer
  then
    if auth.uid() is not null and auth.role() <> 'service_role' then
      raise exception 'Protected profile fields can only be changed server-side';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_privilege_fields on public.profiles;
create trigger protect_profile_privilege_fields
before update on public.profiles
for each row execute function public.protect_profile_privilege_fields();

-- 5) RLS baseline: staff read; superadmin full admin; member own data only.
-- Keep this intentionally conservative and expand only when the application logic
-- is audited and verified in the real Supabase project.

alter table public.profiles enable row level security;
alter table public.subscribers enable row level security;
alter table public.faculties enable row level security;
alter table public.zones enable row level security;

-- Profiles: self read, admin read, write only server-side via function.
drop policy if exists "profiles_self_read" on public.profiles;
create policy "profiles_self_read" on public.profiles for select using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_server_only_write" on public.profiles;
create policy "profiles_server_only_write" on public.profiles for update using (false) with check (false);

-- Subscribers: self read; member updates only their own allowed fields; staff read; superadmin writes.
drop policy if exists "subscribers_self_read" on public.subscribers;
create policy "subscribers_self_read" on public.subscribers for select using (user_id = auth.uid() or public.is_admin() or public.is_treasurer());

drop policy if exists "subscribers_self_update" on public.subscribers;
create policy "subscribers_self_update" on public.subscribers for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "subscribers_admin_write" on public.subscribers;
create policy "subscribers_admin_write" on public.subscribers for all using (public.is_superadmin()) with check (public.is_superadmin());

-- Facilitates staff read while keeping writes restricted.
drop policy if exists "faculties_staff_read" on public.faculties;
create policy "faculties_staff_read" on public.faculties for select using (public.is_admin() or public.is_treasurer());

drop policy if exists "faculties_superadmin_write" on public.faculties;
create policy "faculties_superadmin_write" on public.faculties for all using (public.is_superadmin()) with check (public.is_superadmin());

drop policy if exists "zones_staff_read" on public.zones;
create policy "zones_staff_read" on public.zones for select using (public.is_admin() or public.is_treasurer());

drop policy if exists "zones_superadmin_write" on public.zones;
create policy "zones_superadmin_write" on public.zones for all using (public.is_superadmin()) with check (public.is_superadmin());

-- This migration does not delete member rows, tables, or users.
-- It only adds the canonical role system, relaxes the subscription-number constraint,
-- and preserves the legacy profile field for compatibility while preventing direct client escalation.
