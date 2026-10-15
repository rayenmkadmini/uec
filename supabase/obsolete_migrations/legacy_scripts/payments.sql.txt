-- UE CLUBISTE - PAYMENTS / EVENTS MODULE
-- Run AFTER schema.sql, security_hardening.sql and roles_migration.sql.
-- Safe for both fresh installations and the older events table that used `title`.

-- 1) Membership card payment
alter table public.subscribers add column if not exists card_paid boolean not null default false;
alter table public.subscribers add column if not exists card_paid_at timestamptz;

-- 2) Normalize existing events table without deleting existing data.
do $$
begin
  if to_regclass('public.events') is null then
    create table public.events (
      id uuid primary key default gen_random_uuid(),
      name text not null check (char_length(trim(name)) between 1 and 150),
      description text,
      amount numeric(10,2) not null default 0 check (amount >= 0),
      event_date date,
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  else
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='events' and column_name='title')
       and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='events' and column_name='name') then
      alter table public.events rename column title to name;
    end if;
    alter table public.events add column if not exists name text;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='events' and column_name='title') then
      update public.events set name=coalesce(nullif(trim(name),''),title) where name is null or trim(name)='';
      alter table public.events alter column title drop not null;
    end if;
    update public.events set name='Événement sans nom' where name is null or trim(name)='';
    alter table public.events alter column name set not null;
    alter table public.events add column if not exists amount numeric(10,2) not null default 0;
    alter table public.events add column if not exists is_active boolean not null default true;
    alter table public.events add column if not exists updated_at timestamptz not null default now();
  end if;
end $$;

-- event_payments.event_id must have the same type as events.id (legacy installs use bigint).
do $$
declare id_type text;
begin
  select format_type(a.atttypid,a.atttypmod) into id_type
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='events' and a.attname='id' and not a.attisdropped;
  if to_regclass('public.event_payments') is null then
    execute format('create table public.event_payments (id uuid primary key default gen_random_uuid(), event_id %s not null references public.events(id) on delete cascade, subscriber_id uuid not null references public.subscribers(id) on delete cascade, paid boolean not null default false, paid_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(event_id,subscriber_id))', id_type);
  end if;
end $$;

alter table public.events enable row level security;
alter table public.event_payments enable row level security;

create index if not exists idx_event_payments_event on public.event_payments(event_id);
create index if not exists idx_event_payments_subscriber on public.event_payments(subscriber_id);

drop trigger if exists events_updated_at on public.events;
create trigger events_updated_at before update on public.events for each row execute function public.update_updated_at();
drop trigger if exists event_payments_updated_at on public.event_payments;
create trigger event_payments_updated_at before update on public.event_payments for each row execute function public.update_updated_at();

revoke all on public.events from anon;
revoke all on public.event_payments from anon;
revoke all on public.events from authenticated;
revoke all on public.event_payments from authenticated;
grant select,insert,update,delete on public.events to authenticated;
grant select,insert,update,delete on public.event_payments to authenticated;

-- Final role policies are applied by permissions_v2.sql.
