# Completion audit — 2026-10-17 (afternoon)

Independent re-verification of the 2026-10-17 release, a new security review (database,
Edge Functions, frontend), fixes, and the remaining owner steps.

Labels: **VERIFIED** (checked today by a command whose output is quoted or summarized here),
**FAILED**, **BLOCKED** (missing access), **NOT TESTED**, **PENDING APPROVAL** (ready, not applied).
Nothing in this pass was written to production. No personal data was read or printed.

## 1. Production status (read-only checks, 2026-10-17)

| Item | Result | Label |
|---|---|---|
| Supabase target | linked ref `qwlbbfyhjdeekmrxtzjf`; Postgres 17.11 | VERIFIED |
| Migration history | 7 versions remote = local (`20261001194746` … `20261016120000`) | VERIFIED |
| Edge Functions | 8 ACTIVE, `verify_jwt=true` (7 at v3, `admin-activate-member` v1); `check:functions --with-cli` all passed (CORS from 3 origins, unknown origin refused, POST without JWT → 401 at the gateway) | VERIFIED |
| Function secrets | names only: `PUBLIC_SITE_URL` + platform keys (values not read) | VERIFIED |
| Vercel production | `dpl_8Jo3ktSarnBQQ8TjjiCnnwkFgm67` = commit `fa726d9` on `main`, READY, aliased to `login.ueclubistes.tn`, `www.login.ueclubistes.tn`, `uec-five.vercel.app` | VERIFIED |
| Security headers | CSP, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy, HSTS 2 y | VERIFIED |
| Public exposure | `npm run check:public` all passed (CSV 403, internal files 404, pages 200) | VERIFIED |
| Anonymous REST | 401 on 12 tables/views and the API root; both buckets list `[]` to anon | VERIFIED |
| Auth settings (`/auth/v1/settings`) | **`disable_signup: true`** (self-signup now OFF; the earlier reports still said ON); only the email provider; anonymous sign-in off | VERIFIED |
| Accounts | 2 Auth users; 2 SUPERADMIN usable (active, not flagged); 0 flagged; 0 photos; 0 logos | VERIFIED (counts only) |
| Password policy, redirect allow-list, OTP expiry, MFA settings | not exposed by any read-only API available here | NOT TESTED (owner, Dashboard) |
| SUPERADMIN login in production | needs the owner's credentials | NOT TESTED — see `STAFF_LOGIN_VERIFICATION.md` |
| Supabase / Vercel connectors in Claude | signed in to other accounts (Supabase: permission denied; Vercel: deployment "not found") | BLOCKED; the logged-in CLIs were used instead |

## 2. Confirmed findings and fixes

Severity is for this deployment (2 staff accounts, no members yet). "Fixed locally" means
implemented and tested on this branch, not deployed.

