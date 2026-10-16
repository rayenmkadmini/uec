-- Rollback of 20261016120000_least_privilege_hardening: restores the exact
-- previous grants (verified by npm run test:rollback).


grant execute on function public.can_select_match_zone(uuid, uuid) to anon;
grant execute on function public.has_role(public.app_role)          to anon;
grant execute on function public.is_admin()                         to anon;
grant execute on function public.is_staff()                         to anon;
grant execute on function public.is_superadmin()                    to anon;
grant execute on function public.is_treasurer()                     to anon;
grant execute on function public.create_match_zones()               to anon, authenticated;
grant execute on function public.handle_new_user()                  to anon, authenticated;
grant execute on function public.rls_auto_enable()                  to anon, authenticated;
grant execute on function public.set_updated_at()                   to authenticated;

grant maintain on all tables in schema public to authenticated;

grant delete on public.notifications to authenticated;

alter default privileges for role postgres in schema public grant execute on functions to anon;
alter default privileges for role postgres in schema public grant maintain on tables to authenticated;

