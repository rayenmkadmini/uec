# UE Clubiste — Proposed RLS and Role Design

**Status: DESIGN ONLY — NOT IMPLEMENTED. Do not run or deploy SQL from this document.**

**Production target:** `astsvxyqyyzqvuioqsnq`  
**Inspection date:** 2026-10-01  
**Data/schema writes during inspection:** none

This document records a conservative proposal based on live metadata and existing application calls. It is not approval to migrate. In particular, payment flows, the role of ADMIN in content editing, and the unmatched Auth account need review before implementation.

## 1. Current live inventory

### Public tables and columns

| Object | Live columns |
|---|---|
| `event_payments` | `id`, `event_id`, `paid`, `created_at`, `subscriber_id`, `paid_at` |
| `events` | `id`, `title`, `description`, `event_date`, `location`, `image_url`, `created_at`, `name`, `amount`, `is_active`, `title_ar`, `title_fr`, `title_en`, `description_ar`, `description_fr`, `description_en`, `event_type`, `start_time`, `end_time`, `address`, `cover_image_url`, `registration_required`, `registration_url`, `status`, `is_featured`, `is_published`, `created_by`, `updated_at`, `end_date` |
| `faculties` | `id`, `name`, `created_at`, `updated_at` |
| `gouvernorats` | `id`, `name`, `zone_id`, `created_at` |
| `match_participations` | `id`, `match_id`, `subscriber_id`, `zone_id`, `created_at`, `updated_at` |
| `match_zones` | `id`, `match_id`, `zone_key`, `zone_name`, `capacity`, `is_available`, `created_at`, `updated_at` |
| `matches` | `id`, `sport`, `home_team`, `away_team`, `competition`, `stadium`, `match_date`, `match_time`, `description`, `is_active`, `created_at`, `updated_at`, `home_logo_url`, `away_logo_url` |
| `payments` | `id`, `subscriber_id`, `user_id`, `amount`, `currency`, `payment_method`, `status`, `transaction_id`, `reference`, `notes`, `paid_at`, `created_at`, `updated_at` |
| `profiles` | `id`, `role`, `display_name`, `must_change_password`, `created_at`, `updated_at`, `is_active`, `email`, `is_treasurer` |
| `security_audit_logs` | `id`, `actor_id`, `action`, `target_id`, `success`, `metadata`, `created_at` |
| `subscribers` | `id`, `user_id`, `nom`, `prenom`, `login_name`, `numero_abonnement`, `phone`, `email`, `cin`, `adresse`, `faculty_id`, `zone_id`, `status`, `created_at`, `updated_at`, `gouvernorat`, `gender`, `photo_url`, `card_paid`, `card_paid_at` |
| `zones` | `id`, `name`, `created_at`, `code`, `updated_at` |

Also present: view `v_member_cards`, with subscriber identity/contact fields including CIN, email, phone, and subscription number. It is owned by `postgres`, has no `security_invoker` option, and `anon` has broad grants on the view. **Critical privacy risk once subscriber rows exist.**

### Role and row snapshot

- `roles` and `user_roles`: absent.
- `profiles.role`: `text`, `NOT NULL`, default `SUBSCRIBER`, check currently permits `ADMIN`, `SUPERADMIN`, `SUBSCRIBER`.
- Profile role distribution: two `SUPERADMIN` profiles.
- Auth: 3 users, 2 profiles; no profile without Auth user; one Auth user without a profile: `5eaf3c33-0dcd-47db-8150-0cb8dab33192` (email masked `m***@gmail.com`). Do not delete or auto-link it.
- Exact row counts: 0 subscribers, 0 events, 0 event payments, 0 payments, 8 matches, 40 match zones, 0 match participations, 210 faculties, 4 zones, 24 gouvernorats.
- `subscribers.numero_abonnement`: `text NOT NULL`, existing `UNIQUE (numero_abonnement)`; 0 NULL, empty, or duplicate values currently.
- `events.id` and `event_payments.event_id`: `bigint`; older SQL assumptions using UUID do not match.
- All 12 public base tables have RLS enabled; `FORCE ROW LEVEL SECURITY` is false.

### Keys, constraints, and cascades

