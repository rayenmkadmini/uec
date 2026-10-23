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
let canImportMembers = false;
let canResetAccess = false;
let canForceDelete = false;
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

// Columns any staff reader may select. CIN, address, date of birth, notes, phone,
// email, gender and photo are withheld by the database (column privileges); "*" is refused.
const MEMBER_COLUMNS = "id,user_id,nom,prenom,login_name,numero_abonnement," +
  "faculty_id,zone_id,status,card_paid,card_paid_at,subscription_start,subscription_end,created_at,updated_at," +
  "faculties(name),zones(name)";

function columnCount() {
  if (!canViewDetails) return 7;
  return canViewIdentity ? 11 : 8;
}

// SUPERADMIN / ADMIN read member records without protected identity fields.
// SUPERADMIN additionally loads CIN / address / date of birth / phone / email / gender / photo through
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
        ...(canViewIdentity ? {
          cin: privateById.get(s.id)?.cin ?? null,
          adresse: privateById.get(s.id)?.adresse ?? null,
          phone: privateById.get(s.id)?.phone ?? null,
          email: privateById.get(s.id)?.email ?? null,
          gender: privateById.get(s.id)?.gender ?? null,
          photo_url: privateById.get(s.id)?.photo_url ?? null
        } : {}),
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
  const gender = $("#genderFilter")?.value || "";
  const card = $("#cardFilter").value;

  filtered = allSubs.filter(s => {
    const text = [
      s.nom, s.prenom, s.cin, s.numero_abonnement,
      s.phone, s.email, s.login_name,
      s.faculties?.name, s.zones?.name
    ].join(" ").toLowerCase();

    return (!q || text.includes(q)) &&
      (!status || s.status === status) &&
      (!gender || !canViewIdentity || s.gender === gender) &&
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
  const photoEntries = canViewIdentity
    ? await Promise.all(rows.filter(s => s.photo_url).map(async s => [s.id, await getSubscriberPhotoUrl(s.photo_url)]))
    : [];
  if (renderRequest !== subscriberRenderRequest) return;
  const photoUrls = new Map(photoEntries);

  $("#rows").innerHTML = rows.map(s => `
    <tr>
      ${canViewIdentity ? `<td class="member-thumb-cell">
        ${photoUrls.get(s.id) ? `<img src="${escapeHtml(photoUrls.get(s.id))}" alt="Photo de ${escapeHtml(s.prenom || "membre")}" class="member-thumb" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-flex';">` : ""}
        <span class="member-thumb-fallback" ${photoUrls.get(s.id) ? 'style="display:none;"' : ''}>${escapeHtml((s.prenom || "A").charAt(0).toUpperCase())}</span>
      </td>` : ""}
      <td>${escapeHtml(s.nom)}</td>
      <td>${escapeHtml(s.prenom)}</td>
      ${canViewIdentity ? `<td>${genderLabel(s.gender)}</td>` : ""}
      <td>${escapeHtml(s.numero_abonnement || "—")}</td>
      ${canViewIdentity ? `<td>${escapeHtml(s.cin || "—")}</td>` : ""}
      <td>${escapeHtml(facultyShort(s.faculties?.name) || "—")}</td>
      ${canViewDetails ? `<td>${escapeHtml(s.zones?.name || "—")}</td>` : ""}
      <td>${statusBadge(s.status)}${s.user_id ? "" : ' <span class="status-badge warning" title="Aucun compte de connexion : activation requise">Non activé</span>'}</td>
      <td>
        ${cardLabel(s)}
        ${canMarkCard && !canToggleCardOf(s) ? `<span class="muted-text" title="Votre propre carte doit être validée par un super administrateur.">🔒</span>` : ""}
        ${canToggleCardOf(s) ? `<button class="icon-btn card-toggle-btn" ${pendingCardToggles.has(s.id) ? 'disabled aria-busy="true"' : ""} aria-label="${s.card_paid ? "Marquer la carte comme non payée" : "Marquer la carte comme payée"}" title="${s.card_paid ? "Marquer la carte comme non payée" : "Marquer la carte comme payée"}" onclick="toggleCard('${s.id}')">${s.card_paid ? ICONS.close : ICONS.refresh}</button>` : ""}
      </td>
      <td class="actions">
        <button class="icon-btn" aria-label="Voir la carte membre de ${escapeHtml(`${s.prenom || ""} ${s.nom || ""}`.trim())}" title="Voir la carte membre" onclick="showMemberCard('${s.id}')">▣</button>
        ${canManageMembers ? `<button class="icon-btn" aria-label="Modifier ${escapeHtml(s.nom || "le membre")}" title="Modifier" onclick="editSub('${s.id}')">${ICONS.edit}</button>
        <button class="icon-btn" aria-label="${s.status === "ACTIVE" ? "Désactiver" : "Activer"} ${escapeHtml(s.nom || "le membre")}" title="Activer/Désactiver" onclick="toggleSub('${s.id}')">${s.status === "ACTIVE" ? ICONS.pause : ICONS.play}</button>
        ${s.user_id
          ? (canResetAccess ? `<button class="icon-btn" aria-label="Nouvel accès pour ${escapeHtml(s.nom || "le membre")}" title="Nouvel accès (lien ou mot de passe temporaire)" onclick="resetPassword('${s.user_id}')">${ICONS.refresh}</button>` : "")
          : `<button class="icon-btn" aria-label="Activer le compte de ${escapeHtml(s.nom || "le membre")}" title="Activer le compte" onclick="activateMember('${s.id}')">${ICONS.play}</button>`}
        <button class="icon-btn danger" aria-label="Supprimer ${escapeHtml(s.nom || "le membre")}" title="Supprimer" onclick="deleteSub('${s.id}')">${ICONS.trash}</button>` : ""}
        ${canForceDelete ? `<button class="icon-btn force-delete-btn" aria-label="Suppression forcée de ${escapeHtml(s.nom || "le membre")} (paiements inclus)" title="Suppression forcée : membre + paiements des collectes" onclick="forceDeleteSub('${s.id}')">${ICONS.trash}</button>` : ""}
      </td>
      ${mobileMemberCell(s, photoUrls.get(s.id))}
    </tr>
  `).join("") || `<tr><td colspan="${columnCount()}" class="empty">Aucun résultat</td></tr>`;

  $("#pageInfo").textContent = `Page ${page} / ${totalPages}`;
  if ($("#memberResultCount")) $("#memberResultCount").textContent = `${filtered.length} résultat(s) sur ${allSubs.length} membre(s)`;
  $("#prev").disabled = page <= 1;
  $("#next").disabled = page >= totalPages;
}

/* ------------------------------------------------------------
   Phone layout: one compact card per member (CSS shows this cell
   instead of the table cells below 640px) + an action sheet.
------------------------------------------------------------ */
function mobileMemberCell(s, photoUrl) {
  const name = `${s.prenom || ""} ${s.nom || ""}`.trim() || "Sans nom";
  const initial = escapeHtml((s.prenom || s.nom || "?").charAt(0).toUpperCase());
  const meta = [s.numero_abonnement ? `N° ${s.numero_abonnement}` : "", facultyShort(s.faculties?.name) || ""].filter(Boolean).join(" · ");
  const chips = [
    canViewDetails && s.zones?.name ? `<span class="m-chip">${escapeHtml(s.zones.name)}</span>` : "",
    canViewIdentity ? genderLabel(s.gender) : "",
    canViewIdentity && s.cin ? `<span class="m-chip">CIN ${escapeHtml(s.cin)}</span>` : "",
    cardLabel(s),
    s.user_id ? "" : '<span class="status-badge warning">Non activé</span>'
  ].filter(Boolean).join("");
  return `<td class="m-summary">
    <div class="m-head">
      <span class="m-avatar">${photoUrl ? `<img src="${escapeHtml(photoUrl)}" alt="">` : initial}</span>
      <div class="m-id"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(meta || "—")}</small></div>
      ${statusBadge(s.status)}
    </div>
    <div class="m-chips">${chips}</div>
    <div class="m-actions">
      <button type="button" class="btn secondary sm" onclick="showMemberCard('${s.id}')">▣ Carte</button>
      ${canManageMembers ? `<button type="button" class="btn secondary sm" onclick="editSub('${s.id}')">${ICONS.edit} Modifier</button>` : ""}
      ${memberActionList(s).length ? `<button type="button" class="btn secondary sm m-more" aria-label="Plus d’actions pour ${escapeHtml(name)}" onclick="openMemberActions('${s.id}')"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></button>` : ""}
    </div>
  </td>`;
}

// Secondary actions offered in the phone action sheet (same permissions as the table buttons).
function memberActionList(s) {
  const list = [];
  if (canToggleCardOf(s)) list.push({ label: s.card_paid ? "Marquer la carte non payée" : "Marquer la carte payée", run: () => toggleCard(s.id) });
  if (canManageMembers) {
    list.push({ label: s.status === "ACTIVE" ? "Désactiver le membre" : "Réactiver le membre", run: () => toggleSub(s.id) });
    if (s.user_id && canResetAccess) list.push({ label: "Nouvel accès (lien / mot de passe)", run: () => resetPassword(s.user_id) });
    if (!s.user_id) list.push({ label: "Activer le compte de connexion", run: () => activateMember(s.id) });
    list.push({ label: "Supprimer", danger: true, run: () => deleteSub(s.id) });
  }
  if (canForceDelete) list.push({ label: "Suppression forcée (paiements inclus)", danger: true, strong: true, run: () => forceDeleteSub(s.id) });
  return list;
}

window.openMemberActions = id => {
  const s = allSubs.find(x => x.id === id);
  if (s) openActionSheet(`${s.prenom || ""} ${s.nom || ""}`.trim(), s.numero_abonnement ? `N° ${s.numero_abonnement}` : "Membre", memberActionList(s));
};

async function openMemberCard(subscriber) {
  const user = subscriber || {};
  const photoUrl = canViewIdentity ? await getSubscriberPhotoUrl(user.photo_url) : "";
  const card = renderVirtualMemberCard(user, { photoUrl }) + `
    <div class="member-card-wrap vcard-staff-details">
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
        ${canViewIdentity ? `<div><span>Téléphone</span><strong>${escapeHtml(user.phone || "—")}</strong></div>
        <div><span>Email</span><strong>${escapeHtml(user.email || "—")}</strong></div>` : ""}
        <div><span>Faculté</span><strong>${escapeHtml(user.faculties?.name || "—")}</strong></div>
        <div><span>Zone</span><strong>${escapeHtml(user.zones?.name || "—")}</strong></div>
        ${canViewIdentity ? `<div><span>Sexe</span><strong>${escapeHtml(user.gender === "FEMALE" ? "Femme" : user.gender === "MALE" ? "Homme" : "Non défini")}</strong></div>` : ""}
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

// Shows a single-use activation link or a temporary password exactly once. It is
// not stored in the page; the member must set their own password at first login
// (verified by the database).
async function showAccess(title, result) {
  const secret = result.activation_link || result.temporary_password;
  const isLink = Boolean(result.activation_link);
  const explanation = isLink
    ? "Envoyez ce lien au membre par un canal sûr. Il ne fonctionne qu’une fois et expire (durée définie dans Supabase Auth). Il ne sera plus affiché."
    : "Remettez ce mot de passe temporaire au membre par un canal sûr. Il expire après 7 jours et ne sera plus affiché.";
  if (window.Swal) {
    await Swal.fire({
      ...swalBase(),
      titleText: title,
      html: `<p>${escapeHtml(explanation)}</p>
        <p><code class="temp-password">${escapeHtml(secret)}</code></p>
        <p class="hint">Le membre choisira son propre mot de passe à la première connexion.</p>`,
      icon: "success",
      showDenyButton: Boolean(navigator.clipboard),
      denyButtonText: "Copier",
      confirmButtonText: "Terminé",
      preDeny: async () => { await navigator.clipboard.writeText(secret); return false; }
    });
  } else {
    window.prompt(`${title} — ${isLink ? "lien d’activation" : "mot de passe temporaire"} (affiché une seule fois) :`, secret);
  }
}

async function callAdminFunction(name, payload) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { ok: false, status: 401, result: { error: "Session administrateur expirée." } };
  let response;
  try {
    response = await fetch(`${UE_CONFIG.SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: UE_CONFIG.SUPABASE_ANON_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch (_) {
    // Network failure: the request may or may not have reached the server.
    return { ok: false, status: 0, result: { error: "Le serveur n’a pas répondu. Rechargez la liste avant de réessayer : l’action a peut-être été enregistrée." } };
  }
  let result = {};
  try { result = await response.json(); } catch (_) {}
  return { ok: response.ok, status: response.status, result };
}

// Prefer a single-use recovery link; fall back to a temporary password only if
// links are not configured and the SUPERADMIN confirms.
async function issueAccess(functionName, payload, title) {
  let call = await callAdminFunction(functionName, { ...payload, method: "link" });
  if (!call.ok && call.result.code === "link_unavailable") {
    const fallback = await confirmDialog("Les liens d’activation ne sont pas configurés. Générer plutôt un mot de passe temporaire (affiché une seule fois) ?", { confirmText: "Mot de passe temporaire", icon: "question" });
    if (!fallback) return false;
    call = await callAdminFunction(functionName, functionName === "admin-reset-password" ? { ...payload, generate: true } : { ...payload, method: "temporary_password" });
  }
  if (!call.ok || !(call.result.activation_link || call.result.temporary_password)) {
    showAlert("#pageAlert", call.result.error || "Opération impossible.", "error");
    return false;
  }
  await showAccess(title, call.result);
  return true;
}

window.activateMember = async subscriberId => {
  if (!canManageMembers || !subscriberId) return;
  if (!(await confirmDialog("Créer le compte de connexion de ce membre et générer son accès ?", { confirmText: "Activer", icon: "question" }))) return;
  if (await issueAccess("admin-activate-member", { subscriber_id: subscriberId }, "Compte activé")) await loadSubs();
};

window.resetPassword = async userId => {
  if (!canResetAccess || !userId) return;
  if (!(await confirmDialog("Générer un nouvel accès pour ce membre ? Il devra choisir un nouveau mot de passe.", { confirmText: "Générer", icon: "question" }))) return;
  await issueAccess("admin-reset-password", { user_id: userId }, "Nouvel accès généré");
};

// SUPERADMIN only (the server checks it too): deletes the member and ALL their
// collection payments, whatever their state. Recorded in the audit log.
window.forceDeleteSub = async (id, reason = "") => {
  if (!canForceDelete) return;
  const member = allSubs.find(x => x.id === id);
  const name = `${member?.prenom || ""} ${member?.nom || ""}`.trim() || "ce membre";
  const typed = await promptDialog(`Suppression forcée de ${name}`, {
    placeholder: "Tapez SUPPRIMER pour confirmer",
    confirmText: "Supprimer définitivement",
    validator: value => (String(value || "").trim().toUpperCase() === "SUPPRIMER" ? undefined : "Tapez SUPPRIMER pour confirmer."),
    text: `${reason ? reason + " " : ""}Le membre, son compte de connexion et TOUS ses paiements dans les collectes seront supprimés définitivement (action enregistrée dans le journal).`
  });
  if (typed === null) return;
  const call = await callAdminFunction("admin-delete-user", { subscriber_id: id, force: true });
  if (!call.ok) {
    if (call.result.code === "account_delete_failed" || call.result.code === "record_delete_failed") await loadSubs();
    return showAlert("#pageAlert", call.result.error || "Suppression impossible.", "error");
  }
  const parts = [`${name} supprimé`];
  if (call.result.payments_deleted) parts.push(`${call.result.payments_deleted} paiement(s) supprimé(s)`);
  if (call.result.account_kept) parts.push("compte du personnel conservé");
  showAlert("#pageAlert", parts.join(" · ") + ".");
  await loadSubs();
};

window.deleteSub = async id => {
  if (!canManageMembers) return;
  if (!(await confirmDialog("Supprimer cet abonné et son compte ? Cette action est irréversible.", { confirmText: "Supprimer" }))) return;

  const call = await callAdminFunction("admin-delete-user", { subscriber_id: id });
  if (!call.ok && call.result.code === "has_payments" && canForceDelete) return forceDeleteSub(id, call.result.error);
  if (!call.ok && call.result.code === "has_payments") {
    // Members with collection payments are kept: offer to deactivate instead.
    const member = allSubs.find(x => x.id === id);
    if (member?.status === "ACTIVE" && await confirmDialog(
      `${call.result.error} Désactiver ${member.prenom || ""} ${member.nom || ""} maintenant ?`.trim(),
      { title: "Suppression impossible", confirmText: "Désactiver", icon: "info" })) {
      await toggleSub(id);
      return showAlert("#pageAlert", "Membre désactivé (son historique de paiements est conservé).");
    }
    return showAlert("#pageAlert", call.result.error, "error");
  }
  if (!call.ok) return showAlert("#pageAlert", call.result.error || "Suppression impossible.", "error");
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
    await Swal.fire({ ...swalBase(), titleText: title, html: `<p>${escapeHtml(intro)}</p>${importErrorListHtml(errors)}`, icon: "error", width: 760, confirmButtonText: "Fermer" });
  } else {
    alert(`${title}\n${intro}\n\n${errors.slice(0, 20).map(e => e.message || e).join("\n")}`);
  }
}

// The import is all-or-nothing: the file is refused if a required column is
// missing, a column is ambiguous or any row is invalid. The Edge Function
// re-validates everything (including faculty / zone names and duplicates)
// before writing.
async function importMembersCsv(file) {
  if (!canImportMembers) return;
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
      ["Nouveaux membres", metric(result.created)],
      ["Comptes à activer", metric(result.pending_activation)],
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
  canImportMembers = can(ctx, "importMembers");
  canResetAccess = can(ctx, "resetMemberAccess");
  canForceDelete = can(ctx, "forceDeleteMembers");
  if (!canViewDetails) {
    $$(".col-private").forEach(th => th.remove());
    $("#genderFilter")?.remove();
  }
  if (!canViewIdentity) {
    $$(".col-identity").forEach(th => th.remove());
    $("#genderFilter")?.remove();
  }

  setupShell(ctx);
  setupFacultyCombo();
  await loadRefs();
  await loadSubs();

  $("#search").oninput = apply;
  $("#statusFilter").onchange = apply;
  if ($("#genderFilter")) $("#genderFilter").onchange = apply;
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
  $("#importCsvBtn").classList.toggle("hidden", !canImportMembers);
  $("#importCsvBtn").onclick = () => $("#csvFile").click();
  $("#csvFile").addEventListener("change", async e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) await importMembersCsv(file); });
  $("#closeModal").onclick = () => $("#modal").classList.add("hidden");
  $("#cancelModal").onclick = () => $("#modal").classList.add("hidden");
  $("#closeMemberCardModal").onclick = () => $("#memberCardModal").classList.add("hidden");
}

// One save at a time: a second click while a member is being created would create it twice.
let savingSubscriber = false;
$("#subscriberForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (savingSubscriber) return;
  savingSubscriber = true;
  const submit = e.submitter || $("#subscriberForm [type=submit]");
  submit?.setAttribute("disabled", "");
  submit?.setAttribute("aria-busy", "true");
  try {
    await saveSubscriber();
  } finally {
    savingSubscriber = false;
    submit?.removeAttribute("disabled");
    submit?.removeAttribute("aria-busy");
  }
});

async function saveSubscriber() {
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
    const call = await callAdminFunction("admin-create-user", payload);
    const result = call.result;
    if (!call.ok) return showAlert("#pageAlert", result.error || "Création impossible.", "error");
    if (result.activated) {
      showAlert("#pageAlert", "Abonné créé et compte activé.");
      await showAccess("Compte membre créé", result);
    } else {
      showAlert("#pageAlert", `Abonné créé, compte non activé : ${result.activation_error || "activez-le depuis la liste."}`, "error");
    }
  }

  $("#modal").classList.add("hidden");
  await loadSubs();
}

init();
