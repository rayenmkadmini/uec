// The Vercel project serves every tracked file from the repository root (static site, no build
// step), so anything committed here is public. Incident D1 (2026-10-16): the real member CSV and a
// file with database URLs were downloadable from the production domains. These tests fail the
// suite if a tracked file could leak member data or credentials.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const BINARY = /\.(png|jpe?g|gif|ico|webp|woff2?|ttf|otf|pdf|zip)$/i;

// Files that a deployment of this repository would serve. `git -C <root>` alone is not enough:
// without Git metadata it can resolve to a repository in a parent folder and list nothing.
function servedFiles() {
  try {
    const top = execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    if (path.resolve(top) === path.resolve(root)) {
      return execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
    }
  } catch {}
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (!["node_modules", ".git"].includes(entry.name)) walk(rel); }
      else out.push(rel);
    }
  };
  walk("");
  return out;
}

const FORBIDDEN_NAMES = [
  /(^|\/)[^/]*\.id\)$/,                       // shell-accident files such as "a.id)" (held database URLs)
  /(^|\/)supabaseconfig\.txt$/i,
  /(^|\/)[`{]$/,                              // other stray shell-accident files
  /(^|\/)\.env$/, /(^|\/)\.env\.(?!example$)[^/]+$/,
  /\.(bundle|dump|pgdump|backup|pem|key|p12|pfx)$/i,
  /^(roles|schema|data)\.sql$/, /^platform_objects[^/]*\.sql$/,
  /(^|\/)(uec-backups|backups|\.secrets)\//,
];
const isForbiddenName = (file) => FORBIDDEN_NAMES.some((re) => re.test(file));

const SYNTHETIC_EMAIL_DOMAIN = /@(example\.(invalid|com|org)|test\.invalid|login\.ueclubiste\.local)$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TN_PHONE = /\+216[\s.-]?\d{2}[\s.-]?\d{3}[\s.-]?\d{3}/g;
const EIGHT_DIGITS = /(?<![0-9])[0-9]{8}(?![0-9])/g;

const nonSyntheticEmails = (text) => (text.match(EMAIL) || []).filter((e) => !SYNTHETIC_EMAIL_DOMAIN.test(e));
const nonSyntheticPhones = (text) => (text.match(TN_PHONE) || []).filter((p) => !/^216000000\d{2}$/.test(p.replace(/\D/g, "")));
const nonSyntheticCsvIds = (text) => (text.match(EIGHT_DIGITS) || []).filter((d) => !/^0000000\d$/.test(d));

function secretFindings(text) {
  const found = [];
  for (const m of text.matchAll(/postgres(?:ql)?:\/\/[^:\s/@]+:([^@\s]{3,})@/gi)) {
    if (!/^[[<${%]|^(postgres|password|your-password)$/i.test(m[1])) found.push("Postgres URL with a literal password");
  }
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g)) {
    try {
      const role = JSON.parse(Buffer.from(m[1], "base64url").toString()).role;
      if (role && !["anon", "authenticated"].includes(role)) found.push(`JWT with role ${role}`);
    } catch {}
  }
  if (/\bsb_secret_[A-Za-z0-9_-]{10,}/.test(text)) found.push("Supabase secret key");
  if (/\bsbp_[A-Za-z0-9]{20,}/.test(text)) found.push("Supabase access token");
  if (/\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/.test(text)) found.push("GitHub token");
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) found.push("private key");
  return found;
}

test("detectors catch what they are meant to catch (positive controls)", () => {
  assert.equal(nonSyntheticEmails(`write to ${["someone", "gmail.com"].join("@")}`).length, 1);
  assert.equal(nonSyntheticEmails(`write to ${["test.member001", "example.invalid"].join("@")}`).length, 0);
  assert.equal(nonSyntheticPhones(`call ${"+216 " + "98 765 432"}`).length, 1);
  assert.equal(nonSyntheticPhones(`call ${"+216 " + "00 000 001"}`).length, 0);
  assert.equal(nonSyntheticCsvIds(`x,${"1234" + "5670"},y`).length, 1);
  assert.deepEqual(secretFindings("postgres://postgres:" + "Sample-Pa55word" + "@db.example.supabase.co:5432/postgres"), ["Postgres URL with a literal password"]);
  assert.deepEqual(secretFindings("postgres://postgres:" + "${PGPASS}" + "@db:5432/postgres"), []);
  assert.ok(isForbiddenName("a.id)") && isForbiddenName("docs/x.id)") && isForbiddenName("supabaseconfig.txt"));
  assert.ok(isForbiddenName(".env") && !isForbiddenName(".env.example") && isForbiddenName("backup.bundle"));
});

test("the served file list is the real repository and is not empty", () => {
  const files = servedFiles();
  assert.ok(files.includes("index.html") && files.includes("js/config.js"), "expected the site files");
});

test("no served file has a name known to carry secrets or exported data", () => {
  assert.deepEqual(servedFiles().filter(isForbiddenName), []);
});

test("no served text file contains credentials", () => {
  const problems = [];
  for (const file of servedFiles()) {
    if (BINARY.test(file)) continue;
    for (const finding of secretFindings(fs.readFileSync(path.join(root, file), "utf8"))) problems.push(`${file}: ${finding}`);
  }
  assert.deepEqual(problems, []);
});

test("no served text file contains a real-looking email address or Tunisian phone number", () => {
  const problems = [];
  for (const file of servedFiles()) {
    if (BINARY.test(file)) continue;
    const text = fs.readFileSync(path.join(root, file), "utf8");
    const emails = nonSyntheticEmails(text).length, phones = nonSyntheticPhones(text).length;
    if (emails || phones) problems.push(`${file}: ${emails} email(s), ${phones} phone number(s)`); // counts only, never values
  }
  assert.deepEqual(problems, []);
});

test("every served CSV file contains only synthetic identifiers", () => {
  const problems = [];
  for (const file of servedFiles().filter((f) => /\.csv$/i.test(f))) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    const ids = nonSyntheticCsvIds(text).length, emails = nonSyntheticEmails(text).length, phones = nonSyntheticPhones(text).length;
    if (ids || emails || phones) problems.push(`${file}: ${ids} id(s), ${emails} email(s), ${phones} phone number(s)`);
  }
  assert.deepEqual(problems, []);
});
