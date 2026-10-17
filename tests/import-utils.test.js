const test = require("node:test");
const assert = require("node:assert/strict");

const utilsPromise = import("../supabase/functions/_shared/import-utils.mjs");

test("required member validation accepts empty subscription numbers", async () => {
  const { hasRequiredMemberFields } = await utilsPromise;
  assert.equal(hasRequiredMemberFields({ nom: "TEST", prenom: "USER", cin: "12345678", gender: "M", numero_abonnement: "" }), true);
  assert.equal(hasRequiredMemberFields({ nom: "TEST", prenom: "USER", cin: "", gender: "M" }), false);
});

test("optional subscription number normalizes omitted and blank values to null", async () => {
  const { normalizeOptionalSubscriptionNumber } = await utilsPromise;
  assert.deepEqual(normalizeOptionalSubscriptionNumber(undefined), { valid: true, value: null });
  assert.deepEqual(normalizeOptionalSubscriptionNumber(null), { valid: true, value: null });
  assert.deepEqual(normalizeOptionalSubscriptionNumber("  "), { valid: true, value: null });
  assert.deepEqual(normalizeOptionalSubscriptionNumber(" AB-123 "), { valid: true, value: "AB-123" });
  assert.deepEqual(normalizeOptionalSubscriptionNumber(123), { valid: false, value: null });
});

test("gender normalization accepts French and Arabic values", async () => {
  const { normalizeGender } = await utilsPromise;
  assert.equal(normalizeGender("Féminin"), "FEMALE");
  assert.equal(normalizeGender("Homme"), "MALE");
  assert.equal(normalizeGender("أنثى"), "FEMALE");
  assert.equal(normalizeGender("ذكر"), "MALE");
  assert.equal(normalizeGender("other"), "");
});

test("login base removes accents, spaces, and punctuation", async () => {
  const { buildLoginBase } = await utilsPromise;
  assert.equal(buildLoginBase("Mkád-mini!", "Rayen"), "MKADMINIRAYEN");
  assert.equal(buildLoginBase("علي", "محمد"), "MEMBRE");
});

test("login normalization removes unsupported characters", async () => {
  const { normalizeLogin } = await utilsPromise;
  assert.equal(normalizeLogin("  mkád mini!_2 "), "MKADMINI_2");
});

test("unique login awaits collisions and applies 2, 3 suffixes", async () => {
  const { generateUniqueLogin } = await utilsPromise;
  const checked = [];
  const taken = new Set(["MKADMINIRAYEN", "MKADMINIRAYEN2"]);
  const result = await generateUniqueLogin("MKADMINIRAYEN", async login => {
    checked.push(login);
    return taken.has(login);
  });
  assert.equal(result, "MKADMINIRAYEN3");
  assert.deepEqual(checked, ["MKADMINIRAYEN", "MKADMINIRAYEN2", "MKADMINIRAYEN3"]);
});

const REFERENCES = [
  { id: "f1", name: "FDSP Tunis — Faculté de Droit et des Sciences Politiques de Tunis" },
  { id: "f2", name: "ISET Kebili (Kébili) — Institut Supérieur des Etudes Technologiques de Kebili" },
  { id: "f3", name: "ENIT (Tunis) — Ecole Nationale d'Ingénieurs de Tunis" },
  { id: "z1", name: "Grand Tunis (Nord)" }
];

test("references resolve by full name, short name, long name and short name without (...)", async () => {
  const { buildReferenceIndex, resolveReference } = await utilsPromise;
  const index = buildReferenceIndex(REFERENCES);
  for (const [value, id] of [
    ["FDSP Tunis — Faculté de Droit et des Sciences Politiques de Tunis", "f1"],
    ["fdsp tunis", "f1"],
    ["Faculté de Droit et des Sciences Politiques de Tunis", "f1"],
    ["  faculte de droit et des sciences politiques de tunis ", "f1"],
    ["Iset Kébili", "f2"],
    ["ISET Kebili (Kébili)", "f2"],
    ["Institut Supérieur des Etudes Technologiques de Kebili", "f2"],
    ["ENIT", "f3"],
    ["Grand Tunis", "z1"],
    ["Grand Tunis (Nord)", "z1"]
  ]) assert.deepEqual(resolveReference(index, value), { id }, value);
});