| # | Sev. | Finding (evidence) | Fix | Deploy via |
|---|---|---|---|---|
| F1 | Medium | **Stored XSS** — `js/reference.js` put the faculty/zone name inside `onclick="editRef('…','…')"`. HTML escaping does not protect JS inside an attribute (the browser decodes `&#039;` first) and the CSP allows inline script. Proven in headless Edge: with production's file a hostile name ran script on "Modifier". Only SUPERADMIN can write names. | `data-*` attributes + delegated listener; browser e2e regression (fails on the old file, passes on the new one) | Frontend |
| F2 | Medium | **A password reset did not end existing sessions.** Whoever held a session could still call `PUT /auth/v1/user` and then `complete_password_change()`, taking the account back. | New `public.admin_revoke_user_sessions(uuid)` (service_role only) called after every reset and every staff deactivation. Proven on GoTrue v2.197.0 (production version): old refresh token refused, old session gets 403 on password change | Migration + Functions |
| F3 | Low | One SUPERADMIN could reset (and so take over) or delete the other SUPERADMIN, although deactivating one was already refused | `protected_account` (403) on reset and delete of another SUPERADMIN; the owner does it in the Dashboard | Functions |
| F4 | Low | Catch-all handlers returned raw exception / Postgres / Auth error text; malformed JSON gave 500 with parser text; rate limit answered 500 | `errorResponse` (fixed message, details to function logs), `readJson` (400 `invalid_body`), `HttpError` 429 / 503; static test forbids raw messages | Functions |
| F5 | Low | `admin-delete-user`, `admin-delete-admin`, `admin-update-admin` had no rate limit | Rate-limited (100 / 10 / 60 per hour) | Functions |
| F6 | Low | `replaceRoles` deleted all roles before inserting; a failed insert left the account with none | Upsert new roles, then delete only the removed ones | Functions |
| F7 | Low | `admin-create-user` had no length / format limits; audit rows stored unchecked `method` / `subscriber_id` | Import limits reused; email, photo path (`<LOGIN>/<file>`) and UUID checks | Functions |
| F8 | Low | Any user could rewrite title/message/type of their own notifications (ADMIN included) | `UPDATE (is_read)` only | Migration |
| F9 | Low | `authenticated` held ALL on `audit_logs_id_seq` (+ default privileges); a `setval` broke audit inserts. No API path found | Revoked (identity column; inserts are SECURITY DEFINER) | Migration |
| F10 | Low | Member photo path check was prefix-only (`RLSMEMBER/../RLSOTHER/x.jpg` accepted) | `^<LOGIN>/[A-Za-z0-9_-][A-Za-z0-9._-]{0,120}$`, no `..` | Migration |
| F11 | Low | `private.can_select_match_zone` skipped `account_ok()` (seat RPCs already checked it) | Added | Migration |
| F12 | Low | Public `match-logos` bucket accepted SVG (0 objects today) | JPEG/PNG/WebP only | Migration |
| F13 | Low | Toasts/dialogs rendered messages as HTML (SweetAlert `title`) | `titleText` everywhere | Frontend |
| F14 | Low | Dashboard, matches, admin matches and member home stayed on "Chargement…" after a load error | Error states | Frontend |
| F15 | Low | Member create / delete / activate calls: network errors unhandled; create could be submitted twice | `callAdminFunction` catches network errors; one save at a time | Frontend |
| F16 | Low | No reaction to sign-out in another tab / failed refresh; login button dead if supabase-js failed to load | `onAuthStateChange(SIGNED_OUT)` → login; login page error message; guarded session check | Frontend |
| F17 | Low | Member match page offered "Choisir une place" after kick-off (server refused) | "Match commencé" instead | Frontend |
| F18 | Info | `_shared/security.ts` and `roles.ts` canonical copies had drifted (formatting) from the deployed per-function copies, and the test only compared copies with each other | Synced; the test now requires all 4 shared files byte-identical to canonical | Functions |
| F19 | Info | `CORS` sent `Vary: Origin` only for allowed origins | Always sent | Functions |
| F20 | Low | The staff page (`js/admin-users.js`) loaded every account and then asked for roles with **all** ids in one `in.(…)` URL. It grows by ~37 bytes per account; on the local stack at 103 accounts the gateway answered 502 ("upstream sent too big header") and the page showed nothing. In production it would fail once enough members are activated | Roles fetched in batches of 50 ids (~2 KB per request); behaviour unchanged. The browser suite's staff-page checks (502 before, pass after) cover it | Frontend |

An independent review of the whole diff found no significant bug or safety regression and
7 low/nit items, all fixed: logo upload UI still offered SVG; the "reload before retrying"
network message was rewritten by `userFacingError`; the sign-out redirect could hide the
expired-link message on `change-password.html`; "match started" used the browser's time zone
instead of Tunis (UTC+1); a 401 showed the permission message instead of "session expired";
an unused helper; the default-privilege test ignored database-wide defaults.

Checked and correct (no change): role boundaries for all four roles in the database
(ADMIN read-only, TREASURER payments only with no identity/contact data, MEMBER own data +
seat RPCs, no self-promotion), SECURITY DEFINER functions with fixed `search_path`, no
`user_metadata` in policies, anon has no table grants or function EXECUTE, `requireSuperAdmin`
uses `auth.getUser` + `user_roles` + account state, recovery links use only `PUBLIC_SITE_URL`,
temporary passwords ~120 bits, CSV import all-or-nothing with 500-row cap, route guards fail
closed, logout clears the session, no secrets in tracked files or Git history (pattern scan;
matches were `$VAR` references and a placeholder), `npm audit` 0 vulnerabilities.

### Not fixed (documented)

