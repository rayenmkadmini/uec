let matches = [];
let filteredMatches = [];
let subscriber = null;
let currentMatch = null;
let selectedZoneId = null;
let myParticipation = new Map();
let clubLogos = new Map();
let seatSaveInProgress = false;

const zoneLabels = {
  PELOUSE: "Pelouse",
  ENCEINTE_INF: "Enceinte inférieure",
  ENCEINTE_SUP: "Enceinte supérieure",
  VIRAGE_1: "Virage 1",
  VIRAGE_2: "Virage 2"
};

const sportLabels = {
  FOOTBALL: "Football",
  HANDBALL: "Handball",
  BASKETBALL: "Basketball"
};

function formatMatchDate(date, time) {
  if (!date) return "Date non définie";
  const d = new Date(`${date}T${time || "12:00:00"}`);
  return d.toLocaleDateString("fr-TN", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric"
  });
}

function formatTime(time) {
  return time ? String(time).slice(0, 5) : "Heure à confirmer";
}

async function loadSubscriber() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return false;

  const row = await sb
    .from("subscribers")
    .select("id,nom,prenom,status")
    .eq("user_id", user.id)
    .single();
  // Gender is not selectable through the table API; the member reads their own
  // through get_member_private_fields(). The seat RPC enforces the zone rule anyway.
  const own = row.data ? await sb.rpc("get_member_private_fields", { p_subscriber_id: row.data.id }) : { data: [], error: null };
  const error = row.error || own.error;
  const data = row.data ? { ...row.data, gender: (own.data || [])[0]?.gender ?? null } : null;

  if (error || !data) {
    if (error) console.error("Chargement du profil membre:", error);
    $("#matchesGrid").innerHTML = '<div class="empty-card">Aucun profil membre n’est associé à ce compte. Contactez l’administration.</div>';
    return false;
  }

  subscriber = data;
  $("#userName").textContent = `${data.prenom} ${data.nom}`;
  $("#avatar").textContent = String(data.prenom || "U").charAt(0).toUpperCase();
  $("#genderBadge").textContent = data.gender === "FEMALE" ? "Femme" : data.gender === "MALE" ? "Homme" : "Sexe non renseigné";

  return true;
}

async function loadMatches() {
  const [matchesResult, participationResult, logos] = await Promise.all([
    sb.from("matches")
      .select("id,sport,home_team,away_team,home_logo_url,away_logo_url,competition,stadium,match_date,match_time,description,is_active,match_zones(id,zone_key,zone_name,capacity,is_available)")
      .eq("is_active", true)
      .order("match_date", { ascending: true })
      .order("match_time", { ascending: true }),
    sb.from("match_participations")
      .select("id,match_id,zone_id")
      .eq("subscriber_id", subscriber.id),
    loadClubLogos()
  ]);
  clubLogos = logos;

  const loadError = matchesResult.error || participationResult.error;
  if (loadError) {
    $("#matchesGrid").innerHTML = '<div class="empty-card">Impossible de charger les matchs. Rechargez la page.</div>';
    return showAlert("#pageAlert", loadError.message, "error");
  }

  matches = matchesResult.data || [];
  myParticipation = new Map((participationResult.data || []).map(p => [p.match_id, p]));
  applyFilter();
}

function applyFilter() {
  const sport = $("#sportFilter").value;
  filteredMatches = matches.filter(m => !sport || m.sport === sport);
  renderMatches();
}

