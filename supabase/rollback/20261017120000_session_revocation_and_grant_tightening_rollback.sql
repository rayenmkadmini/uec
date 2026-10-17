-- Rollback of 20261017120000_session_revocation_and_grant_tightening: restores the exact
-- previous state (verified by npm run test:rollback). Deploy the previous Edge Functions
-- first: the current ones call public.admin_revoke_user_sessions after a reset (they
-- report sessions_revoked=false, and keep working, if it is missing).
--
-- Restoring the previous state re-opens the Low findings it closed (notification columns,
-- sequence grant, photo path, seat check without account_ok, SVG logos).

-- 6. Logo bucket MIME types
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
where id = 'match-logos';

-- 5. Seat availability (previous body)
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

-- 4. Member photo path (previous body)
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
$function$;

-- 3. Sequence privileges
alter default privileges for role postgres in schema public grant all on sequences to authenticated;
grant all on sequence public.audit_logs_id_seq to authenticated;

-- 2. Notifications
revoke update (is_read) on public.notifications from authenticated;
grant update on public.notifications to authenticated;

-- 1. Session revocation
drop function if exists public.admin_revoke_user_sessions(uuid);
