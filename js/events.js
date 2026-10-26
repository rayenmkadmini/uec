/* ============================================================
   ÉVÉNEMENTS (bureau) — in-person events with invitations, RSVP and
   attendance by check-in code (present / late / absent / excused).
   Every write goes through the checked RPCs of migration
   20261026120000_club_events; the database decides who may do what.
============================================================ */
const EV_STATUS = {
  PRESENT: { label: "Présent", cls: "ok" },
  LATE: { label: "En retard", cls: "warn" },
  ABSENT: { label: "Absent", cls: "ko" },
  EXCUSED: { label: "Absence justifiée", cls: "info" },
  PENDING: { label: "En attente", cls: "muted" }
};
const EV_CATEGORY = { RASSEMBLEMENT: "Rassemblement", DEPLACEMENT: "Déplacement", TIFO: "Tifo", REUNION: "Réunion", SOIREE: "Soirée", FORMATION: "Formation", AUTRE: "Autre" };
const EV_RSVP = { GOING: "Participe", NOT_GOING: "Ne participe pas", NONE: "Sans réponse" };
let evAll = [];
let evCounts = new Map();
let evTab = "upcoming";
let evCandidates = null;
let evPicked = new Set();
let evRefs = { FACULTY: [], ZONE: [] };
let evCurrent = null;
let evPhotoUrl = null; // photo of the event being edited ("" = removed)

(async () => {
  const ctx = await requirePermission("manageMeetings");
  if (!ctx) return;
  setupShell(ctx);
  $("#addEvent").onclick = () => openEvent();
  $("#evClose").onclick = () => $("#evModal").classList.add("hidden");
  $("#evDetailClose").onclick = () => $("#evDetail").classList.add("hidden");
  $("#evCodeClose").onclick = () => $("#evCodeScreen").classList.add("hidden");
  $("#evAudience").onchange = syncEvAudience;
  $("#evPickSearch").oninput = renderEvPick;
  $("#evForm").onsubmit = saveEvent;
  $("#evPhoto").onchange = e => { const f = e.target.files?.[0]; if (f) showEvPhoto(URL.createObjectURL(f)); };
  $("#evPhotoRemove").onclick = () => { evPhotoUrl = ""; $("#evPhoto").value = ""; showEvPhoto(null); };
  document.querySelectorAll(".mt-tab").forEach(tab => tab.onclick = () => {
    evTab = tab.dataset.tab;
    document.querySelectorAll(".mt-tab").forEach(t => t.classList.toggle("active", t === tab));
    renderEvents();
  });
  $("#evList").addEventListener("click", onEvListClick);
  $("#evDetailBody").addEventListener("change", onEvAttendanceChange);
  $("#evDetailBody").addEventListener("click", e => { if (e.target.closest("[data-code]")) showCode(evCurrent); });
  const [faculties, zones] = await Promise.all([
    sb.from("faculties").select("id,name").order("name"),
    sb.from("zones").select("id,name").order("name")
  ]);
  evRefs = { FACULTY: faculties.data || [], ZONE: zones.data || [] };
  await loadEvents();
})();

const evEnd = e => new Date(new Date(e.starts_at).getTime() + e.duration_min * 60000);
const evPast = e => Date.now() > evEnd(e).getTime();
const evLive = e => { const now = Date.now(); return now >= new Date(e.starts_at).getTime() - 30 * 60000 && now <= evEnd(e).getTime(); };
const evEffective = (status, e) => (status === "PENDING" && evPast(e) ? "ABSENT" : status);
const evDate = d => new Date(d).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
const evTime = d => new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

async function loadEvents() {
  $("#evList").innerHTML = '<div class="loading-state">Chargement…</div>';
  const [events, participants] = await Promise.all([
    sb.from("club_events").select("id,title,description,category,location,starts_at,duration_min,late_after_min,capacity,audience,audience_ref,status,image_url").order("starts_at", { ascending: false }),
    sb.from("club_event_participants").select("event_id,status,rsvp")
  ]);
  if (events.error) {
    $("#evList").innerHTML = '<div class="empty">Les événements ne sont pas encore disponibles. La migration 20261026120000_club_events doit être appliquée.</div>';
    return;
  }
  evAll = events.data || [];
  evCounts = new Map();
  const byId = new Map(evAll.map(e => [e.id, e]));
  for (const p of participants.data || []) {
    const e = byId.get(p.event_id);
    if (!e) continue;
    const c = evCounts.get(p.event_id) || { total: 0, going: 0, notGoing: 0, PRESENT: 0, LATE: 0, ABSENT: 0, EXCUSED: 0, PENDING: 0 };
    c.total++;
    if (p.rsvp === "GOING") c.going++;
    if (p.rsvp === "NOT_GOING") c.notGoing++;
    c[evEffective(p.status, e)]++;
    evCounts.set(p.event_id, c);
  }
  renderEvStats();
  renderEvents();
}

