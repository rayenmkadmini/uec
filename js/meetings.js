/* ============================================================
   RÉUNIONS (bureau) — create / edit meetings with a pasted Google Meet
   link, choose who is invited, follow attendance (present / late /
   absent / excused). Every write goes through the checked RPCs of
   migration 20261025120000; the database decides who may do what.
============================================================ */
const MT_STATUS = {
  PRESENT: { label: "Présent", cls: "ok" },
  LATE: { label: "En retard", cls: "warn" },
  ABSENT: { label: "Absent", cls: "ko" },
  EXCUSED: { label: "Absence justifiée", cls: "info" },
  PENDING: { label: "En attente", cls: "muted" }
};
let mtAll = [];
let mtCounts = new Map();
let mtTab = "upcoming";
let mtCandidates = null;
let mtPicked = new Set();
let mtRefs = { FACULTY: [], ZONE: [] };

(async () => {
  const ctx = await requirePermission("manageMeetings");
  if (!ctx) return;
  setupShell(ctx);
  $("#addMeeting").onclick = () => openMeeting();
  $("#mtClose").onclick = () => $("#mtModal").classList.add("hidden");
  $("#mtDetailClose").onclick = () => $("#mtDetail").classList.add("hidden");
  $("#mtAudience").onchange = syncAudience;
  $("#mtPickSearch").oninput = renderPick;
  $("#mtForm").onsubmit = saveMeeting;
  document.querySelectorAll(".mt-tab").forEach(tab => tab.onclick = () => {
    mtTab = tab.dataset.tab;
    document.querySelectorAll(".mt-tab").forEach(t => t.classList.toggle("active", t === tab));
    renderMeetings();
  });
  $("#mtList").addEventListener("click", onListClick);
  $("#mtDetailBody").addEventListener("change", onAttendanceChange);
  const [faculties, zones] = await Promise.all([
    sb.from("faculties").select("id,name").order("name"),
    sb.from("zones").select("id,name").order("name")
  ]);
  mtRefs = { FACULTY: faculties.data || [], ZONE: zones.data || [] };
  await loadMeetings();
})();

const meetingEnd = m => new Date(new Date(m.starts_at).getTime() + m.duration_min * 60000);
const isLive = m => { const now = Date.now(); return now >= new Date(m.starts_at).getTime() - 15 * 60000 && now <= meetingEnd(m).getTime(); };
const isPast = m => Date.now() > meetingEnd(m).getTime();
// Nobody joined and the meeting is over: absent.
const effectiveStatus = (status, m) => (status === "PENDING" && isPast(m) ? "ABSENT" : status);
const fmtDate = d => new Date(d).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
const fmtTime = d => new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const audienceLabel = m => ({ BUREAU: "Bureau", ALL: "Tous les membres", FACULTY: "Faculté", ZONE: "Zone", CUSTOM: "Sélection" }[m.audience] || m.audience);

async function loadMeetings() {
  $("#mtList").innerHTML = '<div class="loading-state">Chargement…</div>';
  const [meetings, participants] = await Promise.all([
    sb.from("meetings").select("id,title,description,starts_at,duration_min,late_after_min,meet_url,audience,audience_ref,status").order("starts_at", { ascending: false }),
    sb.from("meeting_participants").select("meeting_id,status")
  ]);
  if (meetings.error) {
    $("#mtList").innerHTML = '<div class="empty">Les réunions ne sont pas encore disponibles. La migration 20261025120000_meetings doit être appliquée.</div>';
    return;
  }
  mtAll = meetings.data || [];
  mtCounts = new Map();
  const byId = new Map(mtAll.map(m => [m.id, m]));
  for (const p of participants.data || []) {
    const m = byId.get(p.meeting_id);
    if (!m) continue;
    const c = mtCounts.get(p.meeting_id) || { total: 0, PRESENT: 0, LATE: 0, ABSENT: 0, EXCUSED: 0, PENDING: 0 };
    c.total++;
    c[effectiveStatus(p.status, m)]++;
    mtCounts.set(p.meeting_id, c);
  }
  renderStats();
  renderMeetings();
}