function renderMatches() {
  const container = $("#matchesGrid");
  if (!container.dataset.openReady) {
    container.dataset.openReady = "true";
    container.addEventListener("click", e => {
      const button = e.target.closest("[data-open-match]");
      if (button) openMatch(button.dataset.openMatch);
    });
  }

  if (!filteredMatches.length) {
    container.innerHTML = '<div class="empty-card">Aucun match programmé pour le moment.</div>';
    return;
  }

  container.innerHTML = filteredMatches.map(match => {
    const participation = myParticipation.get(match.id);
    const zone = participation ? (match.match_zones || []).find(z => z.id === participation.zone_id) : null;
    const homeTeam = match.home_team || "Équipe domicile";
    const awayTeam = match.away_team || "Équipe visiteuse";
    const matchDate = match.match_date ? new Date(`${match.match_date}T${match.match_time || "12:00:00"}`) : new Date();
    const day = matchDate.toLocaleDateString("fr-TN", { day: "2-digit" });
    const month = matchDate.toLocaleDateString("fr-TN", { month: "short" }).replace(".", "").replace(".", "");
    const weekday = matchDate.toLocaleDateString("fr-TN", { weekday: "short" }).replace(".", "");
    // Same rule as the seat RPCs: no choice or change once the match has started
    // (match times are Tunis time, UTC+1 all year).
    const started = Boolean(match.match_date) && new Date(`${match.match_date}T${match.match_time || "23:59:00"}+01:00`) <= new Date();

    return `
      <article class="match-card agenda-match-card">
        <div class="agenda-date">
          <span>${escapeHtml(weekday)}</span>
          <strong>${escapeHtml(day)}</strong>
          <small>${escapeHtml(month)}</small>
        </div>
        <div class="agenda-content">
          <div class="match-card-top">
            <span class="sport-pill">${escapeHtml(sportLabels[match.sport] || match.sport)}</span>
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
          <div class="match-info"><span>🕐 ${escapeHtml(formatTime(match.match_time))}</span>${match.stadium ? `<span>📍 ${escapeHtml(match.stadium)}</span>` : ""}</div>
          <div class="match-card-bottom">
            ${zone ? `<span class="choice-pill">✓ ${escapeHtml(zone.zone_name || zoneLabels[zone.zone_key] || "Place choisie")}</span>` : `<span class="muted-text">Aucune place choisie</span>`}
            ${started
              ? `<span class="muted-text">Match commencé</span>`
              : `<button type="button" class="btn primary" data-open-match="${escapeHtml(match.id)}">${zone ? "Modifier" : "Choisir une place"}</button>`}
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function renderZones(zones) {
  const container = $("#zones");
  const current = myParticipation.get(currentMatch.id);

  // Une femme ne voit jamais les deux virages.
  const visibleZones = (zones || []).filter(zone => {
    if (subscriber.gender === "FEMALE" && ["VIRAGE_1", "VIRAGE_2"].includes(zone.zone_key)) return false;
    return true;
  });

  container.innerHTML = visibleZones.map(zone => {
    const unavailable = zone.is_available === false;
    const selected = current?.zone_id === zone.id;
    const label = zone.zone_name || zoneLabels[zone.zone_key] || zone.zone_key;

    return `
      <button type="button" class="match-zone ${unavailable ? "disabled" : ""} ${selected ? "selected" : ""}" data-zone-id="${zone.id}" ${unavailable ? "disabled" : ""}>
        <span class="zone-icon">${zone.zone_key.includes("VIRAGE") ? "🏟️" : "🎟️"}</span>
        <span><strong>${escapeHtml(label)}</strong><small>${unavailable ? "Indisponible" : "Disponible"}</small></span>
        ${selected ? '<span class="zone-check">✓</span>' : ""}
      </button>
    `;
  }).join("");

  $$(".match-zone:not(.disabled)", container).forEach(button => {
    button.addEventListener("click", () => {
      selectedZoneId = button.dataset.zoneId;
      $$(".match-zone", container).forEach(x => x.classList.remove("selected"));
      button.classList.add("selected");
    });
  });

  if (!visibleZones.length) {
    container.innerHTML = '<div class="empty-card">Aucune zone disponible.</div>';
  }
}

window.openMatch = matchId => {
  currentMatch = matches.find(m => m.id === matchId);
  if (!currentMatch) return;

  selectedZoneId = myParticipation.get(matchId)?.zone_id || null;

  $("#modalMatchTitle").textContent = `${currentMatch.home_team} — ${currentMatch.away_team}`;
  $("#modalMatchMeta").textContent = `${sportLabels[currentMatch.sport] || currentMatch.sport} • ${formatMatchDate(currentMatch.match_date, currentMatch.match_time)} • ${formatTime(currentMatch.match_time)}${currentMatch.stadium ? ` • ${currentMatch.stadium}` : ""}`;

  if (!subscriber.gender) {
    $("#zones").innerHTML = '<div class="gender-warning">Votre sexe n’est pas renseigné. Demandez à un administrateur de compléter votre profil avant de choisir une place.</div>';
    $("#confirmZoneBtn").disabled = true;
  } else {
    $("#confirmZoneBtn").disabled = false;
    renderZones(currentMatch.match_zones || []);
  }

  const current = myParticipation.get(matchId);
  const currentZone = current ? (currentMatch.match_zones || []).find(z => z.id === current.zone_id) : null;
  if (currentZone) {
    $("#currentChoice").classList.remove("hidden");
    $("#currentChoice").textContent = `Votre choix actuel : ${currentZone.zone_name || zoneLabels[currentZone.zone_key]}`;
  } else {
    $("#currentChoice").classList.add("hidden");
  }

  $("#matchModal").classList.remove("hidden");
};

async function saveChoice() {
  if (!subscriber || !currentMatch || !selectedZoneId) {
    return showAlert("#pageAlert", "Veuillez choisir une place.", "error");
  }
  if (seatSaveInProgress) return;

  const { data: { user } } = await sb.auth.getUser();
  if (!user) return showAlert("#pageAlert", "Session expirée.", "error");

  seatSaveInProgress = true;
  $("#confirmZoneBtn").disabled = true;
  const { error } = await sb.rpc("set_match_participation", {
    p_match_id: currentMatch.id,
    p_zone_id: selectedZoneId
  });
  seatSaveInProgress = false;
  $("#confirmZoneBtn").disabled = false;

  if (error) {
    return showAlert("#pageAlert", error.message || "Impossible d'enregistrer votre choix.", "error");
  }

  $("#matchModal").classList.add("hidden");
  showAlert("#pageAlert", "Votre place a été enregistrée.");
  await loadMatches();
}

async function removeChoice() {
  if (!currentMatch) return;

  const existing = myParticipation.get(currentMatch.id);
  if (!existing) {
    $("#matchModal").classList.add("hidden");
    return;
  }

  if (!(await confirmDialog("Confirmer que vous ne participez pas à ce match ?", { confirmText: "Oui, retirer" }))) return;

  const { error } = await sb.rpc("remove_match_participation", {
    p_match_id: currentMatch.id
  });

  if (error) return showAlert("#pageAlert", error.message, "error");

  $("#matchModal").classList.add("hidden");
  showAlert("#pageAlert", "Votre participation a été retirée.");
  await loadMatches();
}

async function init() {
  const ctx = await requirePermission("chooseOwnSeat");
  if (!ctx) return;
  setupShell(ctx);
  if (!(await loadSubscriber())) return;
  await loadMatches();

  $("#sportFilter").onchange = applyFilter;
  $("#closeMatchModal").onclick = () => $("#matchModal").classList.add("hidden");
  $("#confirmZoneBtn").onclick = saveChoice;
  $("#notParticipateBtn").onclick = removeChoice;

  $("#matchModal").addEventListener("click", e => {
    if (e.target === $("#matchModal")) $("#matchModal").classList.add("hidden");
  });
}

init();