function renderEvStats() {
  let invited = 0, attended = 0, late = 0, absent = 0;
  for (const e of evAll.filter(x => evPast(x) && x.status !== "CANCELLED")) {
    const c = evCounts.get(e.id);
    if (!c) continue;
    invited += c.total; attended += c.PRESENT + c.LATE; late += c.LATE; absent += c.ABSENT;
  }
  const upcoming = evAll.filter(e => !evPast(e) && e.status !== "CANCELLED").length;
  const rate = invited ? Math.round((attended / invited) * 100) : 0;
  $("#evStats").innerHTML = [["À venir", upcoming, ""], ["Taux de présence", `${rate}%`, "ok"], ["Retards", late, "warn"], ["Absences", absent, "ko"]]
    .map(([k, v, cls]) => `<div class="mt-stat ${cls}"><small>${k}</small><strong>${v}</strong></div>`).join("");
}

function renderEvents() {
  const list = evAll
    .filter(e => (evTab === "past" ? evPast(e) : !evPast(e)))
    .sort((a, b) => (evTab === "past" ? -1 : 1) * (new Date(a.starts_at) - new Date(b.starts_at)));
  if (!list.length) {
    $("#evList").innerHTML = `<div class="empty">${evTab === "past" ? "Aucun événement passé." : "Aucun événement prévu. Créez le premier avec « Nouvel événement »."}</div>`;
    return;
  }
  $("#evList").innerHTML = list.map(e => {
    const c = evCounts.get(e.id) || { total: 0, going: 0, notGoing: 0, PRESENT: 0, LATE: 0, ABSENT: 0, EXCUSED: 0 };
    const cancelled = e.status === "CANCELLED";
    const live = !cancelled && evLive(e);
    const d = new Date(e.starts_at);
    const past = evPast(e);
    return `<article class="mt-card${cancelled ? " cancelled" : ""}${live ? " live" : ""}">
      ${e.image_url ? `<img class="ev-thumb" src="${escapeHtml(e.image_url)}" alt="" loading="lazy">` : ""}<div class="mt-date"><small>${d.toLocaleDateString("fr-FR", { weekday: "short" })}</small><b>${String(d.getDate()).padStart(2, "0")}</b><small>${d.toLocaleDateString("fr-FR", { month: "short" })}</small></div>
      <div class="mt-body">
        <div class="mt-top">${live ? '<span class="mt-live">● EN COURS</span>' : ""}${cancelled ? '<span class="mt-badge ko">Annulé</span>' : ""}<span class="mt-badge ev-cat">${escapeHtml(EV_CATEGORY[e.category] || e.category)}</span></div>
        <h3>${escapeHtml(e.title)}</h3>
        <p class="mt-meta">🕒 ${evTime(e.starts_at)} – ${evTime(evEnd(e))}${e.location ? ` · 📍 ${escapeHtml(e.location)}` : ""}</p>
        <div class="mt-counts">${past
          ? `<span>${c.total} invité(s)</span><span class="ok">${c.PRESENT} présent(s)</span><span class="warn">${c.LATE} retard(s)</span><span class="ko">${c.ABSENT} absent(s)</span>${c.EXCUSED ? `<span class="info">${c.EXCUSED} justifié(s)</span>` : ""}`
          : `<span>${c.total} invité(s)</span><span class="ok">${c.going}${e.capacity ? `/${e.capacity}` : ""} participe(nt)</span><span class="ko">${c.notGoing} décliné(s)</span>${c.PRESENT + c.LATE ? `<span class="info">${c.PRESENT + c.LATE} pointé(s)</span>` : ""}`}</div>
      </div>
      <div class="mt-actions">
        ${live ? `<button type="button" class="btn primary" data-act="code" data-id="${e.id}">Code</button>` : ""}
        <button type="button" class="btn secondary" data-act="attendance" data-id="${e.id}">Présences</button>
        <button type="button" class="icon-btn" data-act="more" data-id="${e.id}" aria-label="Plus d’actions">${typeof MORE_ICON !== "undefined" ? MORE_ICON : "⋯"}</button>
      </div>
    </article>`;
  }).join("");
}

async function onEvListClick(event) {
  const button = event.target.closest("[data-act]");
  if (!button) return;
  const e = evAll.find(x => x.id === button.dataset.id);
  if (!e) return;
  if (button.dataset.act === "code") return showCode(e);
  if (button.dataset.act === "attendance") return openEvAttendance(e);
  const actions = [
    { label: "Modifier", run: () => openEvent(e) },
    { label: "Afficher le code de pointage", run: () => showCode(e) },
    { label: "Nouveau code de pointage", run: () => showCode(e, true) },
    { label: e.status === "CANCELLED" ? "Rétablir l’événement" : "Annuler l’événement", run: () => cancelEvent(e) },
    { label: "Supprimer", danger: true, run: () => deleteEvent(e) }
  ];
  openActionSheet(e.title, evDate(e.starts_at), actions);
}

