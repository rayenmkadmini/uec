let original = {};
let clubLogos = new Map();
let profileSaveInProgress = false;

function formatMatchDate(date, time) {
  if (!date) return "Date non définie";
  const d = new Date(`${date}T${time || "12:00:00"}`);
  return d.toLocaleDateString("fr-TN", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric"
  });
}

function formatMatchTime(time) {
  return time ? String(time).slice(0, 5) : "Heure à confirmer";
}

function isMatchUpcoming(match) {
  if (!match || !match.match_date) return false;
  const now = new Date();
  const matchDate = new Date(`${match.match_date}T${match.match_time || "23:59:00"}`);
  return matchDate > now;
}

async function renderMemberCard(subscriber) {
  const card = document.getElementById("subscriberMemberCard");
  if (!card) return;

  const fullName = `${subscriber.prenom || ""} ${subscriber.nom || ""}`.trim() || "Abonné";
  const initials = (subscriber.prenom || subscriber.nom || "A").charAt(0).toUpperCase();
  const photoUrl = await getSubscriberPhotoUrl(subscriber.photo_url);
  const photo = photoUrl ? `<img src="${escapeHtml(photoUrl)}" alt="Photo du membre" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">` : "";

  card.innerHTML = renderVirtualMemberCard(subscriber, { photoUrl });
}

async function loadUpcomingMatches() {
  const container = $("#upcomingMatches");
  if (!container) return;

  const today = new Date().toISOString().slice(0, 10);
  clubLogos = await loadClubLogos();
  const { data, error } = await sb
    .from("matches")
    .select("id,sport,home_team,away_team,home_logo_url,away_logo_url,competition,stadium,match_date,match_time")
    .eq("is_active", true)
    .gte("match_date", today)
    .order("match_date", { ascending: true })
    .order("match_time", { ascending: true })
    .limit(3);

  if (error) {
    container.innerHTML = '<div class="empty-card">Impossible de charger les matchs à venir.</div>';
    return;
  }

  const upcomingMatches = (data || []).filter(isMatchUpcoming);

  if (!upcomingMatches.length) {
    container.innerHTML = '<div class="empty-card">Aucun match programmé prochainement.</div>';
    return;
  }

  container.innerHTML = upcomingMatches.map(match => {
    const homeTeam = match.home_team || "Équipe domicile";
    const awayTeam = match.away_team || "Équipe visiteuse";
    const matchDate = new Date(`${match.match_date}T${match.match_time || "12:00:00"}`);
    const day = matchDate.toLocaleDateString("fr-TN", { day: "2-digit" });
    const month = matchDate.toLocaleDateString("fr-TN", { month: "short" }).replace(".", "").replace(".", "");
    const weekday = matchDate.toLocaleDateString("fr-TN", { weekday: "short" }).replace(".", "");

    return `
      <article class="match-card agenda-match-card">
        <div class="agenda-date">
          <span>${escapeHtml(weekday)}</span>
          <strong>${escapeHtml(day)}</strong>
          <small>${escapeHtml(month)}</small>
        </div>
        <div class="agenda-content">
          <div class="match-card-top">
            <span class="sport-pill">${escapeHtml(match.sport || "Match")}</span>
            ${match.competition ? `<span class="competition">${escapeHtml(match.competition)}</span>` : ""}
          </div>
          <div class="agenda-teams">
            <div class="team-side">
              ${teamLogoImg(homeTeam, "HOME", match.home_logo_url, clubLogos)}
              <span>${escapeHtml(homeTeam)}</span>
            </div>
            <div class="vs-badge">VS</div>
            <div class="team-side">
              ${teamLogoImg(awayTeam, "AWAY", match.away_logo_url, clubLogos)}
              <span>${escapeHtml(awayTeam)}</span>
            </div>
          </div>
          <div class="match-info">
            <span>🕐 ${escapeHtml(formatMatchTime(match.match_time))}</span>
            ${match.stadium ? `<span>📍 ${escapeHtml(match.stadium)}</span>` : ""}
          </div>
        </div>
      </article>
    `;
  }).join("");
}

// CIN, address, date of birth, phone, email, gender and photo are not selectable
// through the table API; the member reads their own values through get_member_private_fields().
const OWN_MEMBER_COLUMNS = "id,user_id,nom,prenom,login_name,numero_abonnement," +
  "faculty_id,zone_id,status,card_paid,card_paid_at,faculties(name),zones(name)";

async function withOwnPrivateFields(subscriber) {
  if (!subscriber) return { data: null, error: null };
  const { data, error } = await sb.rpc("get_member_private_fields", { p_subscriber_id: subscriber.id });
  if (error) return { data: null, error };
  const own = (data || [])[0] || {};
  return {
    data: {
      ...subscriber,
      cin: own.cin ?? null, adresse: own.adresse ?? null, date_naissance: own.date_naissance ?? null,
      phone: own.phone ?? null, email: own.email ?? null,
      gender: own.gender ?? null, photo_url: own.photo_url ?? null
    },
    error: null
  };
}

(async function init() {
  const ctx = await requirePermission("useMemberArea"); if (!ctx) return;
  setupShell(ctx);
  const row = await sb.from("subscribers").select(OWN_MEMBER_COLUMNS).eq("user_id", ctx.user.id).maybeSingle();
  const { data: s, error } = row.error ? row : await withOwnPrivateFields(row.data);
  if (error) {
    showAlert("#pageAlert","Impossible de charger votre profil.","error");
    $("#statusBadge").textContent = "Statut indisponible";
    $("#subscriberMemberCard").innerHTML = '<div class="empty-card">Impossible de charger votre carte membre. Rechargez la page.</div>';
    const upcoming = $("#upcomingMatches");
    if (upcoming) upcoming.innerHTML = '<div class="empty-card">Impossible de charger les matchs à venir.</div>';
    $("#editBtn")?.classList.add("hidden");
    return;
  }
  if (!s) {
    // Staff accounts that also hold MEMBER may have no member record: send them to their profile page.
    if (can(ctx, "viewStaffProfile")) { location.href = "profile.html"; return; }
    $("#statusBadge").textContent = "Profil membre introuvable";
    $("#subscriberMemberCard").innerHTML = '<div class="empty-card">Aucun profil membre n’est associé à ce compte. Contactez l’administration.</div>';
    $("#editBtn").classList.add("hidden");
    return;
  }
  original = s;
  $("#welcomeName").textContent = `${s.prenom || ""} ${s.nom || ""}`.trim() || "Membre";
  $("#userName").textContent = `${s.prenom || ""} ${s.nom || ""}`.trim();
  $("#avatar").textContent = (s.prenom || s.nom || "U").charAt(0).toUpperCase();
  $("#statusBadge").outerHTML = `<span id="statusBadge" class="badge ${s.status === "ACTIVE" ? "active" : "inactive"}">${s.status === "ACTIVE" ? "Abonnement actif" : "Abonnement désactivé"}</span>`;
  $("#nom").value=s.nom||""; $("#prenom").value=s.prenom||""; $("#numero").value=s.numero_abonnement||"";
  await loadProfileChoices(s);
  fillProfileForm(s);
  $("#editBtn").onclick=()=>{ setProfileEditable(true); $("#saveRow").classList.remove("hidden"); $("#editBtn").classList.add("hidden"); $("#nom").focus(); };
  $("#cancelBtn").onclick=()=>location.reload();
    await renderMemberCard(s);
  const cardPanel = document.querySelector("#subscriberMemberCard")?.closest(".panel");
  $("#printMemberCardBtn").onclick = () => {
    if (cardPanel) cardPanel.classList.add("print-card-section");
    document.body.classList.add("print-card-mode");
    window.print();
  };
  window.addEventListener("afterprint", () => {
    document.body.classList.remove("print-card-mode");
    if (cardPanel) cardPanel.classList.remove("print-card-section");
  });
  await loadUpcomingMatches();
})();
$("#profileForm").addEventListener("submit", async e=>{
  e.preventDefault();
  if (profileSaveInProgress || !original.user_id) return;
  profileSaveInProgress = true;
  const submitButton = $("#profileForm button[type=submit]");
  if (submitButton) submitButton.disabled = true;
  try { await saveMemberProfile(); } finally {
    profileSaveInProgress = false;
    if (submitButton) submitButton.disabled = false;
  }
});

