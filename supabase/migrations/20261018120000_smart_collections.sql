-- ============================================================
-- UE CLUBISTE — SMART COLLECTIONS (individual contributions)
-- Target: project qwlbbfyhjdeekmrxtzjf. Non-destructive: no drops of existing
-- tables/columns, no row deletions; public.event_payments is left untouched.
--
-- Model
--   events                      a collection: GLOBAL target, never split per member
--   collection_contributions    one row per real payment by a member (numeric(12,3) DT)
--   collection_member_targets   OPTIONAL personal goal; without one a member owes nothing
--   collection_totals (view)    totals computed from VALID contributions only
--
-- Role model (same helpers as 20261015120000_role_permissions_repair):
--   read                 is_staff()      SUPERADMIN | ADMIN | TREASURER
--   record / edit /      is_treasurer()  SUPERADMIN | TREASURER, via RPC only;
--   cancel payments                      never on one's own member record unless SUPERADMIN
--   personal targets     is_treasurer(), via RPC only
--   collection settings  is_superadmin() (existing events policies)
--
-- Payments are never deleted: they are cancelled with a reason and excluded from
-- totals. Every change is written to public.audit_logs. A client-generated
-- request id (unique) makes double submissions / retries idempotent.
-- Rollback: supabase/rollback/20261018120000_smart_collections_rollback.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1) Collection settings on public.events
-- ------------------------------------------------------------
alter table public.events add column if not exists target_amount numeric(12,3) not null default 0;
alter table public.events add column if not exists suggested_amount numeric(12,3);
alter table public.events add column if not exists start_date date;
alter table public.events add column if not exists deadline date;
alter table public.events add column if not exists collection_status text not null default 'ACTIVE';
alter table public.events add column if not exists organizer text;
alter table public.events add column if not exists category text;

alter table public.events drop constraint if exists events_collection_status_check;
alter table public.events add constraint events_collection_status_check
  check (collection_status in ('DRAFT','ACTIVE','COMPLETED','CANCELLED'));
alter table public.events drop constraint if exists events_target_amount_check;
alter table public.events add constraint events_target_amount_check check (target_amount >= 0);
alter table public.events drop constraint if exists events_suggested_amount_check;
alter table public.events add constraint events_suggested_amount_check
  check (suggested_amount is null or suggested_amount > 0);
alter table public.events drop constraint if exists events_collection_dates_check;
alter table public.events add constraint events_collection_dates_check
  check (start_date is null or deadline is null or deadline >= start_date);
alter table public.events drop constraint if exists events_organizer_length_check;
alter table public.events add constraint events_organizer_length_check
  check (organizer is null or char_length(organizer) <= 120);
alter table public.events drop constraint if exists events_category_length_check;
alter table public.events add constraint events_category_length_check
  check (category is null or char_length(category) <= 60);

-- Existing rows: the old `amount` was a per-member fee. It becomes the suggested
-- contribution (NOT the target). Inactive events become COMPLETED.
update public.events set suggested_amount = amount
 where suggested_amount is null and amount > 0;
update public.events set collection_status = 'COMPLETED'
 where collection_status = 'ACTIVE' and is_active = false;
update public.events set start_date = event_date::date
 where start_date is null and event_date is not null;

-- Keep is_active consistent for screens that still read it.
create or replace function private.sync_event_active_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.is_active := new.collection_status in ('DRAFT','ACTIVE');
  return new;
end;
$$;

drop trigger if exists events_sync_active on public.events;
create trigger events_sync_active
before insert or update of collection_status on public.events
for each row execute function private.sync_event_active_flag();

-- ------------------------------------------------------------
-- 1b) Reconcile with the earlier manual script (supabase/collections.sql of the
--     old login.ueclubistes.tn repository), which may already have created these
--     tables with slightly different names, triggers and admin-only policies.
--     Nothing is deleted: columns are renamed, old triggers / policies replaced.
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.collection_contributions') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'collection_contributions' and column_name = 'client_request_id')
     and not exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'collection_contributions' and column_name = 'request_id') then
    alter table public.collection_contributions rename column client_request_id to request_id;
  end if;

  -- The earlier script kept the collection status in events.status: carry it over.
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and table_name = 'events' and column_name = 'status') then
    execute $q$
      update public.events set collection_status = status
       where status in ('DRAFT','ACTIVE','COMPLETED','CANCELLED') and collection_status is distinct from status
    $q$;
  end if;
