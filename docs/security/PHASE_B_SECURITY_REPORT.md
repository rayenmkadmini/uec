# UE Clubiste — Phase B security report (local code repairs)

Date: 2026-10-15 · Branch: `backup/pre-production-audit-2026-10-15` · Project: `qwlbbfyhjdeekmrxtzjf`

This report contains no member data, CIN values, credentials or tokens.

## Scope and constraints

Local changes only. Nothing was pushed, deployed or applied. No SQL — not even
read-only or rolled-back — was sent to the production database during Phase B. All
database tests ran in a local, network-isolated container holding the production
**schema only** (`docs/security/LOCAL_TEST_DATABASE.md`).

"Fixed locally" below means: the enforcement point is implemented in the repository
and the negative tests pass locally. **Production is unchanged until the approved
migrations are applied and the Edge Functions / frontend are deployed.**

## Findings

| ID | Finding | Status | Enforcement point | Verified by |
|---|---|---|---|---|
| D3 | Original frontend (`01ff97f`) used `events.name` and `event_payments.paid`; production has `events.title` and `event_payments.status` (`payment_status` enum). The old names exist only in stale scripts `supabase/payments.sql` / `fix_existing_installation.sql`. | Fixed in the checkpoint code; now locked by a contract test | Browser queries | `tests/schema-contract.test.js` (mutation check: reintroducing `name`/`paid` fails the test) |
| D7 | CSV header `Login (FOULENFOULENI)` was not recognised, so CSV logins were silently replaced by generated ones. | Fixed locally | Import page mapping (`js/csv-utils.js`, one explicit alias table); server re-validates content | `tests/member-csv-headers.test.js`, `tests/csv-template.test.js` |
| D8-1 | New member accounts used the **CIN as initial password** (`admin-create-user`, `admin-import-users`, and the stale dashboard copies). | Fixed locally (not deployed) | Edge Functions: random 20-char temporary password (CSPRNG, unbiased) | `tests/import-validation.test.js`, `tests/edge-functions-static.test.js` |
| D8-2 | Import **auto-created** unknown faculties / zones, and matched them with `ilike` (a `%` cell matched any faculty). | Fixed locally (not deployed) | Edge Function: exact normalized match against existing rows; unknown or ambiguous → rejected | `tests/import-validation.test.js` |
| D8-3 | Import was row-by-row with partial writes; invalid rows were silently skipped; explicit logins already taken were silently renamed. | Fixed locally (not deployed) | Edge Function: whole-batch content validation, then whole-batch database conflict check, before any write; errors give line + column, never values | `tests/import-validation.test.js`, `tests/edge-functions-static.test.js` |
| A-1 | **ADMIN (and, in production today, TREASURER) can read CIN, address, date of birth and notes** — through the table, `select *`, filters such as `cin = …` (an existence oracle) and the `v_member_cards` view. | Fixed locally (migration `20261015140000`, not applied) | Database column privileges: protected columns are not selectable by any API role; served only by `get_member_private_fields()` to SUPERADMIN or the member themself | Role matrix (ADMIN / TREASURER / MEMBER negative tests, SUPERADMIN positive tests); `tests/role-access.test.js` |
| D4-1 | `complete_password_change()` cleared the first-login flag without checking that the password changed — a user could skip the forced change. | Fixed locally (migration `20261015140000`) | RPC compares a digest snapshot of the Auth password hash taken when the flag was set (trigger on `profiles`); backfilled for already-flagged accounts | Role matrix: deny before change (member + pre-existing account), allow after |
| D4-2 | `remove_match_participation()` let a member delete a seat after kick-off. | Fixed locally (migration `20261015140000`) | RPC applies the same "match still open" rule as seat selection | Role matrix |
| D4-3 | Production lets members insert seats directly (policy using `can_select_match_zone`, no row lock): capacity can be exceeded under concurrency. | Fixed locally (migration `20261015120000`, reviewed earlier) | Direct insert removed; `set_match_participation()` locks the zone row | Role matrix |
| B-1 | **Deactivated staff keep database access**: role helpers (`private.is_admin()` etc.) check `user_roles` only, not `profiles.is_active`. Deactivation is enforced by the UI and Edge Functions, but a still-valid session can call the API directly. | **Open** — proposal below | — | — |
| B-2 | The new-member form pre-filled a real-looking login, and a code comment repeated it. | Fixed locally | Replaced by the synthetic placeholder `FOULENFOULENI` | Review |
| B-3 | Deprecated `SUPABASE_DASHBOARD_FUNCTIONS/` copies (CIN password, auto-created references, non-existent `profiles.role`) could be pasted into the dashboard. No code depended on them. | Removed locally (kept in Git history) | — | `tests/edge-functions-static.test.js` |
| B-4 | The SQL test runners targeted the linked production project by default. | Fixed locally | Runners default to the local container; `--linked` must be explicit | Review |

