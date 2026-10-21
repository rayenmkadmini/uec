-- ============================================================
-- UE CLUBISTE — STAFF ACCOUNTS THAT ARE ALSO MEMBERS
-- Target: project qwlbbfyhjdeekmrxtzjf. Rollback:
-- supabase/rollback/20261021120000_staff_member_records_rollback.sql
--
-- Owner decision (2026-10-21): an account holding the MEMBER role must have a
-- member record (public.subscribers.user_id), otherwise the member area, seat
-- choice and member card are unavailable to it (e.g. ADMIN + MEMBER accounts
-- created from the Administrateurs page).
--
--   * private.ensure_member_record(user_id) creates the missing record from the
--     account: display name (prénom / nom), a unique login_name derived from the
--     email, the email when it is a real address, status ACTIVE. Faculty, zone,
--     CIN... are completed later from the Abonnés page.
--   * Trigger on user_roles: whenever MEMBER is granted, the record is ensured.
--   * One-time backfill for existing MEMBER accounts without a record.
-- Non-destructive: only inserts missing records; nothing is updated or deleted.
-- ============================================================

create or replace function private.ensure_member_record(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing uuid;
  v_email text;
  v_name text;
  v_prenom text;
  v_nom text;
  v_base text;
  v_login text;
  v_suffix integer := 0;
  v_id uuid;
begin
  if p_user_id is null then
    return null;
  end if;

  select s.id into v_existing from public.subscribers s where s.user_id = p_user_id;
  if found then
    return v_existing;
  end if;

  select u.email, coalesce(nullif(btrim(p.display_name), ''), split_part(u.email, '@', 1))
    into v_email, v_name
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = p_user_id;
  if not found or v_email is null then
    return null;
  end if;

  v_name := regexp_replace(btrim(v_name), '\s+', ' ', 'g');
  v_prenom := split_part(v_name, ' ', 1);
  v_nom := nullif(btrim(substr(v_name, length(v_prenom) + 1)), '');
  if v_nom is null then
    v_nom := v_prenom;
  end if;

  v_base := left(regexp_replace(upper(split_part(v_email, '@', 1)), '[^A-Z0-9_-]', '', 'g'), 36);
  if char_length(v_base) < 3 then
    v_base := 'MEMBRE' || upper(left(replace(p_user_id::text, '-', ''), 8));
  end if;
  v_login := v_base;
  while exists (select 1 from public.subscribers s where s.login_name = v_login) loop
    v_suffix := v_suffix + 1;
    v_login := v_base || v_suffix::text;
  end loop;

  insert into public.subscribers (user_id, nom, prenom, login_name, email, status)
  values (
    p_user_id, v_nom, v_prenom, v_login,
    case when lower(v_email) like '%@login.ueclubiste.local' then null else lower(v_email) end,
    'ACTIVE'
  )
  on conflict (user_id) do nothing
  returning id into v_id;

  if v_id is null then
    select s.id into v_id from public.subscribers s where s.user_id = p_user_id;
  else
    insert into public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
    values (auth.uid(), 'STAFF_MEMBER_RECORD_CREATED', 'subscribers', v_id::text, null,
            jsonb_build_object('user_id', p_user_id, 'login_name', v_login));
  end if;

  return v_id;
end;
$$;

create or replace function private.ensure_member_record_on_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if upper(new.role::text) = 'MEMBER' then
    perform private.ensure_member_record(new.user_id);
  end if;
  return new;
end;
$$;

drop trigger if exists user_roles_ensure_member_record on public.user_roles;
create trigger user_roles_ensure_member_record
after insert on public.user_roles
for each row execute function private.ensure_member_record_on_role();

revoke all on function private.ensure_member_record(uuid) from public, anon, authenticated;
revoke all on function private.ensure_member_record_on_role() from public, anon, authenticated;

-- Backfill: existing MEMBER accounts without a member record.
select private.ensure_member_record(r.user_id)
from public.user_roles r
where upper(r.role::text) = 'MEMBER'
  and not exists (select 1 from public.subscribers s where s.user_id = r.user_id);
