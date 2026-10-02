const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const assert = require("node:assert/strict");

function loadCsvUtils() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "csv-utils.js"), "utf8"), context);
  return context.window.UE_CSV;
}

test("comma CSV handles BOM, accents, quoted commas, and extra form columns", () => {
  const { parseCsv, csvField } = loadCsvUtils();
  const rows = parseCsv('\uFEFFNom,Prénom,CIN,Sexe,Numero d\'abonnement,Login,Google Forms Timestamp\r\n"Mkádmini","Jean, Paul",12345678,M,,TESTUSER,2026-09-30');
  assert.equal(rows.length, 1);
  assert.equal(csvField(rows[0], ["nom", "name"]), "Mkádmini");
  assert.equal(csvField(rows[0], ["prenom", "prénom", "first name"]), "Jean, Paul");
  assert.equal(csvField(rows[0], ["numero d abonnement", "numero abonnement"]), "");
  assert.equal(csvField(rows[0], ["login"]), "TESTUSER");
});

test("semicolon CSV preserves quoted delimiters and newlines", () => {
  const { parseCsv, csvField } = loadCsvUtils();
  const rows = parseCsv('Nom;Prenom;CIN;Sexe;Adresse;Extra\n"El Ghali";Amélie;12345678;F;"Rue 1; étage 2";ignored');
  assert.equal(rows.length, 1);
  assert.equal(csvField(rows[0], ["address", "adresse"]), "Rue 1; étage 2");
  assert.equal(csvField(rows[0], ["extra"]), "ignored");
});

test("Arabic column names normalize and remain readable", () => {
  const { parseCsv, csvField } = loadCsvUtils();
  const rows = parseCsv('اللقب,الاسم,بطاقة التعريف الوطنية,الجنس,رقم الاشتراك\nالعربي,سلمى,12345678,أنثى,');
  assert.equal(csvField(rows[0], ["nom", "اللقب"]), "العربي");
  assert.equal(csvField(rows[0], ["prenom", "الاسم"]), "سلمى");
  assert.equal(csvField(rows[0], ["cin", "بطاقة التعريف الوطنية"]), "12345678");
  assert.equal(csvField(rows[0], ["sexe", "الجنس"]), "أنثى");
  assert.equal(csvField(rows[0], ["numero d abonnement", "رقم الاشتراك"]), "");
});

test("malformed unclosed quoted fields are rejected", () => {
  const { parseCsv } = loadCsvUtils();
  assert.throws(() => parseCsv('Nom,Prenom\n"Mkadmini,Rayen'), /unclosed quoted field/);
});
