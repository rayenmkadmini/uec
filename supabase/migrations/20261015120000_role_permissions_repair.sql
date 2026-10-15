-- ============================================================
-- UE CLUBISTE — ROLE & PERMISSION REPAIR
-- Target: project qwlbbfyhjdeekmrxtzjf (schema inspected live 2026-10-15)
--
-- Non-destructive: no table/column drops, no row deletions, no role changes.
-- Replaces over-broad policies, adds missing RPCs, tightens grants/storage.
--
-- Role model (user_roles is the only authorization source; roles are unioned):
--   SUPERADMIN  full read/write
--   ADMIN       read-only on all administrative data
--   TREASURER   minimal member list + events; card / event payment STATUS via RPC
--               only, never for their own record (SUPERADMIN must do that)
--   MEMBER      own subscriber row (whitelisted fields), own photo, own seat via RPC
--
-- Helper semantics (unchanged, already live):
--   private.is_superadmin()  SUPERADMIN
--   private.is_admin()       SUPERADMIN | ADMIN          (admin readers)
--   private.is_staff()       SUPERADMIN | ADMIN | TREASURER (staff readers)
--   private.is_treasurer()   SUPERADMIN | TREASURER     (payment-status writers)
-- ============================================================

-- ------------------------------------------------------------
-- 1) Clubs: one logo per club, reused by every match
-- ------------------------------------------------------------
create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists clubs_name_lower_key on public.clubs (lower(btrim(name)));

drop trigger if exists clubs_updated_at on public.clubs;
create trigger clubs_updated_at
before update on public.clubs
for each row execute function public.set_updated_at();

alter table public.clubs enable row level security;

-- Register existing team names (logo left empty; existing match data untouched).
insert into public.clubs (name)
select distinct btrim(t.team)
from (
  select home_team as team from public.matches
  union
  select away_team from public.matches
) t
where t.team is not null and btrim(t.team) <> ''
on conflict do nothing;

drop policy if exists clubs_authenticated_select on public.clubs;
drop policy if exists clubs_superadmin_insert on public.clubs;
drop policy if exists clubs_superadmin_update on public.clubs;
drop policy if exists clubs_superadmin_delete on public.clubs;
create policy clubs_authenticated_select on public.clubs for select to authenticated using (true);
create policy clubs_superadmin_insert on public.clubs for insert to authenticated with check ((select public.is_superadmin()));
create policy clubs_superadmin_update on public.clubs for update to authenticated using ((select public.is_superadmin())) with check ((select public.is_superadmin()));
create policy clubs_superadmin_delete on public.clubs for delete to authenticated using ((select public.is_superadmin()));

-- ------------------------------------------------------------
-- 2) Write policies: SUPERADMIN only (ADMIN/TREASURER were allowed via is_staff())
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['events','faculties','zones','matches','match_zones'] loop
    execute format('drop policy if exists %I on public.%I', t || '_staff_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_superadmin_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_superadmin_update', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select public.is_superadmin()))',
      t || '_superadmin_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select public.is_superadmin())) with check ((select public.is_superadmin()))',
      t || '_superadmin_update', t);
  end loop;
end $$;

-- Events are a staff (collections) module; members have no event access in this version.
drop policy if exists events_authenticated_select on public.events;
drop policy if exists events_staff_select on public.events;
create policy events_staff_select on public.events for select to authenticated using ((select public.is_staff()));

-- Subscribers: SUPERADMIN manages; a member may update only their own row
-- (columns restricted by trigger below). Treasurer card status goes through RPC.
drop policy if exists subscribers_staff_insert on public.subscribers;
drop policy if exists subscribers_superadmin_insert on public.subscribers;
create policy subscribers_superadmin_insert on public.subscribers for insert to authenticated
  with check ((select public.is_superadmin()));

drop policy if exists subscribers_self_update on public.subscribers;
create policy subscribers_self_update on public.subscribers for update to authenticated
  using (user_id = (select auth.uid()) or (select public.is_superadmin()))
  with check (user_id = (select auth.uid()) or (select public.is_superadmin()));

