let canManageAdmins = false;
let admins = [];
let currentCtx = null;
const fn = (name) => `${UE_CONFIG.SUPABASE_URL}/functions/v1/${name}`;

async function callFn(name, body) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error("Session administrateur expirée.");

  const r = await fetch(fn(name), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: UE_CONFIG.SUPABASE_ANON_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  let j = {};
  try { j = await r.json(); } catch (_) {}
  if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
  return j;
}

function getSelectedRoles() {
  return [...document.querySelectorAll(".role-checkbox:checked")]
    .map(el => String(el.value).trim().toUpperCase())
    .filter(Boolean);
}

function setSelectedRoles(roles) {
  const normalized = normalizeRoleNames(roles || []);
  document.querySelectorAll(".role-checkbox").forEach(box => {
    box.checked = normalized.includes(String(box.value).trim().toUpperCase());
  });
}

function renderRoleBadges(roleList) {
  const roles = normalizeRoleNames(roleList || []);
  if (!roles.length) return '<span class="badge inactive">—</span>';
  return roles.map(role => `<span class="badge ${role === "SUPERADMIN" ? "active" : "inactive"}">${escapeHtml(role)}</span>`).join(" ");
}

async function loadAdmins() {
  const { data, error } = await sb
    .from("profiles")
    .select("id,display_name,is_active,created_at")
    .order("created_at", { ascending: true });

  if (error) {
    $("#adminRows").innerHTML = '<tr><td colspan="6" class="empty">Impossible de charger les comptes. Réessayez.</td></tr>';
    return showAlert("#pageAlert", "Impossible de charger les administrateurs.", "error");
  }

  const adminIds = (data || []).map(item => item.id);
  let roleRows = [];

  if (adminIds.length) {
    // Batches of 50 ids: one in.(…) filter with every account id makes the URL (and
    // the response headers echoing it) grow with each member, until the gateway
    // refuses it. 50 UUIDs ≈ 2 KB per request.
    const batches = [];
    for (let i = 0; i < adminIds.length; i += 50) batches.push(adminIds.slice(i, i + 50));
    const results = await Promise.all(batches.map(ids => sb.from("user_roles").select("user_id,role").in("user_id", ids)));

    if (results.some(r => r.error)) {
      $("#adminRows").innerHTML = '<tr><td colspan="6" class="empty">Impossible de charger les rôles. Réessayez.</td></tr>';
      return showAlert("#pageAlert", "Impossible de charger les rôles des comptes.", "error");
    }
    roleRows = results.flatMap(r => r.data || []);
  }

  const byUser = {};
  for (const row of roleRows) {
    if (!byUser[row.user_id]) byUser[row.user_id] = [];
    byUser[row.user_id].push(String(row.role ?? row.role_name ?? "").toUpperCase());
  }

  const rolesFor = a => normalizeRoleNames(byUser[a.id] || []);

  // Account emails are withheld from the table API; only SUPERADMIN can read
  // them, through get_account_contacts(). ADMIN never receives them.
  const emails = new Map();
  if (canManageAdmins) {
    const { data: contacts, error: contactError } = await sb.rpc("get_account_contacts");
    if (contactError) return showAlert("#pageAlert", "Impossible de charger les adresses des comptes.", "error");
    for (const contact of contacts || []) emails.set(contact.user_id, contact.email);
  }

  admins = (data || [])
    // Staff page: only ADMIN / SUPERADMIN accounts. Members are listed on the Abonnés page.
    .filter(a => rolesFor(a).some(role => role === "ADMIN" || role === "SUPERADMIN"))
    .map(a => ({
      ...a,
      email: emails.get(a.id) ?? null,
      roles: rolesFor(a)
    }));

  render();
}

function render() {
  const superAdmin = canManageAdmins;
  $("#addAdminBtn")?.classList.toggle("hidden", !superAdmin);

  $("#adminRows").innerHTML = admins.map(a => {
    const mayDeleteAccount = !a.roles.includes("MEMBER") && a.roles.some(role => ["ADMIN", "SUPERADMIN"].includes(role));
    return `
      <tr>
        <td>${escapeHtml(a.display_name || "—")}</td>
        <td>${superAdmin ? escapeHtml(a.email || "—") : '<span class="muted-text">Masqué</span>'}</td>
        <td>${renderRoleBadges(a.roles)}</td>
        <td>${statusBadge(a.is_active === false ? "INACTIVE" : "ACTIVE")}</td>
        <td>${escapeHtml(new Date(a.created_at).toLocaleDateString("fr-TN"))}</td>
        <td class="actions">${superAdmin ? `
          <button class="icon-btn" aria-label="Modifier ${escapeHtml(a.display_name || "le compte")}" title="Modifier" onclick="editAdmin('${a.id}')">${ICONS.edit}</button>
          <button class="icon-btn" aria-label="Activer ou désactiver ${escapeHtml(a.display_name || "le compte")}" title="Activer/Désactiver" onclick="toggleAdmin('${a.id}')">${a.is_active === false ? ICONS.play : ICONS.pause}</button>
          <button class="icon-btn" aria-label="Réinitialiser le mot de passe" title="Réinitialiser mot de passe" onclick="resetAdmin('${a.id}')">${ICONS.refresh}</button>
          ${mayDeleteAccount ? `<button class="icon-btn danger" aria-label="Supprimer le compte ${escapeHtml(a.display_name || "")}" title="Supprimer le compte administrateur" onclick="deleteAdmin('${a.id}')">${ICONS.trash}</button>` : ""}
        ` : "—"}</td>
      </tr>
    `;
  }).join("") || '<tr><td colspan="6" class="empty">Aucun compte à afficher</td></tr>';

  $("#addAdminBtn").style.display = superAdmin ? "" : "none";
}

