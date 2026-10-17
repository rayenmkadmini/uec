// Migration lists shared by the test runners, the local stack and scripts/apply-migration.mjs.
//
// BASE_APPLIED: in production since 2026-10-01.
// RELEASED:     applied to production on 2026-10-17 (docs/security/DEPLOYMENT_PLAN.md).
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
  "20261016120000_least_privilege_hardening"
];

export const PENDING = [
  "20261017120000_session_revocation_and_grant_tightening"
];

export const versionOf = name => name.split("_")[0];
export const APPLIED_VERSIONS = [...BASE_APPLIED, ...RELEASED.map(versionOf)];

export const migrationPath = name => `supabase/migrations/${name}.sql`;
export const rollbackPath = name => `supabase/rollback/${name}_rollback.sql`;

// Prints UE_RELEASED=true|false: whether the target already holds RELEASED.
// private.account_ok() is created by 20261015160000.
export const RELEASED_PROBE_SQL = "select 'UE_RELEASED=' || (to_regprocedure('private.account_ok()') is not null)::text as probe;";

// Prints UE_PENDING_PRESENT=true|false: whether PENDING objects already exist (must be false
// before an apply). public.admin_revoke_user_sessions(uuid) is created by 20261017120000.
export const PENDING_PROBE_SQL = "select 'UE_PENDING_PRESENT=' || (to_regprocedure('public.admin_revoke_user_sessions(uuid)') is not null)::text as probe;";

export function parseProbe(output, key) {
  const match = String(output).match(new RegExp(`${key}=(true|false)`));
  if (!match) throw new Error(`could not read ${key} from the target: ${String(output).trim().slice(0, 300)}`);
  return match[1] === "true";
}

// Migrations to replay on a target, in order.
export const replayList = releasedPresent => releasedPresent ? [...PENDING] : [...RELEASED, ...PENDING];