- `event_payments`: PK `id` (bigint); FKs `event_id → events(id) ON DELETE CASCADE`, `subscriber_id → subscribers(id) ON DELETE CASCADE`; duplicate UNIQUE constraints `event_payments_event_id_subscriber_id_key` and `event_payments_event_subscriber_unique` on `(event_id, subscriber_id)`.
- `events`: PK `id` (bigint); FK `created_by → auth.users(id) ON DELETE SET NULL`; CHECK `event_type ∈ {general, match, training, meeting, announcement, competition, ceremony, other}`; CHECK `status ∈ {draft, upcoming, ongoing, completed, cancelled}`.
- `faculties`: PK `id`; UNIQUE `name`; CHECK trimmed `name` length 1–150.
- `gouvernorats`: PK `id`; UNIQUE `name`; FK `zone_id → zones(id) ON DELETE SET NULL`.
- `match_participations`: PK `id`; UNIQUE `(match_id, subscriber_id)`; FKs match/subscriber with `ON DELETE CASCADE`; `zone_id → match_zones(id) ON DELETE RESTRICT`.
- `match_zones`: PK `id`; UNIQUE `(match_id, zone_key)`; FK match cascade; CHECK `capacity IS NULL OR capacity >= 0`; CHECK zone key in the five supported stadium zones.
- `matches`: PK `id`; CHECK sport in `FOOTBALL`, `HANDBALL`, `BASKETBALL`.
- `payments`: PK `id`; CHECK `amount >= 0`; CHECK method in `cash`, `bank_transfer`, `card`, `d17`, `flouci`, `online`, `other`; CHECK status in `pending`, `paid`, `failed`, `cancelled`, `refunded`; subscriber FK cascade; Auth `user_id` FK `ON DELETE SET NULL`.
- `profiles`: PK `id`; FK `id → auth.users(id) ON DELETE CASCADE`; CHECK role in `ADMIN`, `SUPERADMIN`, `SUBSCRIBER`.
- `security_audit_logs`: PK `id`; FK actor to Auth `ON DELETE SET NULL`; CHECK action matches `^[A-Z0-9_:-]{2,80}$`.
- `subscribers`: PK `id`; UNIQUE `login_name`, `numero_abonnement`, and `user_id`; CHECK login format `^[A-Z0-9_-]{3,40}$`; CHECK gender in `MALE`, `FEMALE`; user FK cascades; faculty/zone FKs set NULL on delete.
- `zones`: PK `id`; UNIQUE `name` and `code`; CHECK trimmed name length 1–150.
- CIN is indexed but is **not unique**. A unique CIN index requires duplicate audit and an approved identity rule before adding it.
- Deleting Auth users can cascade to profiles/subscribers and then payment/participation rows. No delete was run; future deletion operations must be explicitly tested for these cascades.

### Triggers

Current public triggers include: `event_payments_updated_at`, `events_updated_at`, `set_event_title` (INSERT/UPDATE), `faculties_updated_at`, `match_participations_updated_at`, `match_zones_updated_at`, `matches_default_zones`, `matches_updated_at`, `payments_updated_at`, `profiles_updated_at`, `protect_profile_privilege_fields`, `protect_subscriber_self_update`, `subscribers_auto_zone` (INSERT/UPDATE), `subscribers_updated_at`, `protect_main_zones`, and `zones_updated_at`.

### Functions

Live public functions: `auto_assign_zone`, `can_choose_match_zone(uuid, uuid)`, `complete_password_change()`, `create_default_match_zones`, `handle_new_user`, `is_admin`, `is_staff`, `is_superadmin`, `is_treasurer`, `prevent_main_zone_delete`, `protect_profile_privilege_fields`, `protect_subscriber_self_update`, `remove_match_participation(uuid)`, `set_event_title`, `set_match_participation(uuid, uuid)`, `uec_match_updated_at`, `update_events_updated_at`, `update_payments_updated_at`, `update_updated_at`.

`user_has_role` and `has_any_role` do not exist live. The role helpers use `profiles.role` and/or `profiles.is_treasurer`. Several SECURITY DEFINER functions have execute privileges for `anon`; review/revoke unnecessary execution as part of the staged migration.

## 2. Current RLS and grant findings

All live RLS policies are `PERMISSIVE`; permissive policies combine with OR. There are 66 policies. Key current policy names/behaviors include:

- `events`: `Admins can manage events` (`ALL`, `is_admin()`), plus Admin INSERT/UPDATE/DELETE and `events_superadmin_write`; `Anyone can view events` has `USING (true)` for `{anon,authenticated}`.
- `event_payments`: `Admins can manage event payments` (`ALL`, `is_admin()`); Treasurer/Superadmin INSERT and UPDATE policies; Superadmin DELETE; staff SELECT.
- `subscribers`: `subscribers_admin_all`, `subscribers_admin_insert/delete`, and legacy `subscriber self update`; `subscriber_self_update` allows `is_superadmin() OR is_treasurer() OR own row` without column restriction.
- `payments`: `payments_admin_all`; `payments_user_insert_own` checks only `user_id = auth.uid()`; `payments_user_select_own` checks ownership. Member-supplied payment `amount`/`status` are not restricted by that INSERT policy.
- `matches`, `match_zones`: multiple `is_admin()` write policies remain alongside Superadmin policies.
- `faculties`, `zones`, `gouvernorats`: Admin write policies remain.
- `profiles`: overlapping Admin UPDATE policies remain.
- `match_participations`: SELECT policy allows Admin or own rows; seat selection is intended through SECURITY DEFINER RPCs.

Authenticated has table-level DML grants on events, event_payments, faculties, gouvernorats, match_zones, matches, payments, and zones. It has SELECT/UPDATE on subscribers, and SELECT on profiles. Column-level UPDATE grants span all subscriber columns and broad event/payment/match fields. `anon` has all table grants on `gouvernorats`, `payments`, and view `v_member_cards`; RLS currently prevents some anon row access, but the grants are still excessive. Default privileges for tables created in `public` grant broad access to `anon` and `authenticated` for owners `postgres` and `supabase_admin`. Public sequences include `event_payments_id_seq`, `events_id_seq`, and `security_audit_logs_id_seq`; anon/authenticated have SELECT/UPDATE/USAGE grants.

## 3. Proposed role definitions

`user_roles(user_id, role_name, created_at)` is the only authorization source. Use `role_name` to match current local clients, with a unique/primary key on `(user_id, role_name)`. Role catalog values: `SUPERADMIN`, `ADMIN`, `TREASURER`, `MEMBER`.

- `SUPERADMIN`: full administrative operations, but privileged identity/role/payment decisions remain server-side and audited.
- `ADMIN`: may manage operational/content entities (`events` content fields, `matches`, `match_zones`, `faculties`, `zones`, `gouvernorats`) through field-whitelisted policies/RPCs. It is read-only on member identity, financial records, role assignments, profiles, and privilege/configuration fields.
- `TREASURER`: read members/events/payments; may only perform documented payment-status transitions through a narrowly validated RPC/Edge Function. No generic UPDATE to subscribers, events, payment identity, amount, event ID, or ownership.
- `MEMBER`: own profile/subscription read; update only approved contact/photo fields; seat changes only through the existing ownership/capacity/gender-aware RPC. Payment requests may be created only through server validation; status, amount, approval, and ownership are server-controlled.
- Effective permissions are the union of assignments. `SUPERADMIN` overrides normal restrictions.
- `is_admin()` must mean ADMIN only. Define separate `is_superadmin()`, `is_treasurer()`, `is_member()`, and a carefully scoped `is_staff()`; do not use `is_admin()` as a generic write predicate.

### Table permission proposal

`CRUD` below is proposed, not currently verified. `Own` always means server-derived `auth.uid()` ownership; never trust caller-supplied user/subscriber IDs.

| Table | SUPERADMIN | ADMIN | TREASURER | MEMBER | ANON |
|---|---|---|---|---|---|
| `profiles` | CRUD via server operations | SELECT | SELECT only if required for member operations | Own SELECT; no direct role/status updates | Deny |
| `user_roles` | Manage through privileged server path | SELECT roles for user oversight | Own role read only if needed | Own role read only | Deny |
| `roles` | Manage catalog | SELECT | SELECT only if needed | SELECT allowed role names | Deny |
| `subscribers` | CRUD | SELECT | SELECT + payment RPC only | Own SELECT; own contact/photo fields only | Deny |
| `events` | CRUD | CRUD for approved content/operations, excluding financial/protected fields | SELECT | Published/active SELECT only | Deny unless public events are explicitly approved |
| `event_payments` | CRUD | SELECT | SELECT + `paid`/`paid_at` RPC only | Own payment status SELECT | Deny |
| `payments` | CRUD | SELECT | Review/status transition RPC only | Own request SELECT/submit; no status/amount/owner UPDATE | Deny |
| `matches` | CRUD | CRUD operational match content | SELECT | Active match SELECT | Deny unless separately approved |
| `match_zones` | CRUD | CRUD operational zone availability/capacity | SELECT | Active match-zone SELECT | Deny |
| `match_participations` | CRUD | SELECT | SELECT only if operationally needed | Own seat through set/remove RPC only | Deny |
| `faculties` | CRUD | CRUD reference content | SELECT | SELECT reference values | Deny unless approved |
| `zones` | CRUD | CRUD reference content | SELECT | SELECT reference values | Deny unless approved |
| `gouvernorats` | CRUD | CRUD reference content | SELECT | SELECT reference values | Deny |
| `security_audit_logs` | Restricted read/report path | Deny | Deny | Deny | Deny |
| `v_member_cards` | No direct public view; restricted view/RPC if needed | Staff-scoped read | Staff-scoped read | Own row only | Deny |

