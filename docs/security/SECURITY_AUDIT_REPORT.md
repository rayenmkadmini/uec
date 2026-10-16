# Security audit report — 2026-10-16

Status labels: **VERIFIED** (checked today with a command or test), **PENDING** (fix ready,
needs an approval-gated production step), **OWNER** (needs an account owner).
Test evidence: `TEST_REPORT.md`. Launch steps: `DEPLOYMENT_PLAN.md`.

## 1. Targets (VERIFIED)

| Item | Value |
|---|---|
| Repository | `github.com/rayenmkadmini/uec`; production branch `main` = `a5b8cc9` |
| Supabase | `qwlbbfyhjdeekmrxtzjf` (login.uec), Postgres 17.11; `js/config.js` and `supabase/.temp` point at it |
| Vercel | project `uec`, team `rayenmkadminins-projects`; Git-connected, auto-deploys `main`; production deployment `dpl_FogJSA1gAa8hVTsMe76KqGfHhDff` (`a5b8cc9`) |
| Domains | `login.ueclubistes.tn`, `www.login.ueclubistes.tn`, `uec-five.vercel.app` |

## 2. Production state (read-only inspection, 2026-10-16)

| Area | Finding | Status |
|---|---|---|
| Member CSV (incident D1) | Real member CSV was public from 2026-10-01 19:57 UTC. Now **403** on all 3 domains (firewall rule `rule_phase_e_block_member_csv_PdzAWp`) and removed from `main` (`a5b8cc9`). | Contained — VERIFIED |
| Public site output | The deployment publishes the whole repository root: `SECURITY.md`, `README_MATCHS.md`, `IMPORT_MEMBRES_CSV.md` and `supabase/config.toml` answer 200. `SECURITY.md` named one Auth user ID (now removed from the docs). | PENDING: allowlist build (`vercel.json`) — built on Vercel preview `ea30a4f` (26 files) |
| Schema drift | Today's schema-only dump is identical to the 2026-10-15 backup that the local tests use. Remote history: 2 migrations applied, 5 pending. | VERIFIED |
| Anonymous API | 0 rows on all 15 tables and `v_member_cards` (live HEAD requests with the public key). RLS is on everywhere, all 52 policies target `authenticated`, the view is `security_invoker`. | VERIFIED |
| `anon` grants | `GRANT ALL` on every table (Supabase default). Blocked by RLS today, but violates least privilege. | PENDING (migration 120000 revokes) |
| Role escalation | Roles come from `user_roles`; writes are SUPERADMIN-only; `protect_*` triggers stop members editing `app_role`, `is_active`, `status`, `card_paid`, etc. No self-promotion path found. | VERIFIED |
| ADMIN read-only | `is_staff()` includes ADMIN, so ADMIN (and TREASURER) can insert/update member records and event payments in production. Card payments are already TREASURER/SUPERADMIN only. | PENDING (120000, 180000) |
| Member data exposure to staff | Every staff role (ADMIN, TREASURER) reads all member columns, including CIN, address, birth date, phone and email. | PENDING (140000, 160000, 180000) |
| Member photos | Policy `subscriber_photos_public_read` (public). Bucket currently lists **0 objects** to anon. Do not upload photos before 120000. | PENDING (120000 makes the bucket private) |
| Edge Functions | 7 v1 functions (2026-10-01), `verify_jwt = true`. v1 sets the **CIN as the initial password**. `PUBLIC_SITE_URL` secret missing. | PENDING (8 new functions) + OWNER (reset CIN passwords) |
| Function grants | Public helpers are `authenticated`-only; `set_updated_at` is granted to `anon` (trigger function, not callable as RPC). | PENDING (161200) |
| Secrets in browser code | Only the publishable key in `js/config.js`; no service-role/secret key in any page or script. | VERIFIED |

## 3. Database decision: repair, not rebuild