function renderStats() {
  const past = mtAll.filter(m => isPast(m) && m.status !== "CANCELLED");
  let invited = 0, attended = 0, late = 0, absent = 0;
  for (const m of past) {
    const c = mtCounts.get(m.id);
    if (!c) continue;
    invited += c.total; attended += c.PRESENT + c.LATE; late += c.LATE; absent += c.ABSENT;
  }
  const upcoming = mtAll.filter(m => !isPast(m) && m.status !== "CANCELLED").length;
  const rate = invited ? Math.round((attended / invited) * 100) : 0;
  $("#mtStats").innerHTML = [
    ["À venir", upcoming, ""],
    ["Taux de présence", `${rate}%`, "ok"],
    ["Retards", late, "warn"],
    ["Absences", absent, "ko"]
  ].map(([k, v, cls]) => `<div class="mt-stat ${cls}"><small>${k}</small><strong>${v}</strong></div>`).join("");
}

function renderMeetings() {
  const list = mtAll
    .filter(m => (mtTab === "past" ? isPast(m) : !isPast(m)))
    // Upcoming: soonest first. Past: most recent first.
    .sort((a, b) => (mtTab === "past" ? -1 : 1) * (new Date(a.starts_at) - new Date(b.starts_at)));
  if (!list.length) {
    $("#mtList").innerHTML = `<div class="empty">${mtTab === "past" ? "Aucune réunion passée." : "Aucune réunion prévue. Créez la première avec « Nouvelle réunion »."}</div>`;
    return;
  }
  $("#mtList").innerHTML = list.map(m => {
    const c = mtCounts.get(m.id) || { total: 0, PRESENT: 0, LATE: 0, ABSENT: 0, EXCUSED: 0 };
    const cancelled = m.status === "CANCELLED";
    const live = !cancelled && isLive(m);
    const d = new Date(m.starts_at);
    return `<article class="mt-card${cancelled ? " cancelled" : ""}${live ? " live" : ""}">
      <div class="mt-date"><small>${d.toLocaleDateString("fr-FR", { weekday: "short" })}</small><b>${String(d.getDate()).padStart(2, "0")}</b><small>${d.toLocaleDateString("fr-FR", { month: "short" })}</small></div>
      <div class="mt-body">
        <div class="mt-top">${live ? '<span class="mt-live">● EN DIRECT</span>' : ""}${cancelled ? '<span class="mt-badge ko">Annulée</span>' : ""}<span class="mt-badge">${escapeHtml(audienceLabel(m))}</span></div>
        <h3>${escapeHtml(m.title)}</h3>
        <p class="mt-meta">🕒 ${fmtTime(m.starts_at)} – ${fmtTime(meetingEnd(m))} · ${m.duration_min} min${m.meet_url ? "" : ' · <span class="mt-warn">lien Meet manquant</span>'}</p>
        <div class="mt-counts"><span>${c.total} invité(s)</span><span class="ok">${c.PRESENT} présent(s)</span><span class="warn">${c.LATE} retard(s)</span><span class="ko">${c.ABSENT} absent(s)</span>${c.EXCUSED ? `<span class="info">${c.EXCUSED} justifié(s)</span>` : ""}</div>
      </div>
      <div class="mt-actions">
        ${m.meet_url && live ? `<button type="button" class="btn primary" data-act="join" data-id="${m.id}">Rejoindre</button>` : ""}
        <button type="button" class="btn secondary" data-act="attendance" data-id="${m.id}">Présences</button>
        <button type="button" class="icon-btn" data-act="more" data-id="${m.id}" aria-label="Plus d’actions">${typeof MORE_ICON !== "undefined" ? MORE_ICON : "⋯"}</button>
      </div>
    </article>`;
  }).join("");
}

async function onListClick(event) {
  const button = event.target.closest("[data-act]");
  if (!button) return;
  const m = mtAll.find(x => x.id === button.dataset.id);
  if (!m) return;
  if (button.dataset.act === "join") return joinMeeting(m);
  if (button.dataset.act === "attendance") return openAttendance(m);
  const actions = [
    { label: "Modifier", run: () => openMeeting(m) },
    m.meet_url ? { label: "Copier le lien Meet", run: () => navigator.clipboard?.writeText(m.meet_url).then(() => showAlert("#pageAlert", "Lien copié.", "success")) } : null,
    { label: m.status === "CANCELLED" ? "Rétablir la réunion" : "Annuler la réunion", run: () => cancelMeeting(m) },
    { label: "Supprimer", danger: true, run: () => deleteMeeting(m) }
  ].filter(Boolean);
  if (typeof openActionSheet === "function") openActionSheet(m.title, fmtDate(m.starts_at), actions);
  else actions[0].run();
}

