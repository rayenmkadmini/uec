-- ============================================================
-- UE CLUBISTE — CHAT BETWEEN MEMBERS + ANNOUNCEMENTS
-- Target: project qwlbbfyhjdeekmrxtzjf. Requires 20261025120000_meetings
-- (private.is_meeting_manager) and 20261015160000 (private.account_active).
-- Rollback: supabase/rollback/20261028120000_chat_announcements_rollback.sql
--
--   * chat_messages: two rooms. GENERAL = every active account;
--     BUREAU = ADMIN / SUPERADMIN only. Live through Supabase Realtime.
--     The author name is set by the database (never trusted from the
--     browser); 6 messages per 30 seconds at most; a message is withdrawn
--     (soft delete) by its author or by the bureau.
--   * announcements: written by ADMIN / SUPERADMIN, read by every active
--     account; can be pinned.
-- ============================================================

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  channel text not null default 'GENERAL' check (channel in ('GENERAL', 'BUREAU')),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_name text,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists chat_messages_channel_idx on public.chat_messages (channel, created_at desc);

create or replace function private.chat_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.user_id := auth.uid();
  new.created_at := now();
  new.deleted_at := null;
  new.body := btrim(new.body);
  select coalesce(nullif(btrim(coalesce(s.prenom, '') || ' ' || coalesce(s.nom, '')), ''), p.display_name, 'Membre')
    into new.author_name
    from public.profiles p left join public.subscribers s on s.user_id = p.id
   where p.id = new.user_id;
  if (select count(*) from public.chat_messages m
       where m.user_id = new.user_id and m.created_at > now() - interval '30 seconds') >= 6 then
    raise exception 'Doucement : trop de messages en peu de temps.' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_chat_before_insert on public.chat_messages;
create trigger trg_chat_before_insert before insert on public.chat_messages
  for each row execute function private.chat_before_insert();

alter table public.chat_messages enable row level security;

drop policy if exists chat_select on public.chat_messages;
create policy chat_select on public.chat_messages for select to authenticated
  using ((select private.account_active())
         and (channel = 'GENERAL' or (select private.is_meeting_manager())));

drop policy if exists chat_insert on public.chat_messages;
create policy chat_insert on public.chat_messages for insert to authenticated
  with check ((select private.account_active())
              and (channel = 'GENERAL' or (select private.is_meeting_manager())));

revoke all on public.chat_messages from anon;
revoke update, delete on public.chat_messages from authenticated;
grant select, insert on public.chat_messages to authenticated;

create or replace function public.delete_chat_message(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chat_messages
     set deleted_at = now(), body = '…'
   where id = p_id and deleted_at is null
     and (user_id = auth.uid() or private.is_meeting_manager());
  if not found then
    raise exception 'Message introuvable ou non autorisé.' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.delete_chat_message(bigint) from public, anon;
grant execute on function public.delete_chat_message(bigint) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

-- ---------- announcements ----------
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 2 and 140),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  pinned boolean not null default false,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists announcements_created_idx on public.announcements (pinned desc, created_at desc);

alter table public.announcements enable row level security;

drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements for select to authenticated
  using ((select private.account_active()));
drop policy if exists announcements_insert on public.announcements;
create policy announcements_insert on public.announcements for insert to authenticated
  with check ((select private.is_meeting_manager()));
drop policy if exists announcements_update on public.announcements;
create policy announcements_update on public.announcements for update to authenticated
  using ((select private.is_meeting_manager())) with check ((select private.is_meeting_manager()));
drop policy if exists announcements_delete on public.announcements;
create policy announcements_delete on public.announcements for delete to authenticated
  using ((select private.is_meeting_manager()));

revoke all on public.announcements from anon;
grant select, insert, update, delete on public.announcements to authenticated;
