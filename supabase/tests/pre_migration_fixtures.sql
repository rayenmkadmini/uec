-- Runs BEFORE the pending migrations (inside the same rolled-back transaction).
-- A member account that is already waiting for its first password change when
-- 20261015140000 is applied: the migration's backfill must cover it.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'rls-legacy@test.invalid', 'legacy-initial-hash', '{"display_name":"RLS LEGACY"}', '{}', now(), now());
update public.profiles set must_change_password = true where id = '00000000-0000-4000-8000-0000000000a6';
