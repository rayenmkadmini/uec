const stripMarks = value => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "");

export function normalizeGender(raw) {
  const value = stripMarks(raw)
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .trim()
    .toLowerCase();

  if (["f", "female", "femme", "feminin", "woman", "women", "انثى", "انثا"].includes(value)) return "FEMALE";
  if (["m", "male", "homme", "masculin", "man", "men", "ذكر"].includes(value)) return "MALE";
  return "";
}

export function normalizeLogin(raw) {
  return stripMarks(raw)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 40);
}

export function buildLoginBase(nom, prenom) {
  const base = `${stripMarks(nom)}${stripMarks(prenom)}`
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 40);
  return base || "MEMBRE";
}

export function hasRequiredMemberFields(row) {
  return Boolean(
    String(row?.nom ?? "").trim() &&
    String(row?.prenom ?? "").trim() &&
    String(row?.cin ?? "").trim() &&
    normalizeGender(row?.gender)
  );
}

export function normalizeOptionalSubscriptionNumber(raw) {
  if (raw == null) return { valid: true, value: null };
  if (typeof raw !== "string") return { valid: false, value: null };
  return { valid: true, value: raw.trim() || null };
}

export async function generateUniqueLogin(base, isTaken) {
  let normalizedBase = normalizeLogin(base) || "MEMBRE";
  if (normalizedBase.length < 3) normalizedBase = normalizedBase.padEnd(3, "0");
  for (let suffix = 1; suffix <= 999999; suffix += 1) {
    const suffixText = suffix === 1 ? "" : String(suffix);
    const candidate = `${normalizedBase.slice(0, 40 - suffixText.length)}${suffixText}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new Error("Impossible de générer un identifiant disponible.");
}