| Item | Why |
|---|---|
| **No Arabic / RTL or English UI** | The site is French-only (`lang="fr"`, no `dir`, no language switch). Not a regression: it never existed. Adding it is a feature project (string catalog, RTL CSS, switcher) |
| **No MFA** | No enrollment/challenge screens and no `aal2` requirement in RLS. Turning MFA on in the Dashboard alone changes nothing. Separate change |
| CSP keeps `'unsafe-inline'` | ~20 generated `onclick=` handlers remain (escaped ids only). Removing them all would allow a strict CSP |
| Localhost origins in the Edge CORS list | Needed by the local stack; low impact (Bearer auth, no cookies) |
| `match_logos_public_read` lets anon list the (empty, public) bucket | Changing storage policies can only be fully tested on hosted Storage; low impact |
| Reference data readable by an active account with no role | Only matches / settings (non-sensitive) |
| Seat choice does not check `card_paid` | Business decision |
| Lists load whole tables in one request (members, accounts, payments) | Hosted Supabase returns at most 1000 rows per request by default, so past ~1000 members those lists would be silently cut. Production has 2 members today; add paging before the member import grows past that |
| No `deno.lock` for the functions | Direct imports are pinned (`supabase-js@2.117.2`); transitive versions are not |

## 3. Tests run in this pass (all by me, 2026-10-17)

| Command | Result |
|---|---|
| `npm test` | **127 / 127** (122 before; +5 new) |
| `npm run check:js` | passed |
| `npm audit` | 0 vulnerabilities |
| `npm run test:rls` (pre-release replica, replays 6 migrations) | **280 checks, 0 failed** (267 before; +13 new) |
| Negative control: same matrix without the new migration | 280 checks, **8 failed** — exactly the new assertions |
| `npm run test:rollback` | **6 / 6** exact, no data changed |
| `node staging-local/tests/api-e2e.mjs` (local full stack, GoTrue v2.197.0) | baseline 145/0; with the changes **162 / 0** |
| `node staging-local/tests/browser-e2e.mjs` (headless Edge, exact Vercel artifact + headers) | baseline 67/0; with the changes **71 / 0** |
| Negative control: browser suite with production's `js/reference.js` | 71 checks, **3 failed** (script executed) |
| `UE_TEST_DB_CONTAINER=ue-replica-postrelease node scripts/apply-migration.mjs --dry-run` | **passed**: production history and catalog read-only; replica = production in **13/13** categories; exact transaction rehearsed (COMMIT→ROLLBACK); role matrix 280/0; rollback 1/1 exact; replica unchanged; sha256 `d4c923e5ffab2dc72d26415ec0d8abc616f93b943931c296bed0b5810d4ac36f` |
| `npm run check:public`, `npm run check:functions -- --with-cli` (production, credential-free) | all passed |

Not run: Deno type-check (Deno not installed; the functions ran in the Edge runtime in the
e2e suites), hosted Kong/Storage behaviour, anything needing a production login.

## 4. Changes (branch `audit/2026-10-17-completion`, from `fa726d9`)

- Edge Functions: all 8 `index.ts`; `_shared/security.ts`, `roles.ts`, `member-lifecycle.mjs`
  (canonical + 8 per-function copies).
- Migration `supabase/migrations/20261017120000_session_revocation_and_grant_tightening.sql`
  and `supabase/rollback/…_rollback.sql`.
- Frontend: `js/reference.js`, `common.js`, `auth.js`, `subscribers.js`, `subscriber.js`,
  `matchs.js`, `admin-matchs.js`, `admin.js`.
- Tooling: `scripts/lib/pending-migrations.mjs` (RELEASED vs PENDING; replay detection),
  `scripts/lib/sql-target.mjs`, `run-rls-tests.mjs`, `run-rollback-check.mjs`,
  `apply-migration.mjs` (remote = 7 versions; post-release replica; new assertions; outcome
  probe on the new function), `staging-local/stack.sh`.
- Tests: `tests/edge-functions-static.test.js`, `tests/member-lifecycle.test.js`,
  `supabase/tests/rls_role_matrix.sql`, `staging-local/tests/api-e2e.mjs`, `browser-e2e.mjs`.
- Docs: this file, `STAFF_LOGIN_VERIFICATION.md`, `LOCAL_TEST_DATABASE.md` (post-release replica).

## 5. Release plan (each step needs its own approval)

Order: **migration → functions → frontend**. Each part works without the others
(functions report `sessions_revoked: false` if the migration is missing; the migration adds
an unused function and tightens grants the current frontend does not use).

