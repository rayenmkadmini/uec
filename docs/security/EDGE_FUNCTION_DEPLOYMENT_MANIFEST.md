# UE Clubiste — Edge Function Deployment Manifest

**Selected project:** `qwlbbfyhjdeekmrxtzjf`

**Status:** Manifest only. No function deployment was performed.

All eight functions must be deployed together with migrations 120000–160000 and the
frontend (the shared `security.ts` changed in every function). Required secret:
`PUBLIC_SITE_URL` (for activation links; see `STAGING_RUNBOOK.md`).

## Functions

| Function | Local entrypoint | Authentication | Privileged operation | Local verification | Remote verification |
|---|---|---|---|---|---|
| `admin-create-user` | `supabase/functions/admin-create-user/index.ts` | JWT + active, re-secured Superadmin | Creates a member record, then activates it (account + single-use link, or temporary password on request); never the CIN | Shared logic unit-tested in Node; Deno unavailable | Deployed v1 differs (uses the CIN as password) |
| `admin-create-admin` | `supabase/functions/admin-create-admin/index.ts` | JWT + Superadmin role | Creates Auth user, profile, and admin roles | Source inspected; Deno unavailable | Deployed, JWT enabled; source differs |
| `admin-update-admin` | `supabase/functions/admin-update-admin/index.ts` | JWT + Superadmin role | Updates admin profile, status, email, and roles | Source inspected; Deno unavailable | Deployed, JWT enabled; source differs |
| `admin-delete-admin` | `supabase/functions/admin-delete-admin/index.ts` | JWT + Superadmin role | Deletes an eligible admin Auth account | Source inspected; Deno unavailable | Deployed, JWT enabled; source differs |
| `admin-delete-user` | `supabase/functions/admin-delete-user/index.ts` | JWT + active, re-secured Superadmin | Deletes the member record **and** its account; refuses staff accounts | Shared logic unit-tested in Node; Deno unavailable | Deployed version deletes only the Auth user (record and CIN remain) |
| `admin-reset-password` | `supabase/functions/admin-reset-password/index.ts` | JWT + active, re-secured Superadmin | New access: single-use link, temporary password or chosen password; flags the account; never reactivates | Shared logic unit-tested in Node; Deno unavailable | Deployed version differs |
| `admin-import-users` | `supabase/functions/admin-import-users/index.ts` | JWT + active, re-secured Superadmin | Validates (all-or-nothing) and imports up to 500 member **records**; creates no accounts | Shared logic unit-tested in Node; Deno unavailable | Deployed version creates accounts with the CIN as password |
| `admin-activate-member` | `supabase/functions/admin-activate-member/index.ts` | JWT + active, re-secured Superadmin | **New.** Creates the account of one member record; returns a single-use link (or temporary password) once | Shared logic unit-tested in Node; Deno unavailable | Not deployed |

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
