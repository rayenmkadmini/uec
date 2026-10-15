-- ============================================================
-- ROLLBACK for 20261015120000_role_permissions_repair.sql
-- Target: project qwlbbfyhjdeekmrxtzjf
--
-- Restores the exact pre-migration policies, trigger functions, grants, default
-- privileges and storage bucket settings captured from the live catalog on
-- 2026-10-15. Verified by scripts/run-rollback-check.mjs (migration + rollback
-- in one transaction, catalog fingerprints compared, then rolled back).
--
-- NOTE: this restores the previous, INSECURE state (ADMIN/TREASURER writes,
-- anon table grants, public member-photo bucket). Use only to recover from an
-- outage, then fix forward.
--
-- Kept on purpose (harmless to the old frontend, would lose data if dropped):
--   public.clubs (club logos), and audit_logs rows written by the new RPCs.
-- Uncomment the DROP TABLE at the end only if you also accept losing club logos.
-- ============================================================

-- 1) New RPCs / helpers
drop function if exists public.set_card_payment_status(uuid, boolean);
drop function if exists public.set_event_payment_status(uuid, uuid, boolean);
drop function if exists public.set_match_participation(uuid, uuid);
drop function if exists public.remove_match_participation(uuid);
drop function if exists public.complete_password_change();
drop function if exists public.list_payment_members();

-- 2) Storage policies (drop new, restore old) — must precede dropping my_photo_prefix
drop policy if exists subscriber_photos_read on storage.objects;
drop policy if exists subscriber_photos_insert on storage.objects;
drop policy if exists subscriber_photos_update on storage.objects;
drop policy if exists subscriber_photos_delete on storage.objects;
drop policy if exists match_logos_superadmin_upload on storage.objects;
drop policy if exists match_logos_superadmin_update on storage.objects;
drop policy if exists match_logos_superadmin_delete on storage.objects;

create policy subscriber_photos_public_read on storage.objects for select to public
  using (bucket_id = 'subscriber-photos'::text);
create policy subscriber_photos_staff_upload on storage.objects for insert to authenticated
  with check ((bucket_id = 'subscriber-photos'::text) and is_staff());
create policy subscriber_photos_staff_update on storage.objects for update to authenticated
  using ((bucket_id = 'subscriber-photos'::text) and is_staff())
  with check ((bucket_id = 'subscriber-photos'::text) and is_staff());
create policy subscriber_photos_staff_delete on storage.objects for delete to authenticated
  using ((bucket_id = 'subscriber-photos'::text) and is_staff());
create policy match_logos_staff_upload on storage.objects for insert to authenticated
  with check ((bucket_id = 'match-logos'::text) and is_staff());
create policy match_logos_staff_update on storage.objects for update to authenticated
  using ((bucket_id = 'match-logos'::text) and is_staff())
  with check ((bucket_id = 'match-logos'::text) and is_staff());
create policy match_logos_staff_delete on storage.objects for delete to authenticated
  using ((bucket_id = 'match-logos'::text) and is_staff());

drop function if exists private.my_photo_prefix();

update storage.buckets
   set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'subscriber-photos';
update storage.buckets
   set public = true, file_size_limit = null, allowed_mime_types = null
 where id = 'match-logos';

-- 3) Table policies
do $$
declare
  t text;
