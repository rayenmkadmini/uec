# Archived legacy SQL scripts — DO NOT RUN

These scripts predate the versioned migrations in `supabase/migrations/` and
describe a schema that production does not have:

| File | Why archived |
|---|---|
| `payments.sql.txt` | Creates `events.name` and `event_payments.paid boolean`; production uses `events.title` and `event_payments.status` (`payment_status` enum). Also recreates older staff-write policies. |
| `fix_existing_installation.sql.txt` | Same `events.name` definition and older role / RLS assumptions. |

Running either against the production project (`qwlbbfyhjdeekmrxtzjf`) or a
staging copy could recreate wrong columns or weaker policies. They were renamed
to `.sql.txt` (archived 2026-10-15) so they are not picked up by tools or pasted
into the SQL editor by mistake. No script, test or deployment step consumed them.

Schema changes go only through reviewed files in `supabase/migrations/` with
their rollbacks in `supabase/rollback/`.
