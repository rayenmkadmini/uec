-- ============================================================
-- UE CLUBISTE — MEETINGS (réunions) WITH ATTENDANCE
-- Target: project qwlbbfyhjdeekmrxtzjf.
-- Rollback: supabase/rollback/20261025120000_meetings_rollback.sql
--
-- Owner decisions (2026-10-24):
--   * The Google Meet link is pasted by the organiser (no Google API).
--   * Audience chosen per meeting: bureau, all members, one faculty, one
--     zone, or a hand-picked list. Invitations are materialised at creation.
--   * Attendance is automatic: a participant who taps "Rejoindre" is PRESENT,
--     or LATE after the tolerance; nobody joined = ABSENT once the meeting is
--     over. ADMIN / SUPERADMIN can correct and mark EXCUSED (justified).
-- Only ADMIN / SUPERADMIN manage meetings. A participant sees only the
-- meetings they are invited to; the Meet link is never visible to others.
-- ============================================================

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 2 and 140),
  description text check (description is null or char_length(description) <= 2000),
  starts_at timestamptz not null,
  duration_min integer not null default 60 check (duration_min between 5 and 600),
  late_after_min integer not null default 10 check (late_after_min between 0 and 120),
  meet_url text check (meet_url is null or meet_url ~ '^https://[A-Za-z0-9.-]+(/[^\s]*)?$'),
  audience text not null check (audience in ('BUREAU', 'ALL', 'FACULTY', 'ZONE', 'CUSTOM')),
  audience_ref uuid,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'CANCELLED')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meetings_starts_idx on public.meetings (starts_at desc);

create table if not exists public.meeting_participants (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'PENDING' check (status in ('PENDING', 'PRESENT', 'LATE', 'ABSENT', 'EXCUSED')),
  joined_at timestamptz,
  note text check (note is null or char_length(note) <= 500),
  marked_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (meeting_id, user_id)
);
create index if not exists meeting_participants_user_idx on public.meeting_participants (user_id);

-- ---------- helpers ----------
create or replace function private.is_meeting_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = auth.uid() and r.role::text in ('ADMIN', 'SUPERADMIN')
  ) and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active);
$$;

create or replace function private.is_meeting_participant(p_meeting uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.meeting_participants mp where mp.meeting_id = p_meeting and mp.user_id = auth.uid());
$$;

-- ---------- RLS ----------
alter table public.meetings enable row level security;
alter table public.meeting_participants enable row level security;

drop policy if exists meetings_select on public.meetings;
create policy meetings_select on public.meetings for select to authenticated
  using ((select private.is_meeting_manager()) or private.is_meeting_participant(id));

drop policy if exists meeting_participants_select on public.meeting_participants;
create policy meeting_participants_select on public.meeting_participants for select to authenticated
  using ((select private.is_meeting_manager()) or user_id = (select auth.uid()));

-- Writes go through the RPCs below only.
revoke insert, update, delete on public.meetings from anon, authenticated;
revoke insert, update, delete on public.meeting_participants from anon, authenticated;
revoke all on public.meetings, public.meeting_participants from anon;
grant select on public.meetings, public.meeting_participants to authenticated;

