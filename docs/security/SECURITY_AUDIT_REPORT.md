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
| Self-signup (2026-10-17) | `GET /auth/v1/settings`: `disable_signup=false` (email confirmation on). A self-registered user automatically gets a profile and the MEMBER role (`handle_new_user`). Today that user sees only reference data and active matches/events. | OWNER: Dashboard → Authentication → turn off "Allow new users to sign up" (can be done now, independent of the launch) |
| Browser hardening (2026-10-17) | Production sends only HSTS: no CSP, no anti-framing, no `nosniff`. `supabase-js@2` and `sweetalert2@11` load unpinned from the CDN without SRI, on pages that hold staff sessions in `localStorage`. | PENDING: fixed in the release (`vercel.json` headers; scripts pinned with SRI) |
| HTTPS | HTTP → HTTPS 308 on both domains; certificate valid until 2026-12-14; HSTS 2 years. | VERIFIED |
| GitHub repository | Private (anonymous API → 404). The real CSV in history is not public. | VERIFIED |

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
- 2026-10-17: `vercel.json` security headers (CSP: scripts only from the site and jsDelivr,
  API calls only to the project, `frame-ancestors 'none'`, `object-src 'none'`; `X-Frame-Options`,
  `nosniff`, `Referrer-Policy`, `Permissions-Policy`). CDN scripts pinned with SRI:
  `supabase-js` 2.117.2 (newest release ≥ 14 days old), `sweetalert2` 11.26.25, `chart.js` 4.4.4.
  The browser e2e serves the site with these exact headers and fails on any CSP or SRI violation.
  `tests/site-headers.test.js` guards both. The team-logo fallback escapes initials (an apostrophe
  broke the `onerror` handler).
  CSP limit: `script-src` keeps `'unsafe-inline'` because 22 generated buttons use `onclick=`.
  Moving them to `addEventListener` would allow a strict CSP (follow-up).

### 2026-10-17: migration runner, replica fidelity, backup

| Severity | Finding | Fix (local, tested) |
|---|---|---|
| High | `scripts/apply-migration.mjs` committed the migrations and only **then** ran the role matrix (`run-rls-tests --linked`). A failing matrix left the migrations applied, and the runner only printed rollback commands. | The runner was redesigned. Every check that can run in the transaction now runs before COMMIT, and the migration history is recorded inside the same transaction. The role matrix and the rollback check run beforehand, in a mandatory rehearsal on a replica whose catalog matches production in the 13 compared fingerprint categories. Nothing but read-only checks runs after COMMIT. |
| Medium | The migration history was checked with `includes()` on raw CLI text. | It is now parsed with `JSON.parse` in `scripts/lib/migration-history.mjs`, which fails closed. `tests/migration-history.test.js` covers malformed JSON, missing fields, unexpected or already-applied versions, and local versus remote. |
| Medium | The test replica had 12 EXECUTE grants and 1 default privilege that production does not have (a pg_dump restore artifact). As a result, the rollback of `20261016120000` would have **granted** `anon` EXECUTE on role helpers and trigger functions in production. | `supabase/tests/replica_alignment.sql` aligns the replica, and the stack and docs now apply it. The rollback was regenerated, and the rollback-exactness check passes for all 5 migrations. |
| Medium | Migration 160000 removes the roles of any account that is inactive or must change its password, including a SUPERADMIN. | A pre-commit assertion requires that, whenever SUPERADMIN accounts exist, at least one stays usable (active and not flagged). The first version compared "before" with "after" and could never fail; the independent review caught this and it was corrected. Negative controls are refused: all accounts flagged, and all accounts inactive. In production, both SUPERADMIN accounts are active and unflagged. |
| High (review) | If the response to the apply call was lost, the outcome probe could report "unchanged" while the transaction was still running. | The transaction takes an advisory lock, and the probe waits on that lock before reading the state. |
| Medium (review) | Approval by hash was not enforced, and the history was checked only once. | `--confirm-production` now requires `--expect-sha256=<hash>`, verified (a wrong hash is refused before anything is written). The history and the fingerprint are re-checked right before the apply. |
| Medium (functions review) | The Edge Functions imported `npm:@supabase/supabase-js@2` unpinned, in code that holds the service-role key. | Pinned to `2.117.2` (the frontend's version, ≥ 14 days old). A static test now requires exact versions for every remote import. |
| Medium (frontend review) | CORS allowed only `login.ueclubistes.tn`, yet the site is also served on `www.login.ueclubistes.tn` and `uec-five.vercel.app`, so every admin action failed from those origins. | Both origins were added. The static test checks the exact list, and `check:functions` checks the live preflights. |
| Low (migration and functions reviews) | Failed staff-management calls stored the raw error text in `audit_logs.new_data`, which ADMIN can read after the migrations. | Audit rows now store `{code: "unexpected"}`; the details go to the function logs only. A static test with positive controls guards this. |
| Low | The page route guard did not redirect when building the session context threw an exception. One intermittent browser-e2e failure was seen. | The guard now fails closed (an error sends the user to login). Afterwards the browser e2e passed 4 consecutive runs. |
| Low | The UI accepted 5 MB logos, but the `match-logos` bucket accepts 2 MB. | The UI limit is now 2 MB. |
| Test gap | One browser assertion ended in `\|\| true`, so it always passed. | It now asserts the real state for ADMIN (no controls). A SUPERADMIN counterpart serves as a positive control. |
| Info | There are no platform backups (PITR is off). | A new verified backup with a successful restore test (see `DEPLOYMENT_PLAN.md` §2). |

The independent review of the five migrations found no Critical or High issue in the forward
migrations. No statement deletes or updates application rows, and none drops a table or column.
The bucket updates and policy replacements are listed in the review.

Low findings deferred to a later migration (not launch blockers):

- **Photo folders:** the folder name is derived from `login_name`. Add a CHECK so that two names cannot map to the same folder.
- **Logo bucket:** `match-logos` accepts SVG. Uploads are SUPERADMIN-only.
- **Notifications:** a member can rewrite the title and text of their own notifications. Limit their UPDATE grant to `is_read`.
- **Password marks:** marks back-filled before 160000 have no expiry. In production no account is flagged, so none is affected.
- **Default function privileges:** only a per-schema default revoke is used. This is guarded by the safety-net check and by the matrix test "no function executable by anon".

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
| 4 | Database URLs of the old, separate project `astsvxyqyyzqvuioqsnq` exposed in history | **Closed** (2026-10-17): the project no longer exists (its API and DB hosts do not resolve; not in the account). Production is only `qwlbbfyhjdeekmrxtzjf`. |
| 5 | Personal-data breach assessment (INPDP) for the CSV exposure | OWNER |
| 6 | Supabase connector in Claude is signed in to another account (`login.uec` not visible); the Supabase CLI works | OWNER: reconnect the connector if needed |
| 7 | Leaked-password protection, MFA for staff | OWNER: Dashboard, plan-dependent |
| 8 | Hosted Kong gateway / Storage v1.80.2 not tested (local stack uses equivalents) | Accepted risk; smoke test after launch |
