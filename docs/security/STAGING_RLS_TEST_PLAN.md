# UE Clubiste — Staging RLS and Security Test Plan

**Status: PLAN ONLY — NO STAGING OR PRODUCTION TEST ACCOUNTS/PROJECTS CREATED.**

## 1. Environment and safety boundary

- Production project: `astsvxyqyyzqvuioqsnq` (`uec`, `ggctokecqgbnvpsdyngb`).
- Production metadata was inspected read-only on 2026-10-01.
- Do not run `supabase db reset`, `supabase db push`, migrations, deployments, grants, or policy DDL against production.
- A separate Supabase project is required for true role/RLS integration tests. The project `wyyfmdyovaujdvxkyqhm` was visible in the account but **is not assumed to be staging**; get owner confirmation before using it. Do not create/delete projects or copy production data.
- The staging database must start empty and use synthetic identities/data only. Import a reviewed schema-only snapshot or apply a separately reviewed staging migration, not a production data dump.

## 2. Live catalog snapshot for schema-only staging

### Public tables and row counts

| Table | Rows | Notes |
|---|---:|---|
| `profiles` | 2 | role is legacy text; two SUPERADMIN rows |
| `subscribers` | 0 | `numero_abonnement` is `NOT NULL`, full UNIQUE; CIN not unique |
| `events` | 0 | `id` is bigint; includes AR/FR/EN content fields and legacy title/name fields |
| `event_payments` | 0 | `event_id` bigint, subscriber UUID; duplicate UNIQUE constraints on `(event_id, subscriber_id)` |
| `payments` | 0 | UUID PK, amount/status/payment method/owner fields |
| `matches` | 8 | UUID PK |
| `match_zones` | 40 | UUID PK |
| `match_participations` | 0 | unique `(match_id, subscriber_id)` |
| `faculties` | 210 | UUID PK |
| `zones` | 4 | UUID PK |
| `gouvernorats` | 24 | UUID PK, `zone_id` FK |
| `security_audit_logs` | 1 | no authenticated table grants intended |

`v_member_cards` is also present and exposes member identity/contact/number fields. It is Postgres-owned, has no `security_invoker`, and `anon` has broad grants on it; test and resolve before any subscriber data is added.

### Auth/profile mismatch

- Auth users: 3; profiles: 2.
- One Auth user has no profile. Preserve it; manually decide later whether it should be linked. Do not assign a role automatically.
- Synthetic staging accounts: SUPERADMIN, ADMIN, TREASURER, MEMBER-A, MEMBER-B, and an unauthenticated/anon client. Never reuse production identities or tokens.

### Schema/objects

- `roles` and `user_roles` are absent in production.
- `profiles.role` check allows `ADMIN`, `SUPERADMIN`, `SUBSCRIBER`; `is_treasurer` exists.
- `subscribers.numero_abonnement` is text NOT NULL UNIQUE; test the future nullable/unique design on empty staging data first.
- `events.id` / `event_payments.event_id` are bigint; older local SQL uses incompatible UUID assumptions.
- Current public functions: `auto_assign_zone`, `can_choose_match_zone(uuid,uuid)`, `complete_password_change`, `create_default_match_zones`, `handle_new_user`, `is_admin`, `is_staff`, `is_superadmin`, `is_treasurer`, `prevent_main_zone_delete`, `protect_profile_privilege_fields`, `protect_subscriber_self_update`, `remove_match_participation(uuid)`, `set_event_title`, `set_match_participation(uuid,uuid)`, `uec_match_updated_at`, `update_events_updated_at`, `update_payments_updated_at`, `update_updated_at`.
- Current triggers: updated-at triggers for event_payments/events/faculties/match_participations/match_zones/matches/payments/profiles/subscribers/zones; `set_event_title`; `matches_default_zones`; `protect_profile_privilege_fields`; `protect_subscriber_self_update`; `subscribers_auto_zone`; `protect_main_zones`.
- Exact PK/FK/UNIQUE/CHECK definitions are available from the live catalog; preserve all existing constraints unless a reviewed change explicitly replaces one.

## 3. Live grant and RLS risk summary

