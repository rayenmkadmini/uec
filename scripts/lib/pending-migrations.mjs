// Migration lists shared by the test runners, the local stack and scripts/apply-migration.mjs.
//
// BASE_APPLIED: in production since 2026-10-01.
// RELEASED:     applied to production on 2026-10-17: the release (DEPLOYMENT_PLAN.md) and, in the
//               afternoon, 20261017120000 (COMPLETION_AUDIT_2026-10-17.md).
// PENDING:      written locally, NOT yet applied to qwlbbfyhjdeekmrxtzjf, in apply order.
//               Each has a rollback in supabase/rollback/<name>_rollback.sql.
//
// The schema-only test container (ue-phaseb-testdb) holds production's schema from BEFORE
// the release, so the local checks replay RELEASED first. A replica built after the release
// (needed for the production rehearsal) already holds them: see replayList().
export const BASE_APPLIED = ["20261001194746", "20261001194845"];

export const RELEASED = [
  "20261015120000_role_permissions_repair",
  "20261015140000_member_identity_and_password_hardening",
  "20261015160000_active_accounts_and_data_minimization",
  "20261015180000_admin_least_privilege",
  "20261016120000_least_privilege_hardening",
  "20261017120000_session_revocation_and_grant_tightening"
];

// Add the next migration here; scripts/apply-migration.mjs refuses to run with nothing pending.
// Also update RELEASED_PROBE_SQL / PENDING_PROBE_SQL below to objects of the new state.
// 20261018120000 was applied by hand in the SQL editor on 2026-10-18 (not recorded in the
// migration history): record it first with `supabase migration repair --status applied
// 20261018120000` and move it to RELEASED before running scripts/apply-migration.mjs.
export const PENDING = ["20261018120000_smart_collections", "20261019120000_admin_member_management", "20261021120000_staff_member_records", "20261022120000_member_self_edit", "20261023120000_uppercase_member_names", "20261024120000_sync_member_account_status", "20261025120000_meetings", "20261026120000_club_events", "20261027120000_meetings_discord", "20261028120000_chat_announcements"];

export const versionOf = name => name.split("_")[0];
export const APPLIED_VERSIONS = [...BASE_APPLIED, ...RELEASED.map(versionOf)];

export const migrationPath = name => `supabase/migrations/${name}.sql`;
export const rollbackPath = name => `supabase/rollback/${name}_rollback.sql`;

// Prints UE_RELEASED=true|false: whether the target already holds RELEASED.
// public.admin_revoke_user_sessions(uuid) is created by the last released migration
// (20261017120000). A replica holding only part of RELEASED must be rebuilt or brought up to date.
export const RELEASED_PROBE_SQL = "select 'UE_RELEASED=' || (to_regprocedure('public.admin_revoke_user_sessions(uuid)') is not null)::text as probe;";

// Prints UE_PENDING_PRESENT=true|false: whether PENDING objects already exist (must be false
// before an apply). public.collection_contributions is created by 20261018120000.
export const PENDING_PROBE_SQL = "select 'UE_PENDING_PRESENT=' || (to_regclass('public.collection_contributions') is not null or pg_get_functiondef('public.get_member_private_fields(uuid)'::regprocedure) like '%private.is_admin() and private.account_ok()%')::text as probe;";

export function parseProbe(output, key) {
  const match = String(output).match(new RegExp(`${key}=(true|false)`));
  if (!match) throw new Error(`could not read ${key} from the target: ${String(output).trim().slice(0, 300)}`);
  return match[1] === "true";
}

// Migrations to replay on a target, in order.
export const replayList = releasedPresent => releasedPresent ? [...PENDING] : [...RELEASED, ...PENDING];