// Full-screen code to show (or project) on site.
async function showCode(e, regenerate = false) {
  if (!e) return;
  if (regenerate && !(await confirmDialog("Générer un nouveau code ? L’ancien ne fonctionnera plus.", { confirmText: "Nouveau code" }))) return;
  const { data, error } = await sb.rpc("get_club_event_code", { p_id: e.id, p_regenerate: regenerate });
  if (error) return showAlert("#pageAlert", error.message, "error");
  $("#evCodeEvent").textContent = e.title;
  $("#evCodeValue").textContent = String(data || "").replace(/(\d{3})(\d{3})/, "$1 $2");
  $("#evCodeScreen").classList.remove("hidden");
}

async function cancelEvent(e) {
  const cancel = e.status !== "CANCELLED";
  if (cancel && !(await confirmDialog(`Annuler « ${e.title} » ?`, { confirmText: "Annuler l’événement" }))) return;
  const { error } = await sb.rpc("cancel_club_event", { p_id: e.id, p_cancelled: cancel });
  if (error) return showAlert("#pageAlert", error.message, "error");
  loadEvents();
}

async function deleteEvent(e) {
  if (!(await confirmDialog(`Supprimer « ${e.title} », les réponses et les présences ?`, { confirmText: "Supprimer" }))) return;
  const { error } = await sb.rpc("delete_club_event", { p_id: e.id });
  if (error) return showAlert("#pageAlert", error.message, "error");
  showAlert("#pageAlert", "Événement supprimé.", "success");
  loadEvents();
}

/* ---------- create / edit ---------- */
async function openEvent(e = null) {
  $("#evTitle").textContent = e ? "Modifier l’événement" : "Nouvel événement";
  $("#evId").value = e?.id || "";
  $("#evName").value = e?.title || "";
  $("#evCategory").value = e?.category || "RASSEMBLEMENT";
  $("#evLocation").value = e?.location || "";
  $("#evCapacity").value = e?.capacity ?? "";
  const start = e ? new Date(e.starts_at) : new Date(Date.now() + 2 * 86400000);
  if (!e) start.setHours(18, 0, 0, 0);
  const pad = n => String(n).padStart(2, "0");
  $("#evDate").value = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  $("#evTime").value = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  $("#evDuration").value = e?.duration_min ?? 120;
  $("#evLate").value = e?.late_after_min ?? 15;
  $("#evDesc").value = e?.description || "";
  evPhotoUrl = e?.image_url || null;
  $("#evPhoto").value = "";
  showEvPhoto(evPhotoUrl);
  $("#evAudience").value = e?.audience || "ALL";
  evPicked = new Set();
  if (e?.audience === "CUSTOM") {
    const { data } = await sb.from("club_event_participants").select("user_id").eq("event_id", e.id);
    evPicked = new Set((data || []).map(p => p.user_id));
  }
  await syncEvAudience(e?.audience_ref);
  $("#evModal").classList.remove("hidden");
  $("#evName").focus();
}

function showEvPhoto(src) {
  $("#evPhotoPreview").classList.toggle("hidden", !src);
  if (src) $("#evPhotoPreview img").src = src;
}

async function syncEvAudience(ref) {
  const audience = $("#evAudience").value;
  const needsRef = audience === "FACULTY" || audience === "ZONE";
  $("#evRefWrap").hidden = !needsRef;
  $("#evPickWrap").hidden = audience !== "CUSTOM";
  if (needsRef) {
    $("#evRefLabel").textContent = audience === "FACULTY" ? "Faculté" : "Zone";
    $("#evRef").innerHTML = evRefs[audience].map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join("");
    if (typeof ref === "string") $("#evRef").value = ref;
  }
  if (audience === "CUSTOM") {
    if (!evCandidates) {
      const { data, error } = await sb.rpc("list_meeting_candidates");
      if (error) return showAlert("#pageAlert", error.message, "error");
      evCandidates = data || [];
    }
    renderEvPick();
  }
}

function renderEvPick() {
  const q = ($("#evPickSearch").value || "").trim().toLowerCase();
  const list = (evCandidates || []).filter(c => !q || `${c.name} ${c.login || ""}`.toLowerCase().includes(q));
  $("#evPick").innerHTML = list.map(c => `<label class="mt-pick-row"><input type="checkbox" value="${c.user_id}" ${evPicked.has(c.user_id) || c.staff ? "checked" : ""} ${c.staff ? "disabled" : ""}><span>${escapeHtml(c.name)}${c.staff ? " <em>bureau</em>" : ""}</span><small>${escapeHtml(c.login || "")}</small></label>`).join("") || '<div class="empty">Aucun résultat.</div>';
  $("#evPick").onchange = ev => { if (ev.target.checked) evPicked.add(ev.target.value); else evPicked.delete(ev.target.value); };
}

