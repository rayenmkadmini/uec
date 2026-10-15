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

// Same aliases as importMembersCsv() in js/subscribers.js.
function mapRow(r, csvField) {
  return {
    email: csvField(r, ["mail", "email", "e-mail", "البريد الإلكتروني", "البريد الالكتروني"]),
    nom: csvField(r, ["nom", "name", "اللقب", "اسم العائلة", "الاسم العائلي"]),
    prenom: csvField(r, ["prenom", "prénom", "first name", "firstname", "الاسم", "الإسم", "الاسم الأول", "الاسم الشخصي"]),
    numero_abonnement: csvField(r, ["numero d abonnement", "numero abonnement", "n abonnement", "numero", "abonnement", "رقم الاشتراك", "رقم المنخرط"]),
    login: csvField(r, ["login", "identifiant", "username", "اسم الدخول"]),
    cin: csvField(r, ["cin", "بطاقة التعريف الوطنية", "رقم بطاقة التعريف"]),
    gender: csvField(r, ["sexe", "gender", "الجنس"]),
    phone: csvField(r, ["telephone", "téléphone", "phone", "tel", "الهاتف", "رقم الهاتف"]),
    adresse: csvField(r, ["address", "adresse", "العنوان"]),
    faculty: csvField(r, ["faculte", "faculté", "faculty", "الكلية", "المؤسسة"]),
    zone: csvField(r, ["zone", "المنطقة"])
  };
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
  const { parseCsv, csvField } = loadCsvUtils();
  const text = fs.readFileSync(path.join(root, "CSV_MEMBRES_TEMPLATE.csv"), "utf8");
  const rows = parseCsv(text);
  assert.equal(Object.keys(rows[0]).length, 13);
  assert.ok(rows.length >= 1 && rows.length <= 10);

  for (const row of rows.map(r => mapRow(r, csvField))) {
    assert.match(row.prenom, /^SYNTHETIC_MEMBER_\d{3}$/);
    assert.equal(row.nom, "TEST");
    assert.match(row.cin, /^0000000\d$/);
    assert.match(row.email, /^test\.member\d{3}@example\.invalid$/);
    assert.match(row.phone, /^\+216 00 000 \d{3}$/);
    assert.match(row.adresse, /Fictive/);
    assert.ok(row.faculty.length > 0 && row.zone.length > 0);
  }
});

test("every template row passes the importer's required-field validation", async () => {
  const { hasRequiredMemberFields, normalizeGender, normalizeOptionalSubscriptionNumber } = await utilsPromise;
  const { parseCsv, csvField } = loadCsvUtils();
  const rows = parseCsv(fs.readFileSync(path.join(root, "CSV_MEMBRES_TEMPLATE.csv"), "utf8")).map(r => mapRow(r, csvField));

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

test("D7: login column header 'Login (FOULENFOULENI)' maps to the login field", { todo: "fixed in Phase B (header normalization)" }, () => {
  const { parseCsv, csvField } = loadCsvUtils();
  const rows = parseCsv(fs.readFileSync(path.join(root, "CSV_MEMBRES_TEMPLATE.csv"), "utf8")).map(r => mapRow(r, csvField));
  assert.ok(rows.every(row => /^SYNTHETIC_MEMBER_\d{3}$/.test(row.login)));
});