All UI operations must be mapped to explicit server/database permissions. ADMIN may manage event names/translations, descriptions, dates/times, venue/address, images, event type, registration fields, and approved lifecycle/publication flags. Event `amount` and `created_by` remain Superadmin/server-controlled. ADMIN may manage match schedules/content and operational zone availability/capacity, but not participation ownership or financial/member records. Use column grants plus a trigger/RPC for mixed-content tables because RLS alone does not restrict columns. The exact lifecycle/publication flags and public event visibility still require confirmation.

## 4. Column-level mutation rules

- `profiles`: no client role, `is_treasurer`, `is_active`, `id`, password, or `must_change_password` edits. Password change stays in Auth plus `complete_password_change()`.
- `subscribers`: MEMBER may update `phone`, `email`, `adresse`, `photo_url` only for own row. Treasurer cannot update subscriber identity/contact columns; membership-card payment state uses a server payment operation. `numero_abonnement`, `cin`, `nom`, `prenom`, `gender`, `login_name`, `user_id`, `faculty_id`, `zone_id`, and `status` are Superadmin-only through a server endpoint/RPC.
- `event_payments`: Treasurer transition changes only `paid`, `paid_at` (and ideally `paid_by` audit identity, which does not currently exist). Cannot change `event_id`, `subscriber_id`, `id`, or ownership.
- `payments`: Member cannot send trusted `amount`, `status`, `paid_at`, `user_id`, `subscriber_id`, or approval fields. A request endpoint must derive owner/member IDs, calculate or validate amount from trusted event/subscription data, and set status to `pending` server-side. Treasurer status changes require an audited transition.
- `events`: Admin write scope is undecided; do not grant generic table UPDATE. If approved, enumerate content-only columns and keep amount, payment, ownership, publication, and approval controls separately authorized.
- `match_participations`: changes only through the existing RPCs, which derive subscriber from `auth.uid()` and validate match/zone/capacity.

## 5. Authentication and ownership assumptions

- Supabase Auth JWT is the identity source; server code validates the bearer with `auth.getUser(token)`.
- Edge Functions use only server-side secrets. No browser-supplied `role`, `user_id`, permission list, payment status, or approval value is trusted.
- `subscribers.user_id = auth.uid()` is the owner relation. For payments, validate both `user_id` and `subscriber_id` match the authenticated account; do not trust either ID from JSON.
- `profiles.role`/`profiles.is_treasurer` remain temporarily for compatibility and backfill only. Remove authorization fallback only after migration and staged validation.
- Existing Auth user without a profile is unresolved and must not be auto-deleted or assigned a role. Decide manually how/if it should be linked.

## 6. Payment trust model

1. Member submits a payment request with only allowed user inputs (for example payment method and reference).
2. Server derives the authenticated user/subscriber and event/fee, validates amount and ownership, and creates `pending` status.
3. Treasurer sees assigned/pending rows and requests an allowed status transition through an Edge Function/RPC. Server sets `paid_at` and actor audit data; client cannot set these.
4. Admin is read-only for payment records unless a separate audited permission is approved.
5. Superadmin may manage exceptional corrections through audited server-side operations.

The current `payments` table allows own-user INSERT while the policy checks only `user_id`; its `amount`, `status`, `paid_at`, and identity fields are not protected by that policy. `event_payments` has a broad Admin ALL policy and Treasurer UPDATE policy without column restrictions. These policies and associated grants must be replaced together.

## 7. Migration risks and preflight

