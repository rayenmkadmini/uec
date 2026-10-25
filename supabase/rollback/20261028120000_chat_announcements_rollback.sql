-- Rollback of 20261028120000_chat_announcements (deletes every chat message and announcement).
drop function if exists public.delete_chat_message(bigint);
drop table if exists public.chat_messages;
drop function if exists private.chat_before_insert();
drop table if exists public.announcements;