-- Event cotisations / card payments: direct writes SUPERADMIN only; Treasurer uses RPCs.
drop policy if exists event_payments_staff_insert on public.event_payments;
drop policy if exists event_payments_staff_update on public.event_payments;
drop policy if exists event_payments_superadmin_insert on public.event_payments;
drop policy if exists event_payments_superadmin_update on public.event_payments;
create policy event_payments_superadmin_insert on public.event_payments for insert to authenticated
  with check ((select public.is_superadmin()));
create policy event_payments_superadmin_update on public.event_payments for update to authenticated
  using ((select public.is_superadmin())) with check ((select public.is_superadmin()));

drop policy if exists card_payments_treasurer_insert on public.card_payments;
drop policy if exists card_payments_treasurer_update on public.card_payments;
drop policy if exists card_payments_superadmin_insert on public.card_payments;
drop policy if exists card_payments_superadmin_update on public.card_payments;
create policy card_payments_superadmin_insert on public.card_payments for insert to authenticated
  with check ((select public.is_superadmin()));
create policy card_payments_superadmin_update on public.card_payments for update to authenticated
  using ((select public.is_superadmin())) with check ((select public.is_superadmin()));

-- Seat choices: members use set/remove_match_participation RPCs (capacity + gender + lock).
drop policy if exists match_participations_member_insert on public.match_participations;
drop policy if exists match_participations_self_update on public.match_participations;
drop policy if exists match_participations_self_delete on public.match_participations;
drop policy if exists match_participations_superadmin_insert on public.match_participations;
drop policy if exists match_participations_superadmin_update on public.match_participations;
drop policy if exists match_participations_superadmin_delete on public.match_participations;
create policy match_participations_superadmin_insert on public.match_participations for insert to authenticated
  with check ((select public.is_superadmin()));
create policy match_participations_superadmin_update on public.match_participations for update to authenticated
  using ((select public.is_superadmin())) with check ((select public.is_superadmin()));
create policy match_participations_superadmin_delete on public.match_participations for delete to authenticated
  using ((select public.is_superadmin()));

-- Profiles: only SUPERADMIN writes directly; password-flag clearing uses an RPC.
drop policy if exists profiles_self_update on public.profiles;
drop policy if exists profiles_superadmin_update on public.profiles;
create policy profiles_superadmin_update on public.profiles for update to authenticated
  using ((select public.is_superadmin())) with check ((select public.is_superadmin()));

drop policy if exists notifications_staff_insert on public.notifications;
drop policy if exists notifications_superadmin_insert on public.notifications;
create policy notifications_superadmin_insert on public.notifications for insert to authenticated
  with check ((select public.is_superadmin()));

-- Audit trail: written only by SECURITY DEFINER functions / Edge Functions; readable by admins.
drop policy if exists audit_logs_staff_insert on public.audit_logs;
drop policy if exists audit_logs_staff_select on public.audit_logs;
drop policy if exists audit_logs_admin_select on public.audit_logs;
create policy audit_logs_admin_select on public.audit_logs for select to authenticated
  using ((select public.is_admin()));

-- ------------------------------------------------------------
-- 2b) Data minimization
--   SUPERADMIN / ADMIN: read member records, staff profiles, roles, seats (supervision).
--   TREASURER: no direct read of other members' personal data (CIN, address, phone,
--              email, gender, photo...). Payment screens use list_payment_members(),
--              which returns identification + payment-status fields only.
--   Everyone: own rows.
-- ------------------------------------------------------------
drop policy if exists subscribers_self_select on public.subscribers;
create policy subscribers_self_select on public.subscribers for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists user_roles_self_select on public.user_roles;
create policy user_roles_self_select on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists match_participations_self_select on public.match_participations;
create policy match_participations_self_select on public.match_participations for select to authenticated
  using (
    (select public.is_admin())
    or subscriber_id in (select s.id from public.subscribers s where s.user_id = (select auth.uid()))
  );

-- ------------------------------------------------------------
-- 3) Field-level protection triggers
--    ue.trusted_op is set (transaction-local) only by the RPCs below.
-- ------------------------------------------------------------
create or replace function private.protect_subscriber_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed text[];
  v_op text := coalesce(current_setting('ue.trusted_op', true), '');
  v_prefix text;
