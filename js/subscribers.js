let allSubs = [];
let filtered = [];
let page = 1;
const pageSize = 10;

let allFaculties = [];
let currentCtx = null;
let canManageMembers = false;
let canMarkCard = false;
const { csvField, parseCsv } = window.UE_CSV;

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

async function loadSubs() {
  const { data, error } = await sb
    .from("subscribers")
    .select("*,faculties(name),zones(name)")
    .order("nom", { ascending: true });

  if (error) {
    $("#rows").innerHTML = '<tr><td colspan="11" class="empty">Impossible de charger les membres. Réessayez.</td></tr>';
    return showAlert("#pageAlert", error.message, "error");
  }
  allSubs = data || [];
  apply();
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
  const photoEntries = await Promise.all(rows.filter(s => s.photo_url).map(async s => [s.id, await getSubscriberPhotoUrl(s.photo_url)]));
  if (renderRequest !== subscriberRenderRequest) return;
  const photoUrls = new Map(photoEntries);

  $("#rows").innerHTML = rows.map(s => `
    <tr>
      <td class="member-thumb-cell">
        ${photoUrls.get(s.id) ? `<img src="${escapeHtml(photoUrls.get(s.id))}" alt="Photo de ${escapeHtml(s.prenom || "membre")}" class="member-thumb" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-flex';">` : ""}
        <span class="member-thumb-fallback" ${photoUrls.get(s.id) ? 'style="display:none;"' : ''}>${escapeHtml((s.prenom || "A").charAt(0).toUpperCase())}</span>
      </td>
      <td>${escapeHtml(s.nom)}</td>
      <td>${escapeHtml(s.prenom)}</td>
      <td>${genderLabel(s.gender)}</td>
      <td>${escapeHtml(s.numero_abonnement)}</td>
      <td>${escapeHtml(s.cin)}</td>
      <td>${escapeHtml(facultyShort(s.faculties?.name) || "—")}</td>
      <td>${escapeHtml(s.zones?.name || "—")}</td>
      <td>${statusBadge(s.status)}</td>
      <td>
        ${cardLabel(s)}
        ${canMarkCard ? `<button class="icon-btn card-toggle-btn" aria-label="${s.card_paid ? "Marquer la carte comme non payée" : "Marquer la carte comme payée"}" title="${s.card_paid ? "Marquer la carte comme non payée" : "Marquer la carte comme payée"}" onclick="toggleCard('${s.id}')">${s.card_paid ? ICONS.close : ICONS.refresh}</button>` : ""}
      </td>
      <td class="actions">
        <button class="icon-btn" aria-label="Voir la carte membre de ${escapeHtml(`${s.prenom || ""} ${s.nom || ""}`.trim())}" title="Voir la carte membre" onclick="showMemberCard('${s.id}')">▣</button>
        ${canManageMembers ? `<button class="icon-btn" aria-label="Modifier ${escapeHtml(s.nom || "le membre")}" title="Modifier" onclick="editSub('${s.id}')">${ICONS.edit}</button>
        <button class="icon-btn" aria-label="${s.status === "ACTIVE" ? "Désactiver" : "Activer"} ${escapeHtml(s.nom || "le membre")}" title="Activer/Désactiver" onclick="toggleSub('${s.id}')">${s.status === "ACTIVE" ? ICONS.pause : ICONS.play}</button>
        <button class="icon-btn" aria-label="Réinitialiser le mot de passe" title="Réinitialiser mot de passe" onclick="resetPassword('${s.user_id}')">${ICONS.refresh}</button>
        <button class="icon-btn danger" aria-label="Supprimer ${escapeHtml(s.nom || "le membre")}" title="Supprimer" onclick="deleteSub('${s.id}')">${ICONS.trash}</button>` : ""}
      </td>
    </tr>
  `).join("") || '<tr><td colspan="11" class="empty">Aucun résultat</td></tr>';

  $("#pageInfo").textContent = `Page ${page} / ${totalPages}`;
  if ($("#memberResultCount")) $("#memberResultCount").textContent = `${filtered.length} résultat(s) sur ${allSubs.length} membre(s)`;
  $("#prev").disabled = page <= 1;
  $("#next").disabled = page >= totalPages;
}

async function openMemberCard(subscriber) {
  const user = subscriber || {};
  const photoUrl = await getSubscriberPhotoUrl(user.photo_url);
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
        <div><span>CIN</span><strong>${escapeHtml(user.cin || "—")}</strong></div>
        <div><span>Téléphone</span><strong>${escapeHtml(user.phone || "—")}</strong></div>
        <div><span>Email</span><strong>${escapeHtml(user.email || "—")}</strong></div>
        <div><span>Faculté</span><strong>${escapeHtml(user.faculties?.name || "—")}</strong></div>
        <div><span>Zone</span><strong>${escapeHtml(user.zones?.name || "—")}</strong></div>
        <div><span>Sexe</span><strong>${escapeHtml(user.gender === "FEMALE" ? "Femme" : user.gender === "MALE" ? "Homme" : "Non défini")}</strong></div>
        <div><span>Adresse</span><strong>${escapeHtml(user.adresse || "—")}</strong></div>
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
    fLogin: s?.login_name || "DHIASOUDA",
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

  $("#fPhotoFile").value = "";
  $("#fGender").value = s?.gender || "";
  selectFaculty(s?.faculty_id || "", s?.faculties?.name || "");
  $("#fZone").value = s?.zone_id || "";
  $("#fStatus").value = s?.status || "ACTIVE";
}

window.editSub = id => openModal(allSubs.find(s => s.id === id));

window.toggleSub = async id => {
  const s = allSubs.find(x => x.id === id);
  if (!s) return;

  const { error } = await sb
    .from("subscribers")
    .update({ status: s.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })
    .eq("id", id);

  if (error) return showAlert("#pageAlert", error.message, "error");
  await loadSubs();
};

window.toggleCard = async id => {
  const s = allSubs.find(x => x.id === id);
  if (!s) return;

  const nextPaid = !s.card_paid;
  if (nextPaid && !(await confirmDialog(`Confirmer que ${s.prenom} ${s.nom} a payé sa carte membre ?`, { confirmText: "Oui, payée", icon: "question" }))) return;

  const { error } = await sb
    .from("subscribers")
    .update({ card_paid: nextPaid, card_paid_at: nextPaid ? new Date().toISOString() : null })
    .eq("id", id);

  if (error) return showAlert("#pageAlert", error.message, "error");
  showAlert("#pageAlert", nextPaid ? "Carte marquée comme payée." : "Carte marquée comme non payée.");
  await loadSubs();
};

window.resetPassword = async userId => {
  const password = await promptDialog("Nouveau mot de passe", {
    input: "password",
    placeholder: "12 caractères min. : majuscule, minuscule, chiffre, spécial",
    confirmText: "Réinitialiser"
  });
  if (!password) return;
  if (password.length < 12) return showAlert("#pageAlert", "Le mot de passe doit contenir au moins 12 caractères.", "error");
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) return showAlert("#pageAlert", "Utilisez une majuscule, une minuscule, un chiffre et un caractère spécial.", "error");

  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showAlert("#pageAlert", "Session administrateur expirée.", "error");

  const response = await fetch(`${UE_CONFIG.SUPABASE_URL}/functions/v1/admin-reset-password`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: UE_CONFIG.SUPABASE_ANON_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ user_id: userId, new_password: password })
  });

  let result = {};
  try { result = await response.json(); } catch (_) {}

  if (!response.ok) {
    return showAlert("#pageAlert", result.error || "Réinitialisation impossible.", "error");
  }

  showAlert("#pageAlert", "Mot de passe réinitialisé. Le changement sera demandé à la prochaine connexion.");
};

window.deleteSub = async id => {
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


async function importMembersCsv(file) {
  if (!canManageMembers) return;
  let rows;
  try {
    rows = parseCsv(await file.text());
  } catch (_) {
    return showAlert("#pageAlert", "Impossible de lire ce fichier CSV. Vérifiez son format puis réessayez.", "error");
  }
  if (!rows.length) return showAlert("#pageAlert", "Le fichier CSV est vide.", "error");

  const payload = rows.map(r => ({
    email: csvField(r, ["mail", "email", "e-mail", "البريد الإلكتروني", "البريد الالكتروني"]),
    nom: csvField(r, ["nom", "name", "اللقب", "اسم العائلة", "الاسم العائلي"]),
    prenom: csvField(r, ["prenom", "prénom", "first name", "firstname", "الاسم", "الإسم", "الاسم الأول", "الاسم الشخصي"]),
    numero_abonnement: csvField(r, ["numero d abonnement", "numero abonnement", "n abonnement", "numero", "abonnement", "رقم الاشتراك", "رقم المنخرط"]),
    login: csvField(r, ["login", "identifiant", "username", "اسم الدخول"]),
    cin: csvField(r, ["cin", "بطاقة التعريف الوطنية", "رقم بطاقة التعريف"]),
    gender: csvField(r, ["sexe", "gender", "الجنس"]),
    phone: csvField(r, ["telephone", "téléphone", "phone", "tel", "الهاتف", "رقم الهاتف"]),
    adresse: csvField(r, ["address", "adresse", "العنوان"]),
    faculty: csvField(r, ["faculte", "faculté", "faculty", "الكلية", "المؤسسة"]),
    zone: csvField(r, ["zone", "المنطقة"])
  }));

  const validRows = payload.filter(x => x.nom && x.prenom && x.cin && x.gender);
  const invalidCount = payload.length - validRows.length;
  const withoutSubscription = validRows.filter(x => !x.numero_abonnement).length;
  const withSubscription = validRows.length - withoutSubscription;
  const previewRows = payload.slice(0, 8).map((row, index) => {
    const valid = row.nom && row.prenom && row.cin && row.gender;
    return `<tr><td>${index + 2}</td><td>${escapeHtml(`${row.prenom} ${row.nom}`.trim() || "—")}</td><td>${escapeHtml(row.gender || "—")}</td><td>${escapeHtml(row.numero_abonnement || "—")}</td><td><span class="status-badge ${valid ? "success" : "warning"}">${valid ? "Valide" : "À corriger"}</span></td></tr>`;
  }).join("");

  if (!validRows.length) {
    return showAlert("#pageAlert", "Aucune ligne valide. Nom, prénom, CIN et sexe sont obligatoires; le numéro d’abonnement reste optionnel.", "error");
  }

  const previewHtml = `
    <p>Les membres existants seront mis à jour. Aucune ligne existante ne sera remplacée ou supprimée.</p>
    <div class="csv-summary">
      <div><strong>${payload.length}</strong><span>Total des lignes</span></div>
      <div><strong>${validRows.length}</strong><span>Lignes valides</span></div>
      <div><strong>${invalidCount}</strong><span>Lignes à corriger</span></div>
      <div><strong>${withSubscription}</strong><span>Avec numéro d’abonnement</span></div>
      <div><strong>${withoutSubscription}</strong><span>Sans numéro d’abonnement</span></div>
    </div>
    <div class="table-wrap csv-preview"><table><thead><tr><th>Ligne</th><th>Membre</th><th>Sexe</th><th>N° abonnement</th><th>Validation</th></tr></thead><tbody>${previewRows}</tbody></table></div>
    ${payload.length > 8 ? `<p class="muted-text">Aperçu des 8 premières lignes sur ${payload.length}.</p>` : ""}
    ${invalidCount ? `<p class="hint">Les ${invalidCount} ligne(s) invalides seront ignorées. Les champs requis sont Nom, Prénom, CIN et Sexe.</p>` : ""}
  `;

  let confirmed = false;
  if (window.Swal) {
    const preview = await Swal.fire({
      ...swalBase(),
      title: "Vérifier l’import CSV",
      html: previewHtml,
      width: 760,
      showCancelButton: true,
      confirmButtonText: `Importer ${validRows.length} ligne(s) valide(s)`,
      cancelButtonText: "Annuler",
      reverseButtons: true,
      focusCancel: true
    });
    confirmed = preview.isConfirmed;
  } else {
    confirmed = await confirmDialog(`Total : ${payload.length}\nValides : ${validRows.length}\nInvalides : ${invalidCount}\nAvec numéro d’abonnement : ${withSubscription}\nSans numéro d’abonnement : ${withoutSubscription}\n\nImporter uniquement les lignes valides ?`, { confirmText: "Importer" });
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
      body: JSON.stringify({ rows: validRows })
    });

    let result = {};
    try { result = await response.json(); } catch (_) {}
    if (!response.ok) return showAlert("#pageAlert", result.error || "Import impossible. Vérifiez le fichier puis réessayez.", "error");

    const errors = Array.isArray(result.errors) ? result.errors : [];
    const metric = value => Number.isFinite(Number(value)) ? String(Number(value)) : "Non communiqué";
    const report = [
      ["Total des lignes", payload.length],
      ["Lignes valides", validRows.length],
      ["Lignes invalides ignorées", invalidCount],
      ["Nouveaux membres", metric(result.created)],
      ["Membres mis à jour", metric(result.updated)],
      ["Doublons signalés", metric(result.duplicates)],
      ["Avec numéro d’abonnement", withSubscription],
      ["Sans numéro d’abonnement", withoutSubscription],
      ["Erreurs signalées", errors.length]
    ];
    const reportHtml = `<div class="csv-summary">${report.map(([label, value]) => `<div><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join("")}</div>`;

    if (window.Swal) {
      await Swal.fire({
        ...swalBase(),
        title: errors.length || invalidCount ? "Import terminé avec des éléments à vérifier" : "Import terminé",
        html: reportHtml,
        icon: errors.length || invalidCount ? "warning" : "success",
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
  const ctx = await requireStaff();
  if (!ctx) return;
  currentCtx = ctx;
  canManageMembers = hasContextRole(ctx, "SUPERADMIN");
  canMarkCard = canManageMembers || hasContextRole(ctx, "TREASURER");

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
    numero_abonnement: $("#fNumero").value.trim(),
    login_name: $("#fLogin").value.trim().toUpperCase(),
    cin: $("#fCin").value.trim(),
    gender,
    phone: $("#fPhone").value.trim(),
    email: $("#fEmail").value.trim(),
    photo_url: photoUrl,
    adresse: $("#fAdresse").value.trim(),
    faculty_id: $("#fFaculte").value || null,
    zone_id: $("#fZone").value || null,
    status: $("#fStatus").value
  };

  if (!payload.nom || !payload.prenom || !payload.login_name || !payload.cin) {
    return showAlert("#pageAlert", "Veuillez remplir tous les champs obligatoires.", "error");
  }

  if (id) {
    const { error } = await sb.from("subscribers").update(payload).eq("id", id);
    if (error) return showAlert("#pageAlert", error.message, "error");
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
  }

  $("#modal").classList.add("hidden");
  await loadSubs();
});

init();
