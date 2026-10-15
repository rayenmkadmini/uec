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
  assert.match(lifecycle, /const password = generatePassword\(\);/);
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
  for (const file of ["import-utils.mjs", "member-lifecycle.mjs"]) {
    const canonical = read(`supabase/functions/_shared/${file}`);
    for (const name of functionNames) {
      const copy = path.join(functionsDir, name, "_shared", file);
      assert.ok(fs.existsSync(copy), `${name}/_shared/${file}`);
      assert.equal(fs.readFileSync(copy, "utf8"), canonical, `${name}/_shared/${file}`);
    }
  }
  const security = functionNames.map(name => read(`supabase/functions/${name}/_shared/security.ts`));
  assert.ok(security.every(s => s === security[0]), "per-function security.ts copies are identical");
});

test("every admin Edge Function requires an active, re-secured SUPERADMIN", () => {
  for (const name of functionNames) assert.match(indexSource(name), /await requireSuperAdmin\(req\)/, name);
  for (const file of ["supabase/functions/_shared/security.ts", ...functionNames.map(n => `supabase/functions/${n}/_shared/security.ts`)]) {
    const source = read(file);
    assert.match(source, /select\("id,is_active,must_change_password"\)/, file);
    assert.match(source, /profile\.is_active !== true \|\| profile\.must_change_password !== false \|\| !roles\.has\("SUPERADMIN"\)/, file);
  }
});

test("every Edge Function is registered with JWT verification", () => {
  const config = read("supabase/config.toml");
  for (const name of functionNames) assert.match(config, new RegExp(`\\[functions\\.${name}\\]\\s*\\nverify_jwt = true`), name);
});