begin
  -- Service role / SQL editor (no JWT) and SUPERADMIN keep full control.
  if auth.uid() is null or private.is_superadmin() then
    return new;
  end if;

  -- A treasurer may never change their own card status (falls through to the
  -- owner whitelist below, which excludes card fields). SUPERADMIN returned above.
  if v_op = 'card_payment' and private.is_treasurer() and old.user_id is distinct from auth.uid() then
    v_allowed := array['card_paid', 'card_paid_at', 'updated_at'];
  elsif auth.uid() = old.user_id then
    v_allowed := array['phone', 'email', 'adresse', 'photo_url', 'updated_at'];
    if new.photo_url is distinct from old.photo_url and new.photo_url is not null then
      v_prefix := regexp_replace(upper(coalesce(old.login_name, '')), '[^A-Z0-9_-]', '_', 'g');
      if v_prefix = '' or position(v_prefix || '/' in new.photo_url) <> 1 then
        raise exception 'Invalid photo path' using errcode = '42501';
      end if;
    end if;
  else
    raise exception 'Not authorized to modify this member' using errcode = '42501';
  end if;

  if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    raise exception 'You cannot modify protected member fields' using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function private.protect_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed text[] := array['must_change_password', 'updated_at'];
begin
  if auth.uid() is null or private.is_superadmin() then
    return new;
  end if;

  if coalesce(current_setting('ue.trusted_op', true), '') = 'password_change'
     and auth.uid() = old.id
     and new.must_change_password = false
     and (to_jsonb(new) - v_allowed) is not distinct from (to_jsonb(old) - v_allowed) then
    return new;
  end if;

  raise exception 'You cannot modify profile fields' using errcode = '42501';
end;
$$;

-- ------------------------------------------------------------
-- 4) RPCs (SECURITY DEFINER, empty search_path, caller re-verified)
-- ------------------------------------------------------------

