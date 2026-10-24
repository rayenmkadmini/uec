-- Rollback of 20261025120000_meetings (deletes every meeting and attendance record).
drop function if exists public.list_meeting_candidates();
drop function if exists public.list_meeting_participants(uuid);
drop function if exists public.set_meeting_attendance(uuid, uuid, text, text);
drop function if exists public.join_meeting(uuid);
drop function if exists public.delete_meeting(uuid);
drop function if exists public.cancel_meeting(uuid, boolean);
drop function if exists public.save_meeting(uuid, text, text, timestamptz, integer, integer, text, text, uuid, uuid[]);
drop function if exists private.meeting_audience(text, uuid, uuid[]);
drop table if exists public.meeting_participants;
drop table if exists public.meetings;
drop function if exists private.is_meeting_participant(uuid);
drop function if exists private.is_meeting_manager();
