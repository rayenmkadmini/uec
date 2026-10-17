# Test report — 2026-10-16

Every result below was produced by a command run on 2026-10-16. Data was synthetic, or
no data at all. "Local schema" means the production schema-only dump. It was confirmed identical to
production on 2026-10-16, with the 5 pending migrations applied on top.

| Check | Command | Result |
|---|---|---|
| Unit / static tests | `npm test` | **113 / 113 passed** (2026-10-17, including `tests/site-headers.test.js`: CSP, anti-framing, pinned scripts with SRI) |
| JS syntax | `npm run check:js` | passed |
| Role / RLS matrix (local schema, rolled back) | `npm run test:rls` | **267 checks, 0 failed** |
| Rollback exactness (policies, functions, ACLs, default ACLs) | `npm run test:rollback` | passed: no data change; nothing left unrestored |
| Full stack API (GoTrue, PostgREST, Storage, 8 Edge Functions) | `node staging-local/tests/api-e2e.mjs` | **145 checks, 0 failed** (anonymous, MEMBER, TREASURER, ADMIN, SUPERADMIN, import, activation, reset, deactivation, seats, storage) |
| Browser workflows on the exact Vercel artifact (headless Edge) | `node staging-local/tests/browser-e2e.mjs` | **66 checks, 0 failed** (2026-10-17, stack rebuilt). The site is served with the exact `vercel.json` headers, and any CSP or SRI violation fails a page. Includes 12 phone-width (390 px) layout checks and a CSP positive control (cross-origin request blocked by `connect-src`) |
| Production transaction rehearsal | `apply-migration.mjs --dry-run` output run on the disposable DB with `COMMIT`→`ROLLBACK` | passed; 2 negative controls (forbidden grant injected) refused as expected |
| Production target guard | `node scripts/apply-migration.mjs --dry-run` | `Target OK: qwlbbfyhjdeekmrxtzjf (login.uec)`; 5 pending |
| Public exposure (production, HEAD only) | `npm run check:public` | **45 / 45 passed** (CSV 403; core pages 200) |
| Public build | `node scripts/build-public.mjs` | 29 files (html, js, css, png); 260 local references, 0 missing |
| Vercel build of the allowlist | preview `dpl_E75UB6wRrWSt4buQQUjKnYgZSkEQ` (`ea30a4f`) build log | `build-public: 26 files published` |
| Anonymous API (production, HEAD with count) | curl with the publishable key | 0 rows on 16 relations; 0 storage objects listable |
| Production Auth / HTTPS (read-only, 2026-10-17) | `/auth/v1/settings`; HTTP → HTTPS; certificate; response headers | Signup **enabled** (owner action); 308 to HTTPS; certificate valid to 2026-12-14; only HSTS sent today (fixed in the release) |
| Dependencies | `npm audit` | 0 vulnerabilities |

Not run, with the reason:

- Lint and type checking: no linter or TypeScript configuration in the project. Deno is not
  installed, so the Edge Functions were not type-checked. They did run in the Edge runtime
  during the e2e suites.
- Hosted gateway (Kong) and production Storage version: no hosted staging project.
- Tests against the production database: not allowed before approval. Only read-only checks were run.
