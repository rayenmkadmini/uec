-- ============================================================
-- UE CLUBISTE — MEMBER IDENTITY PROTECTION & PASSWORD-CHANGE HARDENING
-- Target: project qwlbbfyhjdeekmrxtzjf. Requires 20261015120000 first.
-- Rollback: supabase/rollback/20261015140000_member_identity_and_password_hardening_rollback.sql
--
-- Non-destructive: no table/column drops, no row deletions or updates of
-- existing application rows, no role changes. Adds one private bookkeeping table.
--
-- 1) Protected identity columns (CIN, address, date of birth, internal notes).
--    Column privileges withhold them from every API role, so no PostgREST
--    query, filter, embed or view can return them — not even to ADMIN.
--    They are served only by get_member_private_fields(): SUPERADMIN (any
--    member) or the member themself (own row). Service role / Edge Functions
--    are unaffected.
-- 2) complete_password_change() only clears the first-login flag once the Auth
--    password really differs from the one in place when the flag was set
--    (a digest snapshot taken by trigger; the password itself is never read
--    or written here).
-- 3) remove_match_participation() refuses matches that have already started.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Protected identity columns
-- ------------------------------------------------------------
-- Fail if the table has drifted from the inspected schema: an unknown column
-- would otherwise be silently withheld (or a protected one silently exposed).
do $check$
declare
  v_actual text;
  v_expected text := 'adresse,card_paid,card_paid_at,cin,created_at,date_naissance,email,faculty_id,gender,id,'
    || 'login_name,nom,notes,numero_abonnement,phone,photo_url,prenom,status,subscription_end,'
    || 'subscription_start,updated_at,user_id,zone_id';
begin
  select string_agg(column_name::text, ',' order by column_name) into v_actual
  from information_schema.columns
  where table_schema = 'public' and table_name = 'subscribers';
  if v_actual is distinct from v_expected then
    raise exception 'public.subscribers columns differ from the reviewed schema: %', v_actual;
  end if;
end
$check$;

revoke select on public.subscribers from authenticated;
grant select (
  id, user_id, nom, prenom, login_name, numero_abonnement, email, phone, gender,
  photo_url, faculty_id, zone_id, status, card_paid, card_paid_at,
  subscription_start, subscription_end, created_at, updated_at
) on public.subscribers to authenticated;

-- v_member_cards (security_invoker) selects cin/adresse/date_naissance, so with
-- the column privileges above no API role can read it any more. The application
-- does not use it; the API grant is removed so the intent is explicit. A
-- replacement view without protected columns needs a DROP VIEW (not done here).
revoke select on public.v_member_cards from authenticated;

-- SUPERADMIN: any member (p_subscriber_id null = all members).
-- Anyone else: own row only; asking for another member is refused.
create or replace function public.get_member_private_fields(p_subscriber_id uuid default null)
returns table (subscriber_id uuid, cin text, adresse text, date_naissance date)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if private.is_superadmin() then
    return query
      select s.id, s.cin, s.adresse, s.date_naissance
      from public.subscribers s
      where p_subscriber_id is null or s.id = p_subscriber_id;
    return;
  end if;

  if p_subscriber_id is not null and not exists (
    select 1 from public.subscribers s where s.id = p_subscriber_id and s.user_id = auth.uid()
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
    select s.id, s.cin, s.adresse, s.date_naissance
    from public.subscribers s
    where s.user_id = auth.uid();
end;
$$;

revoke all on function public.get_member_private_fields(uuid) from public, anon;
grant execute on function public.get_member_private_fields(uuid) to authenticated;

-- ------------------------------------------------------------
-- 2) Verified password change
-- ------------------------------------------------------------
-- One row per account that must change its password: a SHA-256 digest of the
-- Auth password hash at the moment the requirement was set. Not reachable
-- through the API (private schema, no grants, RLS on without policies).
create table if not exists private.password_change_marks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  password_digest text not null,
  marked_at timestamptz not null default now()
);
alter table private.password_change_marks enable row level security;
revoke all on private.password_change_marks from public, anon, authenticated;

create or replace function private.password_digest(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(u.encrypted_password, ''), 'UTF8')), 'hex')
  from auth.users u
  where u.id = p_user_id;
$$;

-- Snapshot whenever must_change_password is set (new account, admin reset).
create or replace function private.mark_password_change_required()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.must_change_password then
    insert into private.password_change_marks (user_id, password_digest, marked_at)
    select new.id, private.password_digest(new.id), now()
    where exists (select 1 from auth.users u where u.id = new.id)
    on conflict (user_id) do update
      set password_digest = excluded.password_digest, marked_at = excluded.marked_at;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_mark_password_change on public.profiles;
create trigger profiles_mark_password_change
  after insert or update of must_change_password on public.profiles
  for each row execute function private.mark_password_change_required();

-- Accounts already waiting for a first change: snapshot their current password.
insert into private.password_change_marks (user_id, password_digest)
select p.id, private.password_digest(p.id)
from public.profiles p
join auth.users u on u.id = p.id
where p.must_change_password
on conflict (user_id) do nothing;

create or replace function public.complete_password_change()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_required boolean;
  v_mark text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select p.must_change_password into v_required from public.profiles p where p.id = auth.uid();
  if v_required is null then
    raise exception 'Profil introuvable.' using errcode = '42501';
  end if;
  if not v_required then
    return;
  end if;

  select m.password_digest into v_mark from private.password_change_marks m where m.user_id = auth.uid();
  if v_mark is null or v_mark = private.password_digest(auth.uid()) then
    raise exception 'Le mot de passe n''a pas encore été changé.' using errcode = '42501';
  end if;

  perform set_config('ue.trusted_op', 'password_change', true);
  update public.profiles p set must_change_password = false where p.id = auth.uid();
  perform set_config('ue.trusted_op', '', true);
  delete from private.password_change_marks m where m.user_id = auth.uid();
end;
$$;

revoke all on function private.password_digest(uuid) from public, anon, authenticated;
revoke all on function private.mark_password_change_required() from public, anon, authenticated;
revoke all on function public.complete_password_change() from public, anon;
grant execute on function public.complete_password_change() to authenticated;

-- ------------------------------------------------------------
-- 3) Seat removal only before kick-off (same rule as set_match_participation)
-- ------------------------------------------------------------
create or replace function public.remove_match_participation(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  perform 1 from public.matches m
  where m.id = p_match_id
    and m.is_active
    and (m.match_date + coalesce(m.match_time, time '23:59')) > (now() at time zone 'Africa/Tunis');
  if not found then
    raise exception 'Ce match n''est plus ouvert aux choix de place.' using errcode = '22023';
  end if;

  delete from public.match_participations mp
  using public.subscribers s
  where mp.match_id = p_match_id
    and mp.subscriber_id = s.id
    and s.user_id = auth.uid();
end;
$$;

revoke all on function public.remove_match_participation(uuid) from public, anon;
grant execute on function public.remove_match_participation(uuid) to authenticated;
