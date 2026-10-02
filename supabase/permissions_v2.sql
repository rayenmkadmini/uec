-- DEPRECATED: legacy role migration retained for historical reference only.
-- The authoritative migration for the current app state is:
-- supabase/final_migration_multi_role_and_csv.sql

-- UE CLUBISTE - final role permissions
-- Run AFTER schema.sql, security_hardening.sql, roles_migration.sql and payments.sql

-- Roles: SUPERADMIN / ADMIN / TREASURER / MEMBER.
-- Multiple roles are supported through public.user_roles.

create table if not exists public.roles (
  role_name text primary key check (role_name in ('SUPERADMIN','ADMIN','TREASURER','MEMBER')),
  description text,
  created_at timestamptz not null default now()
);

insert into public.roles(role_name, description)
values
  ('SUPERADMIN', 'Unrestricted access'),
  ('ADMIN', 'Supervisor read-only access'),
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

insert into public.user_roles(user_id, role_name)
select id, case
  when lower(coalesce(role,'')) = 'superadmin' then 'SUPERADMIN'
  when lower(coalesce(role,'')) = 'admin' then 'ADMIN'
  when lower(coalesce(role,'')) = 'subscriber' then 'MEMBER'
  else 'MEMBER'
end
from public.profiles
where role is not null and trim(role) <> ''
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
    select 1 from public.user_roles
    where user_id = p_user_id
      and role_name = upper(trim(coalesce(p_role, '')))
  )
  or exists (
    select 1 from public.profiles
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
    select 1 from public.user_roles ur
    where ur.user_id = p_user_id
      and upper(ur.role_name) = any (
        select upper(trim(r)) from unnest(p_roles) as r where r is not null and trim(r) <> ''
      )
  )
  or exists (
    select 1 from public.profiles pr
    where pr.id = p_user_id
      and upper(trim(coalesce(pr.role, ''))) = any (
        select upper(trim(r)) from unnest(p_roles) as r where r is not null and trim(r) <> ''
      )
  );
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.profiles
    where id=auth.uid() and is_active=true
      and public.has_any_role(id, array['ADMIN','SUPERADMIN','TREASURER'])
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.profiles
    where id=auth.uid() and is_active=true
      and public.has_any_role(id, array['ADMIN','SUPERADMIN'])
  );
$$;

create or replace function public.is_superadmin()
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.profiles
    where id=auth.uid() and is_active=true and public.user_has_role(id, 'SUPERADMIN')
  );
$$;

create or replace function public.is_treasurer()
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.profiles
    where id=auth.uid() and is_active=true
      and (public.user_has_role(id, 'TREASURER') or is_treasurer=true)
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

-- ------------------------------------------------------------
-- Subscribers: everyone staff can READ. Only SUPERADMIN manages members.
-- Treasurer can only mark the membership card as paid/unpaid.
-- ------------------------------------------------------------
drop policy if exists "subscriber self read" on public.subscribers;
drop policy if exists "subscriber self update" on public.subscribers;
drop policy if exists "admin subscriber insert" on public.subscribers;
drop policy if exists "admin subscriber delete" on public.subscribers;
drop policy if exists subscriber_staff_select on public.subscribers;
drop policy if exists subscriber_self_update on public.subscribers;
drop policy if exists subscriber_superadmin_insert on public.subscribers;
drop policy if exists subscriber_superadmin_update on public.subscribers;
drop policy if exists subscriber_superadmin_delete on public.subscribers;

create policy subscriber_staff_select on public.subscribers for select to authenticated
using (user_id=auth.uid() or public.is_staff());

create policy subscriber_self_update on public.subscribers for update to authenticated
using (user_id=auth.uid() or public.is_superadmin() or public.is_treasurer())
with check (user_id=auth.uid() or public.is_superadmin() or public.is_treasurer());

create policy subscriber_superadmin_insert on public.subscribers for insert to authenticated
with check (public.is_superadmin());

create policy subscriber_superadmin_delete on public.subscribers for delete to authenticated
using (public.is_superadmin());

-- ------------------------------------------------------------
-- Faculties / zones: staff read, SUPERADMIN write.
-- ------------------------------------------------------------