The production schema is small (15 tables), RLS is on everywhere, and the role model is
already table-based. Five incremental migrations close every gap above. They have been tested
on the exact production schema, and each one has a verified rollback. A rebuild would break the links to
`auth.users`, the storage objects and the migration history, and it would add no security. No table is dropped and no data
changes. The production apply script checks row counts inside the transaction.

| Migration | Purpose |
|---|---|
| `20261015120000_role_permissions_repair` | SUPERADMIN-only writes; payment / seat / password RPCs; `protect_*` triggers; private photo bucket; `anon` table grants revoked |
| `20261015140000_member_identity_and_password_hardening` | CIN / address / birth date / notes withheld; verified password change |
| `20261015160000_active_accounts_and_data_minimization` | Deactivated accounts lose access everywhere; phone / email / audit IP / payment notes withheld |
| `20261015180000_admin_least_privilege` | ADMIN read-only; gender / photos SUPERADMIN + owner only |
| `20261016120000_least_privilege_hardening` (new) | No function executable by `anon`; trigger functions not callable by API roles; no MAINTAIN / TRUNCATE / TRIGGER / REFERENCES for API roles; no DELETE grant on `notifications`; safer default privileges |

Role model enforced in PostgreSQL (tested by the 267-check matrix and the HTTP e2e suites):
SUPERADMIN full control; ADMIN read-only supervisor; TREASURER member list + payments through
RPCs, no role administration; MEMBER own record, own seat choice, no other member's data,
no self-promotion.

## 4. Changes in this pass (local, committed, not pushed)

- New migration `20261016120000_least_privilege_hardening` + rollback; 6 new matrix assertions.
- `scripts/apply-migration.mjs`: applies all 5 migrations; 2 new in-transaction checks
  (no `anon` function execution; no MAINTAIN / TRUNCATE for `authenticated`).
- Deployment: `vercel.json` + `scripts/build-public.mjs` (only `*.html`, `css/`, `js/`, `assets/`;
  fails on any other file type); the local stack now serves this exact artifact.
- Browser e2e: phone-width (390 px) layout checks for 11 pages + member redirect.
- Removed the unused `@supabase/server` dependency (no code reference).
- `.mcp.json` untracked and ignored (per-user tool config); `/public/` ignored.
- Docs: Auth user ID removed from `SECURITY.md` and `RLS_ROLE_DESIGN.md`.

### Deleted files

| File | Reason |
|---|---|
| `supabase/schema.sql`, `matchs.sql`, `matches_seed.sql`, `subscriber_photos.sql`, `security_hardening.sql`, `roles_migration.sql`, `permissions_v2.sql`, `multi_role_permissions.sql`, `final_migration_multi_role_and_csv.sql` | Pre-migration scripts (≤ 2026-10-02), not used by code, scripts or tests, and superseded by `supabase/migrations/`. Re-running any of them would restore the old, weaker policies. They remain in Git history. |

No database object is deleted. The applied migration history is untouched.

## 5. Unresolved

| # | Issue | Owner / gate |
|---|---|---|
| 1 | Production still runs the old schema, functions and frontend (section 2 PENDING rows) | Approval: launch sequence in `DEPLOYMENT_PLAN.md` |
| 2 | Accounts created by v1 functions may use the CIN as password | OWNER: reset after the launch (migrations flag `must_change_password`) |
| 3 | Real CSV remains in Git history and in old Vercel deployments (protected by Vercel Authentication) | Approval: Phase E history rewrite; delete old deployments; GitHub Support cache purge |
| 4 | Password of the separate database `astsvxyqyyzqvuioqsnq` exposed in history | OWNER: rotate |
| 5 | Personal-data breach assessment (INPDP) for the CSV exposure | OWNER |
| 6 | Supabase connector in Claude is signed in to another account (`login.uec` not visible); the Supabase CLI works | OWNER: reconnect the connector if needed |
| 7 | Leaked-password protection, MFA for staff | OWNER: Dashboard, plan-dependent |
| 8 | Hosted Kong gateway / Storage v1.80.2 not tested (local stack uses equivalents) | Accepted risk; smoke test after launch |
