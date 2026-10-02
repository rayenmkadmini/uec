# UE Clubiste — Production Reset Snapshot

**Snapshot date:** 2026-10-01  
**Project:** `astsvxyqyyzqvuioqsnq` (`uec`, organization `ggctokecqgbnvpsdyngb`)  
**Inspection mode:** read-only. No SQL writes or deployment occurred.  
**Execution status:** BLOCKED — Supabase CLI reports no physical backups and PITR is disabled.

## 1. What exists now

### Public relations and row counts

There are **12 public base tables**, **one public view**, 19 public functions, 66 public RLS policies, and 18 trigger event entries (16 distinct trigger names; some triggers fire on multiple events).

| Relation | Rows | Main structure |
|---|---:|---|
| `profiles` | 2 | Auth UUID PK; `role` text; `is_active`, `is_treasurer`, password-change flag |
| `subscribers` | 0 | UUID PK; Auth `user_id`; CIN/login; subscription number currently NOT NULL + UNIQUE; card payment fields |
| `events` | 0 | bigint PK; `name` plus `title`, AR/FR/EN fields, dates/times, amount, publication/registration fields |
| `event_payments` | 0 | bigint PK and `event_id`; `paid`, `paid_at`, `subscriber_id`; duplicate unique constraints on event/subscriber |
| `payments` | 0 | UUID PK; subscriber/user IDs, amount, currency, method, status, reference/transaction fields |
| `matches` | 8 | UUID PK; sport, teams, date/time, competition, stadium, active, logos |
| `match_zones` | 40 | UUID PK; match ID, zone, capacity, availability |
| `match_participations` | 0 | UUID PK; match/subscriber/zone IDs |
| `faculties` | 210 | UUID PK, unique name |
| `zones` | 4 | UUID PK, unique name and code |
| `gouvernorats` | 24 | UUID PK, unique name, `zone_id` |
| `security_audit_logs` | 1 | identity PK, actor/action/target/success/metadata |

View `v_member_cards` is Postgres-owned and has no `security_invoker` option. It projects member identity, CIN, email, phone, address, subscription number, and status; broad `anon` grants exist. This is sensitive once subscriber records are present.

### Authentication and roles

- Auth users: **3**; public profiles: **2**.
- Two existing profile rows have legacy role `SUPERADMIN`; a third Auth account has no profile. Preserve Auth accounts. Do not assign the unmatched account a role from its email/name.
- `roles` and `user_roles` do not exist.
- Existing `profiles.role` is text with check values `ADMIN`, `SUPERADMIN`, `SUBSCRIBER`; `is_treasurer` is a separate boolean.
- Live role helpers `is_admin()`, `is_staff()`, `is_superadmin()`, and `is_treasurer()` read legacy profile fields.

### Constraints and key relationships

- `profiles.id → auth.users.id ON DELETE CASCADE`.
- `subscribers.user_id → auth.users.id ON DELETE CASCADE`, unique `user_id`, `login_name`, `numero_abonnement`; CIN is not unique. Faculty/zone references set NULL on delete.
- Subscription number is currently `NOT NULL`; this conflicts with the intended optional-member workflow.
- `events.id` and `event_payments.event_id` are bigint; `matches` and match-related IDs are UUID.
- `payments.subscriber_id → subscribers.id ON DELETE CASCADE`; `payments.user_id → auth.users.id ON DELETE SET NULL`.
- `event_payments.event_id → events.id ON DELETE CASCADE` and subscriber FK cascades.
- `match_participations` has unique `(match_id, subscriber_id)`; match/subscriber cascades; zone delete is restricted.
- `match_zones` has unique `(match_id, zone_key)` and a zone-key check. Payments have amount/method/status checks. Full constraint inventory is in `docs/security/RLS_ROLE_DESIGN.md`.

### Functions, triggers, extensions, views

Live public functions:
`auto_assign_zone`, `can_choose_match_zone`, `complete_password_change`, `create_default_match_zones`, `handle_new_user`, `is_admin`, `is_staff`, `is_superadmin`, `is_treasurer`, `prevent_main_zone_delete`, `protect_profile_privilege_fields`, `protect_subscriber_self_update`, `remove_match_participation`, `set_event_title`, `set_match_participation`, `uec_match_updated_at`, `update_events_updated_at`, `update_payments_updated_at`, `update_updated_at`.

