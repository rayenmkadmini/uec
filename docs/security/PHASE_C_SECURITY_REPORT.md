# UE Clubiste — Phase C security report (hardening and staging readiness)

Date: 2026-10-15 · Branch: `backup/pre-production-audit-2026-10-15` · Project: `qwlbbfyhjdeekmrxtzjf`

Contains no member data, CIN values, contact data, credentials or tokens.

## Scope and constraints

Local, reversible work only. Nothing was pushed, deployed or applied. No SQL,
read-only or otherwise, reached production or any linked project. Every database
test ran in the network-isolated local container `ue-phaseb-testdb`, which holds
the production **schema only** (`LOCAL_TEST_DATABASE.md`). "Fixed locally" means
the enforcement point exists in the repository and its negative tests pass
locally; production is unchanged.

## Confirmed vulnerabilities and fixes

| ID | Finding (confirmed) | Fix (local) | Enforcement point | Evidence |
|---|---|---|---|---|
| C-1 | **Deactivated staff keep database access.** `private.is_admin/is_staff/is_superadmin/is_treasurer/has_role` checked `user_roles` only. A deactivated ADMIN / TREASURER / SUPERADMIN with a valid session kept full API access until the token expired. Self-access policies, member RPCs and storage used `auth.uid()` without any account check. | Migration `20261015160000`: `private.account_active()` / `private.account_ok()` (`SECURITY DEFINER`, `search_path=''`, owner bypasses RLS, so no recursion). Every role helper, self policy, member RPC and storage path requires an active account with no pending password change. | Database, on every request | Role matrix: deactivated SUPERADMIN, ADMIN, TREASURER and MEMBER with live sessions; reactivation and deactivation take effect immediately; role removed mid-session; an identity without an account; anonymous. Mutation check: disabling `account_ok` fails 37 checks. |
| C-2 | Accounts with a **pending password change** could use the API directly (the redirect existed only in the UI). | Same: `account_ok` requires `must_change_password = false`; own profile and own roles stay readable so the UI works. | Database | Role matrix ("FIRST LOGIN" section) |
| C-3 | Edge Functions accepted a SUPERADMIN with a pending password change. | `requireSuperAdmin` requires active **and** re-secured (same rule as the database). | Edge Functions (`_shared/security.ts`, all 8 copies) | Static tests |
| C-4 | **ADMIN read member and staff phone / email**; **audit IP addresses** and **payment notes / references** were readable by all staff. | Column privileges withhold `subscribers.phone/email`, `profiles.email/phone`, `audit_logs.ip_address`, and `event_payments` / `card_payments` `notes`, `transaction_reference`. Served only by `get_member_private_fields()` / `get_account_contacts()` to SUPERADMIN or the person themself. | Database | Role matrix: `select`, `select *`, `where … like`, `order by` all refused; RPC refusals |
| C-5 | Column revokes on the payment tables would have been **ineffective**: a table-level `SELECT` overrides column revokes. Caught by the rollback fingerprint during development. | Table grant replaced by an explicit column list (as for `subscribers`). | Database | Rollback check; role matrix |
| C-6 | **Bulk import created Auth identities** (with the CIN as password in production, a random one locally since Phase B). | Import now creates **member records only** (`user_id` null, shown "Non activé"). New `admin-activate-member` activates one member at a time: a random unknown password plus a **single-use, expiring recovery link** (`auth.admin.generateLink`). A temporary password is only a confirmed fallback. Any failure rolls back everything created. | Edge Functions + shared module | `tests/member-lifecycle.test.js` (fake service-role client): partial write failures, duplicate / ambiguous identities, invalid references, link failure, creation failure, existing Auth login, concurrent activation, expired link handling in the UI |
| C-7 | Temporary access never expired. | `password_change_marks.expires_at` (7 days) for marks created from now on; `complete_password_change()` refuses expired access, and the SUPERADMIN re-issues it. Marks backfilled for existing accounts have no expiry, so nobody is locked out by the deployment. | Database | Role matrix (expired → refused; re-issued → refused until changed → allowed) |
| C-8 | **Deleting a member left the member record behind**: `subscribers.user_id` is `ON DELETE SET NULL`, and `admin-delete-user` deleted only the Auth user, keeping CIN and contact data. | `deleteMember()` deletes the account (if any), then the record. Payments and seats cascade. It refuses accounts that also hold a staff role. | Edge Function | `tests/member-lifecycle.test.js` |
| C-9 | **Resetting access could reactivate a deactivated account**: the first draft of the shared helper set `is_active`. Caught in review before any test or commit. | The helper never touches `is_active`. | Edge Function | Test "reset … never reactivates"; static test |
| C-10 | Legacy scripts `payments.sql`, `fix_existing_installation.sql` define `events.name` / `event_payments.paid` (absent in production) and older policies. `README_MATCHS.md` told readers to run `matchs.sql`. | Archived to `supabase/obsolete_migrations/legacy_scripts/*.sql.txt` with a DO-NOT-RUN README (no workflow consumed them). Warning added to `README_MATCHS.md`. | Repository | `tests/schema-contract.test.js` |

