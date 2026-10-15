# UE Clubiste — Phase D report (staging validation and deployment readiness)

Date: 2026-10-15 · Branch: `backup/pre-production-audit-2026-10-15` · Production: `qwlbbfyhjdeekmrxtzjf` (untouched)

Contains no member data, credentials, tokens or links.

## 1. Environment: was a local full stack feasible?

**Yes, but not with `supabase start`.** The machine is on a *Public* network with
every Windows Firewall profile off (read-only check, unchanged). `supabase start`
publishes about ten ports on all interfaces and uses the well-known demo keys, which
would expose an API with public keys to the local network. Instead, `staging-local/`
runs the same official images as the CLI:

- private Docker network; **only the gateway is published, on `127.0.0.1:54321`**
  (verified with `netstat`: no other listener);
- **fresh random JWT secret and keys**, git-ignored, never printed;
- production **schema only** (no data), plus synthetic users, members and payments
  created through the real APIs;
- no Supabase project contacted; no `--linked`; production secrets never used;
- `stack.sh up` / `down` recreate or remove everything (images kept).

Services that actually ran: Postgres 17.11.0.002 · **GoTrue v2.197.0** (production
version) · PostgREST v16.3 · Storage v1.77.0 · **Edge runtime v1.76.2** (Deno inside the
container; nothing installed on the host) · nginx gateway. Browser: the installed
Microsoft Edge in headless mode, driven over the DevTools protocol with Node's
built-in WebSocket (nothing installed).

Downloads: five official container images (removable with `docker rmi`). No system
packages, no firewall or network-profile changes, no Supabase project, no cost.

## 2. What was tested (real services)

| Suite | Command | Result |
|---|---|---|
| Node unit / static | `npm test` | 102 pass, 0 fail |
| JS syntax | `npm run check:js` (+ `node --check` on scripts / modules) | OK |
| SQL role matrix (schema-only container, 4 migrations) | `npm run test:rls` | **261 checks, 0 failed** |
| Rollback fingerprints | `npm run test:rollback` | 120000: 133 · 140000: 139 · 160000: 164 · 180000: 203 objects, no data change, all restored |
| Apply-script verification (local, rolled back) | scratch harness | passed |
| **API end-to-end, real Auth / REST / Storage / Edge runtime** | `node staging-local/tests/api-e2e.mjs` | **145 checks, 0 failed** |
| **Browser end-to-end (headless Edge)** | `node staging-local/tests/browser-e2e.mjs` | **49 checks, 0 failed** |

All **8 Edge Functions were executed** in the Edge runtime against the local stack:
`admin-import-users`, `admin-activate-member`, `admin-create-user`,
`admin-reset-password`, `admin-delete-user`, `admin-create-admin`,
`admin-update-admin`, `admin-delete-admin`. Covered: authorization (anonymous,
anon key, forged JWT, ADMIN, TREASURER, deactivated SUPERADMIN, SUPERADMIN with a
pending password change), input validation, malformed JSON, wrong method, CORS,
error handling, activation, reset and deletion paths.

Account lifecycle exercised with real GoTrue: CSV import (valid, malformed, duplicate,
unknown faculty / zone, ambiguous identity) creating **no** login accounts; activation
link (redirect, allow-list, **single use, real expiry** after recreating Auth with a
5-second lifetime); temporary-password fallback; first login with weak / strong
passwords; flag cleared only after a real change; reset (success, unknown user,
weak password, non-SUPERADMIN); deactivation and reactivation with the **same live
token**; role removed mid-session; member deletion (activated, never activated,
staff account refused); payments, events, seats (capacity, past match, women /
virage rule), storage (own folder, other folder, ADMIN, private bucket, MIME limit);
self-promotion and metadata role spoofing.

**Not exercised:** real email delivery (the design does not send email: links are
handed over by a SUPERADMIN); hosted Kong gateway and platform `verify_jwt` (an
equivalent HS256 check runs in the local functions router); Storage v1.80.2;
the production Dashboard values.

## 3. Defects found and fixed in Phase D

