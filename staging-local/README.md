# Local staging stack (disposable, synthetic data)

A full local Supabase-compatible stack for validating the pending migrations,
the 8 Edge Functions and the frontend **without any Supabase project**.

| Service | Image (same versions as Supabase CLI 2.117.0 pins) | Published |
|---|---|---|
| Postgres | `supabase/postgres:17.11.0.002` (production version) | no |
| Auth | `supabase/gotrue:v2.197.0` (production version) | no |
| REST | `supabase/postgrest:v16.3` | no |
| Storage | `supabase/storage-api:v1.77.0` (production: v1.80.2) | no |
| Edge Functions | `supabase/edge-runtime:v1.76.2` (Deno inside the container) | no |
| Gateway | `nginx:1.27-alpine` → `/rest/v1`, `/auth/v1`, `/storage/v1`, `/functions/v1` | **127.0.0.1:54321 only** |

## Why not `supabase start`

`supabase start` publishes about ten ports on **all interfaces** and uses the
well-known demo JWT secret and keys. On this machine (Public network profile,
firewall off) that would expose an API with public keys to the local network.
This stack:

- keeps every service on the private Docker network `ue-stage-net`;
- publishes only the gateway, and only on `127.0.0.1` (checked with `netstat`);
- generates a **fresh random JWT secret and keys** (`gen-keys.mjs` →
  `.secrets/stack.env`, git-ignored, never printed);
- never contacts a Supabase project: no `--linked`, no project ref, no production key.

## Usage (Git Bash)

```sh
bash staging-local/stack.sh up         # ~3–5 min: services, production schema (no data), 4 pending migrations, synthetic seed
node staging-local/tests/api-e2e.mjs   # HTTP tests against real Auth / REST / Storage / Edge runtime
node staging-local/tests/browser-e2e.mjs   # headless Microsoft Edge (DevTools protocol), site on 127.0.0.1:5500
bash staging-local/stack.sh status
bash staging-local/stack.sh auth 5     # recreate Auth only with a 5 s link lifetime (expiry test; used by api-e2e)
bash staging-local/stack.sh down       # remove containers, network and site build (images kept)
bash staging-local/stack.sh down --purge   # also delete the generated keys
```

`UE_BACKUP_DIR` points at the restricted schema-only backup (default
`C:/Users/Rayen Mkadmini/uec-backups/2026-10-15`). Only `roles.sql`, `schema.sql`
and `platform_objects.v2.sql` are loaded, **never `data.sql`**.

The browser test serves `staging-local/.build/web`, a copy of the site whose
`js/config.js` points at the local stack. The committed `js/config.js` is never
modified. Edge runs headless with a throw-away profile and DevTools on 127.0.0.1;
only that profile's processes are stopped afterwards.

## Differences from hosted Supabase

- The gateway is nginx, not Kong. `verify_jwt = true` is reproduced in
  `functions-main/index.ts` (HS256 signature and expiry check before the function runs).
- Storage v1.77.0 (production v1.80.2). Bucket size / MIME limits are enforced by Storage.
- No SMTP: links are generated with `auth.admin.generateLink` and never emailed,
  which is also the production design (internal login emails).
- New keys every `--purge`; synthetic users and members are created by the tests.
