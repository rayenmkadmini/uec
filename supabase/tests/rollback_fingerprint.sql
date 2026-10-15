-- Catalog + data fingerprints used by scripts/run-rollback-check.mjs.
-- pg_temp.snap(stage) records one hash per object so differences are named.
create temp table fp (stage text, item text, hash text) on commit drop;

-- Order-independent ACL text: one "grantee:privilege:grantable" entry per grant, sorted.
create function pg_temp.acl(p_acl aclitem[]) returns text language sql as $$
  select coalesce(string_agg(e.entry, ',' order by e.entry), '')
  from (
    select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end || ':' || a.privilege_type || ':' || a.is_grantable as entry
    from aclexplode(p_acl) a
  ) e;
$$;

create function pg_temp.snap(p_stage text) returns void language plpgsql as $$
begin
  -- Policies (public + storage), one row each. clubs is new and intentionally kept by rollback.
  insert into fp
  select p_stage, 'policy ' || schemaname || '.' || tablename || '.' || policyname,
         md5(concat_ws('|', cmd, permissive, roles::text, qual, with_check))
  from pg_policies
  where schemaname in ('public', 'storage') and tablename <> 'clubs';

  -- Functions in public/private: definition + ACL + config
  insert into fp
  select p_stage, 'function ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         md5(concat_ws('|', pg_get_functiondef(p.oid), pg_temp.acl(p.proacl)))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private');

  -- Table / view / sequence ACLs and RLS flags
  insert into fp
  select p_stage, 'acl ' || c.relname, md5(concat_ws('|', pg_temp.acl(c.relacl), c.relrowsecurity, c.relforcerowsecurity))
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'S') and c.relname not like 'clubs%';

  -- Default privileges
  insert into fp
  select p_stage, 'default-acl ' || defaclrole::regrole::text || ' ' || defaclobjtype::text, md5(pg_temp.acl(defaclacl))
  from pg_default_acl where defaclnamespace = 'public'::regnamespace;

  -- Storage buckets
  insert into fp
  select p_stage, 'bucket ' || id, md5(concat_ws('|', public, file_size_limit, allowed_mime_types::text))
  from storage.buckets;

  -- Triggers
  insert into fp
  select p_stage, 'trigger ' || tgrelid::regclass || '.' || tgname, md5(pg_get_triggerdef(oid))
  from pg_trigger where not tgisinternal and tgrelid::regclass::text not like '%clubs%';

  -- Data (full row content) of every application table
  insert into fp select p_stage, 'data auth.users',            md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from auth.users t;
  insert into fp select p_stage, 'data profiles',              md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.profiles t;
  insert into fp select p_stage, 'data user_roles',            md5(coalesce(string_agg(t::text, ',' order by t.user_id, t.role), '')) from public.user_roles t;
  insert into fp select p_stage, 'data subscribers',           md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.subscribers t;
  insert into fp select p_stage, 'data events',                md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.events t;
  insert into fp select p_stage, 'data event_payments',        md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.event_payments t;
  insert into fp select p_stage, 'data card_payments',         md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.card_payments t;
  insert into fp select p_stage, 'data matches',               md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.matches t;
  insert into fp select p_stage, 'data match_zones',           md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.match_zones t;
  insert into fp select p_stage, 'data match_participations',  md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.match_participations t;
  insert into fp select p_stage, 'data faculties',             md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.faculties t;
  insert into fp select p_stage, 'data zones',                 md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.zones t;
  insert into fp select p_stage, 'data site_settings',         md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.site_settings t;
  insert into fp select p_stage, 'data notifications',         md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.notifications t;
  insert into fp select p_stage, 'data audit_logs',            md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.audit_logs t;
  insert into fp select p_stage, 'data storage.objects',       md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from storage.objects t;
end;
$$;
