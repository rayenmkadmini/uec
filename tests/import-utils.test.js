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
