/* ============================================================
   MES RÉUNIONS (member area) — the meetings the member is invited to.
   "Rejoindre" records the attendance server-side (present / late, server
   clock) and only then opens the Google Meet link. Row-level security
   returns only the meetings this account is invited to.
============================================================ */
(function () {
  const box = document.getElementById("myMeetings");
  if (!box) return;
  const LABEL = { PRESENT: ["Présent", "ok"], LATE: ["En retard", "warn"], ABSENT: ["Absent", "ko"], EXCUSED: ["Absence justifiée", "info"] };
  const end = m => new Date(new Date(m.starts_at).getTime() + m.duration_min * 60000);
  const time = d => new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  async function load() {
    const { data: auth } = await sb.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return;
    const [meetings, mine] = await Promise.all([
      sb.from("meetings").select("id,title,description,starts_at,duration_min,late_after_min,meet_url,status").order("starts_at", { ascending: true }),
      sb.from("meeting_participants").select("meeting_id,status,joined_at").eq("user_id", userId)
    ]);
    const section = document.getElementById("reunions");
    if (meetings.error) { section?.classList.add("hidden"); return; }
    const status = new Map((mine.data || []).map(p => [p.meeting_id, p]));
    const now = Date.now();
    const list = (meetings.data || []).filter(m => status.has(m.id));
    const upcoming = list.filter(m => end(m).getTime() >= now);
    const past = list.filter(m => end(m).getTime() < now).reverse().slice(0, 6);
    const attended = list.filter(m => end(m).getTime() < now && m.status !== "CANCELLED");
    const present = attended.filter(m => ["PRESENT", "LATE"].includes(status.get(m.id).status)).length;
    const rate = attended.length ? Math.round((present / attended.length) * 100) : null;

    const card = m => {
      const p = status.get(m.id);
      const start = new Date(m.starts_at).getTime();
      const open = now >= start - 15 * 60000 && now <= end(m).getTime();
      const cancelled = m.status === "CANCELLED";
      const isPast = end(m).getTime() < now;
      const st = isPast && p.status === "PENDING" ? "ABSENT" : p.status;
      const badge = cancelled ? '<span class="mt-badge ko">Annulée</span>'
        : LABEL[st] ? `<span class="mt-badge ${LABEL[st][1]}">${LABEL[st][0]}${p.joined_at ? ` · ${time(p.joined_at)}` : ""}</span>`
        : open ? '<span class="mt-live">● EN COURS</span>' : "";
      const action = !cancelled && !isPast
        ? (open
          ? `<button type="button" class="btn primary" data-join="${m.id}">${p.joined_at ? "Rouvrir Meet" : "Rejoindre"}</button>`
          : `<span class="mt-soon">Ouverture ${new Date(start - 15 * 60000).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>`)
        : "";
      return `<article class="mt-mine${open && !cancelled ? " live" : ""}">
        <div><b>${escapeHtml(m.title)}</b>
        <small>${new Date(m.starts_at).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} · ${time(m.starts_at)} – ${time(end(m))}</small>
        ${m.description && !isPast ? `<p>${escapeHtml(m.description)}</p>` : ""}</div>
        <div class="mt-mine-side">${badge}${action}</div>
      </article>`;
    };

    box.innerHTML = `
      ${rate === null ? "" : `<div class="mt-rate"><span>Assiduité</span><b>${rate}%</b><i style="--p:${rate}%"></i></div>`}
      <h3 class="mt-sub">À venir</h3>
      ${upcoming.map(card).join("") || '<div class="empty-card">Aucune réunion prévue pour vous.</div>'}
      ${past.length ? `<h3 class="mt-sub">Historique</h3>${past.map(card).join("")}` : ""}`;
  }

  box.addEventListener("click", async event => {
    const button = event.target.closest("[data-join]");
    if (!button) return;
    button.disabled = true;
    // Open the tab synchronously (popup blockers), then point it at the link.
    const tab = window.open("", "_blank");
    const { data, error } = await sb.rpc("join_meeting", { p_id: button.dataset.join });
    if (error) {
      tab?.close();
      button.disabled = false;
      return showAlert("#pageAlert", error.message, "error");
    }
    if (tab) { tab.opener = null; tab.location.href = data; } else location.href = data;
    load();
  });

  const start = () => { load(); setInterval(load, 60000); };
  if (document.readyState === "complete") start(); else window.addEventListener("load", start);
})();
