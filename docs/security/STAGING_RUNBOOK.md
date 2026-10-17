# Staging runbook — UE Clubiste (Phase C)

> **Superseded (2026-10-17).** For the production release use `DEPLOYMENT_PLAN.md` §4. For
> test databases use `LOCAL_TEST_DATABASE.md`; restores now need `supabase/tests/replica_alignment.sql`.
> The migration and rollback lists below date from Phase C (3 migrations); there are now 5.

Status: hosted staging **not executed** (no staging project exists). Phase D ran the
full validation on the **local staging stack** (`staging-local/`, see
`PHASE_D_REPORT.md` and `DEPLOYMENT_PLAN.md`), which supersedes Option B below.
A fourth migration, `20261015180000_admin_least_privilege`, now follows 160000.
Include it wherever this runbook lists the pending migrations.

Original status: **not executed.** No staging project exists. Production is
`qwlbbfyhjdeekmrxtzjf` (login.uec) and must not be used for any step below. The
second project in the organization (`astsvxyqyyzqvuioqsnq`, "uec") is **not**
staging and must not be used either.

## 0. What is missing before staging can start

| Prerequisite | Status | Notes |
|---|---|---|
| A staging Supabase project, separate from production | **Missing** | Creating a project may count against the plan's project limit. Do not create, pause or delete any project, or upgrade, without approval. |
| Option B: local full stack | **Done in Phase D** without `supabase start` (only `127.0.0.1:54321` published, fresh keys) | Would also allow the first **real** Edge Function integration test. Docker publishes ports on all interfaces, and the Windows firewall is currently **off** on a Public network. Fix the firewall (approval) or bind ports to localhost first. |
| Staging site URL for the frontend (static hosting) | Missing | Needed for activation links (`PUBLIC_SITE_URL`) and the Auth redirect allow-list. |
| Synthetic test accounts (one per role, plus deactivated / flagged ones) | To create **in staging only** | Never copy production members or Auth users. |
| Production schema snapshot | Available | `uec-backups/2026-10-15/schema.sql` (restricted folder, schema only). |

## 1. Migration dependency map

```
20261001194746_security_hardening_v1      (applied in production)
20261001194845_hardening_v2_core          (applied in production)
        │  private.is_* helpers, profiles / subscribers / payments tables
        ▼
20261015120000_role_permissions_repair     clubs; SUPERADMIN-only writes; payment / seat /
        │                                  password RPCs; protect_* triggers; private photo bucket
        ▼
20261015140000_member_identity_…           column privileges (CIN, adresse, date_naissance, notes);
        │                                  get_member_private_fields; verified password change;
        │                                  password_change_marks; seat removal before kick-off
        ▼
20261015160000_active_accounts_…           account_active / account_ok in every role helper,
                                           self policy, RPC and storage path; phone / email /
                                           audit IP / payment notes withheld; get_account_contacts;
                                           expiring temporary passwords
```

Each migration has a rollback in `supabase/rollback/`, applied in **reverse**
order. `npm run test:rollback` proves locally that each rollback restores the
exact previous catalog state and that no migration changes data.

Edge Functions and frontend depend on them:

| Component | Needs | Breaks if deployed without it |
|---|---|---|
| New frontend | 120000 RPCs; `get_member_private_fields` with phone / email (160000); `get_account_contacts` (160000) | Payment, member, profile and staff pages error. |
| New Edge Functions (all 8, because `security.ts` changed) | Works on any schema; correct behaviour needs 140000 (marks) and 160000 (account state) | Imports and activations work, but first-login verification is weaker (pre-140000). |
| `PUBLIC_SITE_URL` secret + Auth redirect allow-list | — | Activation by link returns `link_unavailable`; the temporary-password fallback still works. |

### Why the current production frontend stops working

The deployed frontend (believed to be `01ff97f`; the hosting has not been inspected):

- **After 140000**: `select("*")` on `subscribers` (member page, members list) is
  refused because CIN and the other protected columns are no longer selectable.
- **After 160000**: `common.js` reads `profiles.email` on **every page load**.
  That column is withheld, so the profile query fails, every user is treated as
  signed out, and **no one can use the site**.
- **After 120000**: ADMIN / TREASURER direct writes (old payment code using
  `paid`, upserts) are refused. The old payment code already fails on the live
  schema today.

The new frontend calls RPCs that do not exist before the migrations, so the
migrations and the frontend must ship **together, in one maintenance window**.

## 2. Deployment order (staging first; production later, only with approval)

1. **Verify the target** (§3) and record it.
2. Pre-checks, counts only:
   ```sql
   select count(*) filter (where must_change_password) as flagged,
          count(*) filter (where not is_active)         as inactive
   from public.profiles;
   ```
   After 160000, **flagged accounts can do nothing except change their password**.
   Make sure at least one SUPERADMIN is active and **not** flagged.
3. Download the currently deployed function versions (rollback source):
   `npx supabase functions download <name> --project-ref <REF> --use-api`.
4. Maintenance page on.
5. Apply the three migrations in one verified transaction. For production this is
   `node scripts/apply-migration.mjs --confirm-production`; for staging, use the
   same files with the staging ref (§4).
6. Secrets and Auth settings: `PUBLIC_SITE_URL`, redirect allow-list, OTP expiry (§5).
7. Deploy all 8 functions from `supabase/functions/`.
8. Deploy the frontend from the reviewed commit.
9. Smoke tests (§6, short list), then maintenance page off.

Rollback: previous frontend → previous functions (downloaded in step 3) →
rollbacks 160000, 140000, 120000 in that order, each in one transaction.

## 3. Verify the project before **every** operation

