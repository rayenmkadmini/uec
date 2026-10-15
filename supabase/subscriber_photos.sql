-- UE CLUBISTE — subscriber photo storage
-- Run this in Supabase SQL Editor.
-- Keep member photos private. The browser already uses signed URLs, so public
-- object reads are not required and would expose PII to unauthenticated users.
-- A member may manage only files below its own login-name prefix; staff access
-- remains controlled by the database role helper.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'subscriber-photos',
  'subscriber-photos',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "subscriber photos public read" on storage.objects;
drop policy if exists "subscriber photos read own or admin" on storage.objects;
create policy "subscriber photos read own or admin"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'subscriber-photos'
  and (
    public.is_admin()
    or exists (
      select 1
      from public.subscribers s
      where s.user_id = auth.uid()
        and s.photo_url = name
    )
  )
);

drop policy if exists "subscriber photos admin upload" on storage.objects;
drop policy if exists "subscriber photos member or admin upload" on storage.objects;
create policy "subscriber photos member or admin upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'subscriber-photos'
  and (
    public.is_admin()
    or exists (
      select 1
      from public.subscribers s
      where s.user_id = auth.uid()
        and name like s.login_name || '/%'
    )
  )
);

drop policy if exists "subscriber photos admin update" on storage.objects;
drop policy if exists "subscriber photos member or admin update" on storage.objects;
create policy "subscriber photos member or admin update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'subscriber-photos'
  and (
    public.is_admin()
    or exists (
      select 1
      from public.subscribers s
      where s.user_id = auth.uid()
        and s.photo_url = name
    )
  )
)
with check (
  bucket_id = 'subscriber-photos'
  and (
    public.is_admin()
    or exists (
      select 1
      from public.subscribers s
      where s.user_id = auth.uid()
        and name like s.login_name || '/%'
    )
  )
);

drop policy if exists "subscriber photos admin delete" on storage.objects;
drop policy if exists "subscriber photos member or admin delete" on storage.objects;
create policy "subscriber photos member or admin delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'subscriber-photos'
  and (
    public.is_admin()
    or exists (
      select 1
      from public.subscribers s
      where s.user_id = auth.uid()
        and s.photo_url = name
    )
  )
);
