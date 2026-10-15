# Field-access matrix (after migrations 120000 + 140000 + 160000 + 180000)

Enforced by the database: RLS for rows, **column privileges** for fields, and
checked `SECURITY DEFINER` RPCs for the few paths that return protected fields.
The UI hides the same fields, but hiding is not the control. Every rule below
has negative tests in `supabase/tests/rls_role_matrix.sql`, and the main ones are
also exercised over HTTP and in a browser against real Supabase services
(`staging-local/tests/`).

**Account state applies to every role.** A role only counts while the account
is active (`profiles.is_active`) and has no pending password change
(`must_change_password = false`). A deactivated or not-yet-re-secured account
can read **only its own profile row**. It can also read its own roles (if
active) and reference data (if active), so the UI can explain its state.
Everything else is denied, even with a still-valid session.

Legend: ✔ allowed · own = own row only · — denied · RPC = only through the named function

## Members (`public.subscribers`)

| Field | SUPERADMIN | ADMIN | TREASURER | MEMBER |
|---|---|---|---|---|
| id, nom, prénom, numero_abonnement, status, card_paid, card_paid_at | ✔ all | ✔ all | via `list_payment_members()` | own |
| user_id (account linked / "Non activé"), login_name | ✔ all | ✔ all | — (is_self flag only) | own |
| faculty, zone, subscription dates, created/updated | ✔ all | ✔ all | faculty name only | own |
| **gender, photo path** | RPC `get_member_private_fields` | — | — | own, RPC |
| **phone, email** | RPC `get_member_private_fields` | — | — | own, RPC |
| **CIN, adresse, date_naissance** | RPC `get_member_private_fields` | — | — | own, RPC |
| notes | — (not used by the app) | — | — | — |
| Write | ✔ (all fields) | — | card status via `set_card_payment_status()`, never own | phone, email, adresse, own photo |

`select *`, filters (`where cin = …`, `phone like …`) and ordering on a
withheld column are refused (`permission denied`). Error messages never contain
values. `v_member_cards` is not readable by any API role.

## Staff / accounts (`public.profiles`, `public.user_roles`)

| Field | SUPERADMIN | ADMIN | TREASURER | MEMBER |
|---|---|---|---|---|
| display_name, nom, prénom, is_active, must_change_password, avatar, created | ✔ all | ✔ all | own | own |
| **email, phone** | RPC `get_account_contacts` (any) | own, RPC | own, RPC | own, RPC |
| roles (`user_roles`) | ✔ all | ✔ all | own | own |
| Write profiles / roles | ✔ (Edge Functions for account changes) | — | — | — (password via Supabase Auth + `complete_password_change()`) |

## Payments, events, audit

| Data | SUPERADMIN | ADMIN | TREASURER | MEMBER |
|---|---|---|---|---|
| events (all columns) | ✔ read/write | read | read | — |
| event_payments / card_payments: id, amounts, status, method, paid_at | ✔ read; write | read | read; status via RPC only, never own | own rows |
| payment **notes, transaction_reference** | — (unused by the app) | — | — | — |
| audit_logs: id, user, action, table, record, old/new data, created | ✔ read | read | — | — |
| audit_logs **ip_address** | — | — | — | — |

Audit rows written by the RPCs and Edge Functions contain flags, statuses, codes
and counts only. They never contain CIN, contact data, passwords or links.

## Matches, seats, references, storage

| Data | SUPERADMIN | ADMIN | TREASURER | MEMBER |
|---|---|---|---|---|
| matches, match_zones, clubs, faculties, zones, site_settings, roles | ✔ read/write | read | read | read |
| seat choices (`match_participations`) | ✔ all | read all; names + zones via `list_match_participants()` (gender empty) | — | own; change via RPC before kick-off |
| `subscriber-photos` bucket | read/write all | — | — | own folder read/write |
| `match-logos` bucket | write | read | read | read |

## Edge Functions

Every function requires an **active SUPERADMIN without a pending password
change** (`requireSuperAdmin`). They run with the service role; their responses
carry codes and line numbers, never member values. Activation links and
temporary passwords are returned once with `Cache-Control: no-store` and are
never logged or audited.

## Exports

The application has **no CSV or file export**. Tests fail if one appears in the
member page (`download`, `Blob(`).

## Decisions to confirm

- Since 180000, ADMIN **no longer** sees member photos or gender (least-privilege default).
  ADMIN keeps faculty, zone, seat choices and card status. The ADMIN role is defined
  with `viewMatches` / supervision duties, and the seat list exposes names, subscription
  numbers and zones only. Any further expansion needs approval.
- TREASURER receives **no contact data**. No payment workflow in the app needs it.
- `notes` (members, payments) and `ip_address` (audit) are now readable by no API
  role, SUPERADMIN included. The app never displayed them.
