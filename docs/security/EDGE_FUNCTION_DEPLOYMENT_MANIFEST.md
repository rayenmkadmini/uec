# UE Clubiste — Edge Function Deployment Manifest

**Selected project:** `qwlbbfyhjdeekmrxtzjf`

**Status:** Manifest only. No function deployment was performed.

## Functions

| Function | Local entrypoint | Authentication | Privileged operation | Local verification | Remote verification |
|---|---|---|---|---|---|
| `admin-create-user` | `supabase/functions/admin-create-user/index.ts` | JWT + Superadmin role | Creates Auth user, profile, subscriber, and member role | Source inspected; JS suite passes | Deployed, JWT enabled; source differs |
| `admin-create-admin` | `supabase/functions/admin-create-admin/index.ts` | JWT + Superadmin role | Creates Auth user, profile, and admin roles | Source inspected; Deno unavailable | Deployed, JWT enabled; source differs |
| `admin-update-admin` | `supabase/functions/admin-update-admin/index.ts` | JWT + Superadmin role | Updates admin profile, status, email, and roles | Source inspected; Deno unavailable | Deployed, JWT enabled; source differs |
| `admin-delete-admin` | `supabase/functions/admin-delete-admin/index.ts` | JWT + Superadmin role | Deletes an eligible admin Auth account | Source inspected; Deno unavailable | Deployed, JWT enabled; source differs |
| `admin-delete-user` | `supabase/functions/admin-delete-user/index.ts` | JWT + Superadmin role | Deletes a member Auth account | Source inspected; Deno unavailable | Deployed, JWT enabled; source differs |
| `admin-reset-password` | `supabase/functions/admin-reset-password/index.ts` | JWT + Superadmin role | Resets password and sets required-change flag | Source inspected; Deno unavailable | Deployed, JWT enabled; source differs |
| `admin-import-users` | `supabase/functions/admin-import-users/index.ts` | JWT + Superadmin role | Validates and imports up to 500 member rows | Source inspected; Deno unavailable | Deployed, JWT enabled; source differs |

## Deployment gate

Do not deploy until staging proves:

- local source compiles in Deno;
- the selected project's `role`/`audit_logs` contract is preserved or migrated;
- the role matrix passes with synthetic JWTs;
- profile and Auth operations have rollback evidence;
- audit and rate-limit operations succeed;
- no function exposes service secrets or private data;
- deployed source hashes are recorded after deployment.

The remote function bundles were downloaded read-only on 2026-10-14 using the
Supabase CLI `functions download --use-api` flow. They were not copied into the
repository and were not deployed back.
