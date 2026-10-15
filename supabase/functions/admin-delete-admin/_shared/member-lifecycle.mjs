// Member import and account activation, shared by the Edge Functions and
// tested in Node with a fake client (tests/helpers/fake-supabase.js).
//
// Lifecycle:
//   import      -> member records only (user_id null = "not activated"); no Auth
//                  identities are created in bulk.
//   activation  -> per member, by a SUPERADMIN: an Auth account is created with a
//                  random password nobody knows, then access is issued as either
//                    - "link": a single-use, expiring Supabase recovery link
//                      (auth.admin.generateLink) that opens change-password.html, or
//                    - "temporary_password": a random temporary password (fallback).
//                  The secret is returned once to the caller and never stored or
//                  logged. If any step fails, everything created is rolled back.
//   first login -> the member must set their own password; the database verifies
//                  the change (complete_password_change).
// Functions return { status, body }. Bodies never contain CIN, phone, email or
// other cell values — only line numbers, codes and counts.
import { buildLoginBase, generateTemporaryPassword, generateUniqueLogin, validateImportBatch } from "./import-utils.mjs";

export const LOGIN_EMAIL_DOMAIN = "login.ueclubiste.local";
export const ACCESS_METHODS = ["link", "temporary_password"];
const LOGIN_RE = /^[A-Z0-9_-]{3,40}$/;

export const loginEmail = login => `${String(login).toLowerCase()}@${LOGIN_EMAIL_DOMAIN}`;

// Redirect target for recovery links. Only https origins (or local development)
// are accepted; it must also be in the project's Auth redirect allow-list.
export function activationRedirect(siteUrl) {
  if (!siteUrl) return null;
  let url;
  try { url = new URL(siteUrl); } catch { return null; }
  const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) return null;
  return `${url.origin}/change-password.html`;
}

const fail = (status, code, message, extra = {}) => ({ status, body: { ok: false, code, error: message, ...extra } });

async function selectIn(db, column, values) {
  const out = [];
  for (let i = 0; i < values.length; i += 100) {
    const { data, error } = await db.from("subscribers").select("id,user_id,login_name,cin,numero_abonnement").in(column, values.slice(i, i + 100));
    if (error) throw new Error("Vérification des membres existants impossible.");
    out.push(...(data || []));
  }
  return out;
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) if (row[key]) map.set(row[key], [...(map.get(row[key]) || []), row]);
  return map;
}

const unique = values => [...new Set(values.filter(Boolean))];

