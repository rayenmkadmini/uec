-- ============================================================
-- ROLLBACK for 20261015160000_active_accounts_and_data_minimization.sql
-- Restores the exact state left by 20261015140000. Function and policy
-- definitions below were generated from that state (pg_get_functiondef /
-- pg_policies) and are verified by scripts/run-rollback-check.mjs.
-- Data note: drops only the expires_at column of private.password_change_marks
-- (derived data). No application rows change. Run only with explicit approval.
-- ============================================================

-- 1) Functions as they were (role helpers ignore account state again)
CREATE OR REPLACE FUNCTION private.has_role(p_role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select exists (
    select 1
    from public.user_roles
    where user_id = auth.uid()
      and role = p_role
  );
$function$
;

CREATE OR REPLACE FUNCTION private.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select exists (
    select 1
    from public.user_roles
    where user_id = auth.uid()
      and role in ('SUPERADMIN','ADMIN')
  );
$function$
;

CREATE OR REPLACE FUNCTION private.is_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select exists (
    select 1
    from public.user_roles
    where user_id = auth.uid()
      and role in ('SUPERADMIN','ADMIN','TREASURER')
  );
$function$
;

CREATE OR REPLACE FUNCTION private.is_superadmin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select private.has_role('SUPERADMIN');
$function$
;

CREATE OR REPLACE FUNCTION private.is_treasurer()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select exists (
    select 1
    from public.user_roles
    where user_id = auth.uid()
      and role in ('SUPERADMIN','TREASURER')
  );
$function$
;

CREATE OR REPLACE FUNCTION private.mark_password_change_required()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.must_change_password then
    insert into private.password_change_marks (user_id, password_digest, marked_at)
    select new.id, private.password_digest(new.id), now()
    where exists (select 1 from auth.users u where u.id = new.id)
    on conflict (user_id) do update
      set password_digest = excluded.password_digest, marked_at = excluded.marked_at;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.my_photo_prefix()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select nullif(regexp_replace(upper(coalesce(s.login_name, '')), '[^A-Z0-9_-]', '_', 'g'), '')
  from public.subscribers s
  where s.user_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.complete_password_change()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_required boolean;
  v_mark text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select p.must_change_password into v_required from public.profiles p where p.id = auth.uid();
  if v_required is null then
    raise exception 'Profil introuvable.' using errcode = '42501';
  end if;
  if not v_required then
    return;
  end if;

  select m.password_digest into v_mark from private.password_change_marks m where m.user_id = auth.uid();
  if v_mark is null or v_mark = private.password_digest(auth.uid()) then
    raise exception 'Le mot de passe n''a pas encore été changé.' using errcode = '42501';
  end if;

  perform set_config('ue.trusted_op', 'password_change', true);
  update public.profiles p set must_change_password = false where p.id = auth.uid();
  perform set_config('ue.trusted_op', '', true);
  delete from private.password_change_marks m where m.user_id = auth.uid();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.remove_match_participation(p_match_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
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
$function$
;

CREATE OR REPLACE FUNCTION public.set_match_participation(p_match_id uuid, p_zone_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

drop function if exists public.get_member_private_fields(uuid);
CREATE OR REPLACE FUNCTION public.get_member_private_fields(p_subscriber_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(subscriber_id uuid, cin text, adresse text, date_naissance date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if private.is_superadmin() then
    return query
      select s.id, s.cin, s.adresse, s.date_naissance
      from public.subscribers s
      where p_subscriber_id is null or s.id = p_subscriber_id;
    return;
  end if;

  if p_subscriber_id is not null and not exists (
    select 1 from public.subscribers s where s.id = p_subscriber_id and s.user_id = auth.uid()
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
    select s.id, s.cin, s.adresse, s.date_naissance
    from public.subscribers s
    where s.user_id = auth.uid();
end;
$function$
;
revoke all on function public.get_member_private_fields(uuid) from public, anon;
grant execute on function public.get_member_private_fields(uuid) to authenticated;

-- 2) Policies as they were
drop policy if exists card_payments_self_select on public.card_payments;
create policy card_payments_self_select on public.card_payments as PERMISSIVE for SELECT to authenticated
  using ((( SELECT is_staff() AS is_staff) OR (subscriber_id IN ( SELECT s.id
   FROM subscribers s
  WHERE (s.user_id = ( SELECT auth.uid() AS uid))))));

drop policy if exists clubs_authenticated_select on public.clubs;
create policy clubs_authenticated_select on public.clubs as PERMISSIVE for SELECT to authenticated
  using (true);

drop policy if exists event_payments_self_select on public.event_payments;
create policy event_payments_self_select on public.event_payments as PERMISSIVE for SELECT to authenticated
  using ((( SELECT is_staff() AS is_staff) OR (subscriber_id IN ( SELECT s.id
   FROM subscribers s
  WHERE (s.user_id = ( SELECT auth.uid() AS uid))))));

drop policy if exists faculties_authenticated_select on public.faculties;
create policy faculties_authenticated_select on public.faculties as PERMISSIVE for SELECT to authenticated
  using (true);

drop policy if exists match_participations_self_select on public.match_participations;
create policy match_participations_self_select on public.match_participations as PERMISSIVE for SELECT to authenticated
  using ((( SELECT is_admin() AS is_admin) OR (subscriber_id IN ( SELECT s.id
   FROM subscribers s
  WHERE (s.user_id = ( SELECT auth.uid() AS uid))))));

drop policy if exists match_zones_authenticated_select on public.match_zones;
create policy match_zones_authenticated_select on public.match_zones as PERMISSIVE for SELECT to authenticated
  using (true);

drop policy if exists matches_authenticated_select on public.matches;
create policy matches_authenticated_select on public.matches as PERMISSIVE for SELECT to authenticated
  using (((is_active = true) OR is_staff()));

drop policy if exists notifications_self_select on public.notifications;
create policy notifications_self_select on public.notifications as PERMISSIVE for SELECT to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));

drop policy if exists notifications_self_update on public.notifications;
create policy notifications_self_update on public.notifications as PERMISSIVE for UPDATE to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));

drop policy if exists roles_authenticated_select on public.roles;
create policy roles_authenticated_select on public.roles as PERMISSIVE for SELECT to authenticated
  using (true);

drop policy if exists site_settings_authenticated_select on public.site_settings;
create policy site_settings_authenticated_select on public.site_settings as PERMISSIVE for SELECT to authenticated
  using (true);

drop policy if exists subscriber_photos_read on storage.objects;
create policy subscriber_photos_read on storage.objects as PERMISSIVE for SELECT to authenticated
  using (((bucket_id = 'subscriber-photos'::text) AND (( SELECT is_admin() AS is_admin) OR ((storage.foldername(name))[1] = ( SELECT private.my_photo_prefix() AS my_photo_prefix)) OR (((storage.foldername(name))[1] = 'profiles'::text) AND ((storage.foldername(name))[2] = (( SELECT auth.uid() AS uid))::text)))));

drop policy if exists subscribers_self_select on public.subscribers;
create policy subscribers_self_select on public.subscribers as PERMISSIVE for SELECT to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_admin() AS is_admin)));

drop policy if exists subscribers_self_update on public.subscribers;
create policy subscribers_self_update on public.subscribers as PERMISSIVE for UPDATE to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_superadmin() AS is_superadmin)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_superadmin() AS is_superadmin)));

drop policy if exists user_roles_self_select on public.user_roles;
create policy user_roles_self_select on public.user_roles as PERMISSIVE for SELECT to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_admin() AS is_admin)));

drop policy if exists zones_authenticated_select on public.zones;
create policy zones_authenticated_select on public.zones as PERMISSIVE for SELECT to authenticated
  using (true);

-- 3) New helpers and RPC
drop function if exists public.get_account_contacts(uuid);
drop function if exists private.account_ok();
drop function if exists private.account_active();

-- 4) Column privileges as they were
grant select (phone, email) on public.subscribers to authenticated;

revoke select (
  id, display_name, nom, prenom, login_name, numero_abonnement, app_role,
  must_change_password, is_active, is_treasurer, avatar_url, created_at, updated_at
) on public.profiles from authenticated;
grant select on public.profiles to authenticated;

revoke select (id, user_id, action, table_name, record_id, old_data, new_data, created_at) on public.audit_logs from authenticated;
grant select on public.audit_logs to authenticated;

revoke select (id, event_id, subscriber_id, amount, status, payment_method, paid_at, created_at, updated_at)
  on public.event_payments from authenticated;
grant select on public.event_payments to authenticated;
revoke select (id, subscriber_id, amount, status, payment_method, paid_at, created_at, updated_at)
  on public.card_payments from authenticated;
grant select on public.card_payments to authenticated;

-- 5) Password-change marks without expiry
alter table private.password_change_marks drop column if exists expires_at;
