-- ============================================================
-- UE CLUBISTE — EVENTS (événements) WITH RSVP AND ATTENDANCE
-- Target: project qwlbbfyhjdeekmrxtzjf. Requires 20261025120000_meetings
-- (private.is_meeting_manager, private.meeting_audience).
-- Rollback: supabase/rollback/20261026120000_club_events_rollback.sql
--
-- Same model as the meetings, for in-person events (rassemblement,
-- déplacement, tifo, soirée...):
--   * audience per event (bureau, all members, faculty, zone, selection);
--   * RSVP: the invited member answers "je participe" / "je ne participe pas";
--   * attendance by check-in code: the organiser shows a 6-digit code on site,
--     the member types it in the app during the event -> PRESENT, or LATE
--     after the tolerance; nobody checked in = ABSENT once it is over;
--   * ADMIN / SUPERADMIN correct statuses and mark EXCUSED (justified).
-- The code lives in its own table that no API role can read: only the
-- organisers get it, through get_club_event_code().
-- ============================================================

create table if not exists public.club_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 2 and 140),
  description text check (description is null or char_length(description) <= 2000),
  category text not null default 'RASSEMBLEMENT'
    check (category in ('RASSEMBLEMENT', 'DEPLACEMENT', 'TIFO', 'REUNION', 'SOIREE', 'FORMATION', 'AUTRE')),
  location text check (location is null or char_length(location) <= 200),
  starts_at timestamptz not null,
  duration_min integer not null default 120 check (duration_min between 10 and 2880),
  late_after_min integer not null default 15 check (late_after_min between 0 and 240),
  capacity integer check (capacity is null or capacity between 1 and 100000),
  audience text not null check (audience in ('BUREAU', 'ALL', 'FACULTY', 'ZONE', 'CUSTOM')),
  audience_ref uuid,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'CANCELLED')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists club_events_starts_idx on public.club_events (starts_at desc);

create table if not exists private.club_event_codes (
  event_id uuid primary key references public.club_events(id) on delete cascade,
  code text not null check (code ~ '^[0-9]{6}$')
);

