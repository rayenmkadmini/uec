/* ============================================================
   MES ÉVÉNEMENTS (member area) — events the member is invited to:
   answer "je participe" / "je ne participe pas", then check in on site
   with the organiser's 6-digit code (present / late, server clock).
   Row-level security returns only this account's invitations.
============================================================ */
(function () {
  const box = document.getElementById("myEvents");
  if (!box) return;
  const LABEL = { PRESENT: ["Présent", "ok"], LATE: ["En retard", "warn"], ABSENT: ["Absent", "ko"], EXCUSED: ["Absence justifiée", "info"] };
  const CAT = { RASSEMBLEMENT: "Rassemblement", DEPLACEMENT: "Déplacement", TIFO: "Tifo", REUNION: "Réunion", SOIREE: "Soirée", FORMATION: "Formation", AUTRE: "Autre" };
  const end = e => new Date(new Date(e.starts_at).getTime() + e.duration_min * 60000);
  const time = d => new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  let events = [];

  async function load() {
    const { data: auth } = await sb.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return;
    const [list, mine] = await Promise.all([
      sb.from("club_events").select("id,title,description,category,location,starts_at,duration_min,late_after_min,capacity,status,image_url").order("starts_at", { ascending: true }),
      sb.from("club_event_participants").select("event_id,status,rsvp,checked_in_at").eq("user_id", userId)
    ]);
    if (list.error) { document.getElementById("evenements")?.classList.add("hidden"); return; }
    const status = new Map((mine.data || []).map(p => [p.event_id, p]));
    const now = Date.now();
    events = (list.data || []).filter(e => status.has(e.id)).map(e => ({ ...e, me: status.get(e.id) }));
    const upcoming = events.filter(e => end(e).getTime() >= now);
    const past = events.filter(e => end(e).getTime() < now).reverse().slice(0, 6);
    const done = events.filter(e => end(e).getTime() < now && e.status !== "CANCELLED");
    const present = done.filter(e => ["PRESENT", "LATE"].includes(e.me.status)).length;
    const rate = done.length ? Math.round((present / done.length) * 100) : null;

    const card = e => {
      const start = new Date(e.starts_at).getTime();
      const isPast = end(e).getTime() < now;
      const open = now >= start - 30 * 60000 && !isPast;
      const cancelled = e.status === "CANCELLED";
      const st = isPast && e.me.status === "PENDING" ? "ABSENT" : e.me.status;
      let side = "";
      if (cancelled) side = '<span class="mt-badge ko">Annulé</span>';
      else if (LABEL[st] && (isPast || e.me.checked_in_at || st === "EXCUSED")) side = `<span class="mt-badge ${LABEL[st][1]}">${LABEL[st][0]}${e.me.checked_in_at ? ` · ${time(e.me.checked_in_at)}` : ""}</span>`;
      else if (open) side = `<button type="button" class="btn primary" data-checkin="${e.id}">Pointer ma présence</button>`;
      else side = `<div class="ev-rsvp" role="group" aria-label="Votre réponse">
          <button type="button" class="${e.me.rsvp === "GOING" ? "on ok" : ""}" data-rsvp="${e.id}" data-going="1">✓ Je participe</button>
          <button type="button" class="${e.me.rsvp === "NOT_GOING" ? "on ko" : ""}" data-rsvp="${e.id}" data-going="0">✕ Absent</button>
        </div>`;
      return `<article class="mt-mine${e.image_url ? " has-cover" : ""}${open && !cancelled ? " live" : ""}">${e.image_url ? `<img class="ev-cover" src="${escapeHtml(e.image_url)}" alt="" loading="lazy">` : ""}
        <div><span class="mt-badge ev-cat">${escapeHtml(CAT[e.category] || e.category)}</span> <b>${escapeHtml(e.title)}</b>
        <small>${new Date(e.starts_at).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} · ${time(e.starts_at)} – ${time(end(e))}</small>
        ${e.location ? `<small>📍 ${escapeHtml(e.location)}</small>` : ""}
        ${e.description && !isPast ? `<p>${escapeHtml(e.description)}</p>` : ""}</div>
        <div class="mt-mine-side">${side}</div>
      </article>`;
    };

    box.innerHTML = `
      ${rate === null ? "" : `<div class="mt-rate"><span>Assiduité aux événements</span><b>${rate}%</b><i style="--p:${rate}%"></i></div>`}
      <h3 class="mt-sub">À venir</h3>
      ${upcoming.map(card).join("") || '<div class="empty-card">Aucun événement prévu pour vous.</div>'}
      ${past.length ? `<h3 class="mt-sub">Historique</h3>${past.map(card).join("")}` : ""}`;
  }

  box.addEventListener("click", async event => {
    const rsvp = event.target.closest("[data-rsvp]");
    if (rsvp) {
      const { error } = await sb.rpc("rsvp_club_event", { p_id: rsvp.dataset.rsvp, p_going: rsvp.dataset.going === "1" });
      if (error) return showAlert("#pageAlert", error.message, "error");
      showAlert("#pageAlert", rsvp.dataset.going === "1" ? "Réponse enregistrée : vous participez." : "Réponse enregistrée : vous ne participez pas.", "success");
      return load();
    }
    const checkin = event.target.closest("[data-checkin]");
    if (!checkin) return;
    const code = await promptDialog("Code de pointage", {
      text: "Tapez le code à 6 chiffres affiché par l’organisateur.",
      input: "text",
      inputAttributes: { inputmode: "numeric", autocomplete: "one-time-code", maxlength: "7", pattern: "[0-9 ]*" },
      placeholder: "123 456",
      confirmText: "Valider",
      validator: v => (/^\d{6}$/.test(String(v || "").replace(/\s/g, "")) ? undefined : "6 chiffres.")
    });
    if (!code) return;
    const { data, error } = await sb.rpc("checkin_club_event", { p_id: checkin.dataset.checkin, p_code: code.replace(/\s/g, "") });
    if (error) return showAlert("#pageAlert", error.message, "error");
    if (data === "WRONG_CODE") return showAlert("#pageAlert", "Code incorrect. Vérifiez auprès de l’organisateur (5 essais maximum).", "error");
    showAlert("#pageAlert", data === "LATE" ? "Présence enregistrée (en retard)." : "Présence enregistrée. Bienvenue !", data === "LATE" ? "error" : "success");
    load();
  });

  const start = () => { load(); setInterval(load, 60000); };
  if (document.readyState === "complete") start(); else window.addEventListener("load", start);
})();