| Live object | Current state | Proposed change | Risk/data impact |
|---|---|---|---|
| `roles`, `user_roles` | Absent | Add catalog/assignment table, explicit grants and RLS, backfill only recognized profile values | High: default public table ACLs currently grant broad privileges; no role accounts to test |
| `profiles.role` | Text; two SUPERADMIN values | Keep compatibility; stop using for auth after staged cutover | High: one unmatched Auth account, legacy triggers/check constraints |
| `subscribers.numero_abonnement` | NOT NULL + UNIQUE; 0 member rows | DROP NOT NULL; retain full unique constraint (PostgreSQL allows multiple NULL); normalize blank input to NULL | Low schema/data risk; must not set NOT NULL again after NULL values exist |
| CIN | Not UNIQUE; 0 members | Audit duplicates, then consider unique index if the identity rule is confirmed | Medium; concurrent imports can race without database uniqueness |
| Existing RLS | 66 permissive overlapping policies | Record each exact policy, then replace in a transaction with reviewed rules | Critical: adding narrower permissive rules does not revoke old access |
| Table/column grants | Broad DML/update columns; anon grants on payments/gouvernorats/view | Revoke excessive grants and regrant least privilege per endpoint | Critical: direct UI writes may break; Superadmin edit flows need server endpoints/RPCs |
| `v_member_cards` | Postgres-owned view, no security-invoker option, anon has broad grants | Revoke anon; convert to invoker/secured view or remove exposure only after consumer audit | Critical privacy risk once subscribers exist |
| `payments` / event FKs | Cascade deletes to subscriber/event children | Preserve current FK behavior unless separately approved; test delete implications | High data impact if parent records are deleted |

**No SQL is approved or included here.** The live schema, grants, view, and policy overlaps make a guessed migration unsafe. A migration should be transactional, captured against a backup/schema-only staging clone, and should never contain `DROP TABLE`, `TRUNCATE`, or production data deletion.

## 8. Rollback strategy

- Before staging migration, export schema/policies/grants and take a staging snapshot.
- Apply schema/policy/grant changes in a transaction where supported and verify every object after commit.
- Preserve the pre-migration policy/grant definitions as a rollback artifact. Rollback may restore old access but must not be used to restore known ADMIN-wide access without explicit risk acceptance.
- Keep new role assignments additive; do not delete Auth users/profiles or drop role tables during rollback.
- Do not restore `numero_abonnement NOT NULL` after null values are admitted. Rollback is forward-only for this nullability change unless all NULLs are resolved with owner approval.
- Keep audit logs and role assignments; rollback application behavior by feature flag/configuration, not data deletion.

## 9. Required decisions before SQL

1. Which exact event publication/lifecycle flags may ADMIN change beyond descriptive and scheduling fields?
2. Is unauthenticated public event listing a product requirement? If so, define published fields and expose them without member/payment data.
3. Which `payments` status transitions may TREASURER perform, and who may create/approve refund/cancel states?
4. Does Treasurer update `subscribers.card_paid` directly, or must every card payment use an audit RPC?
5. Is CIN formally unique? If yes, decide handling for pre-existing duplicate CIN before adding a unique index.
6. How should the unmatched Auth user be linked, if at all? Do not auto-assign roles.
7. Is the existing project `uec site off` a staging project? It is not assumed safe or staging without owner confirmation.
8. Should `v_member_cards` remain for a legitimate client, and which fields may each role see?

## 10. Current source inventory map

- **Frontend:** 11 HTML pages, shared `css/style.css`, browser modules in `js/`; direct data writes remain in member/profile, event/payment, match, and admin interfaces.
- **Backend / Edge Functions:** seven local functions plus `_shared/security.ts`; only six functions are currently deployed, and deployed source was not fetched/runtime-tested.
- **Authentication:** Supabase Auth; `persistSession: true`, `autoRefreshToken: true`, key `ueclubiste-auth`; local storage persistence is intentional but increases XSS session exposure.
- **Authorization:** local functions use shared `user_roles` Superadmin gate; production still uses `profiles.role` and `is_treasurer` because `user_roles` is absent.
- **Database:** 12 tables, one sensitive view, 19 public functions, current triggers/constraints/grants/policies recorded in the staging plan.
- **CSV:** one existing member import route; schema still blocks blank `numero_abonnement`; production import was not performed.
- **Tests/deployment:** deterministic local test suite exists; no Deno runtime or role-isolated staging fixture available.
