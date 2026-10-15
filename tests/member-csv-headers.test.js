// D7: member CSV headers are mapped through one explicit alias table
// (js/csv-utils.js MEMBER_CSV_FIELDS). Only synthetic values are used here.
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

const csv = loadCsvUtils();
// Objects created inside the vm context have foreign prototypes; compare plain copies.
const plain = value => JSON.parse(JSON.stringify(value));
const parseMemberCsv = text => plain(csv.parseMemberCsv(text));
const analyzeMemberHeaders = headers => plain(csv.analyzeMemberHeaders(headers));
const { normalizeCsvHeader } = csv;

test("login header variants map to the login field", () => {
  for (const header of ["Login", "login", "LOGIN", "Login (FOULENFOULENI)", "Login (FOULENFOULENI) ", " Login [optionnel]", "Identifiant", "Username", "Nom d'utilisateur", "اسم الدخول"]) {
    assert.equal(analyzeMemberHeaders(["Nom", "Prenom", "CIN", "Sexe", header]).columns.login, header, JSON.stringify(header));
  }
});

test("parenthetical hints are ignored in every header", () => {
  assert.equal(normalizeCsvHeader("Login (FOULENFOULENI)"), "login");
  assert.equal(normalizeCsvHeader("N° abonnement (optionnel)"), "nabonnement");
  assert.equal(normalizeCsvHeader("Téléphone [+216]"), "telephone");
  const { columns } = analyzeMemberHeaders(["Nom (famille)", "Prénom (usage)", "CIN (8 chiffres)", "Sexe (H/F)"]);
  assert.deepEqual(Object.keys(columns).sort(), ["cin", "gender", "nom", "prenom"]);
});

test("UTF-8 BOM on the first header does not hide the column", () => {
  const { analysis, rows } = parseMemberCsv("﻿Login (FOULENFOULENI),Nom,Prenom,CIN,Sexe\r\nTESTLOGIN,TEST,SYNTHETIC_MEMBER_001,00000001,M\r\n");
  assert.equal(analysis.ok, true);
  assert.equal(rows[0].login, "TESTLOGIN");
});

test("missing required headers are reported and make the file invalid", () => {
  const { analysis } = parseMemberCsv("Nom,Prenom,Sexe\nTEST,SYNTHETIC_MEMBER_001,M\n");
  assert.equal(analysis.ok, false);
  assert.deepEqual(analysis.missing, ["cin"]);
  assert.deepEqual(analyzeMemberHeaders([]).missing, ["nom", "prenom", "cin", "gender"]);
});

test("two columns for the same field are refused instead of guessing", () => {
  const exact = analyzeMemberHeaders(["Nom", "Prenom", "CIN", "Sexe", "Login", "Login"]);
  assert.equal(exact.ok, false);
  assert.deepEqual(exact.duplicates, [{ field: "login", headers: ["Login", "Login"] }]);

  const aliases = analyzeMemberHeaders(["Nom", "Prenom", "CIN", "Sexe", "Email", "Mail"]);
  assert.equal(aliases.ok, false);
  assert.equal(aliases.duplicates[0].field, "email");
});

test("empty cells stay empty strings; absent optional columns are empty", () => {
  const { analysis, rows } = parseMemberCsv("Nom;Prenom;CIN;Sexe;Login (FOULENFOULENI)\nTEST;;00000001;F;\n");
  assert.equal(analysis.ok, true);
  assert.equal(rows[0].prenom, "");
  assert.equal(rows[0].login, "");
  assert.equal(rows[0].zone, "");
  assert.equal(rows[0].line, 2);
});

test("unknown columns (e.g. Google Forms timestamp) are listed and ignored", () => {
  const { analysis } = parseMemberCsv("Horodateur,Nom,Prenom,CIN,Sexe,Commentaire\nx,TEST,SYNTHETIC_MEMBER_001,00000001,M,y\n");
  assert.equal(analysis.ok, true);
  assert.deepEqual(analysis.unknown, ["Horodateur", "Commentaire"]);
});

test("rows keep their file row number for error messages", () => {
  const { rows } = parseMemberCsv("Nom,Prenom,CIN,Sexe\nTEST,A,00000001,M\nTEST,B,00000002,F\n");
  assert.deepEqual(rows.map(r => r.line), [2, 3]);
});