// ------------------------------------------------------------------
// Import (records only)
// ------------------------------------------------------------------
export async function importMembers(db, rows) {
  const [faculties, zones] = await Promise.all([
    db.from("faculties").select("id,name"),
    db.from("zones").select("id,name")
  ]);
  if (faculties.error || zones.error) return fail(503, "references_unavailable", "Références (facultés / zones) indisponibles.");

  const batch = validateImportBatch(rows, { faculties: faculties.data, zones: zones.data });
  if (!batch.ok) {
    return fail(400, "validation", "Import refusé : corrigez les erreurs puis réimportez le fichier. Aucune donnée n’a été modifiée.",
      { errors: batch.errors.slice(0, 200), error_count: batch.errors.length });
  }

  const prepared = batch.prepared;
  const byCin = groupBy(await selectIn(db, "cin", unique(prepared.map(r => r.cin))), "cin");
  const byNumber = groupBy(await selectIn(db, "numero_abonnement", unique(prepared.map(r => r.numero_abonnement))), "numero_abonnement");
  const byLogin = groupBy(await selectIn(db, "login_name", unique(prepared.map(r => r.login || null))), "login_name");

  const conflicts = [];
  const conflict = (line, field, code, message) => conflicts.push({ line, field, code, message: `Ligne ${line} — ${message}` });
  const plan = prepared.map(row => {
    const cinMatches = byCin.get(row.cin) || [];
    const numberMatches = row.numero_abonnement ? byNumber.get(row.numero_abonnement) || [] : [];
    if (cinMatches.length > 1) conflict(row.line, "cin", "duplicate_in_database", "plusieurs membres ont déjà ce CIN. Vérification manuelle nécessaire.");
    if (numberMatches.length > 1) conflict(row.line, "numero_abonnement", "duplicate_in_database", "plusieurs membres ont déjà ce N° d’abonnement. Vérification manuelle nécessaire.");
    const a = cinMatches[0] || null;
    const b = numberMatches[0] || null;
    if (a && b && a.id !== b.id) conflict(row.line, "numero_abonnement", "conflict", "le CIN et le N° d’abonnement correspondent à deux membres différents.");
    if (!a && b && b.cin && b.cin !== row.cin) conflict(row.line, "numero_abonnement", "conflict", "ce N° d’abonnement appartient à un membre dont le CIN est différent.");
    const existing = a || b;
    if (!existing && row.login && byLogin.has(row.login)) conflict(row.line, "login", "taken", "ce login est déjà utilisé par un autre membre.");
    return { row, existing };
  });
  if (conflicts.length) {
    return fail(409, "conflicts", "Import refusé : conflits avec des membres existants. Aucune donnée n’a été modifiée.",
      { errors: conflicts.slice(0, 200), error_count: conflicts.length });
  }

  // Writes. Each row is independent; a failure is reported for that line only.
  const reserved = new Set(prepared.map(r => r.login).filter(Boolean));
  const results = [];
  for (const { row, existing } of plan) {
    try {
      if (existing) {
        const update = { nom: row.nom, prenom: row.prenom, cin: row.cin, gender: row.gender,
          numero_abonnement: row.numero_abonnement || existing.numero_abonnement || null };
        for (const key of ["phone", "email", "adresse", "faculty_id", "zone_id"]) if (row[key]) update[key] = row[key];
        const { error } = await db.from("subscribers").update(update).eq("id", existing.id);
        if (error) throw new Error("update_failed");
        results.push({ line: row.line, status: "updated", activated: Boolean(existing.user_id) });
        continue;
      }
      const login = row.login || await generateUniqueLogin(buildLoginBase(row.nom, row.prenom), async candidate => {
        if (reserved.has(candidate)) return true;
        const { data, error } = await db.from("subscribers").select("id").eq("login_name", candidate).limit(1).maybeSingle();
        if (error) throw new Error("login_check_failed");
        return Boolean(data);
      });
      reserved.add(login);
      const insert = await db.from("subscribers").insert({
        user_id: null, nom: row.nom, prenom: row.prenom, login_name: login, numero_abonnement: row.numero_abonnement,
        cin: row.cin, gender: row.gender, phone: row.phone, email: row.email, adresse: row.adresse,
        faculty_id: row.faculty_id, zone_id: row.zone_id, status: "ACTIVE"
      }).select("id").single();
      if (insert.error || !insert.data) throw new Error("insert_failed");
      results.push({ line: row.line, status: "created", activated: false });
    } catch (e) {
      const code = e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : "unexpected";
      results.push({ line: row.line, status: "failed", code });
    }
  }

  const count = status => results.filter(r => r.status === status).length;
  const failed = count("failed");
  return {
    status: 200,
    body: {
      ok: failed === 0,
      total: prepared.length,
      created: count("created"),
      updated: count("updated"),
      failed,
      pending_activation: count("created") + results.filter(r => r.status === "updated" && !r.activated).length,
      without_subscription: prepared.filter(r => !r.numero_abonnement).length,
      results,
      errors: results.filter(r => r.status === "failed").map(r => ({ line: r.line, code: r.code, message: `Ligne ${r.line} — écriture impossible (${r.code}).` }))
    }
  };
}

// ------------------------------------------------------------------
// Access issuing (shared by activation and reset)
// ------------------------------------------------------------------
// Never touches is_active: issuing access must not reactivate a deactivated account.
async function setMustChange(db, userId, displayName) {
  const patch = { must_change_password: true };
  if (displayName) patch.display_name = displayName;
  const { data, error } = await db.from("profiles").update(patch).eq("id", userId).select("id").single();
  return !error && Boolean(data);
}