-- ---------- audience ----------
create or replace function private.meeting_audience(p_audience text, p_ref uuid, p_users uuid[])
returns table (user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct u.user_id from (
    -- the bureau is always invited
    select r.user_id from public.user_roles r where r.role::text in ('ADMIN', 'SUPERADMIN')
    union
    select s.user_id from public.subscribers s
     where s.user_id is not null and s.status = 'ACTIVE'
       and (p_audience = 'ALL'
         or (p_audience = 'FACULTY' and s.faculty_id = p_ref)
         or (p_audience = 'ZONE' and s.zone_id = p_ref))
    union
    select x from unnest(coalesce(p_users, '{}'::uuid[])) as x where p_audience = 'CUSTOM'
  ) u
  join public.profiles p on p.id = u.user_id and p.is_active;
$$;

-- ---------- RPCs ----------
create or replace function public.save_meeting(
  p_id uuid, p_title text, p_description text, p_starts_at timestamptz, p_duration_min integer,
  p_late_after_min integer, p_meet_url text, p_audience text, p_audience_ref uuid, p_users uuid[]
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
    insert into public.meetings (title, description, starts_at, duration_min, late_after_min, meet_url, audience, audience_ref, created_by)
    values (btrim(p_title), nullif(btrim(p_description), ''), p_starts_at, coalesce(p_duration_min, 60), coalesce(p_late_after_min, 10),
            nullif(btrim(p_meet_url), ''), p_audience, p_audience_ref, auth.uid())
    returning id into v_id;
  else
    update public.meetings
       set title = btrim(p_title), description = nullif(btrim(p_description), ''), starts_at = p_starts_at,
           duration_min = coalesce(p_duration_min, 60), late_after_min = coalesce(p_late_after_min, 10),
           meet_url = nullif(btrim(p_meet_url), ''), audience = p_audience, audience_ref = p_audience_ref, updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Réunion introuvable.' using errcode = 'P0002';
    end if;
    -- Removed from the audience and never attended: invitation withdrawn.
    delete from public.meeting_participants mp
     where mp.meeting_id = v_id and mp.status = 'PENDING' and mp.joined_at is null
       and mp.user_id not in (select a.user_id from private.meeting_audience(p_audience, p_audience_ref, p_users) a);
  end if;

  insert into public.meeting_participants (meeting_id, user_id)
  select v_id, a.user_id from private.meeting_audience(p_audience, p_audience_ref, p_users) a
  on conflict do nothing;
  return v_id;
end;
$$;

create or replace function public.cancel_meeting(p_id uuid, p_cancelled boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_meeting_manager() then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  update public.meetings set status = case when p_cancelled then 'CANCELLED' else 'SCHEDULED' end, updated_at = now() where id = p_id;
end;
$$;

create or replace function public.delete_meeting(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_meeting_manager() then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  delete from public.meetings where id = p_id;
end;
$$;

-- The participant taps "Rejoindre": attendance recorded server-side (server clock),
-- then the Meet link is returned. Open from 15 minutes before the start until the end.
create or replace function public.join_meeting(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.meetings%rowtype;
  v_now timestamptz := now();
begin
  select * into m from public.meetings where id = p_id;
  if not found or not private.is_meeting_participant(p_id) then
    raise exception 'Vous n’êtes pas invité à cette réunion.' using errcode = '42501';
  end if;
  if m.status = 'CANCELLED' then
    raise exception 'Cette réunion est annulée.' using errcode = '22023';
  end if;
  if v_now < m.starts_at - interval '15 minutes' then
    raise exception 'La réunion n’est pas encore ouverte (ouverture 15 min avant).' using errcode = '22023';
  end if;
  if v_now > m.starts_at + make_interval(mins => m.duration_min) then
    raise exception 'La réunion est terminée.' using errcode = '22023';
  end if;
  if m.meet_url is null then
    raise exception 'Le lien de la réunion n’a pas encore été ajouté.' using errcode = '22023';
  end if;

  update public.meeting_participants mp
     set joined_at = v_now,
         status = case when v_now > m.starts_at + make_interval(mins => m.late_after_min) then 'LATE' else 'PRESENT' end,
         updated_at = v_now
   where mp.meeting_id = p_id and mp.user_id = auth.uid() and mp.joined_at is null
     and mp.status in ('PENDING', 'ABSENT');
  return m.meet_url;
end;
$$;

create or replace function public.set_meeting_attendance(p_meeting uuid, p_user uuid, p_status text, p_note text default null)
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
  update public.meeting_participants
     set status = p_status, note = nullif(btrim(p_note), ''), marked_by = auth.uid(), updated_at = now()
   where meeting_id = p_meeting and user_id = p_user;
  if not found then
    raise exception 'Participant introuvable.' using errcode = 'P0002';
  end if;
end;
$$;

-- Names of the participants of a meeting (managers only).
create or replace function public.list_meeting_participants(p_meeting uuid)
returns table (user_id uuid, name text, login text, numero text, status text, joined_at timestamptz, note text)
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
  select mp.user_id,
         coalesce(nullif(btrim(coalesce(s.prenom, '') || ' ' || coalesce(s.nom, '')), ''), p.display_name, 'Compte'),
         s.login_name, s.numero_abonnement, mp.status, mp.joined_at, mp.note
    from public.meeting_participants mp
    left join public.subscribers s on s.user_id = mp.user_id
    left join public.profiles p on p.id = mp.user_id
   where mp.meeting_id = p_meeting
   order by 2;
end;
$$;

-- People a manager can hand-pick (active accounts).
create or replace function public.list_meeting_candidates()
returns table (user_id uuid, name text, login text, staff boolean)
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
  select p.id,
         coalesce(nullif(btrim(coalesce(s.prenom, '') || ' ' || coalesce(s.nom, '')), ''), p.display_name, 'Compte'),
         s.login_name,
         exists (select 1 from public.user_roles r where r.user_id = p.id and r.role::text in ('ADMIN', 'SUPERADMIN'))
    from public.profiles p
    left join public.subscribers s on s.user_id = p.id
   where p.is_active
   order by 2;
end;
$$;

revoke execute on function public.save_meeting(uuid, text, text, timestamptz, integer, integer, text, text, uuid, uuid[]) from public, anon;
revoke execute on function public.cancel_meeting(uuid, boolean) from public, anon;
revoke execute on function public.delete_meeting(uuid) from public, anon;
revoke execute on function public.join_meeting(uuid) from public, anon;
revoke execute on function public.set_meeting_attendance(uuid, uuid, text, text) from public, anon;
revoke execute on function public.list_meeting_participants(uuid) from public, anon;
revoke execute on function public.list_meeting_candidates() from public, anon;
grant execute on function public.save_meeting(uuid, text, text, timestamptz, integer, integer, text, text, uuid, uuid[]) to authenticated;
grant execute on function public.cancel_meeting(uuid, boolean) to authenticated;
grant execute on function public.delete_meeting(uuid) to authenticated;
grant execute on function public.join_meeting(uuid) to authenticated;
grant execute on function public.set_meeting_attendance(uuid, uuid, text, text) to authenticated;
grant execute on function public.list_meeting_participants(uuid) to authenticated;
grant execute on function public.list_meeting_candidates() to authenticated;
revoke execute on function private.meeting_audience(text, uuid, uuid[]) from public, anon, authenticated;
