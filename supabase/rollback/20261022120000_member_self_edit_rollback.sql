-- Rollback of 20261022120000_member_self_edit: the member whitelist of 20261019120000
-- (phone, email, address, photo only).

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

  if v_op = 'card_payment' and private.is_treasurer() and old.user_id is distinct from auth.uid() then
    v_allowed := array['card_paid', 'card_paid_at', 'updated_at'];
  elsif private.is_admin() and private.account_ok() and old.user_id is distinct from auth.uid() then
    -- ADMIN: everything except the account link, the login, the CIN and the card fields.
    if old.user_id is not null and exists (
      select 1 from public.user_roles r where r.user_id = old.user_id and upper(r.role::text) = 'SUPERADMIN'
    ) then
      raise exception 'A SUPERADMIN member record is managed by a SUPERADMIN' using errcode = '42501';
    end if;
    v_allowed := array['nom', 'prenom', 'numero_abonnement', 'gender', 'phone', 'email', 'adresse',
                       'date_naissance', 'photo_url', 'faculty_id', 'zone_id', 'status', 'notes',
                       'subscription_start', 'subscription_end', 'updated_at'];
  elsif auth.uid() = old.user_id then
    v_allowed := array['phone', 'email', 'adresse', 'photo_url', 'updated_at'];
  else
    raise exception 'Not authorized to modify this member' using errcode = '42501';
  end if;

  if new.photo_url is distinct from old.photo_url and new.photo_url is not null
     and 'photo_url' = any (v_allowed) then
    -- v_prefix only contains [A-Z0-9_-], so it is safe inside the pattern.
    v_prefix := regexp_replace(upper(coalesce(old.login_name, '')), '[^A-Z0-9_-]', '_', 'g');
    if v_prefix = ''
       or new.photo_url !~ ('^' || v_prefix || '/[A-Za-z0-9_-][A-Za-z0-9._-]{0,120}$')
       or position('..' in new.photo_url) > 0 then
      raise exception 'Invalid photo path' using errcode = '42501';
    end if;
  end if;

  if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    raise exception 'You cannot modify protected member fields' using errcode = '42501';
  end if;

  return new;
end;
$function$;

revoke all on function private.protect_subscriber_privileged_fields() from public, anon, authenticated;
