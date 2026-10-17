// D8: whole-batch import validation, reference resolution and temporary
// passwords (supabase/functions/_shared/import-utils.mjs). Synthetic data only.
const test = require("node:test");
const assert = require("node:assert/strict");

const utilsPromise = import("../supabase/functions/_shared/import-utils.mjs");

const FACULTIES = [
  { id: "f1", name: "FSEG Tunis — Faculté des Sciences Economiques et de Gestion de Tunis" },
  { id: "f2", name: "FST Tunis — Faculté des Sciences de Tunis" },
  { id: "f3", name: "ISG Tunis — Institut Supérieur de Gestion de Tunis" },
  { id: "f4", name: "ISG Tunis — Institut Supérieur de Gestion (annexe)" }
];
const ZONES = [{ id: "z1", name: "ZONE A" }, { id: "z2", name: "ZONE B" }];

const row = (overrides = {}) => ({
  nom: "TEST", prenom: "SYNTHETIC_MEMBER_001", cin: "00000001", gender: "M",
  login: "", numero_abonnement: "", phone: "", email: "", adresse: "", faculty: "", zone: "",
  ...overrides
});

test("a clean batch is accepted and references resolve to existing ids", async () => {
  const { validateImportBatch } = await utilsPromise;
  const result = validateImportBatch([
    row({ line: 2, faculty: "FSEG Tunis — Faculté des Sciences Economiques et de Gestion de Tunis", zone: "zone a" }),
    row({ line: 3, cin: "00000002", prenom: "SYNTHETIC_MEMBER_002", gender: "Femme", faculty: "fst tunis", zone: "ZONE B" })
  ], { faculties: FACULTIES, zones: ZONES });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.prepared.map(r => [r.faculty_id, r.zone_id, r.gender]), [["f1", "z1", "MALE"], ["f2", "z2", "FEMALE"]]);
});

test("unknown faculty or zone is rejected, never created", async () => {
  const { validateImportBatch } = await utilsPromise;
  const result = validateImportBatch([row({ faculty: "Faculté Inexistante", zone: "ZONE Z" })], { faculties: FACULTIES, zones: ZONES });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map(e => [e.field, e.code]), [["faculty", "unknown_reference"], ["zone", "unknown_reference"]]);
});

test("LIKE wildcards are plain text, not patterns", async () => {
  const { validateImportBatch, resolveReference, buildReferenceIndex } = await utilsPromise;
  const index = buildReferenceIndex(FACULTIES);
  for (const value of ["%", "_", "FS%", "%Tunis%"]) assert.deepEqual(resolveReference(index, value), { error: "unknown" }, value);
  assert.equal(validateImportBatch([row({ zone: "%" })], { faculties: FACULTIES, zones: ZONES }).ok, false);
});

test("an ambiguous short faculty name is rejected; the full name works", async () => {
  const { validateImportBatch } = await utilsPromise;
  const ambiguous = validateImportBatch([row({ faculty: "ISG Tunis" })], { faculties: FACULTIES, zones: ZONES });
  assert.deepEqual(ambiguous.errors.map(e => e.code), ["ambiguous_reference"]);
  const full = validateImportBatch([row({ faculty: "ISG Tunis — Institut Supérieur de Gestion (annexe)" })], { faculties: FACULTIES, zones: ZONES });
  assert.equal(full.prepared[0].faculty_id, "f4");
});

test("the official long name and the short name without (...) are accepted", async () => {
  const { validateImportBatch } = await utilsPromise;
  const faculties = [
    ...FACULTIES,
    { id: "f5", name: "FDSP Tunis — Faculté de Droit et des Sciences Politiques de Tunis" },
    { id: "f6", name: "ISET Kebili (Kébili) — Institut Supérieur des Etudes Technologiques de Kebili" }
  ];
  const result = validateImportBatch([
    row({ line: 2, faculty: "Faculté de Droit et des Sciences Politiques de Tunis" }),
    row({ line: 3, cin: "00000002", faculty: "Iset Kébili" }),
    row({ line: 4, cin: "00000003", faculty: "institut superieur de gestion de tunis" })
  ], { faculties, zones: ZONES });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.prepared.map(r => r.faculty_id), ["f5", "f6", "f3"]);
});

test("a long name or (...)-less short name shared by several faculties is ambiguous", async () => {
  const { validateImportBatch } = await utilsPromise;
  const faculties = [
    { id: "a", name: "ISET Kebili (Kébili) — Institut Supérieur des Etudes Technologiques de Kebili" },
    { id: "b", name: "ISET Kebili (Douz) — Institut Supérieur des Etudes Technologiques de Kebili" }
  ];
  const result = validateImportBatch([
    row({ faculty: "ISET Kebili" }),
    row({ cin: "00000002", faculty: "Institut Supérieur des Etudes Technologiques de Kebili" }),
    row({ cin: "00000003", faculty: "ISET Kebili (Douz)" })
  ], { faculties, zones: ZONES });
  assert.deepEqual(result.errors.map(e => [e.line, e.code]), [[2, "ambiguous_reference"], [3, "ambiguous_reference"]]);
  assert.equal(result.prepared[2].faculty_id, "b");
});

