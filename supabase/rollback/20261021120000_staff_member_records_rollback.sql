-- Rollback of 20261021120000_staff_member_records: removes the trigger and the helper.
-- Member records created by it are kept (they may already hold seats, payments or edits);
-- delete them from the Abonnés page if needed (audit_logs action STAFF_MEMBER_RECORD_CREATED lists them).
drop trigger if exists user_roles_ensure_member_record on public.user_roles;
drop function if exists private.ensure_member_record_on_role();
drop function if exists private.ensure_member_record(uuid);
