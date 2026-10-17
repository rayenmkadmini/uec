-- 20261017120000_session_revocation_and_grant_tightening
--
-- Follow-up hardening from the 2026-10-17 completion audit
-- (docs/security/COMPLETION_AUDIT_2026-10-17.md). Each item was confirmed read-only
-- in production before this file was written.
--
--   1. public.admin_revoke_user_sessions(uuid): ends every Auth session of an account.
--      Executable by service_role only; called by the Edge Functions after a password
--      reset and after a staff deactivation.
--   2. notifications: authenticated may update is_read only (was: every column).
--   3. audit_logs_id_seq: no privilege for authenticated (identity column; inserts are
--      done by SECURITY DEFINER functions). Default sequence privileges of postgres in
--      public no longer include authenticated.
--   4. Member photo path: <LOGIN>/<file name> only (was: prefix check, accepted "..").
--   5. private.can_select_match_zone: also requires a usable account (account_ok).
--   6. match-logos bucket: SVG no longer accepted (public bucket).
--
-- Privileges, two function bodies, one new function and one bucket setting. No table,
-- column or application row is created, changed or dropped. No BEGIN/COMMIT: the
-- runner wraps the file in its own transaction.

do $check$
begin
  if to_regprocedure('private.account_ok()') is null
     or to_regprocedure('private.can_select_match_zone(uuid,uuid)') is null
     or to_regprocedure('private.protect_subscriber_privileged_fields()') is null then
    raise exception '20261017120000 requires the 2026-10-17 release (20261015120000 .. 20261016120000)';
  end if;
end
$check$;

-- 1. Session revocation --------------------------------------------------------------
create or replace function public.admin_revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer;
begin
  if p_user_id is null then
    raise exception 'user id required' using errcode = '22004';
  end if;
  -- Refresh tokens are removed with their session (ON DELETE CASCADE); tokens
  -- without a session (older Auth versions) are removed explicitly.
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_count = row_count;
  delete from auth.refresh_tokens where user_id = p_user_id::text;
  return v_count;
end;
$function$;

comment on function public.admin_revoke_user_sessions(uuid) is
  'Ends every Auth session of the account. service_role only (Edge Functions).';

revoke all on function public.admin_revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.admin_revoke_user_sessions(uuid) to service_role;

-- 2. Notifications: only the read flag is writable -----------------------------------
revoke update on public.notifications from authenticated;
grant update (is_read) on public.notifications to authenticated;

-- 3. Sequence privileges --------------------------------------------------------------
revoke all on sequence public.audit_logs_id_seq from authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from authenticated;

-- 4. Member photo path ----------------------------------------------------------------
-- Same function as 20261015120000 except the photo_url check.
create or replace function private.protect_subscriber_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
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
      -- v_prefix only contains [A-Z0-9_-], so it is safe inside the pattern.
      v_prefix := regexp_replace(upper(coalesce(old.login_name, '')), '[^A-Z0-9_-]', '_', 'g');
      if v_prefix = ''
         or new.photo_url !~ ('^' || v_prefix || '/[A-Za-z0-9_-][A-Za-z0-9._-]{0,120}$')
         or position('..' in new.photo_url) > 0 then
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
$function$;

-- 5. Seat availability requires a usable account --------------------------------------
-- Same function as before except the account_ok() check.
create or replace function private.can_select_match_zone(p_match_id uuid, p_zone_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_subscriber_id uuid;
  v_gender public.gender_type;
  v_zone_key text;
  v_available boolean;
  v_capacity integer;
  v_count integer;
begin
  if not private.account_ok() then
    return false;
  end if;

  select s.id, s.gender
  into v_subscriber_id, v_gender
  from public.subscribers s
  where s.user_id = auth.uid()
    and s.status = 'ACTIVE'
  limit 1;

  if v_subscriber_id is null then
    return false;
  end if;

  select mz.zone_key, mz.is_available, mz.capacity
  into v_zone_key, v_available, v_capacity
  from public.match_zones mz
  where mz.id = p_zone_id
    and mz.match_id = p_match_id;

  if v_zone_key is null or v_available = false then
    return false;
  end if;

  if v_gender = 'FEMALE'
     and v_zone_key in ('VIRAGE_1','VIRAGE_2') then
    return false;
  end if;

  if v_capacity is not null then
    select count(*)
    into v_count
    from public.match_participations mp
    where mp.match_id = p_match_id
      and mp.zone_id = p_zone_id;

    if v_count >= v_capacity then
      return false;
    end if;
  end if;

  return true;
end;
$function$;

-- 6. No SVG in the public logo bucket (scripts in an SVG run on the storage origin) -----
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'match-logos';
