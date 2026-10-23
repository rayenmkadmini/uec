-- Rollback of 20261023120000_uppercase_member_names (the backfilled values stay in capitals).
drop trigger if exists trg_uppercase_member_names on public.subscribers;
drop function if exists public.uppercase_member_names();
