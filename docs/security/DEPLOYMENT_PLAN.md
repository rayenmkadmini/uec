# Deployment plan — 5 migrations, 8 Edge Functions, frontend

Status: **prepared, not executed.** No production step has been run. Every step
below needs explicit approval at the time it is run.

Production: `qwlbbfyhjdeekmrxtzjf` (login.uec). Never `astsvxyqyyzqvuioqsnq`.

Verified read-only on 2026-10-16 (`SECURITY_AUDIT_REPORT.md`): the production schema is identical
to the 2026-10-15 backup used by every local test. Remote history: `20261001194746` and
`20261001194845`; 5 pending. Postgres 17.11. 7 v1 functions. No `PUBLIC_SITE_URL` secret.
2 Auth users, both SUPERADMIN and active. The frontend is Git-connected: a push to `main` deploys to production.

## 1. Migration dependency graph

```
20261001194746_security_hardening_v1        ┐ applied in production
20261001194845_hardening_v2_core            ┘ private.is_* helpers, tables, policies
        │
        ▼
20261015120000_role_permissions_repair       clubs; SUPERADMIN-only writes; payment / seat / password
        │                                    RPCs; protect_* triggers; private photo bucket; anon grants revoked
        ▼
20261015140000_member_identity_and_password_hardening
        │                                    CIN / adresse / date_naissance / notes withheld; get_member_private_fields;
        │                                    password_change_marks + verified complete_password_change;
        │                                    seat removal only before kick-off
        ▼
20261015160000_active_accounts_and_data_minimization
        │                                    account_active / account_ok everywhere; phone / email / audit IP /
        │                                    payment notes withheld; get_account_contacts; expiring temporary access
        ▼
20261015180000_admin_least_privilege         gender / photo_url withheld; photo files SUPERADMIN + owner only;
        │                                    list_match_participants (gender for SUPERADMIN only)
        ▼
20261016120000_least_privilege_hardening     privileges only: no function executable by anon; trigger functions
                                             not callable by API roles; no MAINTAIN / TRUNCATE for API roles;
                                             no DELETE grant on notifications; default privileges tightened
```

Each migration checks that the previous ones are present (column-set and function
checks) and fails otherwise. Rollbacks live in `supabase/rollback/<name>_rollback.sql`
and are applied in **reverse order**. Each is generated from the state it restores
and verified by `npm run test:rollback`.

### Compatibility matrix

| Component | Old (deployed) | New (`816d897`+) |
|---|---|---|
| Frontend vs. new schema | **Breaks**: `select("*")` on members (140000); `profiles.email` read on every page, which **signs everyone out** (160000); gender / photo reads (180000) | Built for it; validated against a real local stack (browser + API) |
| Frontend vs. old schema | Works | **Breaks**: calls RPCs that do not exist yet |
| Edge Functions (8) | v1 deployed: CIN as password, auto-created references, delete keeps member record | Work on any schema; correct behaviour needs 140000+ (password marks) and 160000 (account state) |
| `PUBLIC_SITE_URL` secret | — | Needed for activation links (otherwise `link_unavailable`, with the temporary-password fallback) |

**No order of separate deployments is safe**: there is no frontend that works on
both schemas. The migrations, the 8 functions and the frontend must change
together, in one short window (§4).

## 2. Pre-deployment backup checklist

Status on 2026-10-17:

- **Platform backups:** none. `supabase backups list` returns no backups and PITR is disabled.
- **Own backup:** `uec-backups/2026-10-17-pre-release`, with `MANIFEST.json`. It holds roles, schema, data, and the `auth`/`storage` structure.
- **Checksums:** recorded in the manifest.
- **Counts:** live counts equal dump counts for all 48 tables.
- **Restore test:** passed. It ran in an isolated container (no network): all 48 tables matched the backup, and the catalog matched production in all 13 compared categories. The migrations were then rehearsed on that restored data.
- **Older backups:** the 2026-10-15 backup checksums still match, and the incident Git bundle verifies.
- **Not in the backup:** the migration-history rows (recorded in the manifest), Storage files (0 objects), Edge Function code, and Auth/project settings.

- [ ] `supabase db dump --linked` for roles, schema and data into the restricted backup folder
      (outside the repository; ACL limited to the owner). Record sizes and SHA-256.
