
create schema if not exists private;

create or replace function private.protect_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if auth.uid() is null
     or auth.uid() <> old.id
     or public.is_staff()
  then
    return new;
  end if;

  if new.app_role is distinct from old.app_role
     or new.must_change_password is distinct from old.must_change_password
     or new.is_active is distinct from old.is_active
     or new.is_treasurer is distinct from old.is_treasurer
     or new.email is distinct from old.email
  then
    raise exception 'You cannot modify privileged profile fields';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_privileged_fields on public.profiles;
create trigger protect_profile_privileged_fields
before update on public.profiles
for each row execute function private.protect_profile_privileged_fields();

create or replace function private.protect_subscriber_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if auth.uid() is null
     or auth.uid() <> old.user_id
     or public.is_staff()
  then
    return new;
  end if;

  if new.user_id is distinct from old.user_id
     or new.status is distinct from old.status
     or new.card_paid is distinct from old.card_paid
     or new.card_paid_at is distinct from old.card_paid_at
     or new.subscription_start is distinct from old.subscription_start
     or new.subscription_end is distinct from old.subscription_end
     or new.faculty_id is distinct from old.faculty_id
     or new.zone_id is distinct from old.zone_id
     or new.notes is distinct from old.notes
  then
    raise exception 'You cannot modify privileged subscriber fields';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_subscriber_privileged_fields on public.subscribers;
create trigger protect_subscriber_privileged_fields
before update on public.subscribers
for each row execute function private.protect_subscriber_privileged_fields();

revoke all on function private.protect_profile_privileged_fields() from public, anon, authenticated;
revoke all on function private.protect_subscriber_privileged_fields() from public, anon, authenticated;

revoke execute on function public.can_select_match_zone(uuid, uuid) from anon, public;
grant execute on function public.can_select_match_zone(uuid, uuid) to authenticated;

revoke execute on function public.has_role(public.app_role) from anon, public;
grant execute on function public.has_role(public.app_role) to authenticated;

revoke execute on function public.is_admin() from anon, public;
grant execute on function public.is_admin() to authenticated;

revoke execute on function public.is_staff() from anon, public;
grant execute on function public.is_staff() to authenticated;

revoke execute on function public.is_superadmin() from anon, public;
grant execute on function public.is_superadmin() to authenticated;

revoke execute on function public.is_treasurer() from anon, public;
grant execute on function public.is_treasurer() to authenticated;

revoke execute on function public.create_match_zones() from anon, authenticated, public;
revoke execute on function public.handle_new_user() from anon, authenticated, public;
revoke execute on function public.rls_auto_enable() from anon, authenticated, public;

alter default privileges in schema public
revoke execute on functions from anon, public;

alter view if exists public.v_member_cards set (security_invoker = true);
;
