-- ============================================================
-- UE CLUBISTE — ADMIN LEAST PRIVILEGE (member photos and gender)
-- Target: project qwlbbfyhjdeekmrxtzjf. Requires 20261015120000, 140000, 160000.
-- Rollback: supabase/rollback/20261015180000_admin_least_privilege_rollback.sql
--
-- Non-destructive: no drops of tables or columns, no changes to application rows.
--
-- ADMIN no longer receives member photos or gender:
--   * subscribers.gender and subscribers.photo_url are withheld from every API
--     role (column privileges). SUPERADMIN and the member themself read them
--     through get_member_private_fields().
--   * Member photo files: readable by SUPERADMIN and the member only (no longer ADMIN).
--   * Match supervision (ADMIN's viewMatches duty) uses list_match_participants():
--     names, subscription number and zone; gender only for SUPERADMIN.
-- Faculty, zone and seat choices stay visible to ADMIN (supervision of matches and
-- members), as documented in docs/security/FIELD_ACCESS_MATRIX.md.
-- ============================================================

do $check$
begin
  if (select string_agg(column_name::text, ',' order by column_name) from information_schema.columns
      where table_schema = 'public' and table_name = 'subscribers')
     is distinct from 'adresse,card_paid,card_paid_at,cin,created_at,date_naissance,email,faculty_id,gender,id,login_name,nom,notes,numero_abonnement,phone,photo_url,prenom,status,subscription_end,subscription_start,updated_at,user_id,zone_id' then
    raise exception 'public.subscribers columns differ from the reviewed schema';
  end if;
  if to_regprocedure('private.account_ok()') is null then
    raise exception '20261015160000 must be applied first';
  end if;
end
$check$;

revoke select (gender, photo_url) on public.subscribers from authenticated;

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

-- Member photo files: SUPERADMIN and the member (own folder); staff avatars own only.
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