- [ ] Restore test of the new dump into a disposable local container, with row counts compared.
- [ ] Download every deployed Edge Function (`functions download … --use-api`), as the rollback source.
- [ ] Save the deployed frontend build (the exact files served), as the rollback source.
- [ ] Record the Auth settings (screenshots of Dashboard → Authentication) before changing them.
- [ ] Record the counts only: profiles with `must_change_password`, profiles not `is_active`,
      SUPERADMIN accounts that are active **and** not flagged (**must be ≥ 1**), and
      subscribers without `user_id`.
- [ ] Confirm the release commit: `npm test`, `npm run test:rls`, `npm run test:rollback`,
      local stack `api-e2e` + `browser-e2e` all green.

## 3. Staging validation checklist

Completed in Phase D on the **local full stack**: real GoTrue v2.197.0 (the production
version), PostgREST v16.3, Storage v1.77.0 (production runs v1.80.2) and Edge runtime
v1.76.2, with the production schema and synthetic data
(`staging-local/`, `docs/security/PHASE_D_REPORT.md`):

- [x] All 5 migrations apply on the production schema; rollbacks verified (re-run 2026-10-16,
      with the exact production transaction rehearsed and rolled back; see `TEST_REPORT.md`)
- [x] Frontend served from the exact Vercel artifact (`scripts/build-public.mjs`), with phone-width checks
- [x] Role matrix over HTTP (anonymous, SUPERADMIN, ADMIN, TREASURER, MEMBER, deactivated,
      pending password change, role removed, forged JWT)
- [x] Import (valid / malformed / duplicate / unknown references), activation link
      (redirect, single use, expiry, allow-list), temporary-password fallback, first login,
      reset, deactivation / reactivation, deletion, payments, events, seats, storage
- [x] All 8 Edge Functions executed in the Edge runtime
- [x] Browser workflows per role (headless Edge)

Still to do on a hosted staging project, if one is approved:

- [ ] Hosted gateway (Kong) and platform-managed `verify_jwt`. Locally an equivalent
      check was used.
- [ ] Production Storage version (v1.80.2) and hosted bucket MIME / size enforcement
- [ ] Dashboard Auth settings exactly as they will be in production (§6)
- [ ] Real email / SMTP behaviour (not used by this project)

## 4. Production sequence (maintenance window)

1. **Announce the window.** Only staff are affected: production has 2 Auth accounts, both
   SUPERADMIN. There is no maintenance page. Between steps 5 and 7 the old frontend fails
   against the new schema (sessions end) for a few minutes.
2. **Owner actions** in the Supabase Dashboard (not possible from the CLI):
   - turn self-signup off (§6);
   - set the Site URL and the redirect allow-list.

   They do not depend on the release and can be done before it.
3. **Final backup and pre-checks** (§2).
4. **Dry run (go/no-go):**

   ```sh
   UE_TEST_DB_CONTAINER=<restore container> node scripts/apply-migration.mjs --dry-run
   ```

   It prints the sha256 of the exact transaction.
5. **Apply the migrations:**

   ```sh
   UE_TEST_DB_CONTAINER=<restore container> node scripts/apply-migration.mjs --confirm-production --expect-sha256=<hash>
   ```

   The script refuses any other transaction. Before writing to production it:
   - checks the target and the history (parsed with `JSON.parse`; remote exactly the 2 applied versions);
   - checks that the replica's catalog fingerprint equals production's in the 13 compared categories;
   - checks the shape of production's migration-history table;
   - rehearses the exact transaction on the replica (COMMIT → ROLLBACK);
   - runs the role matrix and the rollback-exactness check, which must report real results;
   - re-checks the history and the fingerprint immediately before applying.

   It then sends one file, which runs in one session and one transaction. Before COMMIT,
   that transaction:
   - takes an advisory lock;
   - runs the 5 migrations;
   - checks that row counts are unchanged;
   - checks that, if SUPERADMIN accounts exist, at least one stays usable;
   - checks the catalog;
   - records the history.

   Any failure aborts the transaction. If the response is lost, the outcome probe waits on
   the same advisory lock, so it reads the state only after the transaction has ended. After
   COMMIT only read-only checks run, and nothing is rolled back automatically. The role matrix
   does not run on production, because it writes fixture rows.
