# UE Clubiste — Supabase Dashboard deployment

The canonical Edge Function source is under `supabase/functions/`. The files in
`SUPABASE_DASHBOARD_FUNCTIONS/` are deprecated snapshots and must not be deployed.
The canonical functions share authorization and audit code from their local
`_shared/` modules, so deploy them from the repository with the Supabase CLI or
copy the complete function directory when using an editor.

## 1. Database

In Supabase Dashboard → SQL Editor, run in this order:

1. Do not run the loose historical SQL files against production.
2. Capture the live schema, grants, policies, and function definitions first.
3. Apply only an owner-approved, versioned migration validated in an isolated staging project.

If you already ran older versions, these scripts contain `IF NOT EXISTS`/idempotent changes for the important profile columns.

## 2. First admin

Create the first Auth user in Authentication → Users, then make sure its `public.profiles` row has `role='ADMIN'`, `is_active=true`, and the correct email/display name.

## 3. Secrets

Edge Functions need the server secret already provided by Supabase. Do NOT paste a service-role/secret key into the website. The functions prefer `SUPABASE_SERVICE_ROLE_KEY` and otherwise read `SUPABASE_SECRET_KEYS`.

## 4. Deploy functions from the canonical source

Deploy these functions from `supabase/functions/` one by one with the Supabase CLI after linking the owner-approved project:

- `admin-create-user`
- `admin-create-admin`
- `admin-update-admin`
- `admin-delete-admin`
- `admin-delete-user`
- `admin-reset-password`
- `admin-import-users`

The canonical functions import their matching `_shared` files. Do not deploy the
deprecated standalone copies from `SUPABASE_DASHBOARD_FUNCTIONS/`.

The checked-in `supabase/config.toml` enables platform JWT verification and the
function code independently validates the bearer token and Superadmin role.

## 5. Website

Deploy the static website files from the repository root to `login.ueclubistes.tn`.
`js/config.js` contains only the browser-safe publishable Supabase key. Never
replace it with a secret/service-role key. Confirm the configured project URL
against the approved environment before publishing; this repository currently
contains conflicting documented project identifiers.

## 6. CORS

The functions already allow:

- `https://login.ueclubistes.tn`
- `https://ueclubistes.tn`
- `https://www.ueclubistes.tn`
- local development origins

## 7. Test

1. Run the checks in `docs/security/STAGING_RLS_TEST_PLAN.md` in an owner-approved staging project.
2. Login as ADMIN.
2. Open Administrateurs.
3. Click `Ajouter un administrateur`.
4. Create an admin with a strong password.
5. Log out.
6. Login with the new admin.
7. The first login must redirect to password change.
8. Test activate/deactivate, reset password and delete.

## 8. If you see `Failed to fetch`

Open browser DevTools → Network → the failing `admin-create-admin` request. If there is no request, the function is not deployed under the exact name. If the request returns 401/403/500, read the JSON response or Edge Function logs.