Live trigger names include:
`event_payments_updated_at`, `events_updated_at`, `set_event_title`, `faculties_updated_at`, `match_participations_updated_at`, `match_zones_updated_at`, `matches_default_zones`, `matches_updated_at`, `payments_updated_at`, `profiles_updated_at`, `protect_profile_privilege_fields`, `protect_subscriber_self_update`, `subscribers_auto_zone`, `subscribers_updated_at`, `protect_main_zones`, `zones_updated_at`.

Installed extensions include `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, and `uuid-ossp`. These are infrastructure dependencies; do not drop extensions as part of a public application reset.

### RLS and grants

- RLS is enabled on all 12 public base tables; `FORCE ROW LEVEL SECURITY` is false.
- There are 66 permissive policies. Several `is_admin()` ALL/INSERT/UPDATE/DELETE policies grant ADMIN writes across events, event payments, subscribers, profiles, faculties, gouvernorats, matches, match zones, zones, and payments.
- `payments_user_insert_own` verifies only `user_id`; client-controlled amount/status fields are not constrained there.
- Treasurer subscriber UPDATE policy is row-wide, not column-limited.
- `anon` has ALL table grants on `gouvernorats`, `payments`, and `v_member_cards`; authenticated has broad DML table grants and UPDATE column grants on multiple business tables.
- Default privileges for new public tables grant broad DML to `anon` and `authenticated` for relevant owners. Public sequences include `events_id_seq`, `event_payments_id_seq`, and `security_audit_logs_id_seq`; anon/authenticated have SELECT/UPDATE/USAGE.
- Exact names and expressions for all 66 policies are recorded in `docs/security/STAGING_RLS_TEST_PLAN.md`.

### Extensions outside `public`

Supabase Auth is in schema `auth`; Storage is in schema `storage`. This reset must not drop/recreate those schemas or delete `auth.users`. The dashboard/Supabase control plane is not part of the public application reset.

### Edge Functions

Six admin functions are deployed: `admin-create-admin` (v5), `admin-create-user` (v5), `admin-delete-admin` (v3), `admin-delete-user` (v3), `admin-reset-password` (v3), and `admin-update-admin` (v3). All report remote `verify_jwt=false`. `admin-import-users` is not deployed. Local config sets JWT verification true for seven functions, but local source was not shown to be deployed. Deno is unavailable locally.

### Migrations and backup state

- Remote migration history has no registered migrations.
- The empty local placeholder migration was archived outside `supabase/migrations/`; current dry-run reports no pending migrations.
- `supabase backups list --project-ref astsvxyqyyzqvuioqsnq` returned `backups: []`, `pitr_enabled: false`, `walg_enabled: true`.
- No backup was created, restored, or verified. **The production reset execution gate therefore fails.**

## 2. What a future authorized reset would remove

After a restorable backup is verified, one reviewed migration may drop/recreate only the enumerated application objects in schema `public`: the 12 application tables, `v_member_cards`, their policies, dependent application triggers/functions, sequences, and application enum types. It must not use `DROP SCHEMA public CASCADE`, and must not drop extensions, `auth`, `storage`, or Auth users.

The reset would remove existing public rows including 8 matches, 40 match zones, 210 faculties, 24 gouvernorats, and 4 zones, in addition to the presently empty business tables. The user explicitly authorized loss of old public application data. No such removal has occurred.

## 3. What the clean rebuild would create

A single reviewed migration would rebuild a consistent schema for profiles, roles/user_roles, subscribers, events/event payments, payments, matches/match zones/participations, faculties, zones, gouvernorats, and audit/required support objects. It would add least-privilege grants, explicit RLS, server-side role/payment functions, safe view exposure, constraints, and indexes. Existing Auth accounts would remain; the two known Superadmins may be mapped from explicit existing role data, while the unmatched account requires an explicit safe default/manual decision. No email/name-based role inference.

## 4. Execution gate

**Do not execute the reset yet.** Supabase reports no available physical backup and PITR is disabled. The user’s own requirement says to stop before production writes unless a verified, usable backup/restore point exists. Also, Deno/runtime and role-matrix tests have not passed. No destructive SQL or reset migration was created or applied during this snapshot.