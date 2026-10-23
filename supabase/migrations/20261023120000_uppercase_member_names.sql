-- 20261023120000: member names (nom, prenom) are always stored in capitals,
-- whatever the path (forms, CSV import, Edge Functions, SQL).
-- Rollback: supabase/rollback/20261023120000_uppercase_member_names_rollback.sql

create or replace function public.uppercase_member_names()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.nom := upper(btrim(new.nom));
  new.prenom := upper(btrim(new.prenom));
  return new;
end;
$$;

drop trigger if exists trg_uppercase_member_names on public.subscribers;
create trigger trg_uppercase_member_names
  before insert or update of nom, prenom on public.subscribers
  for each row execute function public.uppercase_member_names();

-- Backfill the existing members.
update public.subscribers
   set nom = upper(btrim(nom)), prenom = upper(btrim(prenom))
 where nom is distinct from upper(btrim(nom)) or prenom is distinct from upper(btrim(prenom));