begin
  foreach t in array array['events','faculties','zones','matches','match_zones'] loop
    execute format('drop policy if exists %I on public.%I', t || '_superadmin_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_superadmin_update', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (is_staff())', t || '_staff_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (is_staff()) with check (is_staff())', t || '_staff_update', t);
  end loop;
end $$;

drop policy if exists events_staff_select on public.events;
create policy events_authenticated_select on public.events for select to authenticated
  using ((is_active = true) or is_staff());

drop policy if exists subscribers_superadmin_insert on public.subscribers;
create policy subscribers_staff_insert on public.subscribers for insert to authenticated
  with check (is_staff());
drop policy if exists subscribers_self_update on public.subscribers;
create policy subscribers_self_update on public.subscribers for update to authenticated
  using ((user_id = (select auth.uid())) or (select is_staff()))
  with check ((user_id = (select auth.uid())) or (select is_staff()));

drop policy if exists event_payments_superadmin_insert on public.event_payments;
drop policy if exists event_payments_superadmin_update on public.event_payments;
create policy event_payments_staff_insert on public.event_payments for insert to authenticated
  with check (is_staff());
create policy event_payments_staff_update on public.event_payments for update to authenticated
  using (is_staff()) with check (is_staff());

drop policy if exists card_payments_superadmin_insert on public.card_payments;
drop policy if exists card_payments_superadmin_update on public.card_payments;
create policy card_payments_treasurer_insert on public.card_payments for insert to authenticated
  with check (is_treasurer());
create policy card_payments_treasurer_update on public.card_payments for update to authenticated
  using (is_treasurer()) with check (is_treasurer());

drop policy if exists match_participations_superadmin_insert on public.match_participations;
drop policy if exists match_participations_superadmin_update on public.match_participations;
drop policy if exists match_participations_superadmin_delete on public.match_participations;
create policy match_participations_member_insert on public.match_participations for insert to authenticated
  with check (
    (select is_staff())
    or (
      (subscriber_id in (select s.id from subscribers s where s.user_id = (select auth.uid()) and s.status = 'ACTIVE'::member_status))
      and (select can_select_match_zone(match_participations.match_id, match_participations.zone_id))
    )
  );
create policy match_participations_self_update on public.match_participations for update to authenticated
  using ((select is_staff()) or (subscriber_id in (select s.id from subscribers s where s.user_id = (select auth.uid()))))
  with check ((select is_staff()) or (subscriber_id in (select s.id from subscribers s where s.user_id = (select auth.uid()))));
create policy match_participations_self_delete on public.match_participations for delete to authenticated
  using ((select is_staff()) or (subscriber_id in (select s.id from subscribers s where s.user_id = (select auth.uid()))));

drop policy if exists profiles_superadmin_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated
  using ((id = (select auth.uid())) or (select is_superadmin()))
  with check ((id = (select auth.uid())) or (select is_superadmin()));

drop policy if exists notifications_superadmin_insert on public.notifications;
create policy notifications_staff_insert on public.notifications for insert to authenticated
  with check (is_staff());

-- Data-minimization SELECT policies -> previous staff-wide reads
drop policy if exists subscribers_self_select on public.subscribers;
create policy subscribers_self_select on public.subscribers for select to authenticated
  using ((user_id = (select auth.uid())) or (select is_staff()));
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles for select to authenticated
  using ((id = (select auth.uid())) or (select is_staff()));
drop policy if exists user_roles_self_select on public.user_roles;
create policy user_roles_self_select on public.user_roles for select to authenticated
  using ((user_id = (select auth.uid())) or (select is_staff()));
drop policy if exists match_participations_self_select on public.match_participations;
create policy match_participations_self_select on public.match_participations for select to authenticated
  using ((select is_staff()) or (subscriber_id in (select s.id from subscribers s where s.user_id = (select auth.uid()))));

drop policy if exists audit_logs_admin_select on public.audit_logs;
create policy audit_logs_staff_insert on public.audit_logs for insert to authenticated
  with check (is_staff());
create policy audit_logs_staff_select on public.audit_logs for select to authenticated
  using (is_staff());

-- 4) Trigger functions: exact previous bodies
create or replace function private.protect_subscriber_privileged_fields()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public', 'private'
as $function$
begin
  if auth.uid() is null
     or auth.uid() <> old.user_id
     or public.is_staff()
  then
    return new;
  end if;

  if new.user_id is distinct from old.user_id
     or new.status is distinct from old.status
     or new.card_paid is distinct from old.card_paid
     or new.card_paid_at is distinct from old.card_paid_at
     or new.subscription_start is distinct from old.subscription_start
     or new.subscription_end is distinct from old.subscription_end
     or new.faculty_id is distinct from old.faculty_id
     or new.zone_id is distinct from old.zone_id
     or new.notes is distinct from old.notes
  then
    raise exception 'You cannot modify privileged subscriber fields';
  end if;

  return new;
end;
$function$;

create or replace function private.protect_profile_privileged_fields()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public', 'private'
as $function$
begin
  if auth.uid() is null
     or auth.uid() <> old.id
     or public.is_staff()
  then
    return new;
  end if;

  if new.app_role is distinct from old.app_role
     or new.must_change_password is distinct from old.must_change_password
     or new.is_active is distinct from old.is_active
     or new.is_treasurer is distinct from old.is_treasurer
     or new.email is distinct from old.email
  then
    raise exception 'You cannot modify privileged profile fields';
  end if;

  return new;
end;
$function$;

grant execute on function public.set_updated_at() to public, anon;

-- 5) Grants and default privileges
grant all on all tables in schema public to anon;
grant select, update, usage on all sequences in schema public to anon;
grant truncate, trigger, references on all tables in schema public to authenticated;
grant insert, update, delete on public.v_member_cards, public.audit_logs, public.roles to authenticated;

alter default privileges for role postgres in schema public grant all on tables to anon;
alter default privileges for role postgres in schema public grant select, update, usage on sequences to anon;
alter default privileges for role postgres in schema public grant truncate, trigger, references on tables to authenticated;

-- 6) Optional: remove the clubs table (loses any club logos saved after the migration)
-- drop table if exists public.clubs;
