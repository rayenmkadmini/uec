-- Least-privilege hardening (audit 2026-10-16). Follows 20261015180000.
-- Privilege changes only: no DROP, no data change, no table rewrite.
--
-- 1. Nothing in the public schema is executable by anon. The three trigger /
--    event-trigger functions are not executable by any API role: triggers fire
--    without an EXECUTE check, and calling them directly is never legitimate.
--    authenticated keeps EXECUTE on the role helpers used by RLS policies.
-- 2. No API role holds MAINTAIN (VACUUM, REINDEX, LOCK ...) on application tables;
--    TRUNCATE / TRIGGER / REFERENCES are revoked again defensively.
-- 3. notifications: DELETE is granted but no policy uses it; revoke the grant.
-- 4. Default privileges for objects created by postgres in public: new functions
--    are no longer executable by anon, new tables no longer grant MAINTAIN.
--    (Defaults owned by supabase_admin are platform-managed and cannot be
--    changed by postgres; objects created by migrations are owned by postgres.)


-- 1. Functions ---------------------------------------------------------------
revoke execute on function public.can_select_match_zone(uuid, uuid) from public, anon;
revoke execute on function public.has_role(public.app_role)          from public, anon;
revoke execute on function public.is_admin()                         from public, anon;
revoke execute on function public.is_staff()                         from public, anon;
revoke execute on function public.is_superadmin()                    from public, anon;
revoke execute on function public.is_treasurer()                     from public, anon;
revoke execute on function public.create_match_zones()               from public, anon, authenticated;
revoke execute on function public.handle_new_user()                  from public, anon, authenticated;
revoke execute on function public.rls_auto_enable()                  from public, anon, authenticated;
revoke execute on function public.set_updated_at()                   from public, anon, authenticated;

-- Safety net: abort if anything in public / private is still executable by anon.
do $$
declare v_left text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_left
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_left is not null then
    raise exception 'least_privilege_hardening: still executable by anon: %', v_left;
  end if;
end $$;

-- 2. Tables ------------------------------------------------------------------
revoke maintain                     on all tables in schema public from anon, authenticated;
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;

-- 3. notifications -----------------------------------------------------------
revoke delete on public.notifications from authenticated;

-- 4. Default privileges (objects created by postgres in public) ---------------
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;
alter default privileges for role postgres in schema public revoke maintain on tables from anon, authenticated;