async function joinMeeting(m) {
  const { data, error } = await sb.rpc("join_meeting", { p_id: m.id });
  if (error) return showAlert("#pageAlert", error.message, "error");
  window.open(data, "_blank", "noopener");
  loadMeetings();
}

async function cancelMeeting(m) {
  const cancel = m.status !== "CANCELLED";
  if (cancel && !(await confirmDialog(`Annuler « ${m.title} » ?`, { confirmText: "Annuler la réunion" }))) return;
  const { error } = await sb.rpc("cancel_meeting", { p_id: m.id, p_cancelled: cancel });
  if (error) return showAlert("#pageAlert", error.message, "error");
  loadMeetings();
}

async function deleteMeeting(m) {
  if (!(await confirmDialog(`Supprimer « ${m.title} » et ses présences ?`, { confirmText: "Supprimer" }))) return;
  const { error } = await sb.rpc("delete_meeting", { p_id: m.id });
  if (error) return showAlert("#pageAlert", error.message, "error");
  showAlert("#pageAlert", "Réunion supprimée.", "success");
  loadMeetings();
}

/* ---------- create / edit ---------- */
async function openMeeting(m = null) {
  $("#mtTitle").textContent = m ? "Modifier la réunion" : "Nouvelle réunion";
  $("#mtId").value = m?.id || "";
  $("#mtName").value = m?.title || "";
  const start = m ? new Date(m.starts_at) : new Date(Date.now() + 86400000);
  if (!m) start.setHours(20, 0, 0, 0);
  const pad = n => String(n).padStart(2, "0");
  $("#mtDate").value = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  $("#mtTime").value = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  $("#mtDuration").value = m?.duration_min ?? 60;
  $("#mtLate").value = m?.late_after_min ?? 10;
  $("#mtUrl").value = m?.meet_url || "";
  $("#mtDesc").value = m?.description || "";
  $("#mtAudience").value = m?.audience || "BUREAU";
  mtPicked = new Set();
  if (m?.audience === "CUSTOM") {
    const { data } = await sb.from("meeting_participants").select("user_id").eq("meeting_id", m.id);
    mtPicked = new Set((data || []).map(p => p.user_id));
  }
  await syncAudience(m?.audience_ref);
  $("#mtModal").classList.remove("hidden");
  $("#mtName").focus();
}

async function syncAudience(ref) {
  const audience = $("#mtAudience").value;
  const needsRef = audience === "FACULTY" || audience === "ZONE";
  $("#mtRefWrap").hidden = !needsRef;
  $("#mtPickWrap").hidden = audience !== "CUSTOM";
  if (needsRef) {
    $("#mtRefLabel").textContent = audience === "FACULTY" ? "Faculté" : "Zone";
    $("#mtRef").innerHTML = mtRefs[audience].map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join("");
    if (typeof ref === "string") $("#mtRef").value = ref;
  }
  if (audience === "CUSTOM") {
    if (!mtCandidates) {
      const { data, error } = await sb.rpc("list_meeting_candidates");
      if (error) return showAlert("#pageAlert", error.message, "error");
      mtCandidates = data || [];
    }
    renderPick();
  }
}

function renderPick() {
  const q = ($("#mtPickSearch").value || "").trim().toLowerCase();
  const list = (mtCandidates || []).filter(c => !q || `${c.name} ${c.login || ""}`.toLowerCase().includes(q));
  $("#mtPick").innerHTML = list.map(c => `<label class="mt-pick-row"><input type="checkbox" value="${c.user_id}" ${mtPicked.has(c.user_id) || c.staff ? "checked" : ""} ${c.staff ? "disabled" : ""}><span>${escapeHtml(c.name)}${c.staff ? ' <em>bureau</em>' : ""}</span><small>${escapeHtml(c.login || "")}</small></label>`).join("") || '<div class="empty">Aucun résultat.</div>';
  $("#mtPick").onchange = e => { if (e.target.checked) mtPicked.add(e.target.value); else mtPicked.delete(e.target.value); };
}

