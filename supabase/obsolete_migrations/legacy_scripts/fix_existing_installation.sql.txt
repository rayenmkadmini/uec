-- UE CLUBISTE — repair migration for existing installations
-- Safe to run after the original setup scripts. It preserves existing data.

create extension if not exists pgcrypto;

-- The first versions called the event label `title`; the current application uses `name`.
do $$
begin
  if to_regclass('public.events') is not null then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='events' and column_name='title')
       and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='events' and column_name='name') then
      alter table public.events rename column title to name;
    elsif exists (select 1 from information_schema.columns where table_schema='public' and table_name='events' and column_name='title')
       and exists (select 1 from information_schema.columns where table_schema='public' and table_name='events' and column_name='name') then
      update public.events set name = coalesce(nullif(trim(name), ''), title) where name is null or trim(name) = '';
      alter table public.events alter column title drop not null;
    end if;
  end if;
end $$;

-- Match/subscriber versions require gender; add it if an older database is missing it.
alter table public.subscribers add column if not exists gender text;
alter table public.subscribers drop constraint if exists subscribers_gender_check;
alter table public.subscribers add constraint subscribers_gender_check check (gender in ('MALE','FEMALE'));

-- Ensure the current events contract exists even on an older database.
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 150),
  description text,
  amount numeric(10,2) not null default 0 check (amount >= 0),
  event_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.events add column if not exists name text;
alter table public.events add column if not exists description text;
alter table public.events add column if not exists amount numeric(10,2) not null default 0;
alter table public.events add column if not exists event_date date;
alter table public.events add column if not exists is_active boolean not null default true;
alter table public.events add column if not exists created_at timestamptz not null default now();
alter table public.events add column if not exists updated_at timestamptz not null default now();

-- If name was newly added to a legacy table, recover values from title before enforcing NOT NULL.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='events' and column_name='title') then
    update public.events set name = coalesce(nullif(trim(name), ''), title) where name is null or trim(name) = '';
  end if;
  update public.events set name = 'Événement sans nom' where name is null or trim(name) = '';
  alter table public.events alter column name set not null;
end $$;

-- RLS/grants for events.
alter table public.events enable row level security;
revoke all on public.events from anon;
revoke all on public.events from authenticated;
grant select, insert, update, delete on public.events to authenticated;
drop policy if exists events_admin_all on public.events;
create policy events_admin_all on public.events for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Make the subscriber card payment columns available on older databases.
alter table public.subscribers add column if not exists card_paid boolean not null default false;
alter table public.subscribers add column if not exists card_paid_at timestamptz;

