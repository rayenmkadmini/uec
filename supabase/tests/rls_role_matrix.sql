-- ============================================================
-- UE CLUBISTE — RLS / RPC ROLE MATRIX TEST
--
-- Run with: node scripts/run-rls-tests.mjs  (wraps this file after the migration
-- inside BEGIN ... and a final forced error, so NOTHING is ever committed).
--
-- Creates throw-away fixture users for each role, impersonates them with a
-- simulated JWT (role=authenticated, sub=<uid>), attempts every sensitive
-- operation, and reports PASS/FAIL in the final error message.
-- ============================================================

create temp table rls_results (n serial, test text, passed boolean, detail text) on commit drop;

-- p_expect: 'allow' => no error and >= 1 row affected/returned
--           'deny'  => error, or 0 rows affected/returned (RLS filtered)
create function pg_temp.t(p_name text, p_who text, p_sql text, p_expect text)
returns void
language plpgsql
as $$
declare
  v_rows bigint := 0;
  v_err text;
  v_uid uuid;
begin
  v_uid := case p_who
    when 'superadmin' then '00000000-0000-4000-8000-0000000000a1'
    when 'admin'      then '00000000-0000-4000-8000-0000000000a2'
    when 'treasurer'  then '00000000-0000-4000-8000-0000000000a3'
    when 'member'     then '00000000-0000-4000-8000-0000000000a4'
    when 'legacy'     then '00000000-0000-4000-8000-0000000000a6'
    else null end;

  if p_who = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('role', 'anon', true);
  else
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
  end if;

  begin
    execute p_sql;
    get diagnostics v_rows = row_count;
  exception when others then
    v_err := sqlerrm;
  end;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into rls_results (test, passed, detail)
  values (
    upper(p_who) || ' ' || p_expect || ': ' || p_name,
    case p_expect
      when 'allow' then v_err is null and v_rows > 0
      else v_err is not null or v_rows = 0
    end,
    coalesce(v_err, v_rows || ' row(s)')
  );
end;
$$;

-- ---------------- fixtures ----------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-sa@test.invalid',  '{"display_name":"RLS SA"}', '{}', now(), now()),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-ad@test.invalid',  '{"display_name":"RLS AD"}', '{}', now(), now()),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-tr@test.invalid',  '{"display_name":"RLS TR"}', '{}', now(), now()),
  ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-mb@test.invalid',  '{"display_name":"RLS MB"}', '{}', now(), now());

-- handle_new_user gave everyone MEMBER; give staff fixtures exactly one staff role.
delete from public.user_roles where user_id in ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a2','00000000-0000-4000-8000-0000000000a3');
insert into public.user_roles (user_id, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'SUPERADMIN'),
  ('00000000-0000-4000-8000-0000000000a2', 'ADMIN'),
  ('00000000-0000-4000-8000-0000000000a3', 'TREASURER');
update public.profiles set must_change_password = true where id = '00000000-0000-4000-8000-0000000000a4';

insert into public.subscribers (id, user_id, nom, prenom, login_name, gender, status, card_paid) values
  ('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000a4', 'Membre', 'Test', 'RLSMEMBER', 'MALE', 'ACTIVE', false),
  ('00000000-0000-4000-8000-0000000000b5', null, 'Autre', 'Membre', 'RLSOTHER', 'FEMALE', 'ACTIVE', false),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000a3', 'Tresorier', 'Membre', 'RLSTREAS', 'MALE', 'ACTIVE', false);
-- Synthetic protected identity values (never real data).
update public.subscribers set cin = '0000000' || right(id::text, 1), adresse = 'Rue Fictive', date_naissance = date '2000-01-01', notes = 'note'
where id in ('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000b5', '00000000-0000-4000-8000-0000000000b3');

-- Production has one settings row; an empty schema-only test database has none.
insert into public.site_settings (site_name) select 'UE Clubiste' where not exists (select 1 from public.site_settings);

-- Existing seat choice + photo of another member (privacy checks)
insert into storage.objects (bucket_id, name) values ('subscriber-photos', 'RLSOTHER/existing.jpg');

