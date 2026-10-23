// Static invariants for the Edge Functions. Deno is not installed locally, so the
// handlers are not executed; their shared logic (_shared/member-lifecycle.mjs,
// _shared/import-utils.mjs) is exercised by tests/member-lifecycle.test.js and
// tests/import-validation.test.js.
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const functionsDir = path.join(root, "supabase", "functions");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
const functionNames = fs.readdirSync(functionsDir).filter(name => name.startsWith("admin-"));
const indexSource = name => read(`supabase/functions/${name}/index.ts`);
const lifecycle = read("supabase/functions/_shared/member-lifecycle.mjs");

function functionBody(source, name) {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, name);
  const rest = source.slice(start + 10);
  const next = rest.search(/\n(export |async function |function |const |\/\/ -{10})/);
  return source.slice(start, next < 0 ? undefined : start + 10 + next);
}

test("no Edge Function or shared module sets a password derived from member data", () => {
  const sources = [...functionNames.map(indexSource), lifecycle];
  for (const source of sources) {
    for (const match of source.matchAll(/password\s*:\s*([^,}\n]+)/g)) {
      assert.doesNotMatch(match[1], /cin|nom|prenom|login|numero|phone|email/i, `password: ${match[1].trim()}`);
    }
  }
  // Random, unless the staff typed an initial password (bulk activation, change forced at first login).
  assert.match(lifecycle, /const password = method === "initial_password" \? String\(initialPassword\) : generatePassword\(\);/);
  assert.match(lifecycle, /generatePassword = generateTemporaryPassword/);
});

test("the deprecated dashboard copies (CIN password) are gone from the repository", () => {
  assert.equal(fs.existsSync(path.join(root, "SUPABASE_DASHBOARD_FUNCTIONS")), false);
});