test("reference matching stays exact: partial or approximate names are unknown", async () => {
  const { buildReferenceIndex, resolveReference } = await utilsPromise;
  const index = buildReferenceIndex(REFERENCES);
  for (const value of ["Faculté de Droit de Tunis", "ISET Kebil", "Kébili", "Tunis", "FDSP", "Faculté de Droit et des Sciences Politiques"]) {
    assert.deepEqual(resolveReference(index, value), { error: "unknown" }, value);
  }
  assert.deepEqual(resolveReference(index, ""), { id: null });
});

test("an alias shared by several references is ambiguous, whichever form it comes from", async () => {
  const { buildReferenceIndex, resolveReference } = await utilsPromise;
  const index = buildReferenceIndex([
    { id: "a", name: "ISET Kebili (Kébili) — Institut Supérieur des Etudes Technologiques de Kebili" },
    { id: "b", name: "ISET Kebili — Annexe de Douz" },
    { id: "c", name: "ISSI Gabès — Institut Supérieur des Sciences Infirmières de Gabès" },
    { id: "d", name: "ISSI Gabès — Institut Supérieur des Systèmes Industriels de Gabès" },
    { id: "e", name: "IHEC Carthage — Institut des Hautes Etudes Commerciales de Carthage" },
    { id: "f", name: "IHEC (Sousse) — Institut des Hautes Etudes Commerciales de Carthage" }
  ]);
  assert.deepEqual(resolveReference(index, "ISET Kebili"), { error: "ambiguous" }, "short of b vs short-without-(...) of a");
  assert.deepEqual(resolveReference(index, "ISSI Gabès"), { error: "ambiguous" });
  assert.deepEqual(resolveReference(index, "Institut des Hautes Etudes Commerciales de Carthage"), { error: "ambiguous" }, "same long name");
  assert.deepEqual(resolveReference(index, "ISET Kebili (Kébili)"), { id: "a" });
  assert.deepEqual(resolveReference(index, "Institut Supérieur des Sciences Infirmières de Gabès"), { id: "c" });
});

test("an exact full name wins over another reference's alias", async () => {
  const { buildReferenceIndex, resolveReference } = await utilsPromise;
  const index = buildReferenceIndex([
    { id: "a", name: "ENS" },
    { id: "b", name: "ENS (Tunis) — Ecole Normale Supérieure" }
  ]);
  assert.deepEqual(resolveReference(index, "ENS"), { id: "a" });
  assert.deepEqual(resolveReference(index, "ENS (Tunis)"), { id: "b" });
});

test("suggestions list up to 3 existing reference names, closest first", async () => {
  const { buildReferenceIndex, suggestReferences } = await utilsPromise;
  const index = buildReferenceIndex([
    ...REFERENCES,
    { id: "f4", name: "FDSP Sousse — Faculté de Droit et des Sciences Politiques de Sousse" },
    { id: "f5", name: "FD Sfax — Faculté de Droit de Sfax" },
    { id: "f6", name: "FSJPS Tunis — Faculté des Sciences Juridiques, Politiques et Sociales de Tunis" }
  ]);
  const suggestions = suggestReferences(index, "Faculté de Droit et Sciences Politiques Tunis");
  assert.equal(suggestions.length, 3);
  assert.equal(suggestions[0], "FDSP Tunis — Faculté de Droit et des Sciences Politiques de Tunis");
  assert.ok(suggestions.every(name => index.entries.some(entry => entry.name === name)));
  assert.equal(suggestReferences(index, "Iset Kebilli")[0], "ISET Kebili (Kébili) — Institut Supérieur des Etudes Technologiques de Kebili");
  assert.deepEqual(suggestReferences(index, "zzzz qqqq"), [], "nothing close enough");
  assert.deepEqual(suggestReferences(index, "%"), []);
  assert.equal(suggestReferences(index, "Faculté de Droit", 1).length, 1);
});