function openAdmin(a = null) {
  $("#adminModal").classList.remove("hidden");
  $("#adminModalTitle").textContent = a ? "Modifier l'administrateur" : "Ajouter un administrateur";
  $("#adminId").value = a?.id || "";
  $("#adminName").value = a?.display_name || "";
  $("#adminEmail").value = a?.email || "";
  $("#adminPassword").value = "";
  $("#adminPassword").required = !a;
  setSelectedRoles(a?.roles || ["ADMIN"]);
  $("#adminForm button[type=submit]").textContent = a ? "Enregistrer les modifications" : "Créer l'administrateur";
}

window.editAdmin = id => {
  if (!canManageAdmins) return;
  openAdmin(admins.find(x => x.id === id));
};

window.toggleAdmin = async id => {
  if (!canManageAdmins) return;
  try {
    const a = admins.find(x => x.id === id);
    if (!a) return;
    await callFn("admin-update-admin", { user_id: id, is_active: a.is_active === false });
    await loadAdmins();
    showAlert("#pageAlert", "Statut mis à jour.");
  } catch (e) {
    showAlert("#pageAlert", e.message, "error");
  }
};

window.resetAdmin = async id => {
  if (!canManageAdmins) return;
  const p = await promptDialog("Nouveau mot de passe", {
    input: "password",
    placeholder: "12 caractères min. : majuscule, minuscule, chiffre, spécial",
    confirmText: "Réinitialiser"
  });
  if (!p) return;

  try {
    await callFn("admin-reset-password", { user_id: id, new_password: p });
    showAlert("#pageAlert", "Mot de passe réinitialisé.");
  } catch (e) {
    showAlert("#pageAlert", e.message, "error");
  }
};

window.deleteAdmin = async id => {
  if (!canManageAdmins) return;
  if (!(await confirmDialog("Supprimer définitivement cet administrateur ?", { confirmText: "Supprimer" }))) return;

  try {
    await callFn("admin-delete-admin", { user_id: id });
    await loadAdmins();
    showAlert("#pageAlert", "Administrateur supprimé.");
  } catch (e) {
    showAlert("#pageAlert", e.message, "error");
  }
};

$("#adminForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!canManageAdmins) return;

  const id = $("#adminId").value;
  const editingCurrentUser = Boolean(id && id === currentCtx?.user?.id);
  const roles = getSelectedRoles();

  if (!roles.length) {
    return showAlert("#adminFormAlert", "Sélectionnez au moins un rôle.", "error");
  }

  try {
    if (id) {
      await callFn("admin-update-admin", {
        user_id: id,
        display_name: $("#adminName").value.trim(),
        email: $("#adminEmail").value.trim(),
        roles,
        is_treasurer: roles.includes("TREASURER")
      });
      showAlert("#pageAlert", "Administrateur modifié.");
    } else {
      const p = $("#adminPassword").value;
      if (p.length < 12) return showAlert("#adminFormAlert", "Mot de passe trop faible.", "error");

      await callFn("admin-create-admin", {
        display_name: $("#adminName").value.trim(),
        email: $("#adminEmail").value.trim(),
        password: p,
        roles
      });

      showAlert("#pageAlert", "Administrateur créé. Il devra changer son mot de passe à la première connexion.");
    }

    $("#adminModal").classList.add("hidden");
    await loadAdmins();
    if (editingCurrentUser) location.reload();
  } catch (e) {
    showAlert("#adminFormAlert", e.message, "error");
  }
});

$("#addAdminBtn").onclick = () => {
  if (canManageAdmins) openAdmin();
};
$("#closeAdminModal").onclick = () => $("#adminModal").classList.add("hidden");
$("#adminModal").addEventListener("click", e => {
  if (e.target === $("#adminModal")) $("#adminModal").classList.add("hidden");
});

(async () => {
  currentCtx = await requirePermission("viewUsers");
  if (!currentCtx) return;
  canManageAdmins = can(currentCtx, "manageUsers");
  setupShell(currentCtx);
  await loadAdmins();
})();