async function saveMeeting(event) {
  event.preventDefault();
  const audience = $("#mtAudience").value;
  const startsAt = new Date(`${$("#mtDate").value}T${$("#mtTime").value}`);
  if (Number.isNaN(startsAt.getTime())) return showAlert("#pageAlert", "Date ou heure invalide.", "error");
  const url = $("#mtUrl").value.trim();
  if (url && !/^https:\/\/[A-Za-z0-9.-]+(\/\S*)?$/.test(url)) return showAlert("#pageAlert", "Le lien doit commencer par https:// (ex. https://meet.google.com/abc-defg-hij).", "error");
  if (audience === "CUSTOM" && !mtPicked.size && !(await confirmDialog("Aucune personne sélectionnée : seul le bureau sera invité. Continuer ?", { confirmText: "Continuer" }))) return;
  const { error } = await sb.rpc("save_meeting", {
    p_id: $("#mtId").value || null,
    p_title: $("#mtName").value.trim(),
    p_description: $("#mtDesc").value.trim(),
    p_starts_at: startsAt.toISOString(),
    p_duration_min: Number($("#mtDuration").value),
    p_late_after_min: Number($("#mtLate").value),
    p_meet_url: url,
    p_audience: audience,
    p_audience_ref: audience === "FACULTY" || audience === "ZONE" ? $("#mtRef").value || null : null,
    p_users: audience === "CUSTOM" ? [...mtPicked] : null
  });
  if (error) return showAlert("#pageAlert", error.message, "error");
  $("#mtModal").classList.add("hidden");
  showAlert("#pageAlert", "Réunion enregistrée. Les participants la voient dans leur espace.", "success");
  loadMeetings();
}

/* ---------- attendance ---------- */
let mtCurrent = null;
async function openAttendance(m) {
  mtCurrent = m;
  $("#mtDetailTitle").textContent = m.title;
  $("#mtDetailBody").innerHTML = '<div class="loading-state">Chargement…</div>';
  $("#mtDetail").classList.remove("hidden");
  const { data, error } = await sb.rpc("list_meeting_participants", { p_meeting: m.id });
  if (error) { $("#mtDetailBody").innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; return; }
  const rows = data || [];
  const options = status => Object.entries(MT_STATUS).filter(([k]) => k !== "PENDING" || !isPast(m))
    .map(([k, v]) => `<option value="${k}" ${k === status ? "selected" : ""}>${v.label}</option>`).join("");
  $("#mtDetailBody").innerHTML = `
    <p class="mt-meta">${fmtDate(m.starts_at)} · ${fmtTime(m.starts_at)} – ${fmtTime(meetingEnd(m))} · retard après ${m.late_after_min} min</p>
    <div class="mt-att">${rows.map(r => {
      const st = effectiveStatus(r.status, m);
      return `<div class="mt-att-row">
        <div><b>${escapeHtml(r.name)}</b><small>${escapeHtml(r.login || "")}${r.joined_at ? ` · arrivé à ${fmtTime(r.joined_at)}` : ""}</small></div>
        <span class="mt-badge ${MT_STATUS[st].cls}">${MT_STATUS[st].label}</span>
        <select data-user="${r.user_id}" aria-label="Statut de ${escapeHtml(r.name)}">${options(st)}</select>
      </div>`;
    }).join("") || '<div class="empty">Aucun participant.</div>'}</div>`;
}

async function onAttendanceChange(event) {
  const select = event.target.closest("select[data-user]");
  if (!select || !mtCurrent) return;
  let note = null;
  if (select.value === "EXCUSED") note = await promptDialog("Motif de l’absence (facultatif)", { placeholder: "Examen, maladie…" });
  const { error } = await sb.rpc("set_meeting_attendance", { p_meeting: mtCurrent.id, p_user: select.dataset.user, p_status: select.value, p_note: note });
  if (error) return showAlert("#pageAlert", error.message, "error");
  await openAttendance(mtCurrent);
  loadMeetings();
}
