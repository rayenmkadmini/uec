-- ============================================================
-- ROLLBACK for 20261015140000_member_identity_and_password_hardening.sql
-- Restores the exact state left by 20261015120000 (verified by
-- scripts/run-rollback-check.mjs: catalog fingerprints incl. column ACLs).
--
-- Data note: private.password_change_marks only holds digests derived from
-- auth.users and is dropped. After rollback, complete_password_change() again
-- trusts the client (pre-hardening behaviour). No application rows change.
-- Run only with explicit approval, in one transaction.
-- ============================================================

-- 1) Protected identity columns: back to table-level SELECT
revoke select (
  id, user_id, nom, prenom, login_name, numero_abonnement, email, phone, gender,
  photo_url, faculty_id, zone_id, status, card_paid, card_paid_at,
  subscription_start, subscription_end, created_at, updated_at
) on public.subscribers from authenticated;
grant select on public.subscribers to authenticated;

grant select on public.v_member_cards to authenticated;

drop function if exists public.get_member_private_fields(uuid);

-- 2) Password-change verification
drop trigger if exists profiles_mark_password_change on public.profiles;
drop function if exists private.mark_password_change_required();

create or replace function public.complete_password_change()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  perform set_config('ue.trusted_op', 'password_change', true);
  update public.profiles p set must_change_password = false where p.id = auth.uid();
  perform set_config('ue.trusted_op', '', true);
end;
$$;

drop function if exists private.password_digest(uuid);
drop table if exists private.password_change_marks;

-- 3) Seat removal without the kick-off check
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

  delete from public.match_participations mp
  using public.subscribers s
  where mp.match_id = p_match_id
    and mp.subscriber_id = s.id
    and s.user_id = auth.uid();
end;
$$;