async function recoveryLink(auth, email, redirectTo) {
  const { data, error } = await auth.generateLink({ type: "recovery", email, options: { redirectTo } });
  const link = data?.properties?.action_link;
  return error || !link ? null : link;
}

// ------------------------------------------------------------------
// Activation of one imported / created member record
// ------------------------------------------------------------------
export async function activateMember({ db, auth }, { subscriberId, method = "link", redirectTo = null, generatePassword = generateTemporaryPassword }) {
  if (!ACCESS_METHODS.includes(method)) return fail(400, "invalid_method", "Méthode d’activation invalide.");
  if (!subscriberId) return fail(400, "missing_subscriber", "subscriber_id requis.");
  if (method === "link" && !redirectTo) {
    return fail(503, "link_unavailable", "Les liens d’activation ne sont pas configurés (PUBLIC_SITE_URL). Aucun compte n’a été créé.");
  }

  const { data: member, error } = await db.from("subscribers")
    .select("id,user_id,nom,prenom,login_name,gender,status").eq("id", subscriberId).maybeSingle();
  if (error) return fail(503, "lookup_failed", "Membre introuvable pour le moment. Réessayez.");
  if (!member) return fail(404, "not_found", "Membre introuvable.");
  if (member.user_id) return fail(409, "already_active", "Ce membre a déjà un compte. Utilisez la réinitialisation.");
  if (member.status !== "ACTIVE") return fail(409, "inactive_member", "Le membre est désactivé.");
  if (!LOGIN_RE.test(String(member.login_name || ""))) return fail(409, "invalid_login", "Login du membre manquant ou invalide.");

  const displayName = `${member.prenom} ${member.nom}`.trim();
  const password = generatePassword();
  const created = await auth.createUser({
    email: loginEmail(member.login_name), password, email_confirm: true,
    user_metadata: { display_name: displayName, gender: member.gender }
  });
  if (created.error || !created.data?.user) {
    const taken = created.error?.code === "email_exists" || /already/i.test(String(created.error?.message || ""));
    return fail(taken ? 409 : 502, taken ? "login_in_use" : "account_creation_failed",
      taken ? "Un compte Auth utilise déjà ce login. Vérification manuelle nécessaire." : "Création du compte impossible.");
  }
  const userId = created.data.user.id;

  const undo = async (unlink) => {
    if (unlink) await db.from("subscribers").update({ user_id: null }).eq("id", member.id).eq("user_id", userId);
    await auth.deleteUser(userId);
  };

  // Link only if still unlinked (two concurrent activations cannot both win).
  const linked = await db.from("subscribers").update({ user_id: userId }).eq("id", member.id).is("user_id", null).select("id");
  if (linked.error || !linked.data?.length) {
    await undo(false);
    return fail(409, "already_active", "Ce membre a été activé entre-temps.");
  }

  const roleOk = !(await db.from("user_roles").upsert({ user_id: userId, role: "MEMBER" }, { onConflict: "user_id,role" })).error;
  if (!roleOk || !(await setMustChange(db, userId, displayName))) {
    await undo(true);
    return fail(502, "account_setup_failed", "Le compte n’a pas pu être préparé. Rien n’a été conservé.");
  }

  if (method === "temporary_password") {
    return { status: 200, body: { ok: true, user_id: userId, method, temporary_password: password } };
  }
  const link = await recoveryLink(auth, loginEmail(member.login_name), redirectTo);
  if (!link) {
    await undo(true);
    return fail(502, "link_failed", "Le lien d’activation n’a pas pu être généré. Rien n’a été conservé ; réessayez.");
  }
  return { status: 200, body: { ok: true, user_id: userId, method, activation_link: link } };
}

