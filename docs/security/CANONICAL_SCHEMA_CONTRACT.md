# UE Clubiste — Canonical Schema Contract

**Selected project:** `login.uec` (`qwlbbfyhjdeekmrxtzjf`)

**Status:** Production contract documented from read-only inspection. No remote
schema, policy, grant, storage, or function changes were made by this document.

## Current production contract

The selected project currently exposes the legacy contract used by the
deployed Edge Functions:

| Concern | Current selected-project contract | Local compatibility adapter |
|---|---|---|
| Role assignments | `public.user_roles(user_id, role, created_at)` | Reads `role_name` only as a staged-schema fallback |
| Role catalog | `public.roles(role, description, created_at)` | Accepts `role_name` only in a staged-schema fallback |
| Audit/rate-limit source | `public.audit_logs(user_id, action, table_name, record_id, new_data, created_at)` | Falls back to `security_audit_logs` only when the current table contract is unavailable |
| Privileged function authentication | Supabase JWT plus server-side role lookup | Fails closed when both role contracts cannot be read |
| Browser credentials | Publishable/anon key only | No service-role key is permitted in browser code |

The public Data API does not expose every privileged column to an anonymous
caller. A failed anonymous column probe is therefore not treated as proof that
the underlying database column is absent. Exact privileged catalog verification
still requires an approved database catalog connection or Supabase dashboard
access with appropriate read-only privileges.

## Application contract

New code should use the selected project's current `role` and `audit_logs`
contract. The compatibility branch exists only for staging or historical
schemas that expose `role_name` and/or `security_audit_logs`.

Authorization rules:

1. Read the authenticated user from the validated Supabase bearer token.
2. Read the active profile server-side.
3. Read roles from `user_roles` using `role` first, then `role_name` only if the
   first query fails because the column is unavailable.
4. Treat an error in both role queries as authorization-unavailable and deny the
   operation.
5. Never authorize from browser-supplied role values or editable Auth metadata.
6. Write audit records to `audit_logs` first; use `security_audit_logs` only for
   an explicitly verified staged schema.

## Required staging migration decision

Do **not** rename `role` to `role_name` in the selected production project
without an owner-approved staging migration. The current production deployment
already contains seven functions and indexes built around `role`.

Before changing the contract, staging must prove:

- all role assignments are preserved;
- every RLS helper and Edge Function uses the same column;
- role-management writes remain Superadmin-only;
- audit and rate-limit writes remain available;
- old and new application versions can coexist during rollout;
- rollback does not remove roles, users, audit history, or member data.

Until then, the backward-compatible adapter is the safer release-candidate
contract.
