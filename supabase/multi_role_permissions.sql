-- DEPRECATED: legacy role migration retained for historical reference only.
-- The authoritative migration for the current app state is:
-- supabase/final_migration_multi_role_and_csv.sql

-- UE CLUBISTE - multi-role permissions migration
-- Safe migration for existing installations. Keeps the legacy `profiles.role` field
-- for compatibility while introducing a proper many-to-many role system.

create table if not exists public.roles (
  role_name text primary key check (role_name in ('SUPERADMIN','ADMIN','TREASURER','MEMBER')),
  description text,
  created_at timestamptz not null default now()
);

insert into public.roles(role_name, description)
values
  ('SUPERADMIN', 'Unrestricted access'),
  ('ADMIN', 'Read-only supervisor access'),
  ('TREASURER', 'Membership and event payment management'),
  ('MEMBER', 'Own profile and stadium access')
on conflict (role_name) do nothing;

create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role_name text not null references public.roles(role_name) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, role_name)
);

alter table public.profiles
  alter column role type text using coalesce(role::text, 'SUBSCRIBER');

alter table public.profiles
  alter column role set default 'SUBSCRIBER';

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('ADMIN','SUPERADMIN','SUBSCRIBER','MEMBER','TREASURER'));

-- Backfill legacy role assignments into the many-to-many relation.
insert into public.user_roles(user_id, role_name)
select id, case
  when lower(coalesce(role,'')) = 'superadmin' then 'SUPERADMIN'
  when lower(coalesce(role,'')) = 'admin' then 'ADMIN'
  when lower(coalesce(role,'')) = 'subscriber' then 'MEMBER'
  else coalesce(nullif(lower(role),''), 'MEMBER')
end
from public.profiles
where role is not null and trim(role) <> ''
  and lower(role) in ('superadmin','admin','subscriber','member','treasurer')
on conflict (user_id, role_name) do nothing;

insert into public.user_roles(user_id, role_name)
select id, 'TREASURER'
from public.profiles
where is_treasurer = true
on conflict (user_id, role_name) do nothing;

create or replace function public.user_has_role(p_user_id uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = p_user_id
      and role_name = upper(trim(coalesce(p_role, '')))
  )
  or exists (
    select 1
    from public.profiles
    where id = p_user_id
      and upper(trim(coalesce(role, ''))) = upper(trim(coalesce(p_role, '')))
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
      and upper(ur.role_name) = any (
        select upper(trim(r))
        from unnest(p_roles) as r
        where r is not null and trim(r) <> ''
      )
  )
  or exists (
    select 1
    from public.profiles pr
    where pr.id = p_user_id
      and upper(trim(coalesce(pr.role, ''))) = any (
        select upper(trim(r))
        from unnest(p_roles) as r
        where r is not null and trim(r) <> ''
      )
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_active = true
      and (
        public.has_any_role(id, array['ADMIN', 'SUPERADMIN', 'TREASURER'])
      )
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
    select 1 from public.profiles
    where id = auth.uid()
      and is_active = true
      and public.has_any_role(id, array['ADMIN', 'SUPERADMIN'])
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
    select 1 from public.profiles
    where id = auth.uid()
      and is_active = true
      and public.user_has_role(id, 'SUPERADMIN')
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
    select 1 from public.profiles
    where id = auth.uid()
      and is_active = true
      and (
        public.user_has_role(id, 'TREASURER')
        or is_treasurer = true
      )
  );
$$;

revoke all on function public.user_has_role(uuid, text) from public;
revoke all on function public.has_any_role(uuid, text[]) from public;
revoke all on function public.is_staff() from public;
revoke all on function public.is_admin() from public;
revoke all on function public.is_superadmin() from public;
revoke all on function public.is_treasurer() from public;

grant execute on function public.user_has_role(uuid, text) to authenticated;
grant execute on function public.has_any_role(uuid, text[]) to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_superadmin() to authenticated;
grant execute on function public.is_treasurer() to authenticated;
