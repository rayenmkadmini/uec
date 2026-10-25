/* ============================================================
   MEMBER AREA VIEWS — the member area is split into views (Accueil,
   Mon profil, Événements, Réunions) shown one at a time from the URL
   hash (#accueil...), so the page reads like an app instead of one long
   scroll. The home view also gets a summary: next match, event, meeting
   and the attendance rate.
============================================================ */
(function () {
  const root = document.querySelector(".member-views");
  if (!root) return;
  const VIEWS = ["accueil", "carte", "profil", "evenements", "reunions"];
  const ALIASES = { security: "profil" };
  const TITLES = { accueil: "Mon espace", carte: "Ma carte membre", profil: "Mon profil", evenements: "Mes événements", reunions: "Mes réunions" };

  function current() {
    const hash = location.hash.replace("#", "");
    return VIEWS.includes(hash) ? hash : ALIASES[hash] || "accueil";
  }

  function show() {
    const view = current();
    root.querySelectorAll("[data-view]").forEach(section => { section.hidden = section.dataset.view !== view; });
    document.querySelectorAll("[data-view-link], .mobile-tabbar a").forEach(link => {
      const href = link.getAttribute("href") || "";
      const target = href.includes("#") ? href.split("#")[1] : href.endsWith("subscriber.html") ? "accueil" : null;
      const on = target === view && !href.startsWith("matchs");
      link.classList.toggle("active", on);
      if (on) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    });
    const title = document.querySelector(".topbar h1");
    if (title) title.textContent = TITLES[view];
    root.classList.remove("mv-enter");
    void root.offsetWidth;
    root.classList.add("mv-enter");
    if (location.hash.replace("#", "") === "security") document.getElementById("security")?.scrollIntoView({ behavior: "smooth" });
    else window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  window.addEventListener("hashchange", show);
  show();
  // The mobile tab bar is built after this script by setupShell: sync it once ready.
  new MutationObserver((_, observer) => { if (document.querySelector(".mobile-tabbar")) { observer.disconnect(); show(); } })
    .observe(document.body, { childList: true });

  /* ---------- home summary ---------- */
  const hour = new Date().getHours();
  const greet = document.getElementById("mhGreet");
  if (greet) greet.textContent = hour < 5 ? "Bonne nuit" : hour < 12 ? "Bonjour" : hour < 18 ? "Bon après-midi" : "Bonsoir";
  const now = new Date();
  const y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const season = document.getElementById("mhSeason");
  if (season) season.textContent = `Saison ${y}-${y + 1}`;

  const set = (id, text) => { const node = document.getElementById(id); if (node) node.textContent = text; };
  const when = date => {
    const d = new Date(date);
    const days = Math.round((new Date(d.toDateString()) - new Date(new Date().toDateString())) / 86400000);
    const day = days === 0 ? "Aujourd’hui" : days === 1 ? "Demain" : d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" });
    return `${day} · ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  };

  async function summary() {
    const { data: auth } = await sb.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return;
    const today = new Date().toISOString().slice(0, 10);
    const [me, match, meetings, myMeetings, events, myEvents] = await Promise.all([
      sb.from("subscribers").select("prenom,nom,numero_abonnement").eq("user_id", userId).maybeSingle(),
      sb.from("matches").select("home_team,away_team,match_date,match_time").eq("is_active", true).gte("match_date", today).order("match_date", { ascending: true }).order("match_time", { ascending: true }).limit(1),
      sb.from("meetings").select("id,title,starts_at,duration_min,status").order("starts_at", { ascending: true }),
      sb.from("meeting_participants").select("meeting_id,status").eq("user_id", userId),
      sb.from("club_events").select("id,title,starts_at,duration_min,status,location").order("starts_at", { ascending: true }),
      sb.from("club_event_participants").select("event_id,status").eq("user_id", userId)
    ]);

    if (me.data) {
      set("mhNumber", `N° ${me.data.numero_abonnement || "—"}`);
      set("mhAvatar", (me.data.prenom || me.data.nom || "U").charAt(0).toUpperCase());
    }
    const m = match.data?.[0];
    if (m) { set("mhMatch", `${m.home_team} – ${m.away_team}`); set("mhMatchSub", when(`${m.match_date}T${m.match_time || "00:00"}`)); }
    else set("mhMatchSub", "Aucun match programmé");

    const end = x => new Date(x.starts_at).getTime() + x.duration_min * 60000;
    const pick = (list, mine, key) => {
      const status = new Map((mine.data || []).map(p => [p[key], p.status]));
      const items = (list.data || []).filter(x => status.has(x.id) && x.status !== "CANCELLED");
      const next = items.find(x => end(x) >= Date.now());
      const past = items.filter(x => end(x) < Date.now());
      const attended = past.filter(x => ["PRESENT", "LATE"].includes(status.get(x.id))).length;
      return { next, past: past.length, attended };
    };
    const ev = pick(events, myEvents, "event_id");
    const mt = pick(meetings, myMeetings, "meeting_id");
    if (ev.next) { set("mhEvent", ev.next.title); set("mhEventSub", when(ev.next.starts_at)); } else set("mhEventSub", "Rien de prévu");
    if (mt.next) { set("mhMeeting", mt.next.title); set("mhMeetingSub", when(mt.next.starts_at)); } else set("mhMeetingSub", "Rien de prévu");
    const total = ev.past + mt.past;
    const rate = total ? Math.round(((ev.attended + mt.attended) / total) * 100) : null;
    set("mhRate", rate === null ? "—" : `${rate}%`);
    document.getElementById("mhRing")?.style.setProperty("--p", `${rate || 0}%`);
  }
  const start = () => summary().catch(() => {});
  if (document.readyState === "complete") start(); else window.addEventListener("load", start);
})();
