
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create index if not exists audit_logs_user_id_idx
  on public.audit_logs(user_id);

create index if not exists match_participations_zone_id_idx
  on public.match_participations(zone_id);

alter view if exists public.v_member_cards
  set (security_invoker = true);
;
