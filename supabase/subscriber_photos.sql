-- UE CLUBISTE — subscriber photo storage
-- Run this in Supabase SQL Editor.
-- The bucket is PUBLIC so member-card images can be rendered directly.
-- Only active admins/superadmins may upload/change/delete files.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'subscriber-photos',
  'subscriber-photos',
  true,
  5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
set public = true,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "subscriber photos public read" on storage.objects;
create policy "subscriber photos public read"
on storage.objects
for select
to public
using (bucket_id = 'subscriber-photos');

drop policy if exists "subscriber photos admin upload" on storage.objects;
create policy "subscriber photos admin upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'subscriber-photos'
  and public.is_admin()
);

drop policy if exists "subscriber photos admin update" on storage.objects;
create policy "subscriber photos admin update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'subscriber-photos'
  and public.is_admin()
)
with check (
  bucket_id = 'subscriber-photos'
  and public.is_admin()
);

drop policy if exists "subscriber photos admin delete" on storage.objects;
create policy "subscriber photos admin delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'subscriber-photos'
  and public.is_admin()
);