6. **Edge Functions:**
   - `supabase secrets set PUBLIC_SITE_URL=https://login.ueclubistes.tn`;
   - deploy the 8 functions, **without** `--no-verify-jwt` and without `--prune`;
   - `npm run check:functions -- --with-cli`.
7. **Frontend:** fast-forward push of the release commit to `main`
   (`git push origin <release-commit>:main`, no force). Vercel builds it with `vercel.json`,
   which serves only pages, `css/`, `js/` and `assets/`, with the security headers. Then run
   `npm run check:public` and check the response headers.
8. **Smoke tests:** the read-only checks above. Logging in with real staff accounts is the
   owner's step; the release creates no member and no test record in production.
9. **Monitor** the function logs and the error rate for 30 minutes.

Expected effect on users: every session continues, and accounts flagged
`must_change_password` must change their password before using the app.

## 5. Rollback plan

Order: previous frontend (Vercel: promote deployment `dpl_FogJSA1gAa8hVTsMe76KqGfHhDff`
or revert on `main`) → previous functions → rollback 20261016120000 → 180000 → 160000 →
140000 → 120000 (each in one transaction).

Rollback files restore the **previous** state exactly, which includes its weaknesses:

- **120000 rollback:** makes the `subscriber-photos` bucket public again (with a `TO public` read policy) and restores `anon` ALL grants on every table. **Do not run it unchanged.** No partial rollback file is prepared. If 120000 really had to be undone, write one at that time from this file: keep the storage and `anon` hardening, and verify it with `npm run test:rollback`. Otherwise prefer a forward fix.
- **Migration history:** the runner records it inside the migration transaction. After any database rollback, also run `supabase migration repair --status reverted <version>` for each version that was rolled back.
- **20261016120000 rollback:** regenerated on 2026-10-17 so that it no longer grants `anon` anything production never had.

Partial rollback is possible **only from the end**. Rolling back 20261016120000 alone changes
privileges only. Rolling back 180000 alone with the new frontend degrades (no gender in seat
statistics; seat statistics fail) but does not expose data. The old frontend needs all five
rolled back.

What a rollback does **not** undo:

| Change after deployment | After rollback |
|---|---|
| Members imported by the new import (records, no account) | Stay; they show in the old UI. The old functions cannot activate them (no `user_id`). |
| Accounts activated with a link or temporary password | Stay; passwords chosen by members stay. |
| Activation / recovery links already issued | Stay valid until they expire (cannot be revoked; issue a new password to invalidate). |
| Members deleted (record + account, payments and seats cascade) | **Lost**: restore from the backup only. |
| Card / cotisation status changes, seat choices | Stay (they are data, and audited). |
| `password_change_marks` (expiry, digests) | Dropped: first-login verification becomes client-trusted again. |
| `subscriber-photos` bucket made private (120000) | Becomes **public** again. Consider keeping it private even if rolling back. |
| Column privileges / account-state checks | Removed: staff read CIN and contacts again; deactivated staff keep access. |

## 6. Manual Supabase Dashboard actions (production and staging)

See `AUTH_SETTINGS_REVIEW.md` for how to verify each one and what was validated locally.

1. Authentication → Sign In / Providers → **Allow new users to sign up: off**. Verified **on**
   in production on 2026-10-17 (`/auth/v1/settings`: `disable_signup=false`). It does not
   depend on the release, so it can be turned off now. Check afterwards:
   `curl -s -H "apikey: <publishable key>" https://qwlbbfyhjdeekmrxtzjf.supabase.co/auth/v1/settings`
   must show `"disable_signup":true`.
2. Password policy: **minimum length 12**; required characters: lowercase, uppercase,
   digits, symbols.
3. URL Configuration: Site URL = `https://login.ueclubistes.tn`; Redirect URLs include
   `https://login.ueclubistes.tn/change-password.html` (and nothing broader than needed).
4. Email OTP / link expiry: 3600 s (or up to 86400 s for in-person hand-over).
5. Secure password change: decide after testing (sessions older than 24 h would need to sign in again).
6. Leaked-password protection: only if included in the current plan.
7. Edge Function secret `PUBLIC_SITE_URL` (CLI or Dashboard → Edge Functions → Secrets).
8. Confirm `verify_jwt` is on for all 8 functions (deployment from `supabase/config.toml`).