## Database changes prepared (not applied)

1. `supabase/migrations/20261015120000_role_permissions_repair.sql` — reviewed
   earlier, unchanged in Phase B.
2. `supabase/migrations/20261015140000_member_identity_and_password_hardening.sql` — new:
   - column-level `SELECT` on `subscribers` without `cin`, `adresse`,
     `date_naissance`, `notes`; `v_member_cards` no longer granted (unused by the app);
   - `get_member_private_fields(uuid)` (SUPERADMIN any member; anyone else own row only);
   - `private.password_change_marks` + trigger + verified `complete_password_change()`;
   - kick-off check in `remove_match_participation()`.
   - Non-destructive: no drops of existing objects, no updates or deletes of existing
     application rows. Adds one private table; the migration fails if `subscribers`
     columns differ from the reviewed schema.

Rollback scripts: `supabase/rollback/<migration>_rollback.sql` (apply in reverse order).

## Tests run (exact commands, local)

| Command | Result |
|---|---|
| `npm test` | 76 tests, 76 pass, 0 fail, 0 todo |
| `npm run check:js` | OK (all `js/*.js` parse) |
| `node --check` on `scripts/*.mjs`, `scripts/lib/*.mjs`, `import-utils.mjs` | OK |
| `npm run test:rls` (local container, both migrations) | 157 checks, 0 failed — every denial verified to fail for the intended reason (permission denied, RLS filter or explicit RPC refusal) |
| `npm run test:rollback` (local container) | `20261015120000`: 133 objects, no data change, all restored. `20261015140000`: 139 objects (now incl. column ACLs and private tables), no data change, all restored. Mutation check: a deliberately broken rollback was detected. |
| Apply-script verification block, rendered and run locally (rolled back) | Passed |

### Not run / not covered

- **Edge Functions were not executed**: Deno is not installed, so there is no
  `deno check` / runtime test. Coverage is static invariants plus Node tests of the
  shared logic. They must be exercised in staging before deployment.
- No production or staging database run in Phase B (by instruction).
- Browser / UI flows were not exercised in a browser.
- No build: the project is a static site without a build step.
- The Auth and Storage services were stubbed locally, so GoTrue password policy,
  signed URLs and bucket MIME limits were not exercised.
- Production zone names were not inspected (schema-only backup); the template uses
  `ZONE A/B/C`, which must match real zones or the import will refuse the file.

## Residual risks

- **D1 personal data remains in Git history** (local and private GitHub) until the
  Phase E rewrite.
- **Production still runs the old Edge Functions** (CIN as password, auto-created
  references) and the old policies (staff can read CIN) until deployment.
- Changing a password does not require the current password. Supabase's "secure
  password change" (reauthentication) setting is not verified.
- The server-side Auth password policy (length, character classes) and leaked-password
  protection are not verified; the 12-character rule is enforced only by the UI and
  the reset function.
- Phone and email remain visible to ADMIN (role-model decision).
- Temporary passwords are known to the issuing SUPERADMIN until the member changes
  them. That change is now enforced server-side.
- Imported accounts need individual activation (no bulk credential distribution).
- Import writes cannot be one transaction across Auth and the database; individual
  write failures are reported per line.
- Edge Function rate limits rely on `audit_logs` row counts.

## Proposed for approval (not done)

Each item touches staging or production, or changes a security-sensitive default.

1. **Staging validation (Phase D)**: apply both migrations and deploy the three
   changed Edge Functions to an isolated environment. Run the role matrix plus a
   manual browser pass for each role and an import / activation / first-login cycle.
2. **Production migrations**: `scripts/apply-migration.mjs --confirm-production`
   (one verified transaction for both, role matrix, then history repair).
3. **Edge Function deployment**: `admin-import-users`, `admin-create-user`,
   `admin-reset-password` (the other four are unchanged), together with the frontend.
   The migrations and the frontend must ship together, because the old frontend's
   `select("*")` on `subscribers` is refused once `20261015140000` is applied.
4. **B-1 fix**: make the role helpers require an active profile, and/or ban the Auth
   user on deactivation (`auth.admin.updateUserById(id, { ban_duration })`).
5. **Auth settings** (dashboard, no SQL): minimum length 12 with character
   requirements; "secure password change" (reauthentication); leaked-password
   protection if the plan includes it (no paid upgrade without approval).
6. **Role-model decisions**: whether ADMIN should also lose phone / email; how
   activation passwords are distributed for bulk imports.
7. Stale SQL scripts in `supabase/*.sql` (describing `events.name` /
   `event_payments.paid`) could be moved to `supabase/obsolete_migrations/`.
