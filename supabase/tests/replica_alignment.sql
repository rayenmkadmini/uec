-- LOCAL / DISPOSABLE DATABASES ONLY. Never run against production.
--
-- A database restored from the production schema-only dump (uec-backups/2026-10-15/schema.sql)
-- into the supabase/postgres image ends up with MORE function privileges than production:
-- pg_dump emits "REVOKE ... FROM PUBLIC; GRANT ... TO authenticated" relative to the built-in
-- default, but the image's own default privileges also grant EXECUTE to anon (and, for the
-- trigger functions, to authenticated) when the functions are re-created. Verified on
-- 2026-10-17 with scripts/lib/schema-fingerprint.sql: 12 EXECUTE grants and 1 default
-- privilege exist in the replica but not in production; every other category is identical.
--
-- This script removes exactly those differences so that rehearsals, the role matrix and the
-- rollback-exactness check start from production's real state. Idempotent.
--
--   PGOPTIONS="-c ue.replica_alignment=local-only" psql -U postgres ... -f supabase/tests/replica_alignment.sql
do $guard$
begin
  if coalesce(current_setting('ue.replica_alignment', true), '') <> 'local-only' then
    raise exception 'replica_alignment.sql is for local disposable databases only (set ue.replica_alignment=local-only)';
  end if;
end
$guard$;

revoke execute on function public.can_select_match_zone(uuid, uuid) from anon;
revoke execute on function public.has_role(public.app_role)          from anon;
revoke execute on function public.is_admin()                         from anon;
revoke execute on function public.is_staff()                         from anon;
revoke execute on function public.is_superadmin()                    from anon;
revoke execute on function public.is_treasurer()                     from anon;
revoke execute on function public.create_match_zones()               from anon, authenticated;
revoke execute on function public.handle_new_user()                  from anon, authenticated;
revoke execute on function public.rls_auto_enable()                  from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon;

-- Production also has the platform event trigger ensure_rls (enables RLS on every new table in
-- public), owned by postgres as in production (Supabase lets postgres create event triggers).
do $evt$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls on ddl_command_end
      when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      execute function public.rls_auto_enable();
  end if;
end
$evt$;
