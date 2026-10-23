-- 20261024120000: deactivating / reactivating a member (subscribers.status) also
-- disables / enables their login account (profiles.is_active). Staff accounts
-- (ADMIN / SUPERADMIN) are never touched: they are managed from the Administrateurs page.
-- Rollback: supabase/rollback/20261024120000_sync_member_account_status_rollback.sql

create or replace function private.sync_member_account_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is not null
     and not exists (select 1 from public.user_roles r
                      where r.user_id = new.user_id and r.role in ('ADMIN', 'SUPERADMIN')) then
    update public.profiles
       set is_active = (new.status = 'ACTIVE')
     where id = new.user_id and is_active is distinct from (new.status = 'ACTIVE');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_member_account_status on public.subscribers;
create trigger trg_sync_member_account_status
  after insert or update of status, user_id on public.subscribers
  for each row execute function private.sync_member_account_status();

-- Backfill: align existing member accounts with their record.
update public.profiles p
   set is_active = (s.status = 'ACTIVE')
  from public.subscribers s
 where s.user_id = p.id
   and p.is_active is distinct from (s.status = 'ACTIVE')
   and not exists (select 1 from public.user_roles r
                    where r.user_id = p.id and r.role in ('ADMIN', 'SUPERADMIN'));