drop policy if exists faculties_read on public.faculties;
drop policy if exists faculties_write on public.faculties;
drop policy if exists zones_read on public.zones;
drop policy if exists zones_write on public.zones;
drop policy if exists "faculties public read" on public.faculties;
drop policy if exists "zones public read" on public.zones;
create policy faculties_read on public.faculties for select to authenticated using (public.is_staff());
create policy faculties_write on public.faculties for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());
create policy zones_read on public.zones for select to authenticated using (public.is_staff());
create policy zones_write on public.zones for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());

-- ------------------------------------------------------------
-- Matches: staff read, SUPERADMIN manage.
-- ------------------------------------------------------------
drop policy if exists matches_admin_all on public.matches;
drop policy if exists match_zones_admin_all on public.match_zones;
drop policy if exists matches_staff_read on public.matches;
drop policy if exists match_zones_staff_read on public.match_zones;
drop policy if exists matches_superadmin_write on public.matches;
drop policy if exists match_zones_superadmin_write on public.match_zones;
create policy matches_staff_read on public.matches for select to authenticated using (public.is_staff());
create policy match_zones_staff_read on public.match_zones for select to authenticated using (public.is_staff());
create policy matches_superadmin_write on public.matches for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());
create policy match_zones_superadmin_write on public.match_zones for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());

-- ------------------------------------------------------------
-- Events: staff read; only SUPERADMIN can create/edit/delete.
-- Event payments: Treasurer + SUPERADMIN can mark paid/unpaid.
-- ------------------------------------------------------------
drop policy if exists events_admin_all on public.events;
drop policy if exists event_payments_admin_all on public.event_payments;
drop policy if exists events_staff_read on public.events;
drop policy if exists events_superadmin_write on public.events;
drop policy if exists event_payments_staff_read on public.event_payments;
drop policy if exists event_payments_manage on public.event_payments;
create policy events_staff_read on public.events for select to authenticated using (public.is_staff());
create policy events_superadmin_write on public.events for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());
create policy event_payments_staff_read on public.event_payments for select to authenticated using (public.is_staff());
create policy event_payments_manage on public.event_payments for insert to authenticated with check (public.is_superadmin() or public.is_treasurer());
create policy event_payments_manage_update on public.event_payments for update to authenticated using (public.is_superadmin() or public.is_treasurer()) with check (public.is_superadmin() or public.is_treasurer());
create policy event_payments_superadmin_delete on public.event_payments for delete to authenticated using (public.is_superadmin());

-- Treasurer may change only card_paid/card_paid_at on subscribers.
create or replace function public.protect_subscriber_self_update()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is not null and public.is_treasurer() and not public.is_superadmin() then
    if old.id is distinct from new.id
       or old.user_id is distinct from new.user_id
       or old.nom is distinct from new.nom
       or old.prenom is distinct from new.prenom
       or old.login_name is distinct from new.login_name
       or old.numero_abonnement is distinct from new.numero_abonnement
       or old.cin is distinct from new.cin
       or old.gender is distinct from new.gender
       or old.phone is distinct from new.phone
       or old.email is distinct from new.email
       or old.photo_url is distinct from new.photo_url
       or old.adresse is distinct from new.adresse
       or old.faculty_id is distinct from new.faculty_id
       or old.zone_id is distinct from new.zone_id
       or old.status is distinct from new.status
    then raise exception 'Treasurer can only change membership card payment status'; end if;
  elsif auth.uid() is not null and not public.is_admin() then
    if old.id is distinct from new.id
       or old.user_id is distinct from new.user_id
       or old.nom is distinct from new.nom
       or old.prenom is distinct from new.prenom
       or old.login_name is distinct from new.login_name
       or old.numero_abonnement is distinct from new.numero_abonnement
       or old.cin is distinct from new.cin
       or old.gender is distinct from new.gender
       or old.faculty_id is distinct from new.faculty_id
       or old.zone_id is distinct from new.zone_id
       or old.status is distinct from new.status
       or old.card_paid is distinct from new.card_paid
       or old.card_paid_at is distinct from new.card_paid_at
    then raise exception 'Only contact fields can be edited by a subscriber'; end if;
  end if;
  return new;
end;
$$;

-- Existing profile trigger remains server-side only; clients cannot escalate roles.
