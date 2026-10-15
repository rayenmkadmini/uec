# Supabase Auth settings review

Nothing on this page was changed. Production settings were **not** read during
Phase C (no production access). Every value below must be checked in the
Supabase Dashboard (Authentication) by the project owner, first on staging.

## What the repository can and cannot confirm

| Item | From the repository | Needs the Dashboard |
|---|---|---|
| Client auth options | ✔ `js/config.js`: persisted session, auto refresh, `detectSessionInUrl` (needed for activation links), implicit flow | — |
| Password rules in the UI | ✔ 12+ characters with upper, lower, digit and symbol (`change-password.js`, `subscriber.js`) | — |
| Password rules on SUPERADMIN-chosen passwords | ✔ `validateStrongPassword` in the Edge Functions | — |
| **Server-side minimum length / character rules** | ✘ `supabase/config.toml` has no `[auth]` section | Required |
| Public sign-up | ✘ | Required |
| Site URL, redirect allow-list | ✘ | Required |
| Email OTP / link expiry | ✘ | Required |
| Secure password change (reauthentication) | ✘ | Required |
| Leaked-password protection | ✘ | Required (plan-dependent) |
| Auth rate limits, CAPTCHA, MFA | ✘ | Required |

Because the server-side password policy is unknown, a user could call the Auth
API directly and set a password weaker than the UI allows.
`complete_password_change()` can verify that the password **changed**, not how
strong it is. The Dashboard minimum is therefore the real control.

## Recommendations (verify, then enable on staging first)

| Setting (Dashboard → Authentication) | Recommendation | Compatibility notes |
|---|---|---|
| **Allow new users to sign up** | **Off.** Accounts are created only by SUPERADMIN Edge Functions. | The app has no sign-up page. If it is on, anyone with the public key can create an account. That account gets the MEMBER role, though with no member record and no data. |
| Minimum password length | **12** | Matches the UI and Edge Functions. Existing shorter passwords keep working until changed. |
| Password requirements | Lowercase, uppercase, digits **and symbols** | Matches the UI rule; the generated temporary passwords comply. |
| Site URL / Redirect URLs | Site URL = production site; allow-list = `https://<site>/change-password.html` (and the staging equivalent) | Required for activation links. The Edge secret `PUBLIC_SITE_URL` must use the same origin. |
| Email OTP expiration (also governs recovery links) | **3600 s** (1 h) if links are sent remotely; up to 86400 s (24 h) if handed over in person | Expired links show "Ce lien a expiré…" and the SUPERADMIN issues a new one. |
| Secure password change | **On**, after testing | It requires a recent sign-in to change a password. Activation links and first login count as recent. A member changing their password long after signing in will be asked to sign in again: re-authentication by email cannot work, because login emails are internal (`@login.ueclubiste.local`). |
| Leaked-password protection | Enable **only if included in the current plan** | No paid upgrade without approval. |
| Rate limits (sign-in, verify, token refresh) | Keep the defaults or tighten sign-in per IP | Edge Functions also rate-limit admin actions (`audit_logs` counts). |
| CAPTCHA on sign-in | Optional (Turnstile / hCaptcha) | Requires a frontend change. |
| MFA (TOTP) for SUPERADMIN | Recommended | Requires a frontend change, as a separate task. |
| JWT expiry | Default (3600 s) is acceptable | Deactivation no longer depends on token expiry: the database checks account state on every request. |

## Recovery flows in this project

- **Members and staff never receive email**: Auth emails are internal
  (`<login>@login.ueclubiste.local`). Supabase invitations, "forgot password"
  emails and email re-authentication therefore do not reach anyone.
- Supported, no-email path: a SUPERADMIN generates a **single-use recovery link**
  (`auth.admin.generateLink`, type `recovery`) or, as a fallback, a **temporary
  password**. Either is shown once and handed over through a trusted channel. The
  account is flagged; the database grants no data access until the user sets
  their own password, and it verifies that the password changed. Temporary
  passwords expire after 7 days (`private.password_change_marks.expires_at`).
- Sending links by email or SMS would need verified contact data and custom SMTP
  or an SMS provider. Supabase's built-in SMTP sends only to project team members
  and is rate-limited. That is a separate decision.

## Account deactivation and Auth bans

Deactivation (`profiles.is_active = false`) takes effect **immediately** in the
database for every request, including with an already-issued token. Banning the
Auth user (`auth.admin.updateUserById(id, { ban_duration })`) would also stop new
sign-ins and token refreshes, but:

- tokens already issued stay valid until they expire (bans are not checked by
  PostgREST), so a ban alone is not sufficient;
- a ban must be lifted explicitly on reactivation (`ban_duration: "none"`), or
  the user stays locked out.

Recommendation: keep the database check as the control. Optionally add ban /
unban to `admin-update-admin` later, as defense in depth that also blocks sign-in.