- RLS enabled on all 12 public base tables, but not forced.
- 66 public policies, all observed permissive; permissive predicates are OR-combined.
- `is_admin()`/`is_staff()`/`is_superadmin()`/`is_treasurer()` are SECURITY DEFINER and currently derive authorization from `profiles.role`/`is_treasurer`.
- `is_admin()` policies grant writes to ADMIN on events, event_payments, subscribers, faculties, gouvernorats, matches, match_zones, zones, and payments. `payments_admin_all` and `Admins can manage event payments` are ALL policies.
- `subscriber_self_update` permits Treasurer or owner update without protecting identity columns in the policy predicate.
- `payments_user_insert_own` checks only `user_id`, not amount, status, `paid_at`, subscriber ownership, or approval state.
- `anon` has table-level ALL grants on payments and gouvernorats and broad grants on `v_member_cards`; RLS policies may block rows today but least privilege is not satisfied.
- Authenticated has UPDATE column grants across all columns for subscribers, events, event_payments, payments, matches, match_zones, etc. Restrict grants together with RLS and server routes.
- Public default table ACLs grant broad DML to `anon` and `authenticated` for new public tables. New `user_roles` must revoke these grants, enable RLS, and define only necessary policies before exposure.
- Sequence ACLs grant anon/authenticated SELECT/UPDATE/USAGE on `events_id_seq`, `event_payments_id_seq`, and `security_audit_logs_id_seq`.

### Complete live policy inventory (66 policies)

All listed policies are `PERMISSIVE`. The predicate is `USING` unless shown as `WITH CHECK`; paired values appear for UPDATE/ALL.

| Table | Live policies (`name`: command → predicate) |
|---|---|
| `event_payments` | `Admins can manage event payments`: ALL → `is_admin()`; `event_payments_manage`: INSERT → `is_superadmin() OR is_treasurer()`; `event_payments_manage_update`: UPDATE → same predicate for USING/CHECK; `event_payments_staff_read`: SELECT → `is_staff()`; `event_payments_superadmin_delete`: DELETE → `is_superadmin()` |
| `events` | `Admins can create events`: INSERT → `is_admin()`; `Admins can delete events`: DELETE → `is_admin()`; `Admins can manage events`: ALL → `is_admin()`; `Admins can update events`: UPDATE → `is_admin()`; `Anyone can view events`: SELECT to anon/authenticated → `true`; `events_staff_read`: SELECT → `is_staff()`; `events_superadmin_write`: ALL → `is_superadmin()` |
| `faculties` | `faculties admin write`: ALL → `is_admin()`; `faculties authenticated read`: SELECT → `true`; `faculties_admin_delete`: DELETE → `is_admin()`; `faculties_admin_insert`: INSERT → `is_admin()`; `faculties_admin_update`: UPDATE → `is_admin()`; `faculties_read`: SELECT → `is_staff()`; `faculties_select_authenticated`: SELECT → `true`; `faculties_write`: ALL → `is_superadmin()` |
| `gouvernorats` | `gouvernorats_admin_delete`: DELETE → `is_admin()`; `gouvernorats_admin_insert`: INSERT → `is_admin()`; `gouvernorats_admin_update`: UPDATE → `is_admin()`; `gouvernorats_select_authenticated`: SELECT → `true` |
| `match_participations` | `match_participations_select`: SELECT → `is_admin()` or subscriber ID belongs to `auth.uid()` |
| `match_zones` | `match_zones_admin_delete`: DELETE → `is_admin()`; `match_zones_admin_insert`: INSERT → `is_admin()`; `match_zones_admin_update`: UPDATE → `is_admin()`; `match_zones_select_authenticated`: SELECT → `is_admin()` or parent match active; `match_zones_staff_read`: SELECT → `is_staff()`; `match_zones_superadmin_write`: ALL → `is_superadmin()` |
| `matches` | `matches_admin_delete`: DELETE → `is_admin()`; `matches_admin_insert`: INSERT → `is_admin()`; `matches_admin_update`: UPDATE → `is_admin()`; `matches_select_authenticated`: SELECT → match active or `is_admin()`; `matches_staff_read`: SELECT → `is_staff()`; `matches_superadmin_write`: ALL → `is_superadmin()` |
| `payments` | `payments_admin_all`: ALL → `is_admin()`; `payments_user_insert_own`: INSERT → `user_id = auth.uid()` only; `payments_user_select_own`: SELECT → `user_id = auth.uid()` |
| `profiles` | `profiles admin update`: UPDATE to public → `is_admin()`; `profiles self read`: SELECT to public → own row or `is_admin()`; `profiles_admin_update`: UPDATE → `is_admin()`; `profiles_select`: SELECT → own row or `is_admin()` |
| `subscribers` | `admin subscriber delete`: DELETE → `is_admin()`; `admin subscriber insert`: INSERT → `is_admin()`; `subscriber self read`: SELECT to public → own row or `is_admin()`; `subscriber self update`: UPDATE to public → own row or `is_admin()`; `subscriber_self_update`: UPDATE → own row or `is_superadmin()` or `is_treasurer()`; `subscriber_staff_select`: SELECT → own row or `is_staff()`; `subscriber_superadmin_delete`: DELETE → `is_superadmin()`; `subscriber_superadmin_insert`: INSERT → `is_superadmin()`; `subscribers_admin_all`: ALL → `is_admin()`; `subscribers_admin_delete`: DELETE → `is_admin()`; `subscribers_admin_insert`: INSERT → `is_admin()`; `subscribers_select`: SELECT → own row or `is_admin()`; `subscribers_update`: UPDATE → own row or `is_admin()`; `subscribers_user_select_own`: SELECT → own row |
| `zones` | `zones admin write`: ALL → `is_admin()`; `zones authenticated read`: SELECT → `true`; `zones_admin_delete`: DELETE → `is_admin()`; `zones_admin_insert`: INSERT → `is_admin()`; `zones_admin_update`: UPDATE → `is_admin()`; `zones_read`: SELECT → `is_staff()`; `zones_select_authenticated`: SELECT → `true`; `zones_write`: ALL → `is_superadmin()` |

