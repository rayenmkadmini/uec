# Staff login verification — owner checklist (production)

These steps need a real staff account, so only the account owner can run them.
Never paste a password, link or token in chat, a ticket or this file.

Target: `https://login.ueclubistes.tn`, Supabase project `qwlbbfyhjdeekmrxtzjf`.
Production holds 2 Auth accounts (both SUPERADMIN). ADMIN, TREASURER and MEMBER
behaviour is covered by the local stack (`api-e2e`, `browser-e2e`, `test:rls`).
Do **not** create test accounts or records in production to repeat those tests.

Record each result as PASS / FAIL with the date. On any FAIL, stop and report it.

## 0. Before you start (Dashboard, read-only)

| # | Where | Check |
|---|---|---|
| 0.1 | Authentication → Sign In / Providers | "Allow new users to sign up" is **off**. (Verified from the API on 2026-10-17: `disable_signup: true`.) |
| 0.2 | Authentication → Providers → Email → Password | Minimum length **12**; required: lowercase, uppercase, digits, symbols. |
| 0.3 | Authentication → URL Configuration | Site URL `https://login.ueclubistes.tn`; Redirect URLs contain `https://login.ueclubistes.tn/change-password.html` and nothing broader (no `*`, no other domain). |
| 0.4 | Authentication → Email → OTP expiry | 3600 s (or up to 86400 s for in-person hand-over). |
| 0.5 | Authentication → Multi-Factor | Note whether TOTP is enabled. The app has **no MFA screens today** (see §5). |
| 0.6 | Authentication → Users | Exactly the expected accounts exist; no unknown account. |

## 1. SUPERADMIN login (use a private browser window)

| # | Step | Expected |
|---|---|---|
| 1.1 | Open `https://login.ueclubistes.tn`, sign in with your email and password | Redirect to `dashboard.html` (or to `change-password.html` if the account is flagged) |
| 1.2 | Wrong password once | "Identifiants incorrects ou compte indisponible…"; no detail on which part was wrong |
| 1.3 | Dashboard, Membres, Paiements, Matchs, Gestion des utilisateurs open | Each page loads data; browser console (F12) shows no red errors and no CSP violation |
| 1.4 | Top bar | Your display name and role SUPERADMIN; no "Lecture seule" pill |
| 1.5 | Open a member, then close without saving | Private fields (CIN, phone, address) load for SUPERADMIN only |

Do not create, edit or delete anything for this test unless it is real work.

## 2. Password policy and password change

| # | Step | Expected |
|---|---|---|
| 2.1 | `change-password.html`: try `Short1!` | Refused in the page (12+ characters) |
| 2.2 | Try 14 characters without a symbol | Refused |
| 2.3 | Set a new strong password (from a password manager) | Success; you can sign in with it; the old one is refused |

## 3. Password reset (no email: links are handed over)

Login emails are internal (`@login.ueclubiste.local`), so "forgot password" emails reach nobody.
The supported path is SUPERADMIN → Gestion des utilisateurs → reset → single-use link
(or temporary password), handed over in person.

| # | Step | Expected |
|---|---|---|
| 3.1 | Only when a real reset is needed: generate a link for that user | Link shown once; it opens `https://login.ueclubistes.tn/change-password.html` |
| 3.2 | Open the same link a second time | "Ce lien a expiré ou a déjà été utilisé…" |
| 3.3 | Edit the link to point elsewhere (`redirect_to=https://example.com`) | Supabase ignores the redirect (allow-list) |

After the `audit/2026-10-17-completion` functions are deployed, a reset also ends every
existing session of that account, and the app refuses to reset or delete **another**
SUPERADMIN (`protected_account`). Resetting the other owner's password is then done in the
Supabase Dashboard (Authentication → Users), by the project owner.

## 4. Session expiry, logout and refused access

| # | Step | Expected |
|---|---|---|
| 4.1 | Click "Déconnexion" | Back on `index.html`; the browser Back button does not show data (page redirects to login) |
| 4.2 | Signed out, open `https://login.ueclubistes.tn/dashboard.html` directly | Redirect to `index.html` |
| 4.3 | Signed out, open `payments.html`, `admin-users.html`, `subscribers.html` | Redirect to `index.html` each time |
| 4.4 | Sign in, leave the tab idle more than 1 h, then click a page | Session refreshes silently, or you are sent to login. No page shows data without a session |
| 4.5 | Sign in on two browsers, log out in one | The other keeps its access token until it expires (≤ 1 h), then must sign in again. This is Supabase's design |

## 5. MFA (not available yet)

The site has no MFA enrollment or challenge screens, and the database does not require
`aal2`. Turning MFA on in the Dashboard alone changes nothing for this app.
Adding it is a separate change (frontend enrollment + challenge, then RLS requiring
`aal2` for staff roles, via an approved migration). Until then, protect the two
SUPERADMIN accounts with long unique passwords from a password manager.

## 6. Report back

Send only: the step numbers, PASS/FAIL, the date, and for a FAIL the page and the
visible message (a screenshot without personal data is fine). Never send passwords,
links, tokens or member data.
