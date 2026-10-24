-- Rollback of 20261026120000_club_events (deletes every event, RSVP and attendance record).
drop function if exists public.checkin_club_event(uuid, text);
drop function if exists public.rsvp_club_event(uuid, boolean);
drop function if exists public.list_club_event_participants(uuid);
drop function if exists public.set_club_event_attendance(uuid, uuid, text, text);
drop function if exists public.delete_club_event(uuid);
drop function if exists public.cancel_club_event(uuid, boolean);
drop function if exists public.get_club_event_code(uuid, boolean);
drop function if exists public.save_club_event(uuid, text, text, text, text, timestamptz, integer, integer, integer, text, uuid, uuid[]);
drop function if exists private.new_event_code();
drop table if exists public.club_event_participants;
drop table if exists private.club_event_codes;
drop table if exists public.club_events;
drop function if exists private.is_club_event_participant(uuid);