create table if not exists public.club_event_participants (
  event_id uuid not null references public.club_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rsvp text not null default 'NONE' check (rsvp in ('NONE', 'GOING', 'NOT_GOING')),
  status text not null default 'PENDING' check (status in ('PENDING', 'PRESENT', 'LATE', 'ABSENT', 'EXCUSED')),
  checked_in_at timestamptz,
  failed_attempts integer not null default 0,
  note text check (note is null or char_length(note) <= 500),
  marked_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index if not exists club_event_participants_user_idx on public.club_event_participants (user_id);

create or replace function private.is_club_event_participant(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.club_event_participants p where p.event_id = p_event and p.user_id = auth.uid());
$$;

alter table public.club_events enable row level security;
alter table public.club_event_participants enable row level security;

drop policy if exists club_events_select on public.club_events;
create policy club_events_select on public.club_events for select to authenticated
  using ((select private.is_meeting_manager()) or private.is_club_event_participant(id));

drop policy if exists club_event_participants_select on public.club_event_participants;
create policy club_event_participants_select on public.club_event_participants for select to authenticated
  using ((select private.is_meeting_manager()) or user_id = (select auth.uid()));

revoke all on public.club_events, public.club_event_participants from anon;
revoke insert, update, delete on public.club_events, public.club_event_participants from authenticated;
grant select on public.club_events, public.club_event_participants to authenticated;
revoke all on private.club_event_codes from public, anon, authenticated;

create or replace function private.new_event_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select lpad((floor(random() * 1000000))::int::text, 6, '0');
$$;

-- ---------- organiser RPCs ----------
create or replace function public.save_club_event(
  p_id uuid, p_title text, p_description text, p_category text, p_location text, p_starts_at timestamptz,
  p_duration_min integer, p_late_after_min integer, p_capacity integer, p_audience text, p_audience_ref uuid, p_users uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_meeting_manager() then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if p_audience in ('FACULTY', 'ZONE') and p_audience_ref is null then
    raise exception 'Choisissez la faculté ou la zone.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.club_events (title, description, category, location, starts_at, duration_min, late_after_min, capacity, audience, audience_ref, created_by)
    values (btrim(p_title), nullif(btrim(p_description), ''), coalesce(p_category, 'RASSEMBLEMENT'), nullif(btrim(p_location), ''), p_starts_at,
            coalesce(p_duration_min, 120), coalesce(p_late_after_min, 15), p_capacity, p_audience, p_audience_ref, auth.uid())
    returning id into v_id;
    insert into private.club_event_codes (event_id, code) values (v_id, private.new_event_code());
  else
    update public.club_events
       set title = btrim(p_title), description = nullif(btrim(p_description), ''), category = coalesce(p_category, 'RASSEMBLEMENT'),
           location = nullif(btrim(p_location), ''), starts_at = p_starts_at, duration_min = coalesce(p_duration_min, 120),
           late_after_min = coalesce(p_late_after_min, 15), capacity = p_capacity, audience = p_audience, audience_ref = p_audience_ref,
           updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Événement introuvable.' using errcode = 'P0002';
    end if;
    delete from public.club_event_participants p
     where p.event_id = v_id and p.status = 'PENDING' and p.checked_in_at is null and p.rsvp = 'NONE'
       and p.user_id not in (select a.user_id from private.meeting_audience(p_audience, p_audience_ref, p_users) a);
  end if;

  insert into public.club_event_participants (event_id, user_id)
  select v_id, a.user_id from private.meeting_audience(p_audience, p_audience_ref, p_users) a
  on conflict do nothing;
  return v_id;
end;
$$;

create or replace function public.get_club_event_code(p_id uuid, p_regenerate boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if not private.is_meeting_manager() then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if p_regenerate then
    insert into private.club_event_codes (event_id, code) values (p_id, private.new_event_code())
    on conflict (event_id) do update set code = excluded.code;
  end if;
  select code into v_code from private.club_event_codes where event_id = p_id;
  return v_code;
end;
$$;

create or replace function public.cancel_club_event(p_id uuid, p_cancelled boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_meeting_manager() then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  update public.club_events set status = case when p_cancelled then 'CANCELLED' else 'SCHEDULED' end, updated_at = now() where id = p_id;
end;
$$;

create or replace function public.delete_club_event(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_meeting_manager() then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  delete from public.club_events where id = p_id;
end;
$$;

create or replace function public.set_club_event_attendance(p_event uuid, p_user uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_meeting_manager() then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if p_status not in ('PENDING', 'PRESENT', 'LATE', 'ABSENT', 'EXCUSED') then
    raise exception 'Statut invalide.' using errcode = '22023';
  end if;
  update public.club_event_participants
     set status = p_status, note = nullif(btrim(p_note), ''), marked_by = auth.uid(), updated_at = now()
   where event_id = p_event and user_id = p_user;
  if not found then
    raise exception 'Participant introuvable.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.list_club_event_participants(p_event uuid)
returns table (user_id uuid, name text, login text, numero text, rsvp text, status text, checked_in_at timestamptz, note text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_meeting_manager() then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select p.user_id,
         coalesce(nullif(btrim(coalesce(s.prenom, '') || ' ' || coalesce(s.nom, '')), ''), pr.display_name, 'Compte'),
         s.login_name, s.numero_abonnement, p.rsvp, p.status, p.checked_in_at, p.note
    from public.club_event_participants p
    left join public.subscribers s on s.user_id = p.user_id
    left join public.profiles pr on pr.id = p.user_id
   where p.event_id = p_event
   order by 2;
end;
$$;

-- ---------- participant RPCs ----------
create or replace function public.rsvp_club_event(p_id uuid, p_going boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.club_events%rowtype;
  v_going integer;
begin
  select * into e from public.club_events where id = p_id;
  if not found or not private.is_club_event_participant(p_id) then
    raise exception 'Vous n’êtes pas invité à cet événement.' using errcode = '42501';
  end if;
  if e.status = 'CANCELLED' or now() > e.starts_at + make_interval(mins => e.duration_min) then
    raise exception 'Les réponses sont fermées pour cet événement.' using errcode = '22023';
  end if;
  if p_going and e.capacity is not null then
    select count(*) into v_going from public.club_event_participants
     where event_id = p_id and rsvp = 'GOING' and user_id <> auth.uid();
    if v_going >= e.capacity then
      raise exception 'Complet : plus de place disponible.' using errcode = '22023';
    end if;
  end if;
  update public.club_event_participants
     set rsvp = case when p_going then 'GOING' else 'NOT_GOING' end, updated_at = now()
   where event_id = p_id and user_id = auth.uid();
end;
$$;

-- Check-in on site with the organiser's code: open 30 minutes before the start
-- until the end; 5 wrong codes lock the check-in (the organiser can still mark).
create or replace function public.checkin_club_event(p_id uuid, p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.club_events%rowtype;
  p public.club_event_participants%rowtype;
  v_now timestamptz := now();
  v_status text;
begin
  select * into e from public.club_events where id = p_id;
  select * into p from public.club_event_participants where event_id = p_id and user_id = auth.uid();
  if e.id is null or p.user_id is null then
    raise exception 'Vous n’êtes pas invité à cet événement.' using errcode = '42501';
  end if;
  if e.status = 'CANCELLED' then
    raise exception 'Cet événement est annulé.' using errcode = '22023';
  end if;
  if v_now < e.starts_at - interval '30 minutes' then
    raise exception 'Le pointage n’est pas encore ouvert (30 min avant le début).' using errcode = '22023';
  end if;
  if v_now > e.starts_at + make_interval(mins => e.duration_min) then
    raise exception 'L’événement est terminé.' using errcode = '22023';
  end if;
  if p.checked_in_at is not null then
    return p.status;
  end if;
  if p.failed_attempts >= 5 then
    raise exception 'Trop de codes erronés. Présentez-vous à un organisateur.' using errcode = '22023';
  end if;
  if not exists (select 1 from private.club_event_codes c where c.event_id = p_id and c.code = btrim(p_code)) then
    -- Returned, not raised: raising would roll the counter back.
    update public.club_event_participants set failed_attempts = failed_attempts + 1 where event_id = p_id and user_id = auth.uid();
    return 'WRONG_CODE';
  end if;
  v_status := case when v_now > e.starts_at + make_interval(mins => e.late_after_min) then 'LATE' else 'PRESENT' end;
  update public.club_event_participants
     set checked_in_at = v_now, status = v_status, rsvp = 'GOING', updated_at = v_now
   where event_id = p_id and user_id = auth.uid();
  return v_status;
end;
$$;

revoke execute on function public.save_club_event(uuid, text, text, text, text, timestamptz, integer, integer, integer, text, uuid, uuid[]) from public, anon;
revoke execute on function public.get_club_event_code(uuid, boolean) from public, anon;
revoke execute on function public.cancel_club_event(uuid, boolean) from public, anon;
revoke execute on function public.delete_club_event(uuid) from public, anon;
revoke execute on function public.set_club_event_attendance(uuid, uuid, text, text) from public, anon;
revoke execute on function public.list_club_event_participants(uuid) from public, anon;
revoke execute on function public.rsvp_club_event(uuid, boolean) from public, anon;
revoke execute on function public.checkin_club_event(uuid, text) from public, anon;
grant execute on function public.save_club_event(uuid, text, text, text, text, timestamptz, integer, integer, integer, text, uuid, uuid[]) to authenticated;
grant execute on function public.get_club_event_code(uuid, boolean) to authenticated;
grant execute on function public.cancel_club_event(uuid, boolean) to authenticated;
grant execute on function public.delete_club_event(uuid) to authenticated;
grant execute on function public.set_club_event_attendance(uuid, uuid, text, text) to authenticated;
grant execute on function public.list_club_event_participants(uuid) to authenticated;
grant execute on function public.rsvp_club_event(uuid, boolean) to authenticated;
grant execute on function public.checkin_club_event(uuid, text) to authenticated;
revoke execute on function private.new_event_code() from public, anon, authenticated;
