-- Rollback of 20261024120000_sync_member_account_status (backfilled values are kept).
drop trigger if exists trg_sync_member_account_status on public.subscribers;
drop function if exists private.sync_member_account_status();