async function saveEvent(event) {
  event.preventDefault();
  const audience = $("#evAudience").value;
  const startsAt = new Date(`${$("#evDate").value}T${$("#evTime").value}`);
  if (Number.isNaN(startsAt.getTime())) return showAlert("#pageAlert", "Date ou heure invalide.", "error");
  const capacity = $("#evCapacity").value ? Number($("#evCapacity").value) : null;
  const file = $("#evPhoto").files?.[0];
  let uploaded = null;
  if (file) {
    try { uploaded = await uploadCommunityImage(file, "events"); }
    catch (err) { return showAlert("#pageAlert", err.message, "error"); }
  }
  const { data: savedId, error } = await sb.rpc("save_club_event", {
    p_id: $("#evId").value || null,
    p_title: $("#evName").value.trim(),
    p_description: $("#evDesc").value.trim(),
    p_category: $("#evCategory").value,
    p_location: $("#evLocation").value.trim(),
    p_starts_at: startsAt.toISOString(),
    p_duration_min: Number($("#evDuration").value),
    p_late_after_min: Number($("#evLate").value),
    p_capacity: capacity,
    p_audience: audience,
    p_audience_ref: audience === "FACULTY" || audience === "ZONE" ? $("#evRef").value || null : null,
    p_users: audience === "CUSTOM" ? [...evPicked] : null
  });
  if (error) return showAlert("#pageAlert", error.message, "error");
  // Photo: new upload, or removed ("" ), otherwise unchanged.
  if (uploaded || evPhotoUrl === "") {
    const photo = await sb.rpc("set_club_event_image", { p_id: savedId, p_url: uploaded || "" });
    if (photo.error) showAlert("#pageAlert", `Événement enregistré, mais la photo n’a pas pu être ajoutée : ${photo.error.message}`, "error");
  }
  $("#evModal").classList.add("hidden");
  showAlert("#pageAlert", "Événement enregistré. Les invités le voient dans leur espace et peuvent répondre.", "success");
  loadEvents();
}

/* ---------- attendance ---------- */
async function openEvAttendance(e) {
  evCurrent = e;
  $("#evDetailTitle").textContent = e.title;
  $("#evDetailBody").innerHTML = '<div class="loading-state">Chargement…</div>';
  $("#evDetail").classList.remove("hidden");
  const { data, error } = await sb.rpc("list_club_event_participants", { p_event: e.id });
  if (error) { $("#evDetailBody").innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; return; }
  const rows = data || [];
  const options = status => Object.entries(EV_STATUS).filter(([k]) => k !== "PENDING" || !evPast(e))
    .map(([k, v]) => `<option value="${k}" ${k === status ? "selected" : ""}>${v.label}</option>`).join("");
  $("#evDetailBody").innerHTML = `
    <div class="ev-detail-head"><p class="mt-meta">${evDate(e.starts_at)} · ${evTime(e.starts_at)} – ${evTime(evEnd(e))}${e.location ? ` · ${escapeHtml(e.location)}` : ""} · retard après ${e.late_after_min} min</p>
    <button type="button" class="btn secondary" data-code>Afficher le code</button></div>
    <div class="mt-att">${rows.map(r => {
      const st = evEffective(r.status, e);
      return `<div class="mt-att-row">
        <div><b>${escapeHtml(r.name)}</b><small>${escapeHtml(r.login || "")} · ${EV_RSVP[r.rsvp] || ""}${r.checked_in_at ? ` · pointé à ${evTime(r.checked_in_at)}` : ""}${r.note ? ` · ${escapeHtml(r.note)}` : ""}</small></div>
        <span class="mt-badge ${EV_STATUS[st].cls}">${EV_STATUS[st].label}</span>
        <select data-user="${r.user_id}" aria-label="Statut de ${escapeHtml(r.name)}">${options(st)}</select>
      </div>`;
    }).join("") || '<div class="empty">Aucun participant.</div>'}</div>`;
}

async function onEvAttendanceChange(event) {
  const select = event.target.closest("select[data-user]");
  if (!select || !evCurrent) return;
  let note = null;
  if (select.value === "EXCUSED") note = await promptDialog("Motif de l’absence (facultatif)", { placeholder: "Examen, maladie…" });
  const { error } = await sb.rpc("set_club_event_attendance", { p_event: evCurrent.id, p_user: select.dataset.user, p_status: select.value, p_note: note });
  if (error) return showAlert("#pageAlert", error.message, "error");
  await openEvAttendance(evCurrent);
  loadEvents();
}
