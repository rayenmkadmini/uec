// Migrations written locally but NOT yet applied to qwlbbfyhjdeekmrxtzjf, in
// apply order. 20261001194746 and 20261001194845 are already in the remote
// history. Each has a rollback in supabase/rollback/<name>_rollback.sql.
export const PENDING = [
  "20261015120000_role_permissions_repair",
  "20261015140000_member_identity_and_password_hardening"
];

export const migrationPath = name => `supabase/migrations/${name}.sql`;
export const rollbackPath = name => `supabase/rollback/${name}_rollback.sql`;