insert into public.events (id, title, amount, is_active) values
  ('00000000-0000-4000-8000-0000000000c1', 'RLS collecte', 20, true);

insert into public.matches (id, sport, home_team, away_team, match_date, is_active) values
  ('00000000-0000-4000-8000-0000000000d1', 'FOOTBALL', 'Club Africain', 'RLS FC', current_date + 30, true);
update public.match_zones set capacity = 0 where match_id = '00000000-0000-4000-8000-0000000000d1' and zone_key = 'VIRAGE_1';
insert into public.match_participations (match_id, subscriber_id, zone_id)
select '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000b5', id
from public.match_zones where match_id = '00000000-0000-4000-8000-0000000000d1' and zone_key = 'PELOUSE';

-- A match that has already been played, with the member's seat recorded.
insert into public.matches (id, sport, home_team, away_team, match_date, is_active) values
  ('00000000-0000-4000-8000-0000000000d2', 'FOOTBALL', 'Club Africain', 'RLS PAST FC', current_date - 3, true);
insert into public.match_participations (match_id, subscriber_id, zone_id)
select '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000b4', id
from public.match_zones where match_id = '00000000-0000-4000-8000-0000000000d2' and zone_key = 'PELOUSE';

-- ---------------- ANON ----------------
select pg_temp.t('read members',            'anon', $q$select 1 from public.subscribers$q$, 'deny');
select pg_temp.t('read events',             'anon', $q$select 1 from public.events$q$, 'deny');
select pg_temp.t('card payment RPC',        'anon', $q$select public.set_card_payment_status('00000000-0000-4000-8000-0000000000b5', true)$q$, 'deny');

-- ---------------- SUPERADMIN ----------------
select pg_temp.t('read members',            'superadmin', $q$select 1 from public.subscribers$q$, 'allow');
select pg_temp.t('create event',            'superadmin', $q$insert into public.events (title, amount) values ('SA event', 5)$q$, 'allow');
select pg_temp.t('edit event',              'superadmin', $q$update public.events set amount = 25 where id = '00000000-0000-4000-8000-0000000000c1'$q$, 'allow');
select pg_temp.t('edit member identity',    'superadmin', $q$update public.subscribers set nom = 'Changé' where id = '00000000-0000-4000-8000-0000000000b5'$q$, 'allow');
select pg_temp.t('create match',            'superadmin', $q$insert into public.matches (sport, home_team, away_team, match_date) values ('FOOTBALL','Club Africain','SA FC', current_date + 40)$q$, 'allow');
select pg_temp.t('set club logo',           'superadmin', $q$insert into public.clubs (name, logo_url) values ('SA Club', 'https://example.org/l.png')$q$, 'allow');
select pg_temp.t('card payment RPC',        'superadmin', $q$select public.set_card_payment_status('00000000-0000-4000-8000-0000000000b5', true)$q$, 'allow');
select pg_temp.t('event payment RPC',       'superadmin', $q$select public.set_event_payment_status('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b5', true)$q$, 'allow');
select pg_temp.t('edit own profile',        'superadmin', $q$update public.profiles set display_name = 'SA renamed' where id = '00000000-0000-4000-8000-0000000000a1'$q$, 'allow');
select pg_temp.t('update site settings',    'superadmin', $q$update public.site_settings set site_name = site_name$q$, 'allow');
select pg_temp.t('mark treasurer own card (authorizes)', 'superadmin', $q$select public.set_card_payment_status('00000000-0000-4000-8000-0000000000b3', true)$q$, 'allow');
select pg_temp.t('private fields RPC (one member)', 'superadmin', $q$select * from public.get_member_private_fields('00000000-0000-4000-8000-0000000000b5') where cin is not null$q$, 'allow');
select pg_temp.t('private fields RPC (all members)', 'superadmin', $q$select * from public.get_member_private_fields() where cin is not null$q$, 'allow');
select pg_temp.t('direct CIN column read (RPC only)', 'superadmin', $q$select cin from public.subscribers$q$, 'deny');
select pg_temp.t('correct a member CIN',    'superadmin', $q$update public.subscribers set cin = '00000009' where id = '00000000-0000-4000-8000-0000000000b5'$q$, 'allow');
select pg_temp.t('upload match logo',       'superadmin', $q$insert into storage.objects (bucket_id, name) values ('match-logos', 'rls/sa.png')$q$, 'allow');

