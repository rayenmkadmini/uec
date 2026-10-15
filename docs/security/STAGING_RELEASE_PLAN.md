# UE Clubiste — Staging Release Plan

**Status:** Preparation only. No staging project or branch has been created.

## Recommendation

Use a dedicated owner-approved Supabase staging project for the first security
validation. The repository currently has no executable migration history that
can reproduce the selected production schema, so a dashboard branch would not
be sufficient until a schema-only migration path exists.

Supabase documents that persistent branches are isolated environments and are
data-less by default, but their schema is built from repository migrations or
the base project's migration history. See:

- https://supabase.com/docs/guides/platform/branching
- https://supabase.com/pricing

Branching is a possible later option only after the owner confirms plan
availability, isolation, lifecycle, and cost. The published pricing lists
branching at `$0.01344 per branch per hour` and says branching is available on
Pro and above. The organization's current billing plan was not verified.

## Approval required before creation

The owner must approve:

1. Organization `ggctokecqgbnvpsdyngb` for staging use.
2. A dedicated project or persistent branch.
3. Recurring compute/branch cost and any plan upgrade.
4. Synthetic-only test data.
5. No production Auth users, storage objects, or member records copied into
   staging.

## Staging configuration

- Separate project URL and publishable key.
- Separate Auth settings and SMTP/test-email configuration.
- Separate Edge Function secrets.
- No production service-role key in browser code.
- Versioned migrations under `supabase/migrations/`.
- Synthetic Superadmin, Admin, Treasurer, Member-A, Member-B, and anonymous
  test clients.
- Synthetic members, events, payments, matches, zones, and storage objects.
- A cleanup procedure that deletes only synthetic staging data.

## Required staging test order

1. Apply schema-only migrations.
2. Assert tables, columns, constraints, indexes, views, functions, triggers,
   grants, RLS, and storage policies.
3. Seed synthetic identities and records.
4. Deploy the local Edge Function source with JWT verification enabled.
5. Run the role and IDOR matrix through PostgREST and Edge Functions.
6. Run CSV, photo, event, payment, match, password, and print regressions.
7. Capture advisor findings, logs, row counts, and deployed function hashes.
8. Test rollback on a fresh staging copy.

## Current blocker

There is no approved staging environment and no owner authorization to create
one. This plan is therefore **BLOCKED**, not failed.
