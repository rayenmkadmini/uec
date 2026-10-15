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

export const MAX_IMPORT_ROWS = 500;

// Exact, accent/case/punctuation-insensitive comparison key for faculty / zone
// names. Never used as a pattern (no LIKE wildcards).
export function referenceKey(raw) {
  return stripMarks(raw)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

// Index of existing reference rows ({ id, name }). Faculty names look like
// "FSEG Tunis — Faculté ..."; the short part before " — " is also accepted
// when it is unique.
export function buildReferenceIndex(rows) {
  const full = new Map();
  const short = new Map();
  for (const row of rows || []) {
    const name = String(row?.name ?? "");
    const fullKey = referenceKey(name);
    if (fullKey) full.set(fullKey, full.has(fullKey) && full.get(fullKey) !== row.id ? null : row.id);
    const dash = name.indexOf(" — ");
    if (dash > 0) {
      const shortKey = referenceKey(name.slice(0, dash));
      if (shortKey) short.set(shortKey, short.has(shortKey) && short.get(shortKey) !== row.id ? null : row.id);
    }
  }
  return { full, short };
}

// { id } (null when the cell is blank) or { error: "unknown" | "ambiguous" }.
// A non-blank value that normalizes to nothing (e.g. "%", "-") is unknown.
export function resolveReference(index, raw) {
  if (!String(raw ?? "").trim()) return { id: null };
  const key = referenceKey(raw);
  if (!key) return { error: "unknown" };
  for (const map of [index.full, index.short]) {
    if (map.has(key)) return map.get(key) ? { id: map.get(key) } : { error: "ambiguous" };
  }
  return { error: "unknown" };
}

const FIELD_LABELS = {
  nom: "Nom", prenom: "Prénom", cin: "CIN", gender: "Sexe", login: "Login", email: "Email",
  numero_abonnement: "N° abonnement", faculty: "Faculté", zone: "Zone", phone: "Téléphone", adresse: "Adresse"
};

const MAX_LENGTHS = { nom: 100, prenom: 100, cin: 32, numero_abonnement: 50, phone: 40, email: 254, adresse: 300 };

// Validates a whole import before anything is written. Error messages name the
// line and the column, never the cell value (CIN, phone… must not be echoed
// into logs or audit rows).
export function validateImportBatch(rows, { faculties = [], zones = [], maxRows = MAX_IMPORT_ROWS } = {}) {
  const errors = [];
  const prepared = [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, errors: [{ line: null, field: null, code: "empty", message: "Aucune ligne à importer." }], prepared };
  }
  if (rows.length > maxRows) {
    return { ok: false, errors: [{ line: null, field: null, code: "too_many_rows", message: `Maximum ${maxRows} lignes par import.` }], prepared };
  }

  const facultyIndex = buildReferenceIndex(faculties);
  const zoneIndex = buildReferenceIndex(zones);
  const seen = { cin: new Map(), numero_abonnement: new Map(), login: new Map() };
  const add = (line, field, code, message) => errors.push({ line, field, code, message: `Ligne ${line} — ${FIELD_LABELS[field] || field} : ${message}` });

  rows.forEach((raw, index) => {
    const row = raw && typeof raw === "object" ? raw : {};
    const line = Number.isInteger(row.line) && row.line > 1 ? row.line : index + 2;
    const text = key => (typeof row[key] === "string" || typeof row[key] === "number") ? String(row[key]).trim() : "";
    const out = {
      line,
      nom: text("nom"),
      prenom: text("prenom"),
      cin: text("cin"),
      gender: normalizeGender(row.gender),
      login: normalizeLogin(row.login),
      numero_abonnement: text("numero_abonnement") || null,
      phone: text("phone") || null,
      email: text("email") || null,
      adresse: text("adresse") || null,
      faculty_id: null,
      zone_id: null
    };

    for (const field of ["nom", "prenom", "cin"]) if (!out[field]) add(line, field, "required", "obligatoire.");
    if (!text("gender")) add(line, "gender", "required", "obligatoire.");
    else if (!out.gender) add(line, "gender", "invalid", "valeur non reconnue (Homme/Femme, M/F).");

    for (const [field, max] of Object.entries(MAX_LENGTHS)) {
      if (out[field] && out[field].length > max) add(line, field, "too_long", `${max} caractères maximum.`);
    }
    if (out.cin && !/^[A-Za-z0-9-]+$/.test(out.cin)) add(line, "cin", "invalid", "lettres, chiffres ou tiret uniquement.");
    if (text("login") && out.login.length < 3) add(line, "login", "invalid", "3 caractères minimum (A-Z, 0-9, _ ou -).");
    if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) add(line, "email", "invalid", "adresse email invalide.");

    for (const [field, index_, target] of [["faculty", facultyIndex, "faculty_id"], ["zone", zoneIndex, "zone_id"]]) {
      const resolved = resolveReference(index_, text(field));
      if (resolved.error === "unknown") add(line, field, "unknown_reference", "inconnue. Créez-la d'abord dans les références ou corrigez le nom.");
      else if (resolved.error === "ambiguous") add(line, field, "ambiguous_reference", "correspond à plusieurs entrées. Utilisez le nom complet.");
      else out[target] = resolved.id;
    }

    for (const field of ["cin", "numero_abonnement", "login"]) {
      const value = field === "cin" ? out.cin.toUpperCase() : out[field];
      if (!value) continue;
      if (seen[field].has(value)) add(line, field, "duplicate_in_file", `déjà utilisé à la ligne ${seen[field].get(value)}.`);
      else seen[field].set(value, line);
    }

    prepared.push(out);
  });

  return { ok: errors.length === 0, errors, prepared };
}

// Random temporary password for Supabase Auth (never derived from member data).
// Unbiased (rejection sampling), and always contains upper, lower, digit and
// special characters so it satisfies the project password policy.
const PASSWORD_SETS = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!#$%&*+-=?@_"];

function randomIndex(max, random) {
  const limit = Math.floor(256 / max) * max;
  for (;;) {
    const byte = random(new Uint8Array(1))[0];
    if (byte < limit) return byte % max;
  }
}

export function generateTemporaryPassword(length = 20, random = bytes => globalThis.crypto.getRandomValues(bytes)) {
  if (!Number.isInteger(length) || length < 16) throw new Error("Temporary passwords must be at least 16 characters.");
  const all = PASSWORD_SETS.join("");
  const chars = PASSWORD_SETS.map(set => set[randomIndex(set.length, random)]);
  while (chars.length < length) chars.push(all[randomIndex(all.length, random)]);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1, random);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