-- ---------------- ADMIN (read-only) ----------------
select pg_temp.t('read members',            'admin', $q$select 1 from public.subscribers$q$, 'allow');
select pg_temp.t('read events',             'admin', $q$select 1 from public.events$q$, 'allow');
select pg_temp.t('read cotisations',        'admin', $q$select 1 from public.event_payments$q$, 'allow');
select pg_temp.t('read matches',            'admin', $q$select 1 from public.matches$q$, 'allow');
select pg_temp.t('read member CIN (column)', 'admin', $q$select cin from public.subscribers where id = '00000000-0000-4000-8000-0000000000b5'$q$, 'deny');
select pg_temp.t('read address / birth date', 'admin', $q$select adresse, date_naissance from public.subscribers where id = '00000000-0000-4000-8000-0000000000b5'$q$, 'deny');
select pg_temp.t('read internal notes',     'admin', $q$select notes from public.subscribers$q$, 'deny');
select pg_temp.t('select * on members',     'admin', $q$select * from public.subscribers$q$, 'deny');
select pg_temp.t('filter members by CIN',   'admin', $q$select id from public.subscribers where cin = '00000005'$q$, 'deny');
select pg_temp.t('CIN via member-card view','admin', $q$select cin from public.v_member_cards$q$, 'deny');
select pg_temp.t('private fields RPC (other member)', 'admin', $q$select * from public.get_member_private_fields('00000000-0000-4000-8000-0000000000b5')$q$, 'deny');
select pg_temp.t('private fields RPC (all members)',  'admin', $q$select * from public.get_member_private_fields()$q$, 'deny');
select pg_temp.t('read allowed member fields', 'admin', $q$select nom, prenom, numero_abonnement, phone, email, gender, status, card_paid from public.subscribers where id = '00000000-0000-4000-8000-0000000000b5'$q$, 'allow');
select pg_temp.t('read member-card view (exposes CIN)', 'admin', $q$select nom, prenom from public.v_member_cards$q$, 'deny');
select pg_temp.t('change a user role',      'admin', $q$update public.user_roles set role = 'SUPERADMIN' where user_id = '00000000-0000-4000-8000-0000000000a4'$q$, 'deny');
select pg_temp.t('delete a user role',      'admin', $q$delete from public.user_roles where user_id = '00000000-0000-4000-8000-0000000000a4'$q$, 'deny');
select pg_temp.t('change profile app_role', 'admin', $q$update public.profiles set app_role = 'SUPERADMIN' where id = '00000000-0000-4000-8000-0000000000a4'$q$, 'deny');
select pg_temp.t('deactivate a user',       'admin', $q$update public.profiles set is_active = false where id = '00000000-0000-4000-8000-0000000000a4'$q$, 'deny');
select pg_temp.t('delete a member',         'admin', $q$delete from public.subscribers where id = '00000000-0000-4000-8000-0000000000b5'$q$, 'deny');
select pg_temp.t('read payment member list','admin', $q$select * from public.list_payment_members()$q$, 'allow');
select pg_temp.t('read member photos',      'admin', $q$select 1 from storage.objects where bucket_id = 'subscriber-photos' and name = 'RLSOTHER/existing.jpg'$q$, 'allow');
select pg_temp.t('read seat choices',       'admin', $q$select 1 from public.match_participations$q$, 'allow');
select pg_temp.t('read roles of users',     'admin', $q$select 1 from public.user_roles$q$, 'allow');
select pg_temp.t('create event',            'admin', $q$insert into public.events (title, amount) values ('AD event', 5)$q$, 'deny');
select pg_temp.t('edit event',              'admin', $q$update public.events set amount = 1 where id = '00000000-0000-4000-8000-0000000000c1'$q$, 'deny');
select pg_temp.t('delete event',            'admin', $q$delete from public.events where id = '00000000-0000-4000-8000-0000000000c1'$q$, 'deny');
select pg_temp.t('edit member',             'admin', $q$update public.subscribers set nom = 'X' where id = '00000000-0000-4000-8000-0000000000b5'$q$, 'deny');
select pg_temp.t('create member',           'admin', $q$insert into public.subscribers (nom, prenom) values ('A','B')$q$, 'deny');
select pg_temp.t('mark card paid (table)',  'admin', $q$update public.subscribers set card_paid = true where id = '00000000-0000-4000-8000-0000000000b5'$q$, 'deny');
select pg_temp.t('mark card paid (RPC)',    'admin', $q$select public.set_card_payment_status('00000000-0000-4000-8000-0000000000b5', true)$q$, 'deny');
select pg_temp.t('mark cotisation (RPC)',   'admin', $q$select public.set_event_payment_status('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b5', true)$q$, 'deny');
select pg_temp.t('mark cotisation (table)', 'admin', $q$update public.event_payments set status = 'PAID'$q$, 'deny');
select pg_temp.t('create match',            'admin', $q$insert into public.matches (sport, home_team, away_team, match_date) values ('FOOTBALL','A','B', current_date)$q$, 'deny');
select pg_temp.t('edit match zones',        'admin', $q$update public.match_zones set capacity = 1$q$, 'deny');
select pg_temp.t('set club logo',           'admin', $q$update public.clubs set logo_url = 'https://x.invalid/a.png'$q$, 'deny');
select pg_temp.t('edit faculties',          'admin', $q$update public.faculties set name = name$q$, 'deny');
select pg_temp.t('update site settings',    'admin', $q$update public.site_settings set site_name = 'X'$q$, 'deny');
select pg_temp.t('grant self SUPERADMIN',   'admin', $q$insert into public.user_roles (user_id, role) values ('00000000-0000-4000-8000-0000000000a2', 'SUPERADMIN')$q$, 'deny');
select pg_temp.t('edit own profile',        'admin', $q$update public.profiles set display_name = 'X' where id = '00000000-0000-4000-8000-0000000000a2'$q$, 'deny');
select pg_temp.t('upload match logo',       'admin', $q$insert into storage.objects (bucket_id, name) values ('match-logos', 'rls/ad.png')$q$, 'deny');
select pg_temp.t('upload member photo',     'admin', $q$insert into storage.objects (bucket_id, name) values ('subscriber-photos', 'RLSOTHER/ad.jpg')$q$, 'deny');