end $$;

do $$
begin
  if to_regclass('public.collection_contributions') is not null then
    drop trigger if exists collection_contributions_guard on public.collection_contributions;
    drop trigger if exists collection_contributions_audit on public.collection_contributions;
    drop policy if exists contributions_admin_select on public.collection_contributions;
    drop policy if exists contributions_admin_insert on public.collection_contributions;
    drop policy if exists contributions_admin_update on public.collection_contributions;
  end if;
  if to_regclass('public.collection_member_targets') is not null then
    drop policy if exists member_targets_admin_all on public.collection_member_targets;
  end if;
end $$;

drop function if exists public.guard_contribution_update();
drop function if exists public.audit_contribution();
drop function if exists public.sync_event_active_flag();

-- Its separate audit table is kept (history) but no longer exposed: audit_logs is used now.
do $$
begin
  if to_regclass('public.collection_contribution_audit') is not null then
    revoke all on public.collection_contribution_audit from public, anon, authenticated;
  end if;
end $$;

-- ------------------------------------------------------------
-- 2) Individual payments
-- ------------------------------------------------------------
create table if not exists public.collection_contributions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  subscriber_id uuid not null references public.subscribers(id) on delete restrict,
  amount numeric(12,3) not null check (amount > 0 and amount <= 1000000),
  paid_on date not null default current_date,
  method text not null default 'CASH'
    check (method in ('CASH','TRANSFER','CHEQUE','CARD','MOBILE','OTHER')),
  reference text check (reference is null or char_length(reference) <= 120),
  notes text check (notes is null or char_length(notes) <= 500),
  status text not null default 'VALID' check (status in ('VALID','CANCELLED')),
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  source text not null default 'MANUAL' check (source in ('MANUAL','LEGACY')),
  request_id uuid not null unique,
  recorded_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists collection_contributions_event_idx on public.collection_contributions (event_id, status);
create index if not exists collection_contributions_member_idx on public.collection_contributions (subscriber_id);
create index if not exists collection_contributions_paid_on_idx on public.collection_contributions (event_id, paid_on desc);

drop trigger if exists collection_contributions_updated_at on public.collection_contributions;
create trigger collection_contributions_updated_at
before update on public.collection_contributions
for each row execute function public.set_updated_at();

create table if not exists public.collection_member_targets (
  event_id uuid not null references public.events(id) on delete cascade,
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  target_amount numeric(12,3) not null check (target_amount > 0 and target_amount <= 1000000),
  updated_at timestamptz not null default now(),
  primary key (event_id, subscriber_id)
);

alter table public.collection_contributions enable row level security;
alter table public.collection_member_targets enable row level security;

revoke all on public.collection_contributions from public, anon, authenticated;
revoke all on public.collection_member_targets from public, anon, authenticated;
grant select on public.collection_contributions to authenticated;
grant select on public.collection_member_targets to authenticated;

drop policy if exists collection_contributions_staff_select on public.collection_contributions;
create policy collection_contributions_staff_select on public.collection_contributions
  for select to authenticated using ((select public.is_staff()));
drop policy if exists collection_member_targets_staff_select on public.collection_member_targets;
create policy collection_member_targets_staff_select on public.collection_member_targets
  for select to authenticated using ((select public.is_staff()));

-- Totals from the source transactions (RLS of the caller applies).
create or replace view public.collection_totals
with (security_invoker = true) as
select e.id as event_id,
       e.target_amount,
       coalesce(sum(c.amount) filter (where c.status = 'VALID'), 0)::numeric(14,3) as total_collected,
       count(c.id) filter (where c.status = 'VALID') as payments_count,
       count(distinct c.subscriber_id) filter (where c.status = 'VALID') as contributors_count
from public.events e
left join public.collection_contributions c on c.event_id = e.id
group by e.id, e.target_amount;

revoke all on public.collection_totals from public, anon, authenticated;
grant select on public.collection_totals to authenticated;

