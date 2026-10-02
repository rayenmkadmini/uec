# UE CLUBISTE CHANGELOG

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
