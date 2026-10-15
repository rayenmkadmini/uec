-- ============================================================
-- ROLLBACK for 20261015180000_admin_least_privilege.sql
-- Restores the exact state left by 20261015160000 (definitions generated from
-- that state; verified by scripts/run-rollback-check.mjs). No application rows
-- change. Run only with explicit approval, before 20261015160000's rollback.
-- ============================================================

grant select (gender, photo_url) on public.subscribers to authenticated;

drop function if exists public.list_match_participants(uuid);

drop function if exists public.get_member_private_fields(uuid);
CREATE OR REPLACE FUNCTION public.get_member_private_fields(p_subscriber_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(subscriber_id uuid, cin text, adresse text, date_naissance date, phone text, email text)
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
$function$
;
revoke all on function public.get_member_private_fields(uuid) from public, anon;
grant execute on function public.get_member_private_fields(uuid) to authenticated;

drop policy if exists subscriber_photos_read on storage.objects;
create policy subscriber_photos_read on storage.objects as PERMISSIVE for SELECT to authenticated
  using (((bucket_id = 'subscriber-photos'::text) AND (( SELECT is_admin() AS is_admin) OR ((storage.foldername(name))[1] = ( SELECT private.my_photo_prefix() AS my_photo_prefix)) OR (((storage.foldername(name))[1] = 'profiles'::text) AND ((storage.foldername(name))[2] = (( SELECT auth.uid() AS uid))::text) AND ( SELECT private.account_ok() AS account_ok)))));
