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
```

`--network none` means the database is reachable only through `docker exec`
(no published port), which matters while the Windows firewall is disabled.

Use `UE_TEST_DB_CONTAINER=<name>` to point the runners at another container.

## Cleanup

```sh
docker rm -f ue-phaseb-testdb      # removes only this container; the image is kept
```

## Known differences from production

- Auth / Storage are stubs: GoTrue and Storage API behaviour (password policy,
  signed URLs, bucket MIME checks) is **not** exercised here.
- The test database is empty, so data-dependent checks use synthetic fixtures.
- Postgres image version matches production (`17.11.0.002`).
