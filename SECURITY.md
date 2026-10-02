# UE Clubiste Security Status

## Browser authentication
- `js/config.js` contains only the Supabase project URL and Publishable/Anon key. These are public client credentials; no service-role/secret key belongs in browser code.
- `persistSession: true`, automatic refresh, URL session detection, and `storageKey: "ueclubiste-auth"` are intentional for the current login experience. This persists Auth tokens in browser storage: an XSS vulnerability could expose a session. Keep the existing behavior unless the app is migrated to a server-managed session; reduce risk with strict script/CSP controls, safe DOM rendering, HTTPS, and dependency review.
- Frontend role checks are UX only. Database RLS and authenticated server-side authorization must remain authoritative.

## Current role/function code
- The intended canonical role table is `public.user_roles`, supporting `SUPERADMIN`, `ADMIN`, `TREASURER`, and `MEMBER` with role-union behavior.
- Local Edge Function sources use shared Superadmin authorization derived from an authenticated bearer token and `user_roles`; they must not trust browser-supplied roles.
- The standalone copies under `SUPABASE_DASHBOARD_FUNCTIONS/` are deprecated; deploy from `supabase/functions/` only.
- The local `supabase/config.toml` sets `verify_jwt = true` for protected functions. The live project was observed with `verify_jwt = false` on six deployed admin functions, and `admin-import-users` was not listed as deployed. The deployed source/version was not runtime-tested in this audit.

## Live production blockers (read-only inspection, 2026-10-01)
- The linked database has 12 public base tables and 66 public RLS policies. `roles` and `user_roles` are both absent. Live `is_admin()`, `is_staff()`, `is_superadmin()`, and `is_treasurer()` definitions still read `profiles.role` / `profiles.is_treasurer`.
- `subscribers.numero_abonnement` remains `NOT NULL` with a full unique constraint/index. There are currently 0 subscriber rows, so changing it safely still requires a reviewed migration.
- Tables include `payments` and `gouvernorats`, which were missing from the earlier local SQL assumptions. Current exact counts: 2 profiles, 0 subscribers, 0 events, 0 event payments, 0 payments, 8 matches, 40 match zones, 0 match participations, 210 faculties, 4 zones, and 24 gouvernorats.
- There are 3 Auth users and 2 profiles; one Auth user (ID `5eaf3c33-0dcd-47db-8150-0cb8dab33192`, email masked as `m***@gmail.com`) has no profile. No accounts or data were changed.
- The live policy set has overlapping permissive write policies: ADMIN via `is_admin()` has writes on events, event payments, subscribers, faculties, gouvernorats, matches, match zones, zones, and payments. `payments_admin_all` is ALL. `event_payments` has an `is_admin()` ALL policy in addition to Treasurer status policies. PostgreSQL ORs permissive policies, so adding narrower policies alone will not revoke these writes.
- Authenticated has UPDATE privileges across all columns on several business tables; `payments` and `gouvernorats` have broad table grants to `anon`. RLS currently limits some of those grants, but the grants violate least privilege and must be reconciled together with replacement policies.
- `event_payments.event_id` and `events.id` are `bigint`, while older local SQL assumes UUID IDs. Do not apply those scripts without explicit type compatibility handling.
- `supabase/final_migration_multi_role_and_csv.sql` is an **unapproved draft**. It does not secure `user_roles`, does not reconcile all live policies/grants, and still includes legacy-role fallback behavior. **Do not run or push it.**
- The empty, unapplied local migration placeholder was archived as `supabase/obsolete_migrations/20260930124251_remote_schema.sql.txt`, outside the executable migrations directory. The unsafe draft remains outside the migration sequence. Do not run `supabase db push` until a reviewed migration path is prepared and validated.

## Deployment and verification
- Production DB, RLS, and real role-matrix behavior were not exercised because a safe per-role test environment/data fixture is not available.
- Deno is unavailable locally, so Edge Functions were not type-checked or served locally. `get_errors` reported no editor diagnostics, but that is not a substitute for Deno compilation.
- No live migration, Edge Function deployment, member creation, or CSV import was performed.
- Before production release: prepare a replacement migration against live metadata; secure `user_roles` grants/RLS; reconcile every existing policy; verify optional-number and CIN uniqueness; deploy Edge Functions with JWT settings; then execute per-role/RLS and CSV tests in staging.

## Operational recommendations
- Enable leaked-password protection and MFA for administrators where available.
- Keep only required production origins in Auth/CORS configuration.
- Review Edge Function/audit logs, backups, and Auth rate limits regularly.
