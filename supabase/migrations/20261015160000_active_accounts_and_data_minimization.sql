-- ============================================================
-- UE CLUBISTE — ACTIVE ACCOUNTS & PERSONAL-DATA MINIMIZATION
-- Target: project qwlbbfyhjdeekmrxtzjf. Requires 20261015120000 and 20261015140000.
-- Rollback: supabase/rollback/20261015160000_active_accounts_and_data_minimization_rollback.sql
--
-- Non-destructive: no table/column drops, no changes to existing application
-- rows, no role changes. Adds one nullable column to the private marks table.
--
-- 1) Account state is part of every authorization decision.
--    private.account_active(): a profile exists and is_active.
--    private.account_ok():     account_active and no pending password change.
--    Role helpers, self-access policies, member RPCs and storage require
--    account_ok, so a deactivated (or not yet re-secured) account cannot act
--    with a session it already holds. Exceptions, so the UI can detect the
--    state: own profile row (always), own roles and reference data
--    (account_active).
-- 2) Data minimization: phone / email (members and staff), audit IP address and
--    payment notes / references are withheld from every API role. Members and
--    staff read their own contact data, and SUPERADMIN reads anyone's, through
--    checked RPCs.
-- 3) Temporary passwords issued from now on expire after 7 days unless changed.
-- ============================================================

-- Fail if the reviewed column sets have drifted.
do $check$
declare
  v_profiles text;
  v_audit text;
begin
  select string_agg(column_name::text, ',' order by column_name) into v_profiles
  from information_schema.columns where table_schema = 'public' and table_name = 'profiles';
  if v_profiles is distinct from 'app_role,avatar_url,created_at,display_name,email,id,is_active,is_treasurer,login_name,must_change_password,nom,numero_abonnement,phone,prenom,updated_at' then
    raise exception 'public.profiles columns differ from the reviewed schema: %', v_profiles;
  end if;
  select string_agg(column_name::text, ',' order by column_name) into v_audit
  from information_schema.columns where table_schema = 'public' and table_name = 'audit_logs';
  if v_audit is distinct from 'action,created_at,id,ip_address,new_data,old_data,record_id,table_name,user_id' then
    raise exception 'public.audit_logs columns differ from the reviewed schema: %', v_audit;
  end if;
  if (select string_agg(column_name::text, ',' order by column_name) from information_schema.columns
      where table_schema = 'public' and table_name = 'event_payments')
     is distinct from 'amount,created_at,event_id,id,notes,paid_at,payment_method,status,subscriber_id,transaction_reference,updated_at' then
    raise exception 'public.event_payments columns differ from the reviewed schema';
  end if;
  if (select string_agg(column_name::text, ',' order by column_name) from information_schema.columns
      where table_schema = 'public' and table_name = 'card_payments')
     is distinct from 'amount,created_at,id,notes,paid_at,payment_method,status,subscriber_id,transaction_reference,updated_at' then
    raise exception 'public.card_payments columns differ from the reviewed schema';
  end if;
end
$check$;

-- ------------------------------------------------------------
-- 1) Account state
-- ------------------------------------------------------------
create or replace function private.account_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active);
$$;

create or replace function private.account_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and not p.must_change_password);
$$;

revoke all on function private.account_active() from public, anon;
revoke all on function private.account_ok() from public, anon;
grant execute on function private.account_active() to authenticated;
grant execute on function private.account_ok() to authenticated;

-- Role helpers: same signatures and grants; now also require account_ok.
-- SECURITY DEFINER (owner postgres) reads profiles / user_roles without RLS, so
-- policies on those tables that call these helpers cannot recurse.
create or replace function private.has_role(p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.account_ok()
     and exists (select 1 from public.user_roles r where r.user_id = auth.uid() and r.role = p_role);
$$;

create or replace function private.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role('SUPERADMIN');
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.account_ok()
     and exists (select 1 from public.user_roles r where r.user_id = auth.uid() and r.role in ('SUPERADMIN', 'ADMIN'));
$$;

create or replace function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.account_ok()
     and exists (select 1 from public.user_roles r where r.user_id = auth.uid() and r.role in ('SUPERADMIN', 'ADMIN', 'TREASURER'));
$$;

create or replace function private.is_treasurer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.account_ok()
     and exists (select 1 from public.user_roles r where r.user_id = auth.uid() and r.role in ('SUPERADMIN', 'TREASURER'));
$$;

create or replace function private.my_photo_prefix()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(regexp_replace(upper(coalesce(s.login_name, '')), '[^A-Z0-9_-]', '_', 'g'), '')
  from public.subscribers s
  where s.user_id = auth.uid()
    and private.account_ok();
$$;

-- Policies that used auth.uid() directly
drop policy if exists subscribers_self_select on public.subscribers;
create policy subscribers_self_select on public.subscribers for select to authenticated
  using ((user_id = (select auth.uid()) and (select private.account_ok())) or (select public.is_admin()));

drop policy if exists subscribers_self_update on public.subscribers;
create policy subscribers_self_update on public.subscribers for update to authenticated
  using ((user_id = (select auth.uid()) and (select private.account_ok())) or (select public.is_superadmin()))
  with check ((user_id = (select auth.uid()) and (select private.account_ok())) or (select public.is_superadmin()));

drop policy if exists user_roles_self_select on public.user_roles;
create policy user_roles_self_select on public.user_roles for select to authenticated
  using ((user_id = (select auth.uid()) and (select private.account_active())) or (select public.is_admin()));

drop policy if exists match_participations_self_select on public.match_participations;
create policy match_participations_self_select on public.match_participations for select to authenticated
  using ((select public.is_admin()) or (subscriber_id in (select s.id from public.subscribers s where s.user_id = (select auth.uid())) and (select private.account_ok())));

drop policy if exists event_payments_self_select on public.event_payments;
create policy event_payments_self_select on public.event_payments for select to authenticated
  using ((select public.is_staff()) or (subscriber_id in (select s.id from public.subscribers s where s.user_id = (select auth.uid())) and (select private.account_ok())));

drop policy if exists card_payments_self_select on public.card_payments;
create policy card_payments_self_select on public.card_payments for select to authenticated
  using ((select public.is_staff()) or (subscriber_id in (select s.id from public.subscribers s where s.user_id = (select auth.uid())) and (select private.account_ok())));

drop policy if exists notifications_self_select on public.notifications;
create policy notifications_self_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) and (select private.account_ok()));

drop policy if exists notifications_self_update on public.notifications;
create policy notifications_self_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid()) and (select private.account_ok()))
  with check (user_id = (select auth.uid()) and (select private.account_ok()));

drop policy if exists clubs_authenticated_select on public.clubs;
create policy clubs_authenticated_select on public.clubs for select to authenticated
  using ((select private.account_active()));

drop policy if exists faculties_authenticated_select on public.faculties;
create policy faculties_authenticated_select on public.faculties for select to authenticated
  using ((select private.account_active()));

drop policy if exists match_zones_authenticated_select on public.match_zones;
create policy match_zones_authenticated_select on public.match_zones for select to authenticated
  using ((select private.account_active()));

drop policy if exists roles_authenticated_select on public.roles;
create policy roles_authenticated_select on public.roles for select to authenticated
  using ((select private.account_active()));

drop policy if exists site_settings_authenticated_select on public.site_settings;
create policy site_settings_authenticated_select on public.site_settings for select to authenticated
  using ((select private.account_active()));

drop policy if exists zones_authenticated_select on public.zones;
create policy zones_authenticated_select on public.zones for select to authenticated
  using ((select private.account_active()));

drop policy if exists matches_authenticated_select on public.matches;
create policy matches_authenticated_select on public.matches for select to authenticated
  using ((is_active and (select private.account_active())) or (select public.is_staff()));

drop policy if exists subscriber_photos_read on storage.objects;
create policy subscriber_photos_read on storage.objects for select to authenticated
using (
  bucket_id = 'subscriber-photos'
  and (
    (select public.is_admin())
    or (storage.foldername(name))[1] = (select private.my_photo_prefix())
    or ((storage.foldername(name))[1] = 'profiles'
        and (storage.foldername(name))[2] = (select auth.uid())::text
        and (select private.account_ok()))
  )
);


