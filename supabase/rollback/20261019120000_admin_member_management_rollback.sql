-- Rollback of 20261019120000_admin_member_management: restores the exact previous
-- definitions (ADMIN read-only on members, identity fields SUPERADMIN-only).
-- Deploy the previous Edge Functions (SUPERADMIN-only member create/activate/delete) first.

drop policy if exists subscribers_self_update on public.subscribers;
create policy subscribers_self_update on public.subscribers for update to authenticated
  using ((user_id = (select auth.uid()) and (select private.account_ok())) or (select public.is_superadmin()))
  with check ((user_id = (select auth.uid()) and (select private.account_ok())) or (select public.is_superadmin()));

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

revoke all on function private.protect_subscriber_privileged_fields() from public, anon, authenticated;

drop function if exists public.get_member_private_fields(uuid);
create function public.get_member_private_fields(p_subscriber_id uuid default null)
returns table (subscriber_id uuid, cin text, adresse text, date_naissance date, phone text, email text,
               gender public.gender_type, photo_url text)
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
      select s.id, s.cin, s.adresse, s.date_naissance, s.phone, s.email, s.gender, s.photo_url
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
    select s.id, s.cin, s.adresse, s.date_naissance, s.phone, s.email, s.gender, s.photo_url
    from public.subscribers s
    where s.user_id = auth.uid();
end;
$$;

revoke all on function public.get_member_private_fields(uuid) from public, anon;
grant execute on function public.get_member_private_fields(uuid) to authenticated;

-- Seat list for match supervision (SUPERADMIN, ADMIN). Gender only for SUPERADMIN.
create or replace function public.list_match_participants(p_match_id uuid)
returns table (participation_id uuid, zone_key text, zone_name text, nom text, prenom text,
               numero_abonnement text, gender public.gender_type)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_superadmin boolean := private.is_superadmin();
begin
  if not private.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
    select mp.id, mz.zone_key, mz.zone_name, s.nom, s.prenom, s.numero_abonnement,
           case when v_superadmin then s.gender end
    from public.match_participations mp
    join public.subscribers s on s.id = mp.subscriber_id
    join public.match_zones mz on mz.id = mp.zone_id
    where mp.match_id = p_match_id
    order by s.nom, s.prenom;
end;
$$;

revoke all on function public.list_match_participants(uuid) from public, anon;
grant execute on function public.list_match_participants(uuid) to authenticated;

drop policy if exists subscriber_photos_read on storage.objects;
create policy subscriber_photos_read on storage.objects for select to authenticated
using (
  bucket_id = 'subscriber-photos'
  and (
    (select public.is_superadmin())
    or (storage.foldername(name))[1] = (select private.my_photo_prefix())
    or ((storage.foldername(name))[1] = 'profiles'
        and (storage.foldername(name))[2] = (select auth.uid())::text
        and (select private.account_ok()))
  )
);

drop policy if exists subscriber_photos_insert on storage.objects;
drop policy if exists subscriber_photos_update on storage.objects;
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