-- ------------------------------------------------------------
-- 3) Write RPCs
-- ------------------------------------------------------------
-- Shared authorization for a payment on a member: treasurer-level role, and never
-- one's own member record unless SUPERADMIN (same rule as set_event_payment_status).
create or replace function private.assert_can_record_for(p_subscriber_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null or not private.is_treasurer() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select s.user_id into v_owner from public.subscribers s where s.id = p_subscriber_id;
  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  if v_owner = auth.uid() and not private.is_superadmin() then
    raise exception 'Your own payment must be recorded by a SUPERADMIN' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.record_collection_contribution(
  p_event_id uuid,
  p_subscriber_id uuid,
  p_amount numeric,
  p_paid_on date,
  p_method text,
  p_reference text,
  p_notes text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_row public.collection_contributions;
begin
  if p_event_id is null or p_subscriber_id is null or p_request_id is null
     or p_amount is null or p_amount <= 0 or p_amount > 1000000 or p_amount <> round(p_amount, 3)
     or p_paid_on is null or p_paid_on > current_date + 1 then
    raise exception 'Invalid payment' using errcode = '22023';
  end if;

  perform private.assert_can_record_for(p_subscriber_id);

  -- Idempotent: the same request id returns the row already stored.
  select * into v_row from public.collection_contributions c where c.request_id = p_request_id;
  if found then
    if v_row.event_id <> p_event_id or v_row.subscriber_id <> p_subscriber_id then
      raise exception 'Request id reused for another payment' using errcode = '22023';
    end if;
    return jsonb_build_object('id', v_row.id, 'duplicate', true);
  end if;

  select e.collection_status into v_status from public.events e where e.id = p_event_id for share;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  if v_status = 'CANCELLED' then
    raise exception 'Collection is cancelled' using errcode = '22023';
  end if;

  insert into public.collection_contributions
    (event_id, subscriber_id, amount, paid_on, method, reference, notes, request_id, recorded_by)
  values
    (p_event_id, p_subscriber_id, p_amount, p_paid_on, coalesce(nullif(p_method, ''), 'CASH'),
     nullif(btrim(coalesce(p_reference, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''),
     p_request_id, auth.uid())
  on conflict (request_id) do nothing
  returning * into v_row;

  if v_row.id is null then
    -- Lost a race with an identical concurrent request.
    select * into v_row from public.collection_contributions c where c.request_id = p_request_id;
    return jsonb_build_object('id', v_row.id, 'duplicate', true);
  end if;

  insert into public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), 'COLLECTION_PAYMENT_CREATE', 'collection_contributions', v_row.id::text,
          null, to_jsonb(v_row));

  return jsonb_build_object('id', v_row.id, 'duplicate', false);
end;
$$;

create or replace function public.update_collection_contribution(
  p_id uuid,
  p_amount numeric,
  p_paid_on date,
  p_method text,
  p_reference text,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.collection_contributions;
  v_new public.collection_contributions;
begin
  if p_id is null or p_amount is null or p_amount <= 0 or p_amount > 1000000
     or p_amount <> round(p_amount, 3) or p_paid_on is null or p_paid_on > current_date + 1 then
    raise exception 'Invalid payment' using errcode = '22023';
  end if;

  select * into v_old from public.collection_contributions c where c.id = p_id for update;
  if not found then
    raise exception 'Payment not found' using errcode = 'P0002';
  end if;
  perform private.assert_can_record_for(v_old.subscriber_id);
  if v_old.status <> 'VALID' then
    raise exception 'A cancelled payment cannot be edited' using errcode = '22023';
  end if;

  update public.collection_contributions c
     set amount = p_amount,
         paid_on = p_paid_on,
         method = coalesce(nullif(p_method, ''), 'CASH'),
         reference = nullif(btrim(coalesce(p_reference, '')), ''),
         notes = nullif(btrim(coalesce(p_notes, '')), '')
   where c.id = p_id
  returning * into v_new;

  insert into public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), 'COLLECTION_PAYMENT_UPDATE', 'collection_contributions', p_id::text,
          to_jsonb(v_old), to_jsonb(v_new));

  return jsonb_build_object('id', p_id);
end;
$$;

create or replace function public.cancel_collection_contribution(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.collection_contributions;
  v_new public.collection_contributions;
begin
  if p_id is null or char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A cancellation reason is required' using errcode = '22023';
  end if;

  select * into v_old from public.collection_contributions c where c.id = p_id for update;
  if not found then
    raise exception 'Payment not found' using errcode = 'P0002';
  end if;
  perform private.assert_can_record_for(v_old.subscriber_id);
  if v_old.status = 'CANCELLED' then
    return jsonb_build_object('id', p_id, 'already_cancelled', true);
  end if;

  update public.collection_contributions c
     set status = 'CANCELLED', cancelled_at = now(), cancel_reason = left(btrim(p_reason), 500)
   where c.id = p_id
  returning * into v_new;

  insert into public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), 'COLLECTION_PAYMENT_CANCEL', 'collection_contributions', p_id::text,
          to_jsonb(v_old), to_jsonb(v_new));

  return jsonb_build_object('id', p_id, 'already_cancelled', false);