## Confirmed authorization behaviour for deactivated users

With an **existing, still-valid session**, once `profiles.is_active = false`:

| Path | Result (tested locally) |
|---|---|
| Own profile row | Readable, so the UI can show "account deactivated" and sign out |
| Own roles, reference data (faculties, zones, matches…) | Denied |
| Member / staff / payment / event / audit / seat tables | Denied (0 rows, or the write is refused) |
| RPCs (payments, seats, private fields, contacts, password completion) | Denied with an explicit error |
| Storage (photos read / upload, logos upload) | Denied |
| Edge Functions | 403 from `requireSuperAdmin`: checked statically only, not executed (no Deno) |
| Reactivation | Access returns on the next request; no new sign-in needed |
| Role removed | Denied on the next request; restored when the role is restored |
| JWT subject with no account / anonymous | Denied |

An Auth ban was evaluated: tokens already issued stay valid until they expire,
and a ban must be lifted on reactivation. It is therefore not the control. It is
documented as optional defense in depth (`AUTH_SETTINGS_REVIEW.md`).

## Field access

See `FIELD_ACCESS_MATRIX.md` (per role, per field, with the enforcing mechanism).

## Tests (exact commands, local only — `--linked` was never used)

| Command | Result |
|---|---|
| `npm test` | 100 tests, 100 pass, 0 fail, 0 skipped, 0 todo |
| `npm run check:js` | OK |
| `node --check` on `scripts/**/*.mjs`, `supabase/functions/_shared/*.mjs` | OK |
| `npm run test:rls` (local container, 3 migrations) | **247 checks, 0 failed**. Each denial verified to fail for the intended reason. |
| `npm run test:rollback` (local container) | 120000: 133 objects · 140000: 139 · 160000: 164 (now including private-table columns). No data changed; everything restored. |
| Apply-script verification block, rendered and run locally (rolled back) | Passed |

### Not tested / limitations

- **Edge Functions were not executed.** Deno and the Supabase Auth / Storage services
  are not available locally. Their logic lives in `_shared/member-lifecycle.mjs`
  and `_shared/import-utils.mjs` and is tested in Node against an in-memory fake;
  the HTTP wrappers are covered by static tests only.
- **Real activation links** (GoTrue `generateLink`, redirect, expiry) were not
  exercised; expiry is a Supabase Auth setting.
- No browser test; no production or staging run; no build step exists.
- Production Auth settings were not read (see `AUTH_SETTINGS_REVIEW.md`).

## Remaining risks

- Production is unchanged. The old Edge Functions still use the CIN as password;
  staff can read CIN and contact data; deactivated staff keep access.
- D1 personal data remains in Git history until Phase E.
- The **server-side password policy is unknown**. A user can set a weak password
  through the Auth API directly until the Dashboard minimum is set.
- If **public sign-up** is enabled in Auth, outsiders can create MEMBER accounts. They
  hold no member data, but the account should not exist.
- Activation links and temporary passwords are bearer secrets during hand-over;
  their safety depends on the channel the SUPERADMIN uses.
- ADMIN still sees member photos, gender, faculty, zone, seats and card status
  (decision listed in the field matrix).
- The supabase-js browser library is loaded from a CDN without a pinned version or
  integrity hash (`@supabase/supabase-js@2`). Pinning it is recommended.
- Deploying the migrations without the new frontend makes the site unusable for
  everyone (`STAGING_RUNBOOK.md` §1).

## Staging prerequisites and manual Dashboard actions

See `STAGING_RUNBOOK.md` §0 (staging project or local full stack, staging site
URL, firewall) and `AUTH_SETTINGS_REVIEW.md` (sign-up off, minimum length 12 with
symbols, redirect allow-list, OTP expiry, secure password change, leaked-password
protection only if included in the plan).
