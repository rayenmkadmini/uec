-- READ-ONLY catalog fingerprint of everything the pending migrations depend on or change.
-- One row per category (13): md5 of a canonical, ordered text rendering. Used by
-- scripts/apply-migration.mjs to prove that the disposable rehearsal database matches
-- production before anything is applied. No table data is read (only catalog rows and
-- storage bucket settings).
with
rels as (
  select n.nspname || '.' || c.relname || ':' || c.relkind::text || ':rls=' || c.relrowsecurity || ':force=' || c.relforcerowsecurity as line
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind in ('r', 'v', 'm', 'p', 'S')
),
rel_acl as (
  select n.nspname || '.' || c.relname || ':' || coalesce(g.rolname, 'PUBLIC') || ':' || a.privilege_type || ':' || a.is_grantable as line
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  left join pg_roles g on g.oid = a.grantee
  where n.nspname in ('public', 'private') and c.relkind in ('r', 'v', 'm', 'p', 'S')
    and coalesce(g.rolname, 'PUBLIC') in ('PUBLIC', 'anon', 'authenticated', 'service_role')
),
col_acl as (
  select n.nspname || '.' || c.relname || '.' || att.attname || ':' || coalesce(g.rolname, 'PUBLIC') || ':' || a.privilege_type as line
  from pg_attribute att join pg_class c on c.oid = att.attrelid join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(att.attacl) a
  left join pg_roles g on g.oid = a.grantee
  where n.nspname in ('public', 'private') and att.attacl is not null and att.attnum > 0 and not att.attisdropped
),
cols as (
  select table_schema || '.' || table_name || '.' || column_name || ':' || data_type || ':' || udt_name || ':' || is_nullable || ':' || coalesce(column_default, '') as line
  from information_schema.columns where table_schema in ('public', 'private')
),
pols as (
  select schemaname || '.' || tablename || '.' || policyname || ':' || permissive || ':' || cmd || ':' || array_to_string(array(select unnest(roles) order by 1), ',')
         || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') as line
  from pg_policies where schemaname in ('public', 'private', 'storage')
),
funcs as (
  select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || md5(p.prosrc) || ':definer=' || p.prosecdef
         || ':' || p.provolatile::text || ':' || coalesce(array_to_string(p.proconfig, ','), '') as line
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
),
func_acl as (
  select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || coalesce(g.rolname, 'PUBLIC') || ':' || a.privilege_type as line
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  left join pg_roles g on g.oid = a.grantee
  where n.nspname in ('public', 'private') and coalesce(g.rolname, 'PUBLIC') in ('PUBLIC', 'anon', 'authenticated', 'service_role')
),
trigs as (
  select n.nspname || '.' || c.relname || '.' || t.tgname || ':' || pg_get_triggerdef(t.oid) as line
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and (n.nspname in ('public', 'private') or (n.nspname = 'auth' and c.relname = 'users'))
),
cons as (
  select n.nspname || '.' || c.relname || '.' || k.conname || ':' || pg_get_constraintdef(k.oid) as line
  from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private')
),
types as (
  select n.nspname || '.' || t.typname || ':' || array_to_string(array(select e.enumlabel from pg_enum e where e.enumtypid = t.oid order by e.enumsortorder), ',') as line
  from pg_type t join pg_namespace n on n.oid = t.typnamespace
  where n.nspname in ('public', 'private') and t.typtype = 'e'
),
buckets as (
  select b.id || ':' || coalesce(b.public::text, 'null') || ':' || coalesce(b.file_size_limit::text, '') || ':' || coalesce(array_to_string(b.allowed_mime_types, ','), '') as line
  from storage.buckets b
),
defacl as (
  select coalesce(n.nspname, '*') || ':' || r.rolname || ':' || d.defaclobjtype::text || ':' || coalesce(g.rolname, 'PUBLIC') || ':' || a.privilege_type as line
  from pg_default_acl d join pg_roles r on r.oid = d.defaclrole
  left join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) a
  left join pg_roles g on g.oid = a.grantee
  where r.rolname = 'postgres' and (n.nspname is null or n.nspname in ('public', 'private'))
),
ownership as (
  select 'rel ' || n.nspname || '.' || c.relname || ' owner=' || pg_get_userbyid(c.relowner) || ' opts=' || coalesce(array_to_string(c.reloptions, ','), '') as line
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind in ('r', 'v', 'm', 'p', 'S')
  union all
  select 'fn ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') owner=' || pg_get_userbyid(p.proowner)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private')
  union all
  select 'schema ' || n.nspname || ' owner=' || pg_get_userbyid(n.nspowner) || ' acl=' || coalesce(n.nspacl::text, '')
  from pg_namespace n where n.nspname in ('public', 'private', 'storage', 'auth')
  union all
  select 'ext ' || e.extname || ' ' || e.extversion || ' in ' || n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  union all
  select 'evt ' || evtname || ' owner=' || pg_get_userbyid(evtowner) || ' ' || evtevent || ' ' || evtenabled::text || ' ' || evtfoid::regproc::text || ' ' || coalesce(array_to_string(evttags, ','), '') from pg_event_trigger
)
select 'relations' as category, count(*) as n, md5(coalesce(string_agg(line, E'\n' order by line collate "C"), '')) as digest from rels
union all select 'relation_grants', count(*), md5(coalesce(string_agg(line, E'\n' order by line collate "C"), '')) from rel_acl
union all select 'column_grants', count(*), md5(coalesce(string_agg(line, E'\n' order by line collate "C"), '')) from col_acl
union all select 'columns', count(*), md5(coalesce(string_agg(line, E'\n' order by line collate "C"), '')) from cols
union all select 'policies', count(*), md5(coalesce(string_agg(line, E'\n' order by line collate "C"), '')) from pols
union all select 'functions', count(*), md5(coalesce(string_agg(line, E'\n' order by line collate "C"), '')) from funcs
union all select 'function_grants', count(*), md5(coalesce(string_agg(line, E'\n' order by line collate "C"), '')) from func_acl
union all select 'triggers', count(*), md5(coalesce(string_agg(line, E'\n' order by line collate "C"), '')) from trigs
union all select 'constraints', count(*), md5(coalesce(string_agg(line, E'\n' order by line collate "C"), '')) from cons
union all select 'enum_types', count(*), md5(coalesce(string_agg(line, E'\n' order by line collate "C"), '')) from types
union all select 'storage_buckets', count(*), md5(coalesce(string_agg(line, E'\n' order by line collate "C"), '')) from buckets
union all select 'default_privileges', count(*), md5(coalesce(string_agg(line, E'\n' order by line collate "C"), '')) from defacl
union all select 'ownership_options', count(*), md5(coalesce(string_agg(line, E'\n' order by line collate "C"), '')) from ownership
order by category;
