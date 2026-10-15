// The CSV template and documentation example are committed to Git and must
// only ever contain synthetic data (incident D1, 2026-10-15). These tests make
// any real-looking personal data fail the suite.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const utilsPromise = import("../supabase/functions/_shared/import-utils.mjs");

function loadCsvUtils() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "js", "csv-utils.js"), "utf8"), context);
  return context.window.UE_CSV;
}

// The import page maps rows with UE_CSV.parseMemberCsv (explicit alias table).
function parseTemplate() {
  const { parseMemberCsv } = loadCsvUtils();
  return JSON.parse(JSON.stringify(parseMemberCsv(fs.readFileSync(path.join(root, "CSV_MEMBRES_TEMPLATE.csv"), "utf8"))));
}

// Faculty names from the repository seed; zone names are synthetic (production
// zone names were not inspected — schema-only backup).
function referenceRows() {
  const seed = fs.readFileSync(path.join(root, "supabase", "faculties_seed.sql"), "utf8");
  const faculties = [...new Set([...seed.matchAll(/'([^']+ — [^']+)'/g)].map(m => m[1]))].map((name, i) => ({ id: `f${i}`, name }));
  const zones = ["ZONE A", "ZONE B", "ZONE C"].map((name, i) => ({ id: `z${i}`, name }));
  return { faculties, zones };
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EIGHT_DIGITS = /(?<![0-9])[0-9]{8}(?![0-9])/g;

function assertOnlySyntheticIdentifiers(text, label) {
  for (const email of text.match(EMAIL) || []) {
    assert.match(email, /@example\.(invalid|com|org)$/i, `${label}: non-example email domain`);
  }
  for (const digits of text.match(EIGHT_DIGITS) || []) {
    assert.match(digits, /^0000000\d$/, `${label}: 8-digit value is not an obvious placeholder`);
  }
}

test("CSV template keeps the 13 Google Forms headers and parses into synthetic rows", () => {
  const { headers, analysis, rows } = parseTemplate();
  assert.equal(headers.length, 13);
  assert.equal(analysis.ok, true);
  assert.equal(analysis.unknown.length, 2, "Google Forms timestamp + collected email address are ignored");
  assert.ok(rows.length >= 1 && rows.length <= 10);

  for (const row of rows) {
    assert.match(row.prenom, /^SYNTHETIC_MEMBER_\d{3}$/);
    assert.equal(row.nom, "TEST");
    assert.match(row.cin, /^0000000\d$/);
    assert.match(row.email, /^test\.member\d{3}@example\.invalid$/);
    assert.match(row.phone, /^\+216 00 000 \d{3}$/);
    assert.match(row.adresse, /Fictive/);
    assert.ok(row.faculty.length > 0 && row.zone.length > 0);
  }
});

test("the whole template passes the server-side batch validation", async () => {
  const { hasRequiredMemberFields, normalizeGender, normalizeOptionalSubscriptionNumber, validateImportBatch } = await utilsPromise;
  const { rows } = parseTemplate();
  const batch = validateImportBatch(rows, referenceRows());
  assert.equal(batch.ok, true, JSON.stringify(batch.errors));
  assert.ok(batch.prepared.every(r => r.faculty_id && r.zone_id));

  for (const row of rows) {
    assert.equal(hasRequiredMemberFields(row), true);
    assert.ok(["MALE", "FEMALE"].includes(normalizeGender(row.gender)));
    assert.equal(normalizeOptionalSubscriptionNumber(row.numero_abonnement).valid, true);
  }
  assert.ok(rows.some(row => !row.numero_abonnement), "template should show an optional empty subscription number");
});

test("committed CSV template and import documentation contain only synthetic identifiers", () => {
  assertOnlySyntheticIdentifiers(fs.readFileSync(path.join(root, "CSV_MEMBRES_TEMPLATE.csv"), "utf8"), "CSV_MEMBRES_TEMPLATE.csv");
  assertOnlySyntheticIdentifiers(fs.readFileSync(path.join(root, "IMPORT_MEMBRES_CSV.md"), "utf8"), "IMPORT_MEMBRES_CSV.md");
});

test("D7: login column header 'Login (FOULENFOULENI)' maps to the login field", () => {
  const { analysis, rows } = parseTemplate();
  assert.equal(analysis.columns.login, "Login (FOULENFOULENI)");
  assert.ok(rows.every(row => /^SYNTHETIC_MEMBER_\d{3}$/.test(row.login)));
});
