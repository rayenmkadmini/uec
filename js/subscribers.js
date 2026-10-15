let allSubs = [];
let filtered = [];
let page = 1;
const pageSize = 10;

let allFaculties = [];
let currentCtx = null;
let canManageMembers = false;
let canMarkCard = false;
let canViewDetails = false;
let canViewIdentity = false;
const pendingCardToggles = new Set();
const { parseMemberCsv } = window.UE_CSV;

function stripAccents(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function splitFacultyName(name) {
  const i = name.indexOf(" — ");
  return i === -1 ? { short: name, full: "" } : { short: name.slice(0, i), full: name.slice(i + 3) };
}

function renderFacultyOptions(query) {
  const q = stripAccents(query.trim().toLowerCase());
  const matches = q ? allFaculties.filter(f => stripAccents(f.name).toLowerCase().includes(q)) : allFaculties;
  const list = $("#fFaculteList");

  list.innerHTML = matches.length
    ? matches.map(f => {
        const { short, full } = splitFacultyName(f.name);
        return `<div class="combo-option" data-id="${f.id}" data-name="${escapeHtml(f.name)}"><b>${escapeHtml(short)}</b>${full ? `<small>${escapeHtml(full)}</small>` : ""}</div>`;
      }).join("")
    : '<div class="combo-empty">Aucun résultat</div>';
}

function selectFaculty(id, name) {
  $("#fFaculte").value = id || "";
  $("#fFaculteSearch").value = id ? splitFacultyName(name).short : "";
  $("#fFaculteList").classList.add("hidden");
}

function setupFacultyCombo() {
  const search = $("#fFaculteSearch");
  const list = $("#fFaculteList");

  search.addEventListener("input", () => {
    $("#fFaculte").value = "";
    renderFacultyOptions(search.value);
    list.classList.remove("hidden");
  });

  search.addEventListener("focus", () => {
    renderFacultyOptions(search.value);
    list.classList.remove("hidden");
  });

  list.addEventListener("mousedown", e => {
    const option = e.target.closest(".combo-option");
    if (!option) return;
    e.preventDefault();
    selectFaculty(option.dataset.id, option.dataset.name);
  });

  document.addEventListener("click", e => {
    if (!e.target.closest(".combo-field")) list.classList.add("hidden");
  });
}

async function loadRefs() {
  const [facultiesResult, zonesResult] = await Promise.all([
    sb.from("faculties").select("id,name").order("name"),
    sb.from("zones").select("id,name").order("name")
  ]);

  if (facultiesResult.error) return showAlert("#pageAlert", facultiesResult.error.message, "error");
  if (zonesResult.error) return showAlert("#pageAlert", zonesResult.error.message, "error");

  allFaculties = facultiesResult.data || [];

  $("#fZone").innerHTML = '<option value="">Non définie</option>' +
    (zonesResult.data || []).map(x => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join("");
}

// Columns any staff reader may select. CIN, address, date of birth and notes are
// withheld by the database (column privileges); "*" would be refused.
const MEMBER_COLUMNS = "id,user_id,nom,prenom,login_name,numero_abonnement,email,phone,gender,photo_url," +
  "faculty_id,zone_id,status,card_paid,card_paid_at,subscription_start,subscription_end,created_at,updated_at," +
  "faculties(name),zones(name)";

function columnCount() {
  if (!canViewDetails) return 7;
  return canViewIdentity ? 11 : 10;
}

// SUPERADMIN / ADMIN read member records without protected identity fields.
// SUPERADMIN additionally loads CIN / address / date of birth through
// get_member_private_fields(). TREASURER receives only identification + payment
// fields from list_payment_members() — the database refuses anything more.
async function loadSubs() {
  const [result, identity] = await Promise.all([
    canViewDetails
      ? sb.from("subscribers").select(MEMBER_COLUMNS).order("nom", { ascending: true })
      : sb.rpc("list_payment_members"),
    canViewIdentity ? sb.rpc("get_member_private_fields") : Promise.resolve({ data: [], error: null })
  ]);
  const error = result.error || identity.error;

  if (error) {
    allSubs = [];
    $("#rows").innerHTML = `<tr><td colspan="${columnCount()}" class="empty">Impossible de charger les membres. Réessayez.</td></tr>`;
    return showAlert("#pageAlert", error.message, "error");
  }
  const privateById = new Map((identity.data || []).map(p => [p.subscriber_id, p]));
  allSubs = (result.data || []).map(s => canViewDetails
    ? {
        ...s,
        ...(canViewIdentity ? { cin: privateById.get(s.id)?.cin ?? null, adresse: privateById.get(s.id)?.adresse ?? null } : {}),
        is_self: Boolean(s.user_id) && s.user_id === currentCtx?.user?.id
      }
    : { ...s, faculties: s.faculty_name ? { name: s.faculty_name } : null });
  apply();
}

// Separation of duties: a treasurer cannot change their own card status
// (enforced by set_card_payment_status); only SUPERADMIN can.
function canToggleCardOf(s) {
  return canMarkCard && (!s.is_self || canManageMembers);
}

function apply() {
  const q = $("#search").value.toLowerCase().trim();
  const status = $("#statusFilter").value;
  const gender = $("#genderFilter").value;
  const card = $("#cardFilter").value;

  filtered = allSubs.filter(s => {
    const text = [
      s.nom, s.prenom, s.cin, s.numero_abonnement,
      s.phone, s.email, s.login_name,
      s.faculties?.name, s.zones?.name
    ].join(" ").toLowerCase();

    return (!q || text.includes(q)) &&
      (!status || s.status === status) &&
      (!gender || s.gender === gender) &&
      (!card || (card === "paid" ? s.card_paid : !s.card_paid));
  });

  page = 1;
  render();
}

function genderLabel(gender) {
  if (gender === "FEMALE") return '<span class="gender-badge female">Femme</span>';
  if (gender === "MALE") return '<span class="gender-badge male">Homme</span>';
  return '<span class="gender-badge missing">Non défini</span>';
}

function cardLabel(s) {
  if (s.card_paid) {
    const date = s.card_paid_at ? new Date(s.card_paid_at).toLocaleDateString("fr-TN") : "";
    return `<span class="badge active" title="${escapeHtml(date ? `Payée le ${date}` : "")}">Payée</span>`;
  }
  return '<span class="badge inactive">Non payée</span>';
}

let subscriberRenderRequest = 0;
async function render() {
  const renderRequest = ++subscriberRenderRequest;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  if (page > totalPages) page = totalPages;

  const start = (page - 1) * pageSize;
  const rows = filtered.slice(start, start + pageSize);
  const photoEntries = canViewDetails
    ? await Promise.all(rows.filter(s => s.photo_url).map(async s => [s.id, await getSubscriberPhotoUrl(s.photo_url)]))
    : [];
  if (renderRequest !== subscriberRenderRequest) return;
  const photoUrls = new Map(photoEntries);

  $("#rows").innerHTML = rows.map(s => `
    <tr>
      ${canViewDetails ? `<td class="member-thumb-cell">
        ${photoUrls.get(s.id) ? `<img src="${escapeHtml(photoUrls.get(s.id))}" alt="Photo de ${escapeHtml(s.prenom || "membre")}" class="member-thumb" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-flex';">` : ""}
        <span class="member-thumb-fallback" ${photoUrls.get(s.id) ? 'style="display:none;"' : ''}>${escapeHtml((s.prenom || "A").charAt(0).toUpperCase())}</span>
      </td>` : ""}
      <td>${escapeHtml(s.nom)}</td>
      <td>${escapeHtml(s.prenom)}</td>
      ${canViewDetails ? `<td>${genderLabel(s.gender)}</td>` : ""}
      <td>${escapeHtml(s.numero_abonnement || "—")}</td>
      ${canViewIdentity ? `<td>${escapeHtml(s.cin || "—")}</td>` : ""}
      <td>${escapeHtml(facultyShort(s.faculties?.name) || "—")}</td>
      ${canViewDetails ? `<td>${escapeHtml(s.zones?.name || "—")}</td>` : ""}
      <td>${statusBadge(s.status)}</td>
      <td>
        ${cardLabel(s)}
        ${canMarkCard && !canToggleCardOf(s) ? `<span class="muted-text" title="Votre propre carte doit être validée par un super administrateur.">🔒</span>` : ""}
        ${canToggleCardOf(s) ? `<button class="icon-btn card-toggle-btn" ${pendingCardToggles.has(s.id) ? 'disabled aria-busy="true"' : ""} aria-label="${s.card_paid ? "Marquer la carte comme non payée" : "Marquer la carte comme payée"}" title="${s.card_paid ? "Marquer la carte comme non payée" : "Marquer la carte comme payée"}" onclick="toggleCard('${s.id}')">${s.card_paid ? ICONS.close : ICONS.refresh}</button>` : ""}
      </td>
      <td class="actions">
        <button class="icon-btn" aria-label="Voir la carte membre de ${escapeHtml(`${s.prenom || ""} ${s.nom || ""}`.trim())}" title="Voir la carte membre" onclick="showMemberCard('${s.id}')">▣</button>
        ${canManageMembers ? `<button class="icon-btn" aria-label="Modifier ${escapeHtml(s.nom || "le membre")}" title="Modifier" onclick="editSub('${s.id}')">${ICONS.edit}</button>
        <button class="icon-btn" aria-label="${s.status === "ACTIVE" ? "Désactiver" : "Activer"} ${escapeHtml(s.nom || "le membre")}" title="Activer/Désactiver" onclick="toggleSub('${s.id}')">${s.status === "ACTIVE" ? ICONS.pause : ICONS.play}</button>
        <button class="icon-btn" aria-label="Réinitialiser le mot de passe" title="Réinitialiser mot de passe" onclick="resetPassword('${s.user_id}')">${ICONS.refresh}</button>
        <button class="icon-btn danger" aria-label="Supprimer ${escapeHtml(s.nom || "le membre")}" title="Supprimer" onclick="deleteSub('${s.id}')">${ICONS.trash}</button>` : ""}
      </td>
    </tr>
  `).join("") || `<tr><td colspan="${columnCount()}" class="empty">Aucun résultat</td></tr>`;

  $("#pageInfo").textContent = `Page ${page} / ${totalPages}`;
  if ($("#memberResultCount")) $("#memberResultCount").textContent = `${filtered.length} résultat(s) sur ${allSubs.length} membre(s)`;
  $("#prev").disabled = page <= 1;
  $("#next").disabled = page >= totalPages;
}

async function openMemberCard(subscriber) {
  const user = subscriber || {};
  const photoUrl = canViewDetails ? await getSubscriberPhotoUrl(user.photo_url) : "";
  const card = `
    <div class="member-card-wrap">
      <div class="member-card-header">
        <div class="member-card-avatar">
          ${photoUrl ? `<img src="${escapeHtml(photoUrl)}" alt="Photo membre" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">` : ""}
          <span class="member-card-avatar-fallback" ${photoUrl ? 'style="display:none;"' : ''}>${escapeHtml((user.prenom || "A").charAt(0).toUpperCase())}</span>
        </div>
        <div>
          <div class="member-card-name">${escapeHtml(`${user.prenom || ""} ${user.nom || ""}`.trim() || "Abonné")}</div>
          <div class="member-card-status">${statusBadge(user.status)}</div>
        </div>
      </div>
      <div class="member-card-grid">
        <div><span>N° abonnement</span><strong>${escapeHtml(user.numero_abonnement || "—")}</strong></div>
        ${canViewDetails ? `${canViewIdentity ? `<div><span>CIN</span><strong>${escapeHtml(user.cin || "—")}</strong></div>` : ""}
        <div><span>Téléphone</span><strong>${escapeHtml(user.phone || "—")}</strong></div>
        <div><span>Email</span><strong>${escapeHtml(user.email || "—")}</strong></div>
        <div><span>Faculté</span><strong>${escapeHtml(user.faculties?.name || "—")}</strong></div>
        <div><span>Zone</span><strong>${escapeHtml(user.zones?.name || "—")}</strong></div>
        <div><span>Sexe</span><strong>${escapeHtml(user.gender === "FEMALE" ? "Femme" : user.gender === "MALE" ? "Homme" : "Non défini")}</strong></div>
        ${canViewIdentity ? `<div><span>Adresse</span><strong>${escapeHtml(user.adresse || "—")}</strong></div>` : ""}` : `
        <div><span>Faculté</span><strong>${escapeHtml(user.faculties?.name || "—")}</strong></div>`}
        <div><span>Carte membre</span><strong>${user.card_paid ? "Payée" : "Non payée"}</strong></div>
      </div>
    </div>
  `;

  $("#memberCardContent").innerHTML = card;
  $("#memberCardModal").classList.remove("hidden");
}

window.showMemberCard = id => {
  const s = allSubs.find(x => x.id === id);
  if (!s) return;
  void openMemberCard(s);
};

async function uploadSubscriberPhoto(file, loginName) {
  if (!file) return null;

  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) {
    throw new Error("Format photo invalide. Utilisez JPG, PNG ou WebP.");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("La photo dépasse la limite de 5 Mo.");
  }

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const safeLogin = String(loginName || "subscriber").toUpperCase().replace(/[^A-Z0-9_-]/g, "_");
  const path = `${safeLogin}/${crypto.randomUUID()}.${ext}`;

  const { error } = await sb.storage
    .from("subscriber-photos")
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type
    });

  if (error) {
    throw new Error(`Erreur upload photo : ${error.message}`);
  }

  return path;
}

function openModal(s = null) {
  $("#modal").classList.remove("hidden");
  $("#modalTitle").textContent = s ? "Modifier un abonné" : "Ajouter un abonné";
  $("#editId").value = s?.id || "";

  const fields = {
    fNom: s?.nom || "",
    fPrenom: s?.prenom || "",
    fNumero: s?.numero_abonnement || "",
    fLogin: s?.login_name || "",
    fCin: s?.cin || "",
    fPhone: s?.phone || "",
    fEmail: s?.email || "",
    fPhotoUrl: s?.photo_url || "",
    fAdresse: s?.adresse || ""
  };

  Object.entries(fields).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  });

  const editing = Boolean(s);
  $("#fLogin").readOnly = editing;
  $("#fCin").readOnly = editing;
  $("#fLogin").setAttribute("aria-describedby", editing ? "immutableMemberFieldsHint" : "");
  $("#fCin").setAttribute("aria-describedby", editing ? "immutableMemberFieldsHint" : "");

  $("#fPhotoFile").value = "";
  $("#fGender").value = s?.gender || "";
  selectFaculty(s?.faculty_id || "", s?.faculties?.name || "");
  $("#fZone").value = s?.zone_id || "";
  $("#fStatus").value = s?.status || "ACTIVE";
}

window.editSub = id => { if (canManageMembers) openModal(allSubs.find(s => s.id === id)); };

window.toggleSub = async id => {
  if (!canManageMembers) return showAlert("#pageAlert", "Vous avez un accès en lecture seule.", "error");
  const s = allSubs.find(x => x.id === id);
  if (!s) return;

  const failure = writeError(await sb
    .from("subscribers")
    .update({ status: s.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })
    .eq("id", id)
    .select("id"));

  if (failure) return showAlert("#pageAlert", failure, "error");
  await loadSubs();
};

// Card PAID <-> UNPAID goes through a dedicated RPC that can change only
// card_paid / card_paid_at (and is audited), for Treasurer and Superadmin.
window.toggleCard = async id => {
  if (!canMarkCard) return showAlert("#pageAlert", "Vous n’avez pas la permission de modifier le paiement des cartes.", "error");
  const s = allSubs.find(x => x.id === id);
  if (!s || pendingCardToggles.has(id)) return;
  if (!canToggleCardOf(s)) return showAlert("#pageAlert", "Votre propre carte doit être validée par un super administrateur.", "error");

  const nextPaid = !s.card_paid;
  const question = nextPaid
    ? `Confirmer que ${s.prenom} ${s.nom} a payé sa carte membre ?`
    : `Marquer la carte de ${s.prenom} ${s.nom} comme non payée ?`;
  if (!(await confirmDialog(question, { confirmText: nextPaid ? "Oui, payée" : "Oui, non payée", icon: "question" }))) return;

  pendingCardToggles.add(id);
  render();
  const { data, error } = await sb.rpc("set_card_payment_status", { p_subscriber_id: id, p_paid: nextPaid });
  pendingCardToggles.delete(id);

  if (error) {
    render();
    return showAlert("#pageAlert", error.message, "error");
  }

  s.card_paid = data.card_paid;
  s.card_paid_at = data.card_paid_at;
  apply();
  showAlert("#pageAlert", nextPaid ? "Carte marquée comme payée." : "Carte marquée comme non payée.");
};

// Shows a server-generated temporary password exactly once. It is not stored in
// the page and the member must replace it at first login (verified server-side).
async function showTemporaryPassword(title, password) {
  if (window.Swal) {
    await Swal.fire({
      ...swalBase(),
      title,
      html: `<p>Remettez ce mot de passe temporaire au membre par un canal sûr. Il ne sera plus affiché.</p>
        <p><code class="temp-password">${escapeHtml(password)}</code></p>
        <p class="hint">Le membre devra le remplacer à sa première connexion.</p>`,
      icon: "success",
      showDenyButton: Boolean(navigator.clipboard),
      denyButtonText: "Copier",
      confirmButtonText: "Terminé",
      preDeny: async () => { await navigator.clipboard.writeText(password); return false; }
    });
  } else {
    window.prompt(`${title} — mot de passe temporaire (affiché une seule fois) :`, password);
  }
}

// Activation / reset: the Edge Function generates a random temporary password
// (never derived from member data) and flags the account for a first-login change.
window.resetPassword = async userId => {
  if (!canManageMembers || !userId) return;
  if (!(await confirmDialog("Générer un nouveau mot de passe temporaire pour ce membre ? L’ancien ne fonctionnera plus.", { confirmText: "Générer", icon: "question" }))) return;

  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showAlert("#pageAlert", "Session administrateur expirée.", "error");

  const response = await fetch(`${UE_CONFIG.SUPABASE_URL}/functions/v1/admin-reset-password`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: UE_CONFIG.SUPABASE_ANON_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ user_id: userId, generate: true })
  });

  let result = {};
  try { result = await response.json(); } catch (_) {}

  if (!response.ok || !result.temporary_password) {
    return showAlert("#pageAlert", result.error || "Réinitialisation impossible.", "error");
  }

  await showTemporaryPassword("Mot de passe réinitialisé", result.temporary_password);
};

window.deleteSub = async id => {
  if (!canManageMembers) return;
  if (!(await confirmDialog("Supprimer cet abonné et son compte ? Cette action est irréversible.", { confirmText: "Supprimer" }))) return;

  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showAlert("#pageAlert", "Session administrateur expirée.", "error");

  const response = await fetch(`${UE_CONFIG.SUPABASE_URL}/functions/v1/admin-delete-user`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: UE_CONFIG.SUPABASE_ANON_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ subscriber_id: id })
  });

  let result = {};
  try { result = await response.json(); } catch (_) {}

  if (!response.ok) return showAlert("#pageAlert", result.error || "Suppression impossible.", "error");
  await loadSubs();
};


const MEMBER_FIELD_LABELS = {
  nom: "Nom", prenom: "Prénom", cin: "CIN", gender: "Sexe", login: "Login", email: "Email",
  numero_abonnement: "N° abonnement", faculty: "Faculté", zone: "Zone", phone: "Téléphone", adresse: "Adresse"
};

function importErrorListHtml(errors) {
  const shown = errors.slice(0, 50);
  return `<ul class="csv-errors">${shown.map(e => `<li>${escapeHtml(e.message || e)}</li>`).join("")}</ul>` +
    (errors.length > shown.length ? `<p class="muted-text">… et ${errors.length - shown.length} autre(s) erreur(s).</p>` : "");
}

async function showImportErrors(title, intro, errors) {
  if (window.Swal) {
    await Swal.fire({ ...swalBase(), title, html: `<p>${escapeHtml(intro)}</p>${importErrorListHtml(errors)}`, icon: "error", width: 760, confirmButtonText: "Fermer" });
  } else {
    alert(`${title}\n${intro}\n\n${errors.slice(0, 20).map(e => e.message || e).join("\n")}`);
  }
}

// The import is all-or-nothing: the file is refused if a required column is
// missing, a column is ambiguous or any row is invalid. The Edge Function
// re-validates everything (including faculty / zone names and duplicates)
// before writing.
async function importMembersCsv(file) {
  if (!canManageMembers) return;
  let parsed;
  try {
    parsed = parseMemberCsv(await file.text());
  } catch (_) {
    return showAlert("#pageAlert", "Impossible de lire ce fichier CSV. Vérifiez son format puis réessayez.", "error");
  }
  const { analysis, rows } = parsed;
  if (!rows.length) return showAlert("#pageAlert", "Le fichier CSV est vide.", "error");

  if (!analysis.ok) {
    const problems = [
      ...analysis.missing.map(field => `Colonne obligatoire absente : ${MEMBER_FIELD_LABELS[field] || field}.`),
      ...analysis.duplicates.map(d => `Colonnes en double pour ${MEMBER_FIELD_LABELS[d.field] || d.field} : ${d.headers.map(h => `« ${h} »`).join(", ")}. Gardez-en une seule.`)
    ];
    return showImportErrors("En-têtes CSV invalides", "Corrigez les en-têtes puis réimportez le fichier. Aucune donnée n’a été modifiée.", problems);
  }
  if (rows.length > 500) return showAlert("#pageAlert", "Maximum 500 lignes par import. Divisez le fichier.", "error");

  const rowProblems = row => ["nom", "prenom", "cin", "gender"].filter(field => !row[field]);
  const invalid = rows.filter(row => rowProblems(row).length);
  if (invalid.length) {
    return showImportErrors(
      "Import refusé",
      `${invalid.length} ligne(s) incomplète(s). Corrigez le fichier puis réimportez-le : aucune ligne n’est importée tant qu’une ligne est invalide.`,
      invalid.map(row => `Ligne ${row.line} : ${rowProblems(row).map(f => MEMBER_FIELD_LABELS[f]).join(", ")} manquant(s).`)
    );
  }

  const withoutSubscription = rows.filter(x => !x.numero_abonnement).length;
  const withSubscription = rows.length - withoutSubscription;
  const previewRows = rows.slice(0, 8).map(row =>
    `<tr><td>${row.line}</td><td>${escapeHtml(`${row.prenom} ${row.nom}`.trim() || "—")}</td><td>${escapeHtml(row.gender || "—")}</td><td>${escapeHtml(row.numero_abonnement || "—")}</td></tr>`
  ).join("");

  const previewHtml = `
    <p>Les membres existants (retrouvés par CIN puis par N° d’abonnement) seront mis à jour ; aucun membre n’est supprimé.
    Les nouveaux comptes reçoivent un mot de passe aléatoire inconnu : activez-les ensuite avec « Réinitialiser le mot de passe ».</p>
    <div class="csv-summary">
      <div><strong>${rows.length}</strong><span>Lignes</span></div>
      <div><strong>${withSubscription}</strong><span>Avec numéro d’abonnement</span></div>
      <div><strong>${withoutSubscription}</strong><span>Sans numéro d’abonnement</span></div>
    </div>
    <div class="table-wrap csv-preview"><table><thead><tr><th>Ligne</th><th>Membre</th><th>Sexe</th><th>N° abonnement</th></tr></thead><tbody>${previewRows}</tbody></table></div>
    ${rows.length > 8 ? `<p class="muted-text">Aperçu des 8 premières lignes sur ${rows.length}.</p>` : ""}
    ${analysis.unknown.length ? `<p class="hint">Colonnes ignorées : ${analysis.unknown.map(h => escapeHtml(h)).join(", ")}.</p>` : ""}
  `;

  let confirmed = false;
  if (window.Swal) {
    const preview = await Swal.fire({
      ...swalBase(),
      title: "Vérifier l’import CSV",
      html: previewHtml,
      width: 760,
      showCancelButton: true,
      confirmButtonText: `Importer ${rows.length} ligne(s)`,
      cancelButtonText: "Annuler",
      reverseButtons: true,
      focusCancel: true
    });
    confirmed = preview.isConfirmed;
  } else {
    confirmed = await confirmDialog(`Lignes : ${rows.length}\nAvec numéro d’abonnement : ${withSubscription}\nSans numéro d’abonnement : ${withoutSubscription}\n\nImporter ?`, { confirmText: "Importer" });
  }
  if (!confirmed) return;

  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showAlert("#pageAlert", "Session administrateur expirée.", "error");

  const importButton = $("#importCsvBtn");
  const originalText = importButton?.textContent || "Importer CSV";
  if (importButton) {
    importButton.disabled = true;
    importButton.setAttribute("aria-busy", "true");
    importButton.textContent = "Import en cours…";
  }

  try {
    const response = await fetch(`${UE_CONFIG.SUPABASE_URL}/functions/v1/admin-import-users`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: UE_CONFIG.SUPABASE_ANON_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ rows })
    });

    let result = {};
    try { result = await response.json(); } catch (_) {}
    const errors = Array.isArray(result.errors) ? result.errors : [];
    if (!response.ok) {
      if (errors.length) return showImportErrors("Import refusé", result.error || "Aucune donnée n’a été modifiée.", errors);
      return showAlert("#pageAlert", result.error || "Import impossible. Vérifiez le fichier puis réessayez.", "error");
    }

    const metric = value => Number.isFinite(Number(value)) ? String(Number(value)) : "Non communiqué";
    const report = [
      ["Lignes", rows.length],
      ["Nouveaux membres (à activer)", metric(result.created)],
      ["Membres mis à jour", metric(result.updated)],
      ["Échecs d’écriture", metric(result.failed)],
      ["Avec numéro d’abonnement", withSubscription],
      ["Sans numéro d’abonnement", withoutSubscription]
    ];
    const reportHtml = `<div class="csv-summary">${report.map(([label, value]) => `<div><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join("")}</div>` +
      (errors.length ? importErrorListHtml(errors) : "");

    if (window.Swal) {
      await Swal.fire({
        ...swalBase(),
        title: errors.length ? "Import terminé avec des erreurs" : "Import terminé",
        html: reportHtml,
        icon: errors.length ? "warning" : "success",
        width: 760,
        confirmButtonText: "Terminé"
      });
    } else {
      alert(report.map(([label, value]) => `${label} : ${value}`).join("\n"));
    }

    await loadSubs();
  } catch (_) {
    showAlert("#pageAlert", "L’import n’a pas abouti. Vérifiez votre connexion puis réessayez.", "error");
  } finally {
    if (importButton) {
      importButton.disabled = false;
      importButton.removeAttribute("aria-busy");
      importButton.textContent = originalText;
    }
  }
}

async function init() {
  const ctx = await requirePermission("viewMembers");
  if (!ctx) return;
  currentCtx = ctx;
  canManageMembers = can(ctx, "manageMembers");
  canMarkCard = can(ctx, "manageCardPayments");
  canViewDetails = can(ctx, "viewMemberDetails");
  canViewIdentity = can(ctx, "viewMemberIdentity");
  if (!canViewDetails) {
    $$(".col-private").forEach(th => th.remove());
    $("#genderFilter")?.remove();
  }
  if (!canViewIdentity) $$(".col-identity").forEach(th => th.remove());

  setupShell(ctx);
  setupFacultyCombo();
  await loadRefs();
  await loadSubs();

  $("#search").oninput = apply;
  $("#statusFilter").onchange = apply;
  $("#genderFilter").onchange = apply;
  $("#cardFilter").onchange = apply;

  $("#prev").onclick = () => {
    if (page > 1) { page--; render(); }
  };

  $("#next").onclick = () => {
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (page < totalPages) { page++; render(); }
  };

  $("#addBtn").onclick = () => { if (canManageMembers) openModal(); };
  $("#addBtn").classList.toggle("hidden", !canManageMembers);
  $("#importCsvBtn").classList.toggle("hidden", !canManageMembers);
  $("#importCsvBtn").onclick = () => $("#csvFile").click();
  $("#csvFile").addEventListener("change", async e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) await importMembersCsv(file); });
  $("#closeModal").onclick = () => $("#modal").classList.add("hidden");
  $("#cancelModal").onclick = () => $("#modal").classList.add("hidden");
  $("#closeMemberCardModal").onclick = () => $("#memberCardModal").classList.add("hidden");
}

$("#subscriberForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!canManageMembers) return showAlert("#pageAlert", "Vous avez un accès en lecture seule.", "error");

  const id = $("#editId").value;
  const gender = $("#fGender").value;

  if (!gender) {
    return showAlert("#pageAlert", "Veuillez sélectionner le sexe : Homme ou Femme.", "error");
  }

  const photoFile = $("#fPhotoFile").files?.[0] || null;
  let photoUrl = $("#fPhotoUrl").value.trim() || null;

  try {
    if (photoFile) {
      photoUrl = await uploadSubscriberPhoto(photoFile, $("#fLogin").value.trim());
    }
  } catch (error) {
    return showAlert("#pageAlert", error.message, "error");
  }

  const payload = {
    nom: $("#fNom").value.trim(),
    prenom: $("#fPrenom").value.trim(),
    numero_abonnement: $("#fNumero").value.trim() || null,
    gender,
    phone: $("#fPhone").value.trim(),
    email: $("#fEmail").value.trim(),
    photo_url: photoUrl,
    adresse: $("#fAdresse").value.trim(),
    faculty_id: $("#fFaculte").value || null,
    zone_id: $("#fZone").value || null,
    status: $("#fStatus").value
  };

  if (!id) {
    payload.login_name = $("#fLogin").value.trim().toUpperCase();
    payload.cin = $("#fCin").value.trim();
  }

  if (!payload.nom || !payload.prenom || (!id && (!payload.login_name || !payload.cin))) {
    return showAlert("#pageAlert", "Veuillez remplir tous les champs obligatoires.", "error");
  }

  if (id) {
    const failure = writeError(await sb.from("subscribers").update(payload).eq("id", id).select("id"));
    if (failure) return showAlert("#pageAlert", failure, "error");
    showAlert("#pageAlert", "Abonné modifié avec succès.");
  } else {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return showAlert("#pageAlert", "Session administrateur expirée.", "error");

    const response = await fetch(`${UE_CONFIG.SUPABASE_URL}/functions/v1/admin-create-user`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: UE_CONFIG.SUPABASE_ANON_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    let result = {};
    try { result = await response.json(); } catch (_) {}

    if (!response.ok) return showAlert("#pageAlert", result.error || "Création impossible.", "error");
    showAlert("#pageAlert", "Abonné créé avec succès.");
    if (result.temporary_password) await showTemporaryPassword("Compte membre créé", result.temporary_password);
  }

  $("#modal").classList.add("hidden");
  await loadSubs();
});

init();
