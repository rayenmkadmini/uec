// Static invariants for the Edge Functions (Deno is not installed locally, so
// they are not executed here — see docs/security/PHASE_B_SECURITY_REPORT.md).
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const functionsDir = path.join(root, "supabase", "functions");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
const functionNames = fs.readdirSync(functionsDir).filter(name => name.startsWith("admin-"));
const indexSource = name => read(`supabase/functions/${name}/index.ts`);

test("no Edge Function sets a password derived from member data", () => {
  for (const name of functionNames) {
    const source = indexSource(name);
    for (const match of source.matchAll(/password\s*:\s*([^,}\n]+)/g)) {
      assert.doesNotMatch(match[1], /cin|nom|prenom|login|numero|phone|email/i, `${name}: password: ${match[1].trim()}`);
    }
  }
  assert.match(indexSource("admin-import-users"), /password: generateTemporaryPassword\(\)/);
  assert.match(indexSource("admin-create-user"), /const temporaryPassword = generateTemporaryPassword\(\);/);
});

test("the deprecated dashboard copies (CIN password) are gone from the repository", () => {
  assert.equal(fs.existsSync(path.join(root, "SUPABASE_DASHBOARD_FUNCTIONS")), false);
});

test("import never creates faculties / zones and never uses LIKE patterns", () => {
  const source = indexSource("admin-import-users");
  assert.doesNotMatch(source, /from\("(faculties|zones)"\)\s*\.(insert|upsert)/);
  assert.doesNotMatch(source, /\.i?like\(/);
  assert.match(source, /validateImportBatch\(rows, \{ faculties: faculties\.data, zones: zones\.data \}\)/);
});

test("import validates the whole batch and checks database conflicts before any write", () => {
  const source = indexSource("admin-import-users");
  const firstWrite = Math.min(...["auth.admin.createUser", ".update(", ".insert("].map(s => source.indexOf(s)).filter(i => i >= 0));
  for (const gate of ["if (!batch.ok)", "if (conflicts.length)"]) {
    assert.ok(source.indexOf(gate) > 0 && source.indexOf(gate) < firstWrite, `${gate} must come before the first write`);
  }
});

test("temporary passwords are returned with Cache-Control: no-store and never audited", () => {
  for (const name of ["admin-create-user", "admin-reset-password"]) {
    const source = indexSource(name);
    for (const match of source.matchAll(/temporary_password/g)) {
      const window = source.slice(match.index, match.index + 300);
      assert.match(window, /"Cache-Control": "no-store"/, `${name}: response carrying temporary_password`);
    }
    for (const call of source.matchAll(/audit\(([^;]*)\);/g)) {
      const metadata = (call[1].match(/\{[^{}]*\}\s*$/) || [""])[0];
      assert.doesNotMatch(metadata, /password|cin\b/i, `${name}: audit metadata ${metadata}`);
    }
  }
});

test("password resets go through the Supabase Auth Admin API only", () => {
  const source = indexSource("admin-reset-password");
  assert.match(source, /auth\.admin\.updateUserById\(userId, \{ password \}\)/);
  assert.match(source, /must_change_password: true/);
  for (const name of functionNames) assert.doesNotMatch(indexSource(name), /encrypted_password|\.rpc\("exec|crypt\(/, name);
});

test("every per-function _shared copy of import-utils.mjs matches the canonical file", () => {
  const canonical = read("supabase/functions/_shared/import-utils.mjs");
  for (const name of functionNames) {
    const copy = path.join(functionsDir, name, "_shared", "import-utils.mjs");
    if (fs.existsSync(copy)) assert.equal(fs.readFileSync(copy, "utf8"), canonical, name);
  }
});

test("every admin Edge Function requires SUPERADMIN", () => {
  for (const name of functionNames) assert.match(indexSource(name), /await requireSuperAdmin\(req\)/, name);
});
