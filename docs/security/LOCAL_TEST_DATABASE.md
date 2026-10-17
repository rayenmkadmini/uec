# Local test database (schema only, no network)

The SQL test runners (`npm run test:rls`, `npm run test:rollback`) run by default
against a **local Docker container** that holds the production *schema* only — no
member data, no Auth users, no credentials. They reach the linked Supabase
project only when `--linked` is passed explicitly, and that is a remote operation
requiring approval.

## What is in the container

| Loaded | Source | Contains personal data? |
|---|---|---|
| Roles (ALTER ROLE settings) | `roles.sql` from the 2026-10-15 backup | No |
| `public` / `private` schema: tables, functions, policies, grants, triggers | `schema.sql` from the backup | No |
| `auth.users` trigger + storage policies | `platform_objects.v2.sql` from the backup | No |
| Auth helper functions, Storage tables, buckets | `supabase/tests/fixtures/platform_stub.sql` (test only) | No |
| Rows | none — every test creates synthetic fixtures inside a transaction that is always rolled back | No |

`data.sql` (which contains personal data and session tokens) is **never** loaded.

The plain `supabase/postgres` image does not include what the Auth and Storage
services install at runtime, so `platform_stub.sql` adds the current
`auth.uid()/auth.role()/auth.jwt()` definitions and the `storage.buckets`,
`storage.objects`, `storage.foldername()` objects that the policies use. **Never
run that file against a Supabase project.**

## Setup (Git Bash)

```sh
export MSYS_NO_PATHCONV=1
B='C:/Users/<you>/uec-backups/2026-10-15'          # restricted backup folder (outside the repo)
docker run -d --name ue-phaseb-testdb --network none \
  -e POSTGRES_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9)" \
  public.ecr.aws/supabase/postgres:17.11.0.002
docker exec ue-phaseb-testdb mkdir -p /restore
for f in roles.sql schema.sql platform_objects.v2.sql; do docker cp "$B/$f" ue-phaseb-testdb:/restore/$f; done
docker cp supabase/tests/fixtures/platform_stub.sql ue-phaseb-testdb:/restore/platform_stub.sql
docker exec ue-phaseb-testdb sh -c 'cd /restore &&
  psql -U supabase_admin -d postgres -q -f roles.sql &&        # 1 expected error: supabase_realtime_admin (platform role)
  psql -U supabase_admin -d postgres -q -f schema.sql &&
  psql -U supabase_admin -d postgres -q -f platform_stub.sql &&
  psql -U supabase_admin -d postgres -q -f platform_objects.v2.sql'
# Remove the EXECUTE grants that the restore adds but production does not have (see below).
docker exec -i -e PGOPTIONS="-c ue.replica_alignment=local-only" ue-phaseb-testdb \
  psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 < supabase/tests/replica_alignment.sql
```

### Proving the replica matches production

`scripts/lib/schema-fingerprint.sql` is a read-only catalog fingerprint in 13 categories:
relations, columns, constraints, policies (including storage), function bodies, function
and table grants, column grants, triggers, enum types, storage buckets, default
privileges, and ownership/options. The last category covers object owners, view options
(`security_invoker`), schema owners and privileges, extensions with their versions, and
event triggers.

`node scripts/apply-migration.mjs --dry-run` runs it on production and on this container
and refuses to continue unless every category matches. It does not compare role attributes
or the Auth/Storage services themselves; those are stubs here (see the differences below).

On 2026-10-17 a restore without the alignment step differed in 2 categories. The restore
had 12 extra EXECUTE grants and 1 extra default privilege. This happens because pg_dump
does not revoke the grants that the image's own default privileges add.
`supabase/tests/replica_alignment.sql` removes exactly those, and all 13 categories then
match. The rollback of `20261016120000` had been generated from the unaligned state and
would have granted those privileges in production; it was regenerated.

`--network none` means the database is reachable only through `docker exec`
(no published port), which matters while the Windows firewall is disabled.

Use `UE_TEST_DB_CONTAINER=<name>` to point the runners at another container.

## Cleanup

```sh
docker rm -f ue-phaseb-testdb      # removes only this container; the image is kept
```

## Restore test with data (pre-release backup)

The pre-release backup (`uec-backups/2026-10-17-pre-release`, which contains personal data)
was restored into a separate container: `--network none`, no published port, same image.
The procedure:

1. Load `roles.sql`.
2. Drop the image's `auth` and `storage` schemas.
3. Load `auth_storage_schema.sql`, except its 7 statements that reference `public`.
4. Load `schema.sql`.
5. Load those 7 statements.
6. Run `replica_alignment.sql`.
7. Load `data.sql`.

Results:

- Row counts match the backup for all 48 tables.
- The catalog fingerprint matches production in all 13 categories.
- Running `UE_TEST_DB_CONTAINER=<restore container> node scripts/apply-migration.mjs --dry-run`
  rehearses the exact production transaction on real data.

That container is **not** the schema-only test container described above. It holds
personal data and the live Auth sessions and refresh tokens of the backup, so:

- it has no network and no published port;
- it is only used for rehearsals;
- it must be removed once the release is done (`docker rm -f <name>`).

## Known differences from production

- Auth / Storage are stubs: GoTrue and Storage API behaviour (password policy,
  signed URLs, bucket MIME checks) is **not** exercised here.
- The test database is empty, so data-dependent checks use synthetic fixtures.
- Postgres image version matches production (`17.11.0.002`).
