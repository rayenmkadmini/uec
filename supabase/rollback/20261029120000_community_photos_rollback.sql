-- Rollback of 20261029120000_community_photos (the uploaded files stay in the bucket).
drop function if exists public.set_club_event_image(uuid, text);
alter table public.club_events drop column if exists image_url;
alter table public.announcements drop column if exists image_url;
drop policy if exists community_media_insert on storage.objects;
drop policy if exists community_media_delete on storage.objects;