```sh
STAGING_REF=<staging ref>                     # never qwlbbfyhjdeekmrxtzjf / astsvxyqyyzqvuioqsnq
test "$STAGING_REF" != qwlbbfyhjdeekmrxtzjf && test "$STAGING_REF" != astsvxyqyyzqvuioqsnq || exit 1
npx supabase projects list                     # confirm name + ref
cat supabase/.temp/project-ref                 # the linked ref must equal $STAGING_REF
grep -c qwlbbfyhjdeekmrxtzjf js/config.js      # the staging frontend build must point at staging
```

Pass `--project-ref "$STAGING_REF"` explicitly to every CLI command, even when linked.

## 4. Apply reviewed migrations to staging only

```sh
npx supabase link --project-ref "$STAGING_REF"
# Start from the production schema (no data), then the pending migrations:
npx supabase db query --linked --project-ref "$STAGING_REF" -f <restricted>/schema.sql
npx supabase db query --linked --project-ref "$STAGING_REF" -f <restricted>/platform_objects.v2.sql   # auth.users trigger + storage policies
# Buckets (empty): subscriber-photos (public, 5 MB, images), match-logos (public), as in production.
for m in 20261015120000_role_permissions_repair 20261015140000_member_identity_and_password_hardening 20261015160000_active_accounts_and_data_minimization 20261015180000_admin_least_privilege; do
  npx supabase db query --linked --project-ref "$STAGING_REF" -f supabase/migrations/$m.sql || break
done
node scripts/run-rls-tests.mjs --no-migration --linked        # role matrix against staging, rolled back
```

`scripts/apply-migration.mjs` is pinned to the production ref on purpose. Do not
edit it for staging.

## 5. Staging functions and Auth settings

```sh
npx supabase secrets set PUBLIC_SITE_URL=https://<staging-site> --project-ref "$STAGING_REF"
for f in admin-create-user admin-import-users admin-activate-member admin-reset-password \
         admin-create-admin admin-update-admin admin-delete-admin admin-delete-user; do
  npx supabase functions deploy "$f" --project-ref "$STAGING_REF"
done
```

Dashboard (staging), see `AUTH_SETTINGS_REVIEW.md`: Site URL; redirect allow-list
containing `https://<staging-site>/change-password.html`; email OTP / link expiry;
minimum password length 12 with character requirements; secure password change.

## 6. Test plan (record every result in §7)

Accounts (synthetic): SUPERADMIN, ADMIN, TREASURER, MEMBER, a member never
activated, a deactivated ADMIN, a deactivated MEMBER, an account with a pending
password change, and anonymous.

| # | Area | Steps | Expected |
|---|---|---|---|
| 1 | Login / routing | Each role logs in | Lands on its home page; no loop |
| 2 | Deactivation | SUPERADMIN deactivates ADMIN **while ADMIN's session is open**; ADMIN reloads, then calls the REST API with the old token | UI signs out; REST calls return no rows or `permission denied` (not data) |
| 3 | Role removal | Remove the ADMIN role while signed in; call the REST API | Denied immediately |
| 4 | Import | Template CSV, then a CSV with an unknown faculty, a duplicate CIN or an existing login | Records created "Non activé"; bad files refused with line + column, nothing written |
| 5 | Activation (link) | Activate one member; open the link in a private window | Lands on `change-password.html` signed in; must set a password; then member home |
| 6 | Expired / reused link | Open the same link again; open a link after the OTP expiry | "Ce lien a expiré…"; no session |
| 7 | Fallback | Unset `PUBLIC_SITE_URL`, activate | `link_unavailable`, then the confirmed temporary password works; first login forces a change |
| 8 | First login | Try any data page before changing the password | Redirected; REST API returns nothing |
| 9 | Password change | Call `complete_password_change` without changing the password | Refused |
| 10 | Payments | TREASURER toggles card / cotisation for another member, then for themself | Others: OK and audited; self: refused |
| 11 | Events | TREASURER / ADMIN try to create, edit or delete events | Refused |
| 12 | Seats | Member chooses, changes and removes a seat; the same after kick-off; a full zone | Before kick-off OK; otherwise refused |
| 13 | Storage | Member uploads own photo / another member's folder; ADMIN uploads | Own OK; others refused |
| 14 | Direct API: restricted fields | With ADMIN / TREASURER / MEMBER tokens: `GET /rest/v1/subscribers?select=cin`, `select=phone`, `select=*`, `?cin=eq.00000001`, `GET /rest/v1/profiles?select=email`, `GET /rest/v1/audit_logs?select=ip_address`, `GET /rest/v1/v_member_cards` | All refused (`permission denied`), no values in the error |
| 15 | Direct API: RPCs | ADMIN / TREASURER: `get_member_private_fields` with another member's id; `get_account_contacts` with another user's id | `Not authorized` |
| 16 | Anonymous | Anon key only: any table or RPC | Refused |
| 17 | Edge Functions | Call each with ADMIN, TREASURER, a deactivated SUPERADMIN and a flagged SUPERADMIN | 403 |
| 18 | Audit | Inspect `audit_logs` after 4–10 | Codes and counts only; no CIN, contact data, link or password |

Use `curl` with each user's access token. Never paste tokens into tickets or
reports: record only status codes and whether a value was returned.

## 7. Results record (template)

| # | Date / tester | Target ref verified | Result | Evidence (status codes / counts only) |
|---|---|---|---|---|
| 1 | | ☐ | ☐ pass ☐ fail | |

Rollback readiness checklist: ☐ previous function versions downloaded ☐ rollback
scripts reviewed ☐ `npm run test:rollback` green on the release commit ☐ previous
frontend build available ☐ at least one unflagged, active SUPERADMIN confirmed.