| # | Defect | Found by | Fix |
|---|---|---|---|
| D-1 | **TREASURER and ADMIN members page crashed**: `apply()` read `.value` of a gender filter removed for those roles (present since Phase B for TREASURER) | code review, then browser test | null-safe read |
| D-2 | **Profile page showed another account's email for SUPERADMIN**: `get_account_contacts()` without an id returns all accounts (Phase C) | browser test | pass the own id; unit test |
| D-3 | **Expired / reused activation link not explained**: supabase-js consumes the URL fragment before page scripts run, and the error was shown only in a 4.5-second toast inside a hidden form | browser test | redirect snapshot in `config.js` before the client is created; persistent message outside the form |
| D-4 | ADMIN could see **member photos and gender** (below the least-privilege default requested) | requirement | migration `20261015180000` + UI changes (§4) |
| D-5 | API test assumptions (anon key → 401 not 403; last-active-ADMIN rule; `return=representation` without `select` is refused) | API test | tests corrected; behaviour confirmed correct and documented |

## 4. Verified role / field access

See `FIELD_ACCESS_MATRIX.md`. Summary of what the API and browser tests proved:

| | SUPERADMIN | ADMIN | TREASURER | MEMBER |
|---|---|---|---|---|
| CIN, address, birth date, phone, email | RPC | **refused** (column, `*`, filter, order, view, RPC) | refused | own (RPC) |
| Gender, photo path, photo files | RPC / read | **refused** | refused | own |
| Names, number, status, card, faculty, zone | ✔ | ✔ read-only | payment list only | own |
| Seat list | with gender | names + zones, no gender | refused | own seat |
| Staff email / phone | RPC | masked / refused | refused | own |
| Audit IP, payment notes | refused | refused | refused | refused |
| Writes | ✔ | **none** (events, members, roles, storage, functions refused) | card / cotisation status of others only | own phone / email / address / photo |
| Deactivated (live token) | nothing | nothing | nothing | nothing (own profile row only) |
| Pending password change | change password only | same | same | same |

## 5. Remaining gaps

- Production is unchanged: CIN-as-password functions, staff access to CIN and contacts,
  and deactivated staff keeping access all persist until the approved deployment.
- D1 personal data remains in Git history (Phase E, separate from this plan).
- A deactivated user can still obtain an Auth token (no ban). It grants nothing.
  An optional ban / unban is documented.
- The **Dashboard Auth values in production are unverified**. The settings were
  validated only on the same GoTrue version locally.
- A SUPERADMIN account cannot be deactivated through `admin-update-admin` (by
  design). A compromised SUPERADMIN must have its role removed by another
  SUPERADMIN, or be handled in the Dashboard.
- supabase-js is loaded from a CDN without a pinned version or integrity hash.
- The hosted gateway and Storage v1.80.2 were not exercised; a hosted staging project
  would close that gap but is optional (see §7).

## 6. Fresh-stack run (final)

Final verification on a freshly recreated stack (`stack.sh down && stack.sh up`, all four
migrations applied on the production schema), so that no state from earlier runs could
hide a failure:

- `stack.sh up`: all 6 services ready; migrations 120000, 140000, 160000 and 180000 applied
- `api-e2e.mjs`: **145 checks, 0 failed**
- `browser-e2e.mjs`: **49 checks, 0 failed**: SUPERADMIN, ADMIN and TREASURER pages with no
  JS error and no failed API call; ADMIN pages contain no CIN, contact data, photos or
  gender; activation link → password page → member home; reused link explained; first
  login forced; deactivated account refused
- Afterwards, only `127.0.0.1:54321` is listening (the site and browser ports close themselves)

## 7. Is a hosted staging project still needed?

Not strictly. The local stack exercised the same Auth version and every function,
policy and workflow. A hosted staging project (approval and plan limits apply) would
additionally validate the platform gateway / `verify_jwt`, Storage v1.80.2 and the exact
Dashboard settings before production. Recommended if the plan allows it at no cost.
Otherwise, do the production smoke test of `DEPLOYMENT_PLAN.md` §4 step 8 inside the
maintenance window.