async function saveMemberProfile() {
  let photoUrl = original.photo_url || null;
  const file = $("#photoFile")?.files?.[0];
  if (file) {
    if (!["image/jpeg","image/png","image/webp"].includes(file.type)) return showAlert("#pageAlert","Format photo invalide.","error");
    if (file.size > 5 * 1024 * 1024) return showAlert("#pageAlert","La photo dépasse 5 Mo.","error");
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const safe = String(original.login_name || "subscriber").toUpperCase().replace(/[^A-Z0-9_-]/g,"_");
    const path = `${safe}/${crypto.randomUUID()}.${ext}`;
    const upload = await sb.storage.from("subscriber-photos").upload(path,file,{cacheControl:"3600",upsert:false,contentType:file.type});
    if (upload.error) return showAlert("#pageAlert",upload.error.message,"error");
    photoUrl = path;
  }
  const email = $("#email").value.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showAlert("#pageAlert","Adresse email invalide.","error");
  const nom = $("#nom").value.trim().toUpperCase(), prenom = $("#prenom").value.trim().toUpperCase(), cin = $("#cin").value.trim();
  if (!nom || !prenom) return showAlert("#pageAlert","Le nom et le prénom sont obligatoires.","error");
  if (cin && !/^[A-Za-z0-9-]+$/.test(cin)) return showAlert("#pageAlert","CIN invalide (lettres, chiffres ou tiret).","error");
  // Everything except the subscription number (and administrative fields); the database enforces the same whitelist.
  const result = await sb.from("subscribers")
    .update({ nom: nom, prenom: prenom, cin: cin || null, gender: $("#gender").value || null, date_naissance: $("#dateNaissance").value || null, phone: $("#phone").value.trim() || null, email: email || null, adresse: $("#adresse").value.trim() || null, photo_url: photoUrl, faculty_id: $("#faculte").value || null, zone_id: $("#zone").value || null })
    .eq("user_id", original.user_id)
    .select(OWN_MEMBER_COLUMNS);
  const failure = writeError(result);
  if (failure) { showAlert("#pageAlert",failure,"error"); return; }
  const refreshed = await withOwnPrivateFields(result.data[0]);
  original = refreshed.data || {
    ...result.data[0], cin: original.cin, adresse: $("#adresse").value.trim() || null,
    phone: $("#phone").value.trim() || null, email: email || null,
    gender: original.gender, photo_url: photoUrl
  };
  if ($("#photoFile")) $("#photoFile").value = "";
  setProfileEditable(false);
  fillProfileForm(original);
  $("#welcomeName").textContent = `${original.prenom || ""} ${original.nom || ""}`.trim() || "Membre";
  await renderMemberCard(original);
  showAlert("#pageAlert","Informations et photo mises à jour."); $("#saveRow").classList.add("hidden"); $("#editBtn").classList.remove("hidden");
}
$("#passwordForm").addEventListener("submit", async e=>{
  e.preventDefault(); const p=$("#newPassword").value, c=$("#confirmPassword").value;
  if(p!==c) return showAlert("#passwordAlert","Les mots de passe ne correspondent pas.","error");
  if(p.length<12) return showAlert("#passwordAlert","Minimum 12 caractères.","error");
  if(!/[A-Z]/.test(p)||!/[a-z]/.test(p)||!/[0-9]/.test(p)||!/[^A-Za-z0-9]/.test(p)) return showAlert("#passwordAlert","Utilisez une majuscule, une minuscule, un chiffre et un caractère spécial.","error");
  const { error }=await sb.auth.updateUser({password:p});
  if(error) return showAlert("#passwordAlert",error.message,"error");
  const {error:rpcError}=await sb.rpc("complete_password_change");
  if(rpcError)return showAlert("#passwordAlert","Le mot de passe a été changé mais la validation a échoué.","error");
  showAlert("#passwordAlert","Mot de passe changé avec succès.");
  setTimeout(()=>location.href="subscriber.html",800);
});


// ---------- Member profile form ----------
// Editable by the member: everything except the subscription number.
const EDITABLE_PROFILE_FIELDS = ["nom", "prenom", "cin", "gender", "dateNaissance", "phone", "email", "adresse", "faculte", "zone"];

function setProfileEditable(on) {
  EDITABLE_PROFILE_FIELDS.forEach(id => { const el = $("#" + id); if (el) el.disabled = !on; });
  $("#numero").disabled = true;
}

function fillProfileForm(s) {
  $("#nom").value = s.nom || ""; $("#prenom").value = s.prenom || ""; $("#numero").value = s.numero_abonnement || "";
  $("#phone").value = s.phone || ""; $("#email").value = s.email || ""; $("#adresse").value = s.adresse || "";
  $("#cin").value = s.cin || ""; $("#gender").value = s.gender || "";
  $("#dateNaissance").value = (s.date_naissance || "").slice(0, 10);
  $("#faculte").value = s.faculty_id || ""; $("#zone").value = s.zone_id || "";
}

async function loadProfileChoices(s) {
  const [fac, zon] = await Promise.all([
    sb.from("faculties").select("id,name").order("name"),
    sb.from("zones").select("id,name").order("name")
  ]);
  const fill = (select, rows, currentId, currentName) => {
    const list = rows || [];
    if (currentId && !list.some(r => r.id === currentId)) list.push({ id: currentId, name: currentName || "Actuelle" });
    select.innerHTML = '<option value="">—</option>' + list.map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`).join("");
  };
  fill($("#faculte"), fac.data, s.faculty_id, s.faculties?.name);
  fill($("#zone"), zon.data, s.zone_id, s.zones?.name);
}