test("an unknown faculty error suggests up to 3 existing names, never the submitted value", async () => {
  const { validateImportBatch } = await utilsPromise;
  const result = validateImportBatch([row({ faculty: "Fac Sciences Economiques Gestion Tunis 00000077" })], { faculties: FACULTIES, zones: ZONES });
  const [error] = result.errors;
  assert.equal(error.code, "unknown_reference");
  assert.ok(error.suggestions.length >= 1 && error.suggestions.length <= 3, JSON.stringify(error.suggestions));
  assert.equal(error.suggestions[0], FACULTIES[0].name);
  assert.ok(error.suggestions.every(name => FACULTIES.some(f => f.name === name)));
  assert.match(error.message, /^Ligne 2 — Faculté : inconnue\..* Suggestions : « FSEG Tunis — Faculté des Sciences Economiques et de Gestion de Tunis »/);
  assert.ok(!error.message.includes("00000077"));
  const none = validateImportBatch([row({ faculty: "zzzz" })], { faculties: FACULTIES, zones: ZONES }).errors[0];
  assert.deepEqual(none.suggestions, []);
  assert.doesNotMatch(none.message, /Suggestions/);
});

test("one invalid row invalidates the whole batch", async () => {
  const { validateImportBatch } = await utilsPromise;
  const result = validateImportBatch([row(), row({ cin: "00000002", gender: "X" })], { faculties: FACULTIES, zones: ZONES });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map(e => [e.line, e.field, e.code]), [[3, "gender", "invalid"]]);
});

test("required fields and empty values are reported per line and column", async () => {
  const { validateImportBatch } = await utilsPromise;
  const result = validateImportBatch([row({ nom: " ", prenom: "", cin: "", gender: "" })]);
  assert.deepEqual(result.errors.map(e => e.field).sort(), ["cin", "gender", "nom", "prenom"]);
  assert.ok(result.errors.every(e => e.line === 2));
});

test("duplicate CIN, subscription number and login inside the file are rejected", async () => {
  const { validateImportBatch } = await utilsPromise;
  const result = validateImportBatch([
    row({ cin: "0000000a", numero_abonnement: "TEST-0001", login: "SYNTH_LOGIN" }),
    row({ cin: "0000000A", numero_abonnement: "TEST-0001", login: "synth_login", prenom: "SYNTHETIC_MEMBER_002" })
  ]);
  assert.deepEqual(result.errors.map(e => [e.line, e.field, e.code]), [
    [3, "cin", "duplicate_in_file"], [3, "numero_abonnement", "duplicate_in_file"], [3, "login", "duplicate_in_file"]
  ]);
  assert.match(result.errors[0].message, /ligne 2/);
});

test("batch size, empty batch and malformed input are refused", async () => {
  const { validateImportBatch, MAX_IMPORT_ROWS } = await utilsPromise;
  assert.equal(MAX_IMPORT_ROWS, 500);
  assert.equal(validateImportBatch(Array.from({ length: 501 }, (_, i) => row({ cin: String(i).padStart(8, "0") }))).errors[0].code, "too_many_rows");
  assert.equal(validateImportBatch([]).errors[0].code, "empty");
  assert.equal(validateImportBatch(null).errors[0].code, "empty");
  const weird = validateImportBatch([{ nom: ["TEST"], prenom: { a: 1 }, cin: 1, gender: "M" }]);
  assert.deepEqual(weird.errors.map(e => e.field).sort(), ["nom", "prenom"]);
});

test("CIN accepts letters, digits and hyphens only", async () => {
  const { validateImportBatch } = await utilsPromise;
  for (const cin of ["0000 0001", "000,0001", '00"0001', "00(0001)", "0000.001"]) {
    assert.deepEqual(validateImportBatch([row({ cin })]).errors.map(e => [e.field, e.code]), [["cin", "invalid"]], cin);
  }
  assert.equal(validateImportBatch([row({ cin: "TEST-00001" })]).ok, true);
});

test("invalid email, short login, over-long values and spaces in CIN are refused", async () => {
  const { validateImportBatch } = await utilsPromise;
  const result = validateImportBatch([row({ email: "not-an-email", login: "a!", nom: "X".repeat(101), cin: "0000 0001" })]);
  assert.deepEqual(result.errors.map(e => [e.field, e.code]).sort(), [["cin", "invalid"], ["email", "invalid"], ["login", "invalid"], ["nom", "too_long"]]);
});

test("error messages never echo the submitted values", async () => {
  const { validateImportBatch } = await utilsPromise;
  const secretCin = "00000077";
  const result = validateImportBatch([
    row({ cin: secretCin, email: "bad@@example.invalid", phone: "+216 00 000 077", faculty: "Unknown 00000077" }),
    row({ cin: secretCin })
  ], { faculties: FACULTIES, zones: ZONES });
  assert.equal(result.ok, false);
  const text = JSON.stringify(result.errors);
  for (const value of [secretCin, "bad@@example.invalid", "+216 00 000 077", "Unknown"]) assert.ok(!text.includes(value), value);
});

test("temporary passwords are random, policy-compliant and never derived from member data", async () => {
  const { generateTemporaryPassword } = await utilsPromise;
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    const password = generateTemporaryPassword();
    assert.equal(password.length, 20);
    assert.match(password, /[A-Z]/);
    assert.match(password, /[a-z]/);
    assert.match(password, /[0-9]/);
    assert.match(password, /[^A-Za-z0-9]/);
    assert.doesNotMatch(password, /[O0Il1]/, "ambiguous characters are excluded");
    seen.add(password);
  }
  assert.equal(seen.size, 200);
  assert.throws(() => generateTemporaryPassword(8), /at least 16/);
  assert.equal(generateTemporaryPassword.length, 0, "takes no member data");
});

test("temporary password generator uses the injected CSPRNG with rejection sampling", async () => {
  const { generateTemporaryPassword } = await utilsPromise;
  let calls = 0;
  const fake = bytes => { calls += 1; bytes[0] = calls % 2 ? 255 : 7; return bytes; };
  const password = generateTemporaryPassword(16, fake);
  assert.equal(password.length, 16);
  assert.ok(calls > 16, "biased bytes (255) are rejected and redrawn");
});
