-- 20261027120000: meetings take place on the UEC Discord server.
-- A meeting may carry its own link (a Discord voice channel, or any https
-- room); without one, "Rejoindre" opens the UEC Discord server invite.
-- Attendance is recorded exactly as before (join_meeting, server clock).
-- Rollback: supabase/rollback/20261027120000_meetings_discord_rollback.sql

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

  update public.meeting_participants mp
     set joined_at = v_now,
         status = case when v_now > m.starts_at + make_interval(mins => m.late_after_min) then 'LATE' else 'PRESENT' end,
         updated_at = v_now
   where mp.meeting_id = p_id and mp.user_id = auth.uid() and mp.joined_at is null
     and mp.status in ('PENDING', 'ABSENT');
  -- No room link pasted: the UEC Discord server.
  return coalesce(m.meet_url, 'https://discord.gg/chRj5Ycj');
end;
$$;
