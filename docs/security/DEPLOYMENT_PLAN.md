# Deployment plan — 5 migrations, 8 Edge Functions, frontend

Status: **prepared, not executed.** No production step has been run. Every step
below needs explicit approval at the time it is run.

Production: `qwlbbfyhjdeekmrxtzjf` (login.uec). Never `astsvxyqyyzqvuioqsnq`.

Verified read-only on 2026-10-16 (`SECURITY_AUDIT_REPORT.md`): the production schema is identical
to the 2026-10-15 backup used by every local test. Remote history: `20261001194746` and
`20261001194845`; 5 pending. Postgres 17.11. 7 v1 functions. No `PUBLIC_SITE_URL` secret.
3 Auth users. The frontend is Git-connected: a push to `main` deploys to production.

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
together, behind a maintenance page (§4).

## 2. Pre-deployment backup checklist

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

1. Announce the window (staff only: production has 3 Auth users). There is no maintenance
   page in the repository. Between steps 5 and 7, the old frontend fails against the new
   schema (sessions end) for about 2–5 minutes. Optional: a temporary Vercel firewall rule
   denying all paths during steps 5–7. It uses the same mechanism as the CSV rule and is
   removed after step 8.
2. Verify the target (`supabase/.temp/project-ref`, `js/config.js`, `migration list`).
   `scripts/apply-migration.mjs` refuses any other project.
3. Final backup and pre-checks (§2).
4. Dashboard Auth settings (§6), so that new links follow the new rules.
5. `node scripts/apply-migration.mjs --confirm-production`: all 5 migrations in **one**
   transaction with in-transaction verification. Any failure rolls back everything.
   Then the role matrix runs (rolled back) and the history is repaired.
6. `supabase secrets set PUBLIC_SITE_URL=https://login.ueclubistes.tn`, then deploy the
   8 functions (including the new `admin-activate-member`).
7. Deploy the frontend: fast-forward push of the release commit to `main`
   (`git push origin <release-commit>:main`, no force). Vercel builds it with `vercel.json`
   (allowlist build: only pages, `css/`, `js/` and `assets/` are served). Then run `npm run check:public`.
8. Smoke tests with real staff accounts (no member data in notes): SUPERADMIN, ADMIN and
   TREASURER pages load; ADMIN sees no CIN, contacts, photos or gender; one activation
   on a synthetic member, then delete it.
9. Turn off the maintenance page. Keep the window open for 30 minutes and monitor the
   function logs and the error rate.

Expected effect on users: every session continues, and accounts flagged
`must_change_password` must change their password before using the app.

## 5. Rollback plan

Order: previous frontend (Vercel: promote deployment `dpl_FogJSA1gAa8hVTsMe76KqGfHhDff`
or revert on `main`) → previous functions → rollback 20261016120000 → 180000 → 160000 →
140000 → 120000 (each in one transaction).

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