end;
$$;

-- p_target null removes the personal goal.
create or replace function public.set_collection_member_target(p_event_id uuid, p_subscriber_id uuid, p_target numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old numeric;
begin
  if p_event_id is null or p_subscriber_id is null
     or (p_target is not null and (p_target <= 0 or p_target > 1000000 or p_target <> round(p_target, 3))) then
    raise exception 'Invalid target' using errcode = '22023';
  end if;
  perform private.assert_can_record_for(p_subscriber_id);
  if not exists (select 1 from public.events e where e.id = p_event_id) then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  select t.target_amount into v_old from public.collection_member_targets t
   where t.event_id = p_event_id and t.subscriber_id = p_subscriber_id;

  if p_target is null then
    delete from public.collection_member_targets t
     where t.event_id = p_event_id and t.subscriber_id = p_subscriber_id;
  else
    insert into public.collection_member_targets (event_id, subscriber_id, target_amount)
    values (p_event_id, p_subscriber_id, p_target)
    on conflict (event_id, subscriber_id) do update
      set target_amount = excluded.target_amount, updated_at = now();
  end if;

  if v_old is distinct from p_target then
    insert into public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
    values (auth.uid(), 'COLLECTION_MEMBER_TARGET', 'collection_member_targets',
            p_event_id::text || ':' || p_subscriber_id::text,
            jsonb_build_object('target_amount', v_old), jsonb_build_object('target_amount', p_target));
  end if;

  return jsonb_build_object('event_id', p_event_id, 'subscriber_id', p_subscriber_id, 'target_amount', p_target);
end;
$$;

revoke all on function private.sync_event_active_flag() from public, anon, authenticated;
revoke all on function private.assert_can_record_for(uuid) from public, anon, authenticated;
revoke all on function public.record_collection_contribution(uuid, uuid, numeric, date, text, text, text, uuid) from public, anon;
revoke all on function public.update_collection_contribution(uuid, numeric, date, text, text, text) from public, anon;
revoke all on function public.cancel_collection_contribution(uuid, text) from public, anon;
revoke all on function public.set_collection_member_target(uuid, uuid, numeric) from public, anon;
grant execute on function public.record_collection_contribution(uuid, uuid, numeric, date, text, text, text, uuid) to authenticated;
grant execute on function public.update_collection_contribution(uuid, numeric, date, text, text, text) to authenticated;
grant execute on function public.cancel_collection_contribution(uuid, text) to authenticated;
grant execute on function public.set_collection_member_target(uuid, uuid, numeric) to authenticated;

-- ------------------------------------------------------------
-- 4) One-time import of existing PAID event payments
-- ------------------------------------------------------------
-- Only rows with status PAID and a positive stored amount are imported, with
-- that real amount. PENDING / FAILED / REFUNDED / CANCELLED rows are not turned
-- into payments. The deterministic request id makes re-running a no-op.
insert into public.collection_contributions
  (event_id, subscriber_id, amount, paid_on, method, reference, notes, source, request_id, recorded_by)
select ep.event_id, ep.subscriber_id, round(ep.amount::numeric, 3),
       coalesce(ep.paid_at::date, ep.updated_at::date, current_date),
       case when upper(coalesce(ep.payment_method::text, '')) in ('CASH','TRANSFER','CHEQUE','CARD','MOBILE')
            then upper(ep.payment_method::text) else 'OTHER' end,
       left(ep.transaction_reference::text, 120),
       'Importé depuis le suivi payé / non payé',
       'LEGACY',
       md5('legacy:' || ep.event_id::text || ':' || ep.subscriber_id::text)::uuid,
       null
from public.event_payments ep
where ep.status = 'PAID' and ep.amount > 0 and ep.amount <= 1000000
on conflict (request_id) do nothing;
