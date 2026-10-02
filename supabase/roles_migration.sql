-- DEPRECATED: legacy role migration retained for historical reference only.
-- The authoritative migration for the current app state is:
-- supabase/final_migration_multi_role_and_csv.sql

-- UE CLUBISTE — roles & permissions migration
-- Run AFTER schema.sql and security_hardening.sql.
-- Rayen + Oussema = SUPERADMIN + TREASURER.
-- Other existing admins remain ADMIN.
-- Adjust the two name/email match clauses if your profiles use different values.

-- Use text for roles so SUPERADMIN can be introduced without enum transaction issues.
alter table public.profiles
  alter column role drop default;

alter table public.profiles
  alter column role type text using role::text;

alter table public.profiles
  alter column role set default 'SUBSCRIBER';

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('ADMIN','SUPERADMIN','SUBSCRIBER'));

alter table public.profiles
  add column if not exists is_treasurer boolean not null default false;

-- Superadmins are also admins for all normal administrative operations.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('ADMIN','SUPERADMIN')
      and is_active = true
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
    from public.profiles
    where id = auth.uid()
      and role = 'SUPERADMIN'
      and is_active = true
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
    from public.profiles
    where id = auth.uid()
      and is_treasurer = true
      and is_active = true
  );
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.is_superadmin() from public;
revoke all on function public.is_treasurer() from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_superadmin() to authenticated;
grant execute on function public.is_treasurer() to authenticated;

-- Protect the secondary Treasurer privilege from client-side escalation.
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
     or old.id is distinct from new.id
  then
    if auth.uid() is not null and auth.role() <> 'service_role' then
      raise exception 'Protected profile fields can only be changed server-side';
    end if;
  end if;
  return new;
end;
$$;

-- Keep every current ADMIN as ADMIN; promote only Rayen and Oussema.
-- Matching is intentionally limited to display_name/email.
update public.profiles
set role = 'SUPERADMIN',
    is_treasurer = true,
    updated_at = now()
where (
  lower(coalesce(display_name,'')) in ('rayen','rayen mkadmini','rayen megadmini')
  or lower(coalesce(display_name,'')) like 'rayen %'
  or lower(coalesce(email,'')) like 'rayen%@%'
)
and role in ('ADMIN','SUPERADMIN');

update public.profiles
set role = 'SUPERADMIN',
    is_treasurer = true,
    updated_at = now()
where (
  lower(coalesce(display_name,'')) in ('oussema','oussema louhichi')
  or lower(coalesce(display_name,'')) like 'oussema %'
  or lower(coalesce(email,'')) like 'oussema%@%'
)
and role in ('ADMIN','SUPERADMIN');

-- Ensure all other existing administrators stay ADMIN and are not treasurers.
update public.profiles
set role = 'ADMIN',
    is_treasurer = false,
    updated_at = now()
where role = 'ADMIN'
  and not (
    lower(coalesce(display_name,'')) like 'rayen%'
    or lower(coalesce(display_name,'')) like 'oussema%'
    or lower(coalesce(email,'')) like 'rayen%@%'
    or lower(coalesce(email,'')) like 'oussema%@%'
  );

-- Enforce exactly two named SUPERADMIN accounts; every other admin stays ADMIN.
update public.profiles
set role = 'ADMIN', is_treasurer = false, updated_at = now()
where role = 'SUPERADMIN'
  and not (
    lower(coalesce(display_name,'')) like 'rayen%'
    or lower(coalesce(display_name,'')) like 'oussema%'
    or lower(coalesce(email,'')) like 'rayen%@%'
    or lower(coalesce(email,'')) like 'oussema%@%'
  );

-- Verification
select id, display_name, email, role, is_treasurer, is_active
from public.profiles
where role in ('ADMIN','SUPERADMIN')
order by role desc, display_name;
