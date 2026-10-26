-- 20261029120000: optional photo on announcements and events.
--   * public bucket "community-media" (images only, 5 MB): everyone can view,
--     only ADMIN / SUPERADMIN upload or delete;
--   * announcements.image_url and club_events.image_url (https only);
--   * set_club_event_image(): events are written through RPCs only.
-- Requires 20261025120000 (private.is_meeting_manager), 20261026120000, 20261028120000.
-- Rollback: supabase/rollback/20261029120000_community_photos_rollback.sql

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-media', 'community-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists community_media_insert on storage.objects;
create policy community_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'community-media' and (select private.is_meeting_manager()));
drop policy if exists community_media_delete on storage.objects;
create policy community_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'community-media' and (select private.is_meeting_manager()));

alter table public.announcements add column if not exists image_url text
  check (image_url is null or image_url ~ '^https://[A-Za-z0-9.-]+/');
alter table public.club_events add column if not exists image_url text
  check (image_url is null or image_url ~ '^https://[A-Za-z0-9.-]+/');

create or replace function public.set_club_event_image(p_id uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_meeting_manager() then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  update public.club_events set image_url = nullif(btrim(p_url), ''), updated_at = now() where id = p_id;
end;
$$;
revoke execute on function public.set_club_event_image(uuid, text) from public, anon;
grant execute on function public.set_club_event_image(uuid, text) to authenticated;