-- Member RPCs (bodies unchanged from 20261015120000 / 20261015140000 except the account check)
create or replace function public.set_match_participation(p_match_id uuid, p_zone_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subscriber_id uuid;
  v_gender public.gender_type;
  v_status public.member_status;
  v_zone_key text;
  v_available boolean;
  v_capacity integer;
  v_taken integer;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not private.account_ok() then
    raise exception 'Compte désactivé ou changement de mot de passe requis.' using errcode = '42501';
  end if;

  select s.id, s.gender, s.status into v_subscriber_id, v_gender, v_status
  from public.subscribers s
  where s.user_id = auth.uid();

  if v_subscriber_id is null then
    raise exception 'Profil membre introuvable.' using errcode = '42501';
  end if;
  if v_status <> 'ACTIVE' then
    raise exception 'Votre abonnement n''est pas actif.' using errcode = '42501';
  end if;
  if v_gender is null then
    raise exception 'Votre sexe n''est pas renseigné.' using errcode = '22023';
  end if;

  perform 1 from public.matches m
  where m.id = p_match_id
    and m.is_active
    and (m.match_date + coalesce(m.match_time, time '23:59')) > (now() at time zone 'Africa/Tunis');
  if not found then
    raise exception 'Ce match n''est plus ouvert aux choix de place.' using errcode = '22023';
  end if;

  select mz.zone_key, mz.is_available, mz.capacity
    into v_zone_key, v_available, v_capacity
  from public.match_zones mz
  where mz.id = p_zone_id and mz.match_id = p_match_id
  for update;

  if v_zone_key is null then
    raise exception 'Zone introuvable pour ce match.' using errcode = 'P0002';
  end if;
  if not v_available then
    raise exception 'Cette zone est indisponible.' using errcode = '22023';
  end if;
  if v_gender = 'FEMALE' and v_zone_key in ('VIRAGE_1', 'VIRAGE_2') then
    raise exception 'Cette zone n''est pas accessible.' using errcode = '42501';
  end if;

  if v_capacity is not null then
    select count(*) into v_taken
    from public.match_participations mp
    where mp.zone_id = p_zone_id
      and mp.subscriber_id <> v_subscriber_id;
    if v_taken >= v_capacity then
      raise exception 'Cette zone est complète.' using errcode = '22023';
    end if;
  end if;

  insert into public.match_participations (match_id, subscriber_id, zone_id)
  values (p_match_id, v_subscriber_id, p_zone_id)
  on conflict (match_id, subscriber_id) do update set zone_id = excluded.zone_id
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.remove_match_participation(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not private.account_ok() then
    raise exception 'Compte désactivé ou changement de mot de passe requis.' using errcode = '42501';
  end if;

  perform 1 from public.matches m
  where m.id = p_match_id
    and m.is_active
    and (m.match_date + coalesce(m.match_time, time '23:59')) > (now() at time zone 'Africa/Tunis');
  if not found then
    raise exception 'Ce match n''est plus ouvert aux choix de place.' using errcode = '22023';
  end if;

  delete from public.match_participations mp
  using public.subscribers s
  where mp.match_id = p_match_id
    and mp.subscriber_id = s.id
    and s.user_id = auth.uid();
end;
$$;

-- ------------------------------------------------------------
-- 2) Personal-data minimization
-- ------------------------------------------------------------
revoke select (phone, email) on public.subscribers from authenticated;

revoke select on public.profiles from authenticated;
grant select (
  id, display_name, nom, prenom, login_name, numero_abonnement, app_role,
  must_change_password, is_active, is_treasurer, avatar_url, created_at, updated_at
) on public.profiles to authenticated;

revoke select on public.audit_logs from authenticated;
grant select (id, user_id, action, table_name, record_id, old_data, new_data, created_at) on public.audit_logs to authenticated;

-- Table-level SELECT must be replaced by a column list: revoking single columns
-- has no effect while a table-level grant exists.
revoke select on public.event_payments from authenticated;
grant select (id, event_id, subscriber_id, amount, status, payment_method, paid_at, created_at, updated_at)
  on public.event_payments to authenticated;
revoke select on public.card_payments from authenticated;
grant select (id, subscriber_id, amount, status, payment_method, paid_at, created_at, updated_at)
  on public.card_payments to authenticated;

-- Members' protected fields, now including contact data.
drop function if exists public.get_member_private_fields(uuid);
create function public.get_member_private_fields(p_subscriber_id uuid default null)
returns table (subscriber_id uuid, cin text, adresse text, date_naissance date, phone text, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if private.is_superadmin() then
    return query
      select s.id, s.cin, s.adresse, s.date_naissance, s.phone, s.email
      from public.subscribers s
      where p_subscriber_id is null or s.id = p_subscriber_id;
    return;
  end if;

  if not private.account_ok() then
    raise exception 'Compte désactivé ou changement de mot de passe requis.' using errcode = '42501';
  end if;

  if p_subscriber_id is not null and not exists (
    select 1 from public.subscribers s where s.id = p_subscriber_id and s.user_id = auth.uid()
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
    select s.id, s.cin, s.adresse, s.date_naissance, s.phone, s.email
    from public.subscribers s
    where s.user_id = auth.uid();
end;
$$;

revoke all on function public.get_member_private_fields(uuid) from public, anon;
grant execute on function public.get_member_private_fields(uuid) to authenticated;

-- Account (profile) contact data: SUPERADMIN any account; anyone else own only.
create or replace function public.get_account_contacts(p_user_id uuid default null)
returns table (user_id uuid, email text, phone text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if private.is_superadmin() then
    return query
      select p.id, p.email, p.phone from public.profiles p
      where p_user_id is null or p.id = p_user_id;
    return;
  end if;

  if not private.account_active() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  if p_user_id is not null and p_user_id <> auth.uid() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query select p.id, p.email, p.phone from public.profiles p where p.id = auth.uid();
end;
$$;

revoke all on function public.get_account_contacts(uuid) from public, anon;
grant execute on function public.get_account_contacts(uuid) to authenticated;

-- ------------------------------------------------------------
-- 3) Expiring temporary passwords
-- ------------------------------------------------------------
alter table private.password_change_marks add column if not exists expires_at timestamptz;

create or replace function private.mark_password_change_required()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.must_change_password then
    insert into private.password_change_marks (user_id, password_digest, marked_at, expires_at)
    select new.id, private.password_digest(new.id), now(), now() + interval '7 days'
    where exists (select 1 from auth.users u where u.id = new.id)
    on conflict (user_id) do update
      set password_digest = excluded.password_digest,
          marked_at = excluded.marked_at,
          expires_at = excluded.expires_at;
  end if;
  return new;
end;
$$;

create or replace function public.complete_password_change()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_required boolean;
  v_mark text;
  v_expires timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not private.account_active() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;

  select p.must_change_password into v_required from public.profiles p where p.id = auth.uid();
  if v_required is null then
    raise exception 'Profil introuvable.' using errcode = '42501';
  end if;
  if not v_required then
    return;
  end if;

  select m.password_digest, m.expires_at into v_mark, v_expires
  from private.password_change_marks m where m.user_id = auth.uid();
  if v_expires is not null and v_expires < now() then
    raise exception 'Mot de passe temporaire expiré. Demandez un nouvel accès à l''administration.' using errcode = '42501';
  end if;
  if v_mark is null or v_mark = private.password_digest(auth.uid()) then
    raise exception 'Le mot de passe n''a pas encore été changé.' using errcode = '42501';
  end if;

  perform set_config('ue.trusted_op', 'password_change', true);
  update public.profiles p set must_change_password = false where p.id = auth.uid();
  perform set_config('ue.trusted_op', '', true);
  delete from private.password_change_marks m where m.user_id = auth.uid();
end;
$$;
