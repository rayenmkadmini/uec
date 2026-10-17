-- Rollback of 20261018120000_smart_collections: removes the collections objects and the
-- columns added to public.events. public.event_payments was never modified.
--
-- DATA LOSS WARNING: every payment recorded in collection_contributions and every personal
-- target is dropped. Export them first (CSV export of each collection, or
-- `copy public.collection_contributions to stdout with csv header`) if any were entered.
-- The audit_logs rows written by the RPCs are kept.

drop function if exists public.set_collection_member_target(uuid, uuid, numeric);
drop function if exists public.cancel_collection_contribution(uuid, text);
drop function if exists public.update_collection_contribution(uuid, numeric, date, text, text, text);
drop function if exists public.record_collection_contribution(uuid, uuid, numeric, date, text, text, text, uuid);
drop function if exists private.assert_can_record_for(uuid);

drop view if exists public.collection_totals;
drop table if exists public.collection_member_targets;
drop table if exists public.collection_contributions;

drop trigger if exists events_sync_active on public.events;
drop function if exists private.sync_event_active_flag();

alter table public.events drop constraint if exists events_collection_status_check;
alter table public.events drop constraint if exists events_target_amount_check;
alter table public.events drop constraint if exists events_suggested_amount_check;
alter table public.events drop constraint if exists events_collection_dates_check;
alter table public.events drop constraint if exists events_organizer_length_check;
alter table public.events drop constraint if exists events_category_length_check;

alter table public.events drop column if exists category;
alter table public.events drop column if exists organizer;
alter table public.events drop column if exists collection_status;
alter table public.events drop column if exists deadline;
alter table public.events drop column if exists start_date;
alter table public.events drop column if exists suggested_amount;
alter table public.events drop column if exists target_amount;