test("import creates records only: no Auth calls, no faculty/zone writes, no LIKE patterns", () => {
  const body = functionBody(lifecycle, "importMembers");
  assert.doesNotMatch(body, /auth\.|createUser|generateLink|updateUserById/);
  assert.doesNotMatch(body, /from\("(faculties|zones)"\)\s*\.(insert|upsert|update)/);
  assert.doesNotMatch(body, /\.i?like\(/);
  assert.match(body, /user_id: null/);
  const index = indexSource("admin-import-users");
  assert.match(index, /importMembers\(ctx\.admin, rows\)/);
  assert.doesNotMatch(index, /createUser|\.insert\(|\.update\(/);
});

test("import validates the whole batch and database conflicts before any write", () => {
  const body = functionBody(lifecycle, "importMembers");
  const firstWrite = Math.min(...[".update(", ".insert("].map(s => body.indexOf(s)).filter(i => i >= 0));
  for (const gate of ["if (!batch.ok)", "if (conflicts.length)"]) {
    assert.ok(body.indexOf(gate) > 0 && body.indexOf(gate) < firstWrite, `${gate} must come before the first write`);
  }
});

test("responses that can carry a link or password are no-store; audits never carry them", () => {
  for (const name of ["admin-activate-member", "admin-create-user", "admin-reset-password"]) {
    const source = indexSource(name);
    for (const match of source.matchAll(/new Response\(JSON\.stringify\(/g)) {
      assert.match(source.slice(match.index, match.index + 300), /"Cache-Control": "no-store"/, name);
    }
    for (const call of source.matchAll(/audit\(([\s\S]*?)\);/g)) {
      const metadata = (call[1].match(/\{[^{}]*\}\s*$/) || [""])[0];
      assert.doesNotMatch(metadata, /password|activation_link|temporary|cin\b|email|phone/i, `${name}: audit metadata ${metadata}`);
    }
    assert.doesNotMatch(source, /console\.(log|info|debug)\(/, `${name} must not log`);
  }
});

test("access is issued through supported Supabase Auth Admin API methods only", () => {
  assert.match(lifecycle, /auth\.generateLink\(\{ type: "recovery", email, options: \{ redirectTo \} \}\)/);
  assert.match(lifecycle, /auth\.updateUserById\(userId, \{ password \}\)/);
  for (const source of [...functionNames.map(indexSource), lifecycle]) {
    assert.doesNotMatch(source, /encrypted_password|\.rpc\("exec|crypt\(/);
  }
});

test("access issuing never reactivates a deactivated account", () => {
  const helper = lifecycle.slice(lifecycle.indexOf("async function setMustChange"), lifecycle.indexOf("async function recoveryLink"));
  assert.doesNotMatch(helper, /is_active/);
});

test("every per-function _shared copy matches the canonical modules", () => {
  // The per-function copies are what gets deployed; the canonical files are what
  // reviews and unit tests read. They must be byte-identical.
  for (const file of ["import-utils.mjs", "member-lifecycle.mjs", "security.ts", "roles.ts"]) {
    const canonical = read(`supabase/functions/_shared/${file}`);
    for (const name of functionNames) {
      const copy = path.join(functionsDir, name, "_shared", file);
      assert.ok(fs.existsSync(copy), `${name}/_shared/${file}`);
      assert.equal(fs.readFileSync(copy, "utf8"), canonical, `${name}/_shared/${file}`);
    }
  }
});

test("handlers never send raw exception or database error text to the caller", () => {
  for (const name of functionNames) {
    const source = indexSource(name);
    assert.doesNotMatch(source, /error:\s*e instanceof Error \? e\.message/, `${name}: raw exception text in a response`);
    assert.doesNotMatch(source, /json\(req,\s*\{\s*error:\s*\w*[eE]rror\??\.message/, `${name}: raw database/Auth error text in a response`);
    assert.match(source, /return errorResponse\(req, "[a-z-]+", e\);/, `${name}: catch-all must use errorResponse`);
    assert.doesNotMatch(source, /await req\.json\(\)/, `${name}: body must be read with readJson (400 on malformed JSON)`);
  }
  const security = read("supabase/functions/_shared/security.ts");
  const handler = security.slice(security.indexOf("export function errorResponse"), security.indexOf("export function failureCode"));
  assert.match(handler, /console\.error/, "unexpected errors are logged for project owners");
  assert.doesNotMatch(handler.split("console.error")[1], /e\.message\s*}/, "the caller gets a fixed message");
});

test("destructive staff functions are rate-limited and protect other SUPERADMIN accounts", () => {
  for (const name of ["admin-delete-admin", "admin-delete-user", "admin-update-admin", "admin-reset-password"]) {
    assert.match(indexSource(name), /await rateLimit\(ctx\.admin, ctx\.caller\.id, "[A-Z_]+", \d+, \d+\)/, name);
  }
  assert.match(indexSource("admin-delete-admin"), /roles\.has\("SUPERADMIN"\)\)\s*\{\s*return json\(req, \{[^}]*protected_account[^}]*\}, 403\)/);
  assert.match(indexSource("admin-reset-password"), /callerId: ctx\.caller\.id/);
  assert.match(lifecycle, /protected_account/);
  const security = read("supabase/functions/_shared/security.ts");
  assert.match(security, /new HttpError\(429, "rate_limited"/, "rate limit answers 429");
  assert.match(security, /"Vary": "Origin",/, "Vary: Origin on every response");
});

test("role replacement adds before it removes (never leaves an account without roles)", () => {
  const roles = read("supabase/functions/_shared/roles.ts");
  const body = roles.slice(roles.indexOf("export async function replaceRoles"));
  assert.ok(body.indexOf(".upsert(") > 0 && body.indexOf(".upsert(") < body.indexOf(".delete()"), "upsert precedes delete");
  assert.match(body, /\.not\("role", "in"/, "only roles no longer wanted are deleted");
});

// Member management (create / activate / delete ONE member) is open to ADMIN since
// 20261019120000; CSV import, password resets and staff accounts stay SUPERADMIN-only.
const MEMBER_MANAGER_FUNCTIONS = ["admin-create-user", "admin-activate-member", "admin-delete-user"];

test("every admin Edge Function requires an active, re-secured SUPERADMIN (or ADMIN for member management)", () => {
  for (const name of functionNames) {
    const expected = MEMBER_MANAGER_FUNCTIONS.includes(name) ? /await requireMemberManager\(req\)/ : /await requireSuperAdmin\(req\)/;
    assert.match(indexSource(name), expected, name);
  }
  for (const file of ["supabase/functions/_shared/security.ts", ...functionNames.map(n => `supabase/functions/${n}/_shared/security.ts`)]) {
    const source = read(file);
    assert.match(source, /select\("id,is_active,must_change_password"\)/, file);
    assert.match(source, /profile\.is_active !== true \|\| profile\.must_change_password !== false \|\| !allowed\.some\(\(role\) => roles\.has\(role\)\)/, file);
    assert.match(source, /requireSuperAdmin\(req: Request\) \{\s*return requireRoles\(req, \["SUPERADMIN"\]\);/, file);
    assert.match(source, /requireMemberManager\(req: Request\) \{\s*return requireRoles\(req, \["SUPERADMIN", "ADMIN"\]\);/, file);
  }
});

test("every Edge Function is registered with JWT verification", () => {
  const config = read("supabase/config.toml");
  for (const name of functionNames) assert.match(config, new RegExp(`\\[functions\\.${name}\\]\\s*\\nverify_jwt = true`), name);
});

test("every remote import in the Edge Functions is pinned to an exact version", () => {
  const sources = [];
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|mjs|js)$/.test(e.name)) sources.push(p);
    }
  };
  walk(functionsDir);
  let specs = 0;
  for (const file of sources) {
    const source = fs.readFileSync(file, "utf8");
    for (const [, spec] of source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']((?:npm|jsr|https?):[^"']+)["']/g)) {
      specs++;
      assert.match(spec, /@\d+\.\d+\.\d+(\/[^@]*)?$/, `${path.relative(functionsDir, file)}: ${spec}`);
    }
  }
  assert.ok(specs > 0, "no remote import found: the scan is broken");
});

test("audit rows of failed calls hold codes, never raw error text (ADMIN can read audit_logs.new_data)", () => {
  for (const name of functionNames) {
    for (const [call] of indexSource(name).matchAll(/audit\([^;]*\);/g)) {
      assert.doesNotMatch(call, /String\((e|err|error)\)|\b(e|err|error)\.message\b|\berror\s*:\s*(e|err|error)\b|\.stack\b/, `${name}: ${call}`);
    }
  }
});

test("CORS allows exactly the expected origins and never a wildcard", () => {
  for (const name of functionNames) {
    const security = read(`supabase/functions/${name}/_shared/security.ts`);
    const list = security.match(/allowedOrigins = new Set\(\[([^\]]*)\]\)/);
    assert.ok(list, name);
    const origins = [...list[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
    for (const origin of ["https://login.ueclubistes.tn", "https://www.login.ueclubistes.tn", "https://uec-five.vercel.app"]) {
      assert.ok(origins.includes(origin), `${name}: ${origin}`);
    }
    assert.ok(origins.every(o => /^https?:\/\/[a-z0-9.-]+(:\d+)?$/.test(o)), `${name}: ${origins.join(", ")}`);
    assert.doesNotMatch(security, /Access-Control-Allow-Origin"?\s*:\s*"\*"/, name);
  }
});