1. **Preview** — done 2026-10-17 (push approved by the owner): branch pushed at `a1e5199`;
   Vercel preview `dpl_5t3ScB8NFWC7u1Qi8xsqFjY9riTR`
   (`uec-akeh891dg-rayenmkadminins-projects.vercel.app`) READY; build log: clone of
   `audit/2026-10-17-completion` @ `a1e5199`, `build-public: 29 files published`. Production
   aliases unchanged (all three on `dpl_8Jo3…` / `fa726d9`). The preview is behind Vercel
   Authentication (anonymous → 302 to the Vercel login), so it was **not** exercised in a
   browser here; the identical build output was exercised on the local stack (browser e2e 71/0).
   The preview uses the production Supabase project (same `js/config.js`): test it with a
   SUPERADMIN account only, read-only, and expect Edge Function calls to fail CORS from the
   preview origin (only the 3 production origins are allowed) — that is by design.
2. **Migration** (one transaction, approved by hash):
   ```sh
   UE_TEST_DB_CONTAINER=ue-replica-postrelease node scripts/apply-migration.mjs --dry-run
   UE_TEST_DB_CONTAINER=ue-replica-postrelease node scripts/apply-migration.mjs --confirm-production --expect-sha256=<hash printed by the dry run>
   ```
   Last dry run (2026-10-17, exit 0): sha256 `d4c923e5ffab2dc72d26415ec0d8abc616f93b943931c296bed0b5810d4ac36f`.
   The hash covers the exact file bytes in this working tree; `core.autocrlf=true`, so a fresh
   checkout (CRLF) produces a different hash. Always re-run the dry run in the checkout you apply
   from, immediately before applying. The replica `ue-replica-postrelease` must still match
   production in all 13 categories (the runner refuses otherwise).
3. **Functions** (no `--no-verify-jwt`, no `--prune`), then `npm run check:functions -- --with-cli`:
   ```sh
   npx supabase functions deploy admin-activate-member admin-create-admin admin-create-user admin-delete-admin admin-delete-user admin-import-users admin-reset-password admin-update-admin --use-api
   ```
   Check first that the CLI is linked to `qwlbbfyhjdeekmrxtzjf` (`cat supabase/.temp/project-ref`)
   and deploy from a clean checkout of the reviewed commit (the per-function `_shared` copies are
   what gets bundled).
4. **Frontend**: fast-forward `main` to the reviewed commit, no force:
   ```sh
   git push origin <reviewed-commit>:main
   ```
   Vercel then builds and promotes production. Afterwards: `npm run check:public`, the response
   headers, and `STAFF_LOGIN_VERIFICATION.md` §1–4.

### Compatibility (any order is safe)

| Deployed | Not yet deployed | Behaviour | Evidence |
|---|---|---|---|
| New functions | Migration | Resets work; response `sessions_revoked: false`, error logged | Local stack, RPC renamed away: reset 200, temporary password returned, `sessions_revoked=false` |
| Migration | New functions | Old functions never call the RPC; grants they use are unchanged (service role) | Rehearsal on the post-release replica; role matrix 280/0 |
| Migration | New frontend | Old frontend: photo paths it builds (`<LOGIN>/<uuid>.<ext>`) still pass; an SVG logo upload is refused by the bucket with a raw error (SUPERADMIN only; 0 logos today) | Code review; matrix "photo path: generated name" allow |
| New frontend | Migration / functions | Frontend uses no new server field | `grep sessions_revoked\|protected_account js/` → none |

### Needs the owner (Dashboard or credentials)

- Preview test in a browser logged in to Vercel (or approve a temporary
  "Protection Bypass for Automation" secret, to revoke afterwards).
- SUPERADMIN login and the checks in `STAFF_LOGIN_VERIFICATION.md` (password policy, redirect
  allow-list, OTP expiry, MFA settings are only visible in the Dashboard).
- `gh` CLI is not logged in (`gh auth login` if PRs should be opened from here); Git pushes
  use Git Credential Manager as `rayenmkadmini`.

### Rollback

- Frontend: Vercel → promote `dpl_8Jo3ktSarnBQQ8TjjiCnnwkFgm67` (`fa726d9`), or revert on `main`.
- Functions: redeploy from `fa726d9` (`git worktree add ../uec-fa726d9 fa726d9`, deploy the 8
  functions from there with the same command).
- Migration: run `supabase/rollback/20261017120000_session_revocation_and_grant_tightening_rollback.sql`
  in one transaction (functions first), then
  `npx supabase migration repair --status reverted 20261017120000`. Exactness verified by
  `npm run test:rollback`. It re-opens F8–F12. No data is changed either way.