-- Treasurer / Superadmin: membership card PAID <-> UNPAID only.
create or replace function public.set_card_payment_status(p_subscriber_id uuid, p_paid boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old boolean;
  v_paid_at timestamptz;
  v_owner uuid;
begin
  if auth.uid() is null or not private.is_treasurer() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_subscriber_id is null or p_paid is null then
    raise exception 'Invalid payment status request' using errcode = '22023';
  end if;

  select s.card_paid, s.card_paid_at, s.user_id into v_old, v_paid_at, v_owner
  from public.subscribers s
  where s.id = p_subscriber_id
  for update;

  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  -- Separation of duties: only a SUPERADMIN may change a treasurer's own payment.
  if v_owner = auth.uid() and not private.is_superadmin() then
    raise exception 'Your own payment status must be changed by a SUPERADMIN' using errcode = '42501';
  end if;

  v_paid_at := case when p_paid then (case when v_old then coalesce(v_paid_at, now()) else now() end) else null end;

  perform set_config('ue.trusted_op', 'card_payment', true);
  update public.subscribers s
     set card_paid = p_paid,
         card_paid_at = v_paid_at
   where s.id = p_subscriber_id;
  perform set_config('ue.trusted_op', '', true);

  if v_old is distinct from p_paid then
    insert into public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
    values (auth.uid(), 'CARD_PAYMENT_STATUS', 'subscribers', p_subscriber_id::text,
            jsonb_build_object('card_paid', v_old),
            jsonb_build_object('card_paid', p_paid));
  end if;

  return jsonb_build_object('subscriber_id', p_subscriber_id, 'card_paid', p_paid, 'card_paid_at', v_paid_at);
end;
$$;

-- Treasurer / Superadmin: event cotisation PAID <-> PENDING (unpaid) only.
-- Amount is copied server-side from the event; the client cannot set it.
create or replace function public.set_event_payment_status(p_event_id uuid, p_subscriber_id uuid, p_paid boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount numeric;
  v_old public.payment_status;
  v_new public.payment_status := case when p_paid then 'PAID' else 'PENDING' end;
  v_paid_at timestamptz;
  v_saved_amount numeric;
  v_owner uuid;
begin
  if auth.uid() is null or not private.is_treasurer() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_event_id is null or p_subscriber_id is null or p_paid is null then
    raise exception 'Invalid payment status request' using errcode = '22023';
  end if;

  select e.amount into v_amount from public.events e where e.id = p_event_id;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  select s.user_id into v_owner from public.subscribers s where s.id = p_subscriber_id;
  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  -- Separation of duties: only a SUPERADMIN may change a treasurer's own payment.
  if v_owner = auth.uid() and not private.is_superadmin() then
    raise exception 'Your own payment status must be changed by a SUPERADMIN' using errcode = '42501';
  end if;

  select ep.status into v_old
  from public.event_payments ep
  where ep.event_id = p_event_id and ep.subscriber_id = p_subscriber_id
  for update;

  insert into public.event_payments as ep (event_id, subscriber_id, amount, status, paid_at)
  values (p_event_id, p_subscriber_id, v_amount, v_new, case when p_paid then now() end)
  on conflict (event_id, subscriber_id) do update
    set status = excluded.status,
        paid_at = case
          when excluded.status = 'PAID' and ep.status = 'PAID' then coalesce(ep.paid_at, now())
          when excluded.status = 'PAID' then now()
          else null
        end,
        amount = case
          when excluded.status = 'PAID' and ep.status = 'PAID' then ep.amount
          else excluded.amount
        end
  returning ep.paid_at, ep.amount into v_paid_at, v_saved_amount;

  if v_old is distinct from v_new then
    insert into public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
    values (auth.uid(), 'EVENT_PAYMENT_STATUS', 'event_payments',
            p_event_id::text || ':' || p_subscriber_id::text,
            jsonb_build_object('status', v_old),
            jsonb_build_object('status', v_new));
  end if;

  return jsonb_build_object(
    'event_id', p_event_id,
    'subscriber_id', p_subscriber_id,
    'status', v_new,
    'paid_at', v_paid_at,
    'amount', v_saved_amount
  );
end;
$$;

-- Staff payment screens: identification + payment-status fields only (no CIN,
-- address, phone, email, gender, zone, photo). is_self lets the UI disable the
-- caller's own row; the payment RPCs enforce that rule independently.
create or replace function public.list_payment_members()
returns table (
  id uuid,
  nom text,
  prenom text,
  numero_abonnement text,
  faculty_name text,
  status public.member_status,
  card_paid boolean,
  card_paid_at timestamptz,
  is_self boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_staff() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  select s.id, s.nom, s.prenom, s.numero_abonnement, f.name, s.status, s.card_paid, s.card_paid_at,
         coalesce(s.user_id = auth.uid(), false)
  from public.subscribers s
  left join public.faculties f on f.id = s.faculty_id
  order by s.nom, s.prenom;
end;
$$;

-- Member: choose / change own zone for a match. The zone row is locked so two
-- concurrent requests cannot both take the last place.
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

  delete from public.match_participations mp
  using public.subscribers s
  where mp.match_id = p_match_id
    and mp.subscriber_id = s.id
    and s.user_id = auth.uid();
end;
$$;

-- Any signed-in user: clear own first-login flag after changing the Auth password.
create or replace function public.complete_password_change()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  perform set_config('ue.trusted_op', 'password_change', true);
  update public.profiles p set must_change_password = false where p.id = auth.uid();
  perform set_config('ue.trusted_op', '', true);
end;
$$;

-- Storage helper: the folder a member may write their photo into.
create or replace function private.my_photo_prefix()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(regexp_replace(upper(coalesce(s.login_name, '')), '[^A-Z0-9_-]', '_', 'g'), '')
  from public.subscribers s
  where s.user_id = auth.uid();
$$;

revoke all on function public.set_card_payment_status(uuid, boolean) from public, anon;
revoke all on function public.set_event_payment_status(uuid, uuid, boolean) from public, anon;
revoke all on function public.set_match_participation(uuid, uuid) from public, anon;
revoke all on function public.remove_match_participation(uuid) from public, anon;
revoke all on function public.complete_password_change() from public, anon;
revoke all on function public.list_payment_members() from public, anon;
revoke all on function private.my_photo_prefix() from public, anon;
grant execute on function public.set_card_payment_status(uuid, boolean) to authenticated;
grant execute on function public.set_event_payment_status(uuid, uuid, boolean) to authenticated;
grant execute on function public.set_match_participation(uuid, uuid) to authenticated;
grant execute on function public.remove_match_participation(uuid) to authenticated;
grant execute on function public.complete_password_change() to authenticated;
grant execute on function public.list_payment_members() to authenticated;
grant execute on function private.my_photo_prefix() to authenticated;

revoke execute on function private.protect_subscriber_privileged_fields() from public, anon, authenticated;
revoke execute on function private.protect_profile_privileged_fields() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon;

-- ------------------------------------------------------------
-- 5) Storage
-- ------------------------------------------------------------
-- Member photos are personal data: private bucket, read through signed URLs.
update storage.buckets
   set public = false,
       file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'subscriber-photos';

update storage.buckets
   set file_size_limit = 2097152,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
 where id = 'match-logos';

drop policy if exists subscriber_photos_public_read on storage.objects;
drop policy if exists subscriber_photos_staff_upload on storage.objects;
drop policy if exists subscriber_photos_staff_update on storage.objects;
drop policy if exists subscriber_photos_staff_delete on storage.objects;
drop policy if exists subscriber_photos_read on storage.objects;
drop policy if exists subscriber_photos_insert on storage.objects;
drop policy if exists subscriber_photos_update on storage.objects;
drop policy if exists subscriber_photos_delete on storage.objects;

create policy subscriber_photos_read on storage.objects for select to authenticated
using (
  bucket_id = 'subscriber-photos'
  and (
    (select public.is_admin())
    or (storage.foldername(name))[1] = (select private.my_photo_prefix())
    or ((storage.foldername(name))[1] = 'profiles' and (storage.foldername(name))[2] = (select auth.uid())::text)
  )
);

create policy subscriber_photos_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'subscriber-photos'
  and (
    (select public.is_superadmin())
    or (storage.foldername(name))[1] = (select private.my_photo_prefix())
  )
);

create policy subscriber_photos_update on storage.objects for update to authenticated
using (
  bucket_id = 'subscriber-photos'
  and ((select public.is_superadmin()) or (storage.foldername(name))[1] = (select private.my_photo_prefix()))
)
with check (
  bucket_id = 'subscriber-photos'
  and ((select public.is_superadmin()) or (storage.foldername(name))[1] = (select private.my_photo_prefix()))
);

create policy subscriber_photos_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'subscriber-photos'
  and ((select public.is_superadmin()) or (storage.foldername(name))[1] = (select private.my_photo_prefix()))
);

drop policy if exists match_logos_staff_upload on storage.objects;
drop policy if exists match_logos_staff_update on storage.objects;
drop policy if exists match_logos_staff_delete on storage.objects;
drop policy if exists match_logos_superadmin_upload on storage.objects;
drop policy if exists match_logos_superadmin_update on storage.objects;
drop policy if exists match_logos_superadmin_delete on storage.objects;
create policy match_logos_superadmin_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'match-logos' and (select public.is_superadmin()));
create policy match_logos_superadmin_update on storage.objects for update to authenticated
  using (bucket_id = 'match-logos' and (select public.is_superadmin()))
  with check (bucket_id = 'match-logos' and (select public.is_superadmin()));
create policy match_logos_superadmin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'match-logos' and (select public.is_superadmin()));

-- ------------------------------------------------------------
-- 6) Grants: the app never queries tables without a session.
-- ------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke truncate, trigger, references on all tables in schema public from authenticated;
revoke insert, update, delete on public.v_member_cards from authenticated;
revoke insert, update, delete on public.audit_logs from authenticated;
revoke insert, update, delete on public.roles from authenticated;

grant select, insert, update, delete on public.clubs to authenticated;

alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke truncate, trigger, references on tables from authenticated;
