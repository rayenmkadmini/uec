# UE CLUBISTE CHANGELOG

## 2026-10-18 — Smart collections (individual contributions)

### Added
- Migration `20261018120000_smart_collections` (PENDING, with rollback): collection settings on `events` (global `target_amount`, optional `suggested_amount`, `start_date`, `deadline`, `collection_status`, `organizer`, `category`), `collection_contributions` (one row per real payment, `numeric(12,3)`), optional `collection_member_targets`, and the `collection_totals` view.
- RPCs `record_collection_contribution` (idempotent by `p_request_id`), `update_collection_contribution`, `cancel_collection_contribution` (reason required, never deleted) and `set_collection_member_target`. SUPERADMIN / TREASURER only, never on one's own member record unless SUPERADMIN; every change goes to `audit_logs`.
- Existing `event_payments` rows with status `PAID` are imported once with their stored amount (`source = LEGACY`); `event_payments` itself is unchanged.
- New Collectes page: financial dashboard (collected / target / remaining or surplus / progress, contributors, average, largest, smallest), member table with search, filters, sorting, pagination and side panel, payment ledger, CSV export, print view, deadline / target alerts. Financial maths in `js/collections-core.js` (integer millimes) with unit tests.

### Changed
- `tests/role-access.test.js` and `tests/schema-contract.test.js` now pin the new contract (RPC-only writes, new columns) instead of the paid / unpaid toggle this replaces.

### Notes
- Not applied to production. `npm run test:rls` / `test:rollback` were not run (no Docker on the authoring machine).

## 2026-09-30

### Fixed
- Fixed optional subscription-number handling in manual member creation and normalized empty values to SQL `NULL`.
- Repaired generated-login uniqueness checks, added safe CIN/subscription identity-conflict handling, and preserved existing optional member fields when an import cell is blank.
- Added one shared CSV parser for comma/semicolon, quoted fields, UTF-8/BOM, and Arabic headers, with deterministic regression tests.
- Centralized the member/admin creation privilege gate on the shared `user_roles` Superadmin check and made rate limiting fail closed.
- Prevented admin-only deletion from deleting accounts that still carry the MEMBER role and made multi-role updates add new roles before removing old ones.
- Added explicit JWT verification config for the CSV import function and required publishable-key headers on browser function requests.
- Corrected README deployment/security guidance so it no longer recommends blindly running overlapping legacy SQL scripts or claims unverified RLS protection.
- Archived the empty, unapplied migration placeholder outside Supabase's executable migration directory; no database migration was applied.

### Deprecated
- Legacy SQL files are retained for historical reference but are no longer the canonical authority for role logic.
- The old `profiles.role` field stays only for compatibility and should not be used as the primary source for authorization.

### Notes
- Frontend checks remain UX-only; final enforcement must be placed in Supabase database policies and server-side functions.
- The live database has no `user_roles` table and retains permissive legacy policies; the draft migration is not safe to apply.
- The remote project has not received the current Edge Function code; production deployment and RLS/runtime validation remain blocked pending a reviewed migration.
- No production migration or Edge Function deployment was performed during the final audit.