There are no live policies for `user_roles` or `roles` because those tables do not exist. Do not drop any row above until its replacement and all callers have been reviewed in staging.

## 4. Local Edge Function deployment inventory

| Function | Deployed / JWT | Auth & authorization in local source | Service secret / admin operation | Browser-supplied identifier/data | Risk / staging action |
|---|---|---|---|---|---|
| `admin-create-admin` | Active v5 / remote `verify_jwt=false`; local true | Shared `auth.getUser(bearer)` + `user_roles.SUPERADMIN` | Shared server secret client; creates Auth user, profile, role assignments | `email`, `display_name`, `password`, role array | High: remote source not compared to local hash; verify JWT on deploy, password/role validation and create rollback in staging |
| `admin-create-user` | Active v5 / remote false; local true | Shared Superadmin gate in current local source | Shared service client; creates Auth user, subscriber, profile, MEMBER assignment | Member fields, `login_name`, optional number, faculty/zone IDs | High: test optional NULL number, uniqueness, rollback and ownership before deploy |
| `admin-delete-admin` | Active v3 / remote false; local true | Shared Superadmin gate | Shared service client; deletes Auth account | `user_id` | High: local code blocks self-delete, requires canonical ADMIN/SUPERADMIN, protects MEMBER accounts and last active admin; verify cascades and survivor count on staging |
| `admin-delete-user` | Active v3 / remote false; local true | Shared Superadmin gate | Shared service client; deletes Auth user (which can cascade to related rows) | `subscriber_id` | High: verify target/subscriber relationship, cascades, and confirmation semantics with synthetic records only |
| `admin-reset-password` | Active v3 / remote false; local true | Shared Superadmin gate | Shared service client; Auth password reset/profile flag update | `user_id`, new password | High: validate strong password, non-existent target, and password-change flag behavior |
| `admin-update-admin` | Active v3 / remote false; local true | Shared Superadmin gate | Shared service client; profile/email and role-array changes | `user_id`, email, display name, status, role array | Critical: REST requests are not one transaction; role upsert/removal or email/profile failure can partially apply. Implement/test a database transaction/RPC before production deployment |
| `admin-import-users` | **Not deployed** / N/A; local true | Shared Superadmin gate | Shared service client; creates/updates subscriber/Auth/profile/role records | `rows[]` including identity, contact, optional number, login, faculty/zone | High: deploy only after Deno compile and staging duplicate/partial-failure tests; production import was not attempted |

Remote deployed bundle hashes/versions were listed, but remote function source was not downloaded or compared with local files; manual JWT enforcement in local source is not proof that deployed code is equivalent.

Platform JWT verification disabled remotely does not by itself prove endpoint unauthenticated, but remote function source and runtime checks were not verified. Treat deployed status as a blocker. Deno is not installed locally; no local function compile/serve test was performed.

## 5. Existing frontend query/mutation inventory

| Feature / source | Tables or RPCs | Existing operation / concern |
|---|---|---|
| `js/common.js`, `js/auth.js` | profiles, user_roles, Auth | Role lookup uses `user_roles` with legacy fallback while production table is absent. |
| `js/admin.js` | subscribers (+ faculties/zones relation) | Dashboard read of member counts and recent rows. |
| `js/admin-users.js` | profiles, user_roles; privileged Edge Functions | Role list/create/edit/status/password/delete. Uses `user_roles` when available. |
| `js/subscribers.js` | subscribers, faculties, zones, Storage; admin-create-user/import/delete/reset functions | Member list/read; direct UPDATE of subscriber payload; card payment UPDATE; CSV import; member create/delete/reset. Direct update grants/policies are too broad live. |
| `js/subscriber.js` | subscribers, matches; `complete_password_change` RPC | Own profile read; direct contact/photo UPDATE; password RPC; match preview. |
| `js/admin-payments.js` | events, event_payments, subscribers | Direct event CRUD; event-payment upsert of `paid`/`paid_at`; current RLS/admin policy is too broad. |
| `js/admin-matchs.js` | matches, match_zones, match_participations | Match CRUD, zone changes, stats. Live is_admin policies allow ADMIN writes. |
| `js/matchs.js` | matches, match_zones, match_participations; `set_match_participation`, `remove_match_participation` | Active match/own participation reads; seat mutation via RPC. Test owner/capacity/gender rules in staging. |
| `js/reference.js` | faculties or zones | Direct Superadmin UI CRUD; RLS currently has ADMIN write policies. |
| Security-sensitive payment UI | `payments` | No matching browser module query found during scan; table still has permissive policies/grants and needs an explicit feature owner decision. |

### Authorization reference audit

- `js/common.js`: fetches `user_roles`; on query error it temporarily falls back from `profiles.role` and `profiles.is_treasurer`. `hasContextRole`, `requireStaff`, `requireAdmin`, and `requireSubscriber` use the resulting role set. This fallback must be removed only after the role migration is staged and verified.
- `js/auth.js`: passes the legacy role/treasurer fields only as a compatibility fallback for sign-in routing.
- `js/admin-users.js`: prefers `user_roles`; if unavailable, converts legacy `SUBSCRIBER` to `MEMBER` and reads `is_treasurer` for display compatibility. It calls privileged functions for management.
- `js/admin-matchs.js`, `js/admin-payments.js`, `js/reference.js`, `js/subscribers.js`, and `js/change-password.js`: use `hasContextRole`/role lists for UI gating. Those checks are not enforcement.
- `supabase/functions/_shared/security.ts`: current local shared Superadmin gate calls `auth.getUser()` and requires `SUPERADMIN` in `user_roles`; missing/failed role lookup denies the request.
- Local `admin-create-admin`, `admin-create-user`, and `admin-import-users` write compatibility fields in `profiles.role`/`is_treasurer` while also assigning canonical roles. `admin-update-admin` uses the role array and mirrors primary role/treasurer flag. Do not drop those columns until every deployed consumer is verified.
- `schema.sql`, `roles_migration.sql`, `permissions_v2.sql`, `multi_role_permissions.sql`, `security_hardening.sql`, `matchs.sql`, `payments.sql` and `fix_existing_installation.sql` (both archived to `supabase/obsolete_migrations/legacy_scripts/` on 2026-10-15) retain older profile-role/RLS assumptions. They are historical inputs to compare, not a safe run list. The SQL role/multi-role files are marked deprecated; the current authority migration is separately marked unapproved.
- `SUPABASE_DASHBOARD_FUNCTIONS/` (standalone duplicate Edge Function copies using the CIN as password and a non-existent `profiles.role` column) was removed on 2026-10-15; it remains in Git history. Deploy only from `supabase/functions/`.

### Grant inventory summary

- `anon`: ALL table grants on `payments`, `gouvernorats`, and `v_member_cards`.
- `authenticated`: ALL table grants on `event_payments`, `events`, `faculties`, `gouvernorats`, `match_zones`, `matches`, `payments`, `v_member_cards`, and `zones`; SELECT/UPDATE on `subscribers`; SELECT on `profiles`; SELECT (not DML) on `match_participations`.
- `authenticated` also has column UPDATE grants for every listed column in `subscribers`, `events`, `event_payments`, `payments`, `matches`, and `match_zones`; no column whitelist currently constrains Treasurer to payment status.
- `anon` and `authenticated` have SELECT/UPDATE/USAGE on `events_id_seq`, `event_payments_id_seq`, and `security_audit_logs_id_seq`.
- Default ACLs for new public tables grant broad DML to `anon` and `authenticated` for owners `postgres` and `supabase_admin`; creation of `user_roles` must first address this.

## 6. Staging role test accounts and setup

Create only in an owner-approved separate staging Supabase project, with synthetic data:

1. `test-superadmin`
2. `test-admin`
3. `test-treasurer`
4. `test-member-a`
5. `test-member-b`
6. anonymous client (no JWT)
7. Combined `test-admin-treasurer` with both assignments

Seed two fake subscribers linked to MEMBER-A/B, one fake published and one draft event, one payment request, one event payment, one match with two zones, and one owned participation. Never copy production Auth users or subscriber data.

## 7. Required RLS test matrix

For each action, test through PostgREST as that JWT, not SQL as postgres/service_role. Assert both successful results and explicit denied writes/zero affected rows. Run inside a disposable staging project only.

| Table/operation | SUPERADMIN | ADMIN | TREASURER | MEMBER-A | MEMBER-B | anon |
|---|---|---|---|---|---|---|
| `profiles` SELECT own/other | all allowed | read-only per approved visibility | read-only only if needed | own only | own only | deny |
| `profiles` UPDATE role/treasury/active | allowed through server route | deny | deny | deny | deny | deny |
| `subscribers` SELECT own/other | all | read-only | read | own only | own only | deny |
| `subscribers` UPDATE identity fields | allowed via server route | deny | deny | deny | deny | deny |
| `subscribers` contact/photo UPDATE | allowed | deny | deny | own allowlisted fields | own allowlisted fields | deny |
| subscription/card payment transition | allowed | deny | payment RPC only | deny | deny | deny |
| `user_roles` SELECT | allowed | role visibility only | deny/own role only | own role only | own role only | deny |
| `user_roles` INSERT/DELETE | allowed via server route | deny | deny | deny | deny | deny |
| `payments` submit request | allowed | deny | deny/approved workflow only | own request, server sets trusted fields | own request, server sets trusted fields | deny |
| `payments` status/amount/owner UPDATE | allowed via audited server route | deny | limited audited transition | deny | deny | deny |
| `event_payments` SELECT | all | read-only | read | own status only if approved | own status only if approved | deny |
| `event_payments` UPDATE | all | deny | only `paid`/`paid_at` transition via RPC | deny | deny | deny |
| `events` SELECT | all | read-only | read | published/allowed events | published/allowed events | only if public view approved |
| `events` content INSERT/UPDATE/DELETE | all | allowed only through approved field-whitelisted path | deny | deny | deny | deny |
| `events` amount/ownership/financial fields | all | deny | deny | deny | deny | deny |
| `matches`/`match_zones` operational content write | all | allowed | deny | deny | deny | deny |
| `match_participations` | all/admin operations | read-only | read only if justified | only own set/remove RPC | only own set/remove RPC | deny |
| `faculties`/`zones`/`gouvernorats` write | all | deny | deny | deny | deny | deny |
| `v_member_cards` | role-scoped fields | role-scoped | role-scoped | own fields only | own fields only | deny |

### Multi-role tests

- ADMIN + TREASURER gets ADMIN operational/content management plus permitted Treasurer payment transitions.
- ADMIN + TREASURER still cannot modify member identity/financial records, payment approvals outside Treasurer scope, or role assignments.
- MEMBER + TREASURER retains own profile/seat operations plus Treasurer payment scope; no other-member reads/writes.
- SUPERADMIN override works even with multiple additional roles.

### Privilege escalation tests

Attempt role insert/update/delete as MEMBER, ADMIN, TREASURER, anon; all deny. Attempt profile role/is_treasurer/is_active edits as non-Superadmin; deny. Attempt client-supplied payment owner/status/amount spoof; server rejects or overwrites trusted fields.

### RPC/SECURITY DEFINER tests

- `set_match_participation`: caller identity is derived from JWT, cannot choose another subscriber; capacity, active match/zone, gender checks remain.
- `remove_match_participation`: cannot remove another member’s participation.
- `complete_password_change`: only caller’s profile flag changes.
- Audit each function’s EXECUTE ACL; anon must not call privileged routines.

## 8. Payment-specific staging tests

`payments` statuses are currently constrained to `pending`, `paid`, `failed`, `cancelled`, `refunded`; `payment_method` has a finite CHECK. Test:

1. MEMBER-A submits only approved payment request fields; server derives `user_id` and subscriber and sets `status=pending`.
2. MEMBER-A cannot choose another user/subscriber, amount, status, paid timestamp, approval, or transaction verification fields.
3. MEMBER-A cannot read or update MEMBER-B’s payment.
4. TREASURER can transition only permitted statuses using an audited server route; cannot change amount, reference ownership, user, subscriber, or event.
5. ADMIN is read-only; SUPERADMIN can perform approved operations through audited server operations.
6. Duplicate request/retry behavior is deterministic and does not duplicate payment rows.
7. Event payment unique `(event_id, subscriber_id)` constraint is honored; only allowed status fields can change.
8. Every status transition records authenticated actor and timestamp; current tables do not yet have `approved_by`/`approved_at`, so schema requirements need approval first.

## 9. CSV staging tests

Use a synthetic 10-row CSV with six blank subscription numbers, plus comma/semicolon files, quoted separators/newlines, UTF-8 BOM/accents, Arabic names/headers, extra form columns, duplicate CIN, duplicate subscription number, blank login, and login collisions. Expected: missing subscription number is valid; repeated import inserts no duplicate; CIN wins only if no conflicting number identifies another row; conflicts are reported for review; absent CSV members remain untouched. Never run this test on production.

## 10. Proposed migration sequence — no SQL applied

1. Obtain owner-approved staging project and schema-only snapshot. Do not copy production data.
2. Decide ADMIN content-write scope, public events visibility, payment approval fields/transitions, CIN uniqueness, view field visibility, and unmatched Auth account handling.
3. Build an object dependency map for all 12 tables, view, 19 functions, 16 triggers, constraints, RLS policies, table/column grants, sequences, and default ACLs.
4. Implement `roles`/`user_roles` in staging only with explicit owner/role grants, RLS enabled (consider FORCE after owner analysis), no client role writes, and safe profile-role backfill report. Unknown/conflicting values must be logged for manual decision, not normalized silently.
5. Implement role helper functions using `user_roles` only; restrict function EXECUTE ACLs; test SECURITY DEFINER ownership/search_path and all call paths.
6. Replace policies per table in one reviewed transaction: record exact old definitions; revoke broad anon/authenticated grants/default ACLs; install table-specific policies/column grants/RPCs; test before committing staging.
7. Make `numero_abonnement` nullable while preserving uniqueness for non-null/non-empty values. Before replacing the full unique index, check duplicates and design a safe transition. Do not assign fake values.
8. Fix the public `v_member_cards` view (least-privilege columns and security-invoker semantics or secured function) and remove anon/table/sequence grants only after dependency checks.
9. Deploy functions with JWT verification enabled and shared user_roles authorization to staging; compare actual deployed source/version hashes.
10. Run the complete test matrix above, then review data/object counts and policy/grant diff.
11. Only after staging passes and backup/rollback are approved, prepare a separately reviewed production migration and show its dry-run plan to the owner. Do not run it automatically.

## 11. Rollback plan

- Before staging tests: snapshot staging schema, grants, policies, functions, and synthetic data.
- Each migration phase must be transactionally grouped where supported and saved as a versioned migration.
- If a policy/grant stage fails, rollback that transaction and restore the captured staging policy/grant definitions. Do not drop tables or role assignments.
- Role backfill is additive; rollback should disable new authorization paths, not delete mappings or Auth users.
- Once `numero_abonnement` NULLs are allowed/inserted, do not restore NOT NULL unless no NULL exists and owner approves. Never delete or fabricate subscription numbers.
- Before production: take verified backup; store an exact pre-change policy/grant/function snapshot; define rollback commands reviewed by a second operator. Any rollback affecting data is prohibited without explicit approval.

## 12. Current deployment blockers

- No staging project is confirmed; `wyyfmdyovaujdvxkyqhm` is not assumed to be staging.
- Production `user_roles` is absent; `profiles.role` helpers are live.
- ADMIN write policies and all-column UPDATE grants violate the target matrix.
- MEMBER payment INSERT allows client-controlled fields; Treasurer event payment policy is broad.
- `v_member_cards` has anon grants and contains sensitive fields.
- `payments` and `gouvernorats` have anon ALL table grants; public sequence grants are broad.
- Subscription number remains NOT NULL.
- Production has one Auth user without a profile; no automatic action permitted.
- Local migration history is empty after archiving the empty placeholder; production has no registered migrations. Dry-run is empty/up-to-date and does not prove the live schema is safe.
- Six deployed functions have `verify_jwt=false`; `admin-import-users` is not deployed; Deno unavailable locally.
- Current local UI gates event, match, and reference-data writes to SUPERADMIN only; this differs from the new proposed ADMIN content-management scope and requires an approved compatibility/UI/server change after the DB design is accepted.
- Live database lint has no schema errors, but no role/RLS runtime behavior has been tested.