-- ---------------- TREASURER ----------------
select pg_temp.t('payment member list',     'treasurer', $q$select * from public.list_payment_members()$q$, 'allow');
select pg_temp.t('list hides CIN',          'treasurer', $q$select cin from public.list_payment_members()$q$, 'deny');
select pg_temp.t('read other members (table)', 'treasurer', $q$select 1 from public.subscribers where user_id is distinct from '00000000-0000-4000-8000-0000000000a3'$q$, 'deny');
select pg_temp.t('read other CIN/address',  'treasurer', $q$select cin, adresse from public.subscribers where id = '00000000-0000-4000-8000-0000000000b5'$q$, 'deny');
select pg_temp.t('read member-card view',   'treasurer', $q$select 1 from public.v_member_cards where id = '00000000-0000-4000-8000-0000000000b5'$q$, 'deny');
select pg_temp.t('read other profiles',     'treasurer', $q$select 1 from public.profiles where id <> '00000000-0000-4000-8000-0000000000a3'$q$, 'deny');
select pg_temp.t('read others roles',       'treasurer', $q$select 1 from public.user_roles where user_id <> '00000000-0000-4000-8000-0000000000a3'$q$, 'deny');
select pg_temp.t('read seat choices',       'treasurer', $q$select 1 from public.match_participations$q$, 'deny');
select pg_temp.t('read member photos',      'treasurer', $q$select 1 from storage.objects where bucket_id = 'subscriber-photos' and name = 'RLSOTHER/existing.jpg'$q$, 'deny');
select pg_temp.t('read audit log',          'treasurer', $q$select 1 from public.audit_logs$q$, 'deny');
select pg_temp.t('read own member row',     'treasurer', $q$select 1 from public.subscribers where user_id = '00000000-0000-4000-8000-0000000000a3'$q$, 'allow');
select pg_temp.t('own card status (RPC)',   'treasurer', $q$select public.set_card_payment_status('00000000-0000-4000-8000-0000000000b3', false)$q$, 'deny');
select pg_temp.t('own cotisation (RPC)',    'treasurer', $q$select public.set_event_payment_status('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b3', true)$q$, 'deny');
select pg_temp.t('own card status (table)', 'treasurer', $q$update public.subscribers set card_paid = false where id = '00000000-0000-4000-8000-0000000000b3'$q$, 'deny');
select pg_temp.t('read events',             'treasurer', $q$select 1 from public.events$q$, 'allow');
select pg_temp.t('mark card paid (RPC)',    'treasurer', $q$select public.set_card_payment_status('00000000-0000-4000-8000-0000000000b5', false)$q$, 'allow');
select pg_temp.t('mark cotisation (RPC)',   'treasurer', $q$select public.set_event_payment_status('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b4', true)$q$, 'allow');
select pg_temp.t('unmark cotisation (RPC)', 'treasurer', $q$select public.set_event_payment_status('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b4', false)$q$, 'allow');
select pg_temp.t('RPC on unknown event',    'treasurer', $q$select public.set_event_payment_status('00000000-0000-4000-8000-0000000000ff', '00000000-0000-4000-8000-0000000000b4', true)$q$, 'deny');
select pg_temp.t('mark card paid (table)',  'treasurer', $q$update public.subscribers set card_paid = true where id = '00000000-0000-4000-8000-0000000000b5'$q$, 'deny');
select pg_temp.t('edit member identity',    'treasurer', $q$update public.subscribers set nom = 'X' where id = '00000000-0000-4000-8000-0000000000b5'$q$, 'deny');
select pg_temp.t('create member',           'treasurer', $q$insert into public.subscribers (nom, prenom) values ('A','B')$q$, 'deny');
select pg_temp.t('create event',            'treasurer', $q$insert into public.events (title, amount) values ('TR event', 5)$q$, 'deny');
select pg_temp.t('edit event amount',       'treasurer', $q$update public.events set amount = 1 where id = '00000000-0000-4000-8000-0000000000c1'$q$, 'deny');
select pg_temp.t('delete event',            'treasurer', $q$delete from public.events where id = '00000000-0000-4000-8000-0000000000c1'$q$, 'deny');
select pg_temp.t('edit cotisation amount',  'treasurer', $q$update public.event_payments set amount = 0$q$, 'deny');
select pg_temp.t('insert cotisation row',   'treasurer', $q$insert into public.event_payments (event_id, subscriber_id, amount, status) values ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b5', 0, 'PAID')$q$, 'deny');
select pg_temp.t('delete cotisation',       'treasurer', $q$delete from public.event_payments$q$, 'deny');
select pg_temp.t('grant self SUPERADMIN',   'treasurer', $q$insert into public.user_roles (user_id, role) values ('00000000-0000-4000-8000-0000000000a3', 'SUPERADMIN')$q$, 'deny');
select pg_temp.t('update site settings',    'treasurer', $q$update public.site_settings set site_name = 'X'$q$, 'deny');
select pg_temp.t('private fields RPC (other member)', 'treasurer', $q$select * from public.get_member_private_fields('00000000-0000-4000-8000-0000000000b5')$q$, 'deny');
select pg_temp.t('edit event title',        'treasurer', $q$update public.events set title = 'X' where id = '00000000-0000-4000-8000-0000000000c1'$q$, 'deny');
select pg_temp.t('edit event active flag',  'treasurer', $q$update public.events set is_active = false where id = '00000000-0000-4000-8000-0000000000c1'$q$, 'deny');
select pg_temp.t('edit cotisation paid_at', 'treasurer', $q$update public.event_payments set paid_at = now()$q$, 'deny');
select pg_temp.t('edit card payment row',   'treasurer', $q$update public.card_payments set amount = 0$q$, 'deny');
select pg_temp.t('change a user role',      'treasurer', $q$update public.user_roles set role = 'SUPERADMIN' where user_id = '00000000-0000-4000-8000-0000000000a3'$q$, 'deny');
select pg_temp.t('delete a user role',      'treasurer', $q$delete from public.user_roles where user_id = '00000000-0000-4000-8000-0000000000a4'$q$, 'deny');
select pg_temp.t('deactivate a user',       'treasurer', $q$update public.profiles set is_active = false where id = '00000000-0000-4000-8000-0000000000a4'$q$, 'deny');
select pg_temp.t('create match',            'treasurer', $q$insert into public.matches (sport, home_team, away_team, match_date) values ('FOOTBALL','A','B', current_date)$q$, 'deny');

-- ---------------- MEMBER ----------------
select pg_temp.t('read own member row',     'member', $q$select 1 from public.subscribers where user_id = '00000000-0000-4000-8000-0000000000a4'$q$, 'allow');
select pg_temp.t('read other members',      'member', $q$select 1 from public.subscribers where id = '00000000-0000-4000-8000-0000000000b5'$q$, 'deny');
select pg_temp.t('read events',             'member', $q$select 1 from public.events$q$, 'deny');
select pg_temp.t('read cotisations',        'member', $q$select 1 from public.event_payments where subscriber_id <> '00000000-0000-4000-8000-0000000000b4'$q$, 'deny');
select pg_temp.t('read other profiles',     'member', $q$select 1 from public.profiles where id <> '00000000-0000-4000-8000-0000000000a4'$q$, 'deny');
select pg_temp.t('payment member list',     'member', $q$select * from public.list_payment_members()$q$, 'deny');
select pg_temp.t('read other seat choices', 'member', $q$select 1 from public.match_participations where subscriber_id = '00000000-0000-4000-8000-0000000000b5'$q$, 'deny');
select pg_temp.t('read other member photo', 'member', $q$select 1 from storage.objects where name = 'RLSOTHER/existing.jpg'$q$, 'deny');
select pg_temp.t('read matches + zones',    'member', $q$select 1 from public.match_zones$q$, 'allow');
select pg_temp.t('edit own phone/address',  'member', $q$update public.subscribers set phone = '+21600000000', adresse = 'Tunis' where user_id = '00000000-0000-4000-8000-0000000000a4'$q$, 'allow');
select pg_temp.t('set own photo path',      'member', $q$update public.subscribers set photo_url = 'RLSMEMBER/me.jpg' where user_id = '00000000-0000-4000-8000-0000000000a4'$q$, 'allow');
select pg_temp.t('point photo at other',    'member', $q$update public.subscribers set photo_url = 'RLSOTHER/x.jpg' where user_id = '00000000-0000-4000-8000-0000000000a4'$q$, 'deny');
select pg_temp.t('edit own name',           'member', $q$update public.subscribers set nom = 'Hack' where user_id = '00000000-0000-4000-8000-0000000000a4'$q$, 'deny');
select pg_temp.t('mark own card paid',      'member', $q$update public.subscribers set card_paid = true where user_id = '00000000-0000-4000-8000-0000000000a4'$q$, 'deny');
select pg_temp.t('change own status',       'member', $q$update public.subscribers set status = 'SUSPENDED' where user_id = '00000000-0000-4000-8000-0000000000a4'$q$, 'deny');
select pg_temp.t('edit other member',       'member', $q$update public.subscribers set phone = '1' where id = '00000000-0000-4000-8000-0000000000b5'$q$, 'deny');
select pg_temp.t('card payment RPC',        'member', $q$select public.set_card_payment_status('00000000-0000-4000-8000-0000000000b4', true)$q$, 'deny');
select pg_temp.t('cotisation RPC',          'member', $q$select public.set_event_payment_status('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b4', true)$q$, 'deny');
select pg_temp.t('grant self SUPERADMIN',   'member', $q$insert into public.user_roles (user_id, role) values ('00000000-0000-4000-8000-0000000000a4', 'SUPERADMIN')$q$, 'deny');
select pg_temp.t('change own app_role',     'member', $q$update public.profiles set app_role = 'SUPERADMIN' where id = '00000000-0000-4000-8000-0000000000a4'$q$, 'deny');
select pg_temp.t('create event',            'member', $q$insert into public.events (title, amount) values ('MB event', 5)$q$, 'deny');
select pg_temp.t('create match',            'member', $q$insert into public.matches (sport, home_team, away_team, match_date) values ('FOOTBALL','A','B', current_date)$q$, 'deny');
select pg_temp.t('choose seat (RPC)',       'member', $q$select public.set_match_participation('00000000-0000-4000-8000-0000000000d1', (select id from public.match_zones where match_id = '00000000-0000-4000-8000-0000000000d1' and zone_key = 'PELOUSE'))$q$, 'allow');
select pg_temp.t('change seat (RPC)',       'member', $q$select public.set_match_participation('00000000-0000-4000-8000-0000000000d1', (select id from public.match_zones where match_id = '00000000-0000-4000-8000-0000000000d1' and zone_key = 'ENCEINTE_SUP'))$q$, 'allow');
select pg_temp.t('choose full zone (RPC)',  'member', $q$select public.set_match_participation('00000000-0000-4000-8000-0000000000d1', (select id from public.match_zones where match_id = '00000000-0000-4000-8000-0000000000d1' and zone_key = 'VIRAGE_1'))$q$, 'deny');
select pg_temp.t('seat via direct insert',  'member', $q$insert into public.match_participations (match_id, subscriber_id, zone_id) select match_id, '00000000-0000-4000-8000-0000000000b5', id from public.match_zones where match_id = '00000000-0000-4000-8000-0000000000d1' limit 1$q$, 'deny');
select pg_temp.t('read own seat',           'member', $q$select 1 from public.match_participations$q$, 'allow');
select pg_temp.t('remove seat (RPC)',       'member', $q$select public.remove_match_participation('00000000-0000-4000-8000-0000000000d1')$q$, 'allow');
select pg_temp.t('upload own photo',        'member', $q$insert into storage.objects (bucket_id, name) values ('subscriber-photos', 'RLSMEMBER/p.jpg')$q$, 'allow');
select pg_temp.t('upload into other folder','member', $q$insert into storage.objects (bucket_id, name) values ('subscriber-photos', 'RLSOTHER/p.jpg')$q$, 'deny');
select pg_temp.t('own private fields (RPC)', 'member', $q$select * from public.get_member_private_fields() where cin is not null$q$, 'allow');
select pg_temp.t('own private fields by id (RPC)', 'member', $q$select * from public.get_member_private_fields('00000000-0000-4000-8000-0000000000b4')$q$, 'allow');
select pg_temp.t('other member private fields (RPC)', 'member', $q$select * from public.get_member_private_fields('00000000-0000-4000-8000-0000000000b5')$q$, 'deny');
select pg_temp.t('own CIN via table (RPC only)', 'member', $q$select cin from public.subscribers where user_id = '00000000-0000-4000-8000-0000000000a4'$q$, 'deny');
select pg_temp.t('edit own CIN',            'member', $q$update public.subscribers set cin = '00000001' where user_id = '00000000-0000-4000-8000-0000000000a4'$q$, 'deny');
select pg_temp.t('delete own MEMBER role',  'member', $q$delete from public.user_roles where user_id = '00000000-0000-4000-8000-0000000000a4'$q$, 'deny');
select pg_temp.t('choose seat on past match', 'member', $q$select public.set_match_participation('00000000-0000-4000-8000-0000000000d2', (select id from public.match_zones where match_id = '00000000-0000-4000-8000-0000000000d2' and zone_key = 'ENCEINTE_SUP'))$q$, 'deny');
select pg_temp.t('remove seat after kick-off', 'member', $q$select public.remove_match_participation('00000000-0000-4000-8000-0000000000d2')$q$, 'deny');
select pg_temp.t('clear own password flag (table)', 'member', $q$update public.profiles set must_change_password = false where id = '00000000-0000-4000-8000-0000000000a4'$q$, 'deny');
select pg_temp.t('complete password change before changing it', 'member', $q$select public.complete_password_change()$q$, 'deny');
select pg_temp.t('legacy account: complete without changing', 'legacy', $q$select public.complete_password_change()$q$, 'deny');
select pg_temp.t('call password digest helper', 'member', $q$select private.password_digest('00000000-0000-4000-8000-0000000000a4')$q$, 'deny');
select pg_temp.t('read password marks table', 'superadmin', $q$select 1 from private.password_change_marks$q$, 'deny');

-- What Supabase Auth does on a successful password update (as postgres, outside any JWT).
update auth.users set encrypted_password = 'rls-new-hash-' || gen_random_uuid() where id = '00000000-0000-4000-8000-0000000000a4';

select pg_temp.t('complete password change after changing it', 'member', $q$select public.complete_password_change()$q$, 'allow');

-- Postconditions (checked as postgres)
insert into rls_results (test, passed, detail)
select 'POST: member password flag cleared', not must_change_password, must_change_password::text
from public.profiles where id = '00000000-0000-4000-8000-0000000000a4';

insert into rls_results (test, passed, detail)
select 'POST: treasurer cotisation stored as PENDING with server amount',
       status = 'PENDING' and amount = 25, status || ' / ' || amount
from public.event_payments
where event_id = '00000000-0000-4000-8000-0000000000c1' and subscriber_id = '00000000-0000-4000-8000-0000000000b4';

insert into rls_results (test, passed, detail)
select 'POST: payment status changes audited', count(*) >= 4, count(*)::text
from public.audit_logs where action in ('CARD_PAYMENT_STATUS', 'EVENT_PAYMENT_STATUS') and created_at >= now();

insert into rls_results (test, passed, detail)
select 'POST: treasurer own card still as set by SUPERADMIN (paid)', card_paid, card_paid::text
from public.subscribers where id = '00000000-0000-4000-8000-0000000000b3';

insert into rls_results (test, passed, detail)
select 'POST: treasurer own cotisation never created', count(*) = 0, count(*)::text
from public.event_payments where subscriber_id = '00000000-0000-4000-8000-0000000000b3';

insert into rls_results (test, passed, detail)
select 'POST: subscriber-photos bucket is private', not public, public::text
from storage.buckets where id = 'subscriber-photos';

insert into rls_results (test, passed, detail)
select 'POST: anon has no table grants', count(*) = 0, count(*)::text
from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon';

insert into rls_results (test, passed, detail)
select 'POST: password mark removed after verified change', count(*) = 0, count(*)::text
from private.password_change_marks where user_id = '00000000-0000-4000-8000-0000000000a4';

insert into rls_results (test, passed, detail)
select 'POST: legacy flagged account still flagged', must_change_password, must_change_password::text
from public.profiles where id = '00000000-0000-4000-8000-0000000000a6';

insert into rls_results (test, passed, detail)
select 'POST: every flagged account has a password mark', count(*) = 0, count(*)::text
from public.profiles p
where p.must_change_password and not exists (select 1 from private.password_change_marks m where m.user_id = p.id);

insert into rls_results (test, passed, detail)
select 'POST: past-match seat kept', count(*) = 1, count(*)::text
from public.match_participations where match_id = '00000000-0000-4000-8000-0000000000d2';

insert into rls_results (test, passed, detail)
select 'POST: member CIN unchanged by member', cin = '00000004', coalesce(cin, 'null')
from public.subscribers where id = '00000000-0000-4000-8000-0000000000b4';

insert into rls_results (test, passed, detail)
select 'POST: no table-level SELECT on subscribers for authenticated',
       not has_table_privilege('authenticated', 'public.subscribers', 'SELECT'), '';

insert into rls_results (test, passed, detail)
select 'POST: authenticated cannot select protected columns',
       not (has_column_privilege('authenticated', 'public.subscribers', 'cin', 'SELECT')
         or has_column_privilege('authenticated', 'public.subscribers', 'adresse', 'SELECT')
         or has_column_privilege('authenticated', 'public.subscribers', 'date_naissance', 'SELECT')
         or has_column_privilege('authenticated', 'public.subscribers', 'notes', 'SELECT')
         or has_column_privilege('authenticated', 'public.v_member_cards', 'cin', 'SELECT')), '';