// ------------------------------------------------------------------
// Reset of an existing account
// ------------------------------------------------------------------
export async function resetAccess({ db, auth }, { userId, method, newPassword = null, redirectTo = null, generatePassword = generateTemporaryPassword }) {
  if (!userId) return fail(400, "missing_user", "user_id requis.");
  if (!["link", "temporary_password", "chosen_password"].includes(method)) return fail(400, "invalid_method", "Méthode invalide.");
  if (method === "link" && !redirectTo) return fail(503, "link_unavailable", "Les liens de réinitialisation ne sont pas configurés (PUBLIC_SITE_URL).");

  const { data: profile, error } = await db.from("profiles").select("id").eq("id", userId).maybeSingle();
  if (error) return fail(503, "lookup_failed", "Utilisateur introuvable pour le moment.");
  if (!profile) return fail(404, "not_found", "Utilisateur introuvable.");

  if (method === "link") {
    const { data: found, error: userError } = await auth.getUserById(userId);
    const email = found?.user?.email;
    if (userError || !email) return fail(404, "not_found", "Compte Auth introuvable.");
    if (!(await setMustChange(db, userId))) return fail(502, "flag_failed", "Le changement obligatoire n’a pas pu être enregistré.");
    const link = await recoveryLink(auth, email, redirectTo);
    if (!link) return fail(502, "link_failed", "Le lien n’a pas pu être généré. Réessayez.");
    return { status: 200, body: { ok: true, method, activation_link: link } };
  }

  const password = method === "temporary_password" ? generatePassword() : String(newPassword || "");
  const { error: updateError } = await auth.updateUserById(userId, { password });
  if (updateError) return fail(400, "password_rejected", "Le mot de passe a été refusé par Supabase Auth.");
  // Setting the flag after the password snapshots the new digest (database trigger).
  if (!(await setMustChange(db, userId))) {
    return fail(500, "flag_failed", "Le mot de passe a été réinitialisé, mais le changement obligatoire n’a pas pu être enregistré.");
  }
  return { status: 200, body: method === "temporary_password" ? { ok: true, method, temporary_password: password } : { ok: true, method } };
}

// ------------------------------------------------------------------
// Deletion of a member (record + account)
// ------------------------------------------------------------------
// subscribers.user_id is ON DELETE SET NULL, so deleting only the Auth user
// would leave the member record (CIN, contact data) behind. Both are deleted
// here; payments and seats cascade with the record. An account that also holds
// a staff role is refused: staff accounts are managed separately.
export async function deleteMember({ db, auth }, { subscriberId }) {
  if (!subscriberId) return fail(400, "missing_subscriber", "subscriber_id requis.");
  const { data: member, error } = await db.from("subscribers").select("id,user_id").eq("id", subscriberId).maybeSingle();
  if (error) return fail(503, "lookup_failed", "Membre introuvable pour le moment. Réessayez.");
  if (!member) return fail(404, "not_found", "Membre introuvable.");

  if (member.user_id) {
    const { data: roles, error: rolesError } = await db.from("user_roles").select("role").eq("user_id", member.user_id);
    if (rolesError) return fail(503, "roles_unavailable", "Rôles du compte indisponibles. Réessayez.");
    if ((roles || []).some(r => r.role !== "MEMBER")) {
      return fail(409, "staff_account", "Ce compte a aussi un rôle du personnel. Retirez ses rôles dans la gestion des administrateurs avant de supprimer le membre.");
    }
    const { error: authError } = await auth.deleteUser(member.user_id);
    if (authError) return fail(502, "account_delete_failed", "Le compte de connexion n’a pas pu être supprimé. Rien n’a été supprimé.");
  }

  const { error: deleteError } = await db.from("subscribers").delete().eq("id", member.id);
  if (deleteError) {
    return fail(500, "record_delete_failed", "La fiche membre n’a pas pu être supprimée. Réessayez la suppression.",
      { account_deleted: Boolean(member.user_id) });
  }
  return { status: 200, body: { ok: true, account_deleted: Boolean(member.user_id) } };
}
