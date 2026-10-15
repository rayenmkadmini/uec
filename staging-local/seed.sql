-- Synthetic reference data for the LOCAL staging stack only (no personal data).
-- Faculties come from supabase/faculties_seed.sql (public institution list),
-- loaded separately by stack.sh. Members, staff and payments are created by
-- the test suite through the real APIs with synthetic values.

-- Buckets as in production before 20261015120000 (both public; photos 5 MB, images).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('subscriber-photos', 'subscriber-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('match-logos', 'match-logos', true, null, null)
on conflict (id) do nothing;

insert into public.zones (name) values ('ZONE A'), ('ZONE B'), ('ZONE C')
on conflict do nothing;

insert into public.site_settings (site_name)
select 'UE Clubiste (local staging)' where not exists (select 1 from public.site_settings);

-- One upcoming and one past match (zones created by the matches trigger).
insert into public.matches (id, sport, home_team, away_team, match_date, is_active) values
  ('10000000-0000-4000-8000-0000000000d1', 'FOOTBALL', 'Club Africain', 'STAGING FC', current_date + 30, true),
  ('10000000-0000-4000-8000-0000000000d2', 'FOOTBALL', 'Club Africain', 'PAST FC', current_date - 3, true)
on conflict (id) do nothing;
update public.match_zones set capacity = 1
where match_id = '10000000-0000-4000-8000-0000000000d1' and zone_key = 'ENCEINTE_INF';

insert into public.events (id, title, amount, is_active) values
  ('10000000-0000-4000-8000-0000000000c1', 'Collecte de test', 20, true)
on conflict (id) do nothing;
