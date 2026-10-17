-- Rollback of 20261016120000_least_privilege_hardening: restores the exact
-- previous grants (verified by npm run test:rollback).
--
-- 2026-10-17: regenerated against production's real pre-migration state. The earlier
-- version was generated on a replica that had extra EXECUTE grants (see
-- supabase/tests/replica_alignment.sql) and would have GRANTED anon EXECUTE on the role
-- helpers and trigger functions, which production never had. In production the migration's
-- revokes on those functions are no-ops, so the rollback must not grant anything back.


grant execute on function public.set_updated_at() to authenticated;

grant maintain on all tables in schema public to authenticated;

grant delete on public.notifications to authenticated;

alter default privileges for role postgres in schema public grant maintain on tables to authenticated;

