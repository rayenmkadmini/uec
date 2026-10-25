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

  // "dans 2 j", "dans 3 h", "maintenant"
  const countdown = date => {
    const ms = new Date(date).getTime() - Date.now();
    if (ms <= 0) return "en cours";
    const h = Math.floor(ms / 3600000);
    if (h < 1) return `dans ${Math.max(1, Math.round(ms / 60000))} min`;
    if (h < 24) return `dans ${h} h`;
    return `dans ${Math.round(h / 24)} j`;
  };

  async function summary() {
    const { data: auth } = await sb.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return;
    const today = new Date().toISOString().slice(0, 10);
    const [me, matches, meetings, myMeetings, events, myEvents] = await Promise.all([
      sb.from("subscribers").select("prenom,nom,numero_abonnement,card_paid").eq("user_id", userId).maybeSingle(),
      sb.from("matches").select("id,home_team,away_team,home_logo_url,away_logo_url,match_date,match_time,stadium").eq("is_active", true).gte("match_date", today).order("match_date", { ascending: true }).order("match_time", { ascending: true }).limit(3),
      sb.from("meetings").select("id,title,starts_at,duration_min,status").order("starts_at", { ascending: true }),
      sb.from("meeting_participants").select("meeting_id,status").eq("user_id", userId),
      sb.from("club_events").select("id,title,starts_at,duration_min,status,location").order("starts_at", { ascending: true }),
      sb.from("club_event_participants").select("event_id,status,rsvp").eq("user_id", userId)
    ]);

    const ann = await sb.from("announcements").select("title,body,pinned,created_at").order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(1);
    const latest = ann.data?.[0];
    if (latest) {
      let seen = 0;
      try { seen = Number(localStorage.getItem("uec-announcements-seen") || 0); } catch (_) {}
      set("mhAnnTag", new Date(latest.created_at).getTime() > seen ? "Nouvelle annonce" : latest.pinned ? "Annonce épinglée" : "Dernière annonce");
      set("mhAnnTitle", latest.title);
      set("mhAnnBody", latest.body);
      document.getElementById("mhAnn")?.classList.remove("hidden");
    }

    if (me.data) {
      set("mhNumber", `N° ${me.data.numero_abonnement || "—"}`);
      const avatar = document.getElementById("mhAvatar");
      if (avatar && !avatar.classList.contains("has-photo")) avatar.textContent = (me.data.prenom || me.data.nom || "U").charAt(0).toUpperCase();
      set("mhCardState", me.data.card_paid ? "Carte payée" : "Carte non payée");
      set("mhCardSub", me.data.card_paid ? "Vous êtes en règle ✓" : "Rapprochez-vous du trésorier");
      set("mhCardIcon", me.data.card_paid ? "✅" : "⏳");
      document.querySelector("#mhCardIcon")?.closest(".mh-stat")?.classList.toggle("warn", !me.data.card_paid);
    }

    const end = x => new Date(x.starts_at).getTime() + x.duration_min * 60000;
    const mine = (list, rows, key) => {
      const status = new Map((rows.data || []).map(p => [p[key], p]));
      return (list.data || []).filter(x => status.has(x.id) && x.status !== "CANCELLED").map(x => ({ ...x, me: status.get(x.id) }));
    };
    const ev = mine(events, myEvents, "event_id");
    const mt = mine(meetings, myMeetings, "meeting_id");

    // Attendance over finished meetings and events.
    const done = [...ev, ...mt].filter(x => end(x) < Date.now());
    const attended = done.filter(x => ["PRESENT", "LATE"].includes(x.me.status)).length;
    const rate = done.length ? Math.round((attended / done.length) * 100) : null;
    set("mhRate", rate === null ? "—" : `${rate}%`);
    set("mhRateSub", rate === null ? "pas encore d’historique" : `${attended} présence(s) sur ${done.length}`);
    document.getElementById("mhRing")?.style.setProperty("--p", `${rate || 0}%`);

    // One agenda: matches, events and meetings, soonest first.
    const items = [
      ...(matches.data || []).map(m => ({ kind: "match", match: m, when: `${m.match_date}T${m.match_time || "00:00"}`, title: `${m.home_team} – ${m.away_team}`, sub: m.stadium || "Match", href: "matchs.html", cta: "Ma place" })),
      ...ev.filter(x => end(x) >= Date.now()).map(x => ({ kind: "event", when: x.starts_at, title: x.title, sub: x.location || "Événement", href: "subscriber.html#evenements",
        cta: x.me.rsvp === "GOING" ? "Inscrit ✓" : x.me.rsvp === "NOT_GOING" ? "Décliné" : "Répondre", pending: x.me.rsvp === "NONE" })),
      ...mt.filter(x => end(x) >= Date.now()).map(x => ({ kind: "meeting", when: x.starts_at, title: x.title, sub: "Discord UEC", href: "subscriber.html#reunions", cta: "Voir" }))
    ].sort((a, b) => new Date(a.when) - new Date(b.when)).slice(0, 5);
    const LABEL = { match: "Match", event: "Événement", meeting: "Réunion" };
    const logos = (matches.data || []).length ? await loadClubLogos().catch(() => new Map()) : new Map();
    const box = document.getElementById("mhAgenda");
    if (box) box.innerHTML = items.length ? items.map(it => {
      const d = new Date(it.when);
      return `<a class="mh-item ${it.kind}" href="${it.href}">
        ${it.match
          ? `<span class="mh-item-logos">${teamLogoImg(it.match.home_team, "HOME", it.match.home_logo_url, logos)}${teamLogoImg(it.match.away_team, "AWAY", it.match.away_logo_url, logos)}</span>`
          : `<span class="mh-item-date"><b>${String(d.getDate()).padStart(2, "0")}</b><small>${d.toLocaleDateString("fr-FR", { month: "short" })}</small></span>`}
        <span class="mh-item-main"><small>${LABEL[it.kind]} · ${countdown(it.when)}</small><b>${escapeHtml(it.title)}</b><em>${d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" })} · ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · ${escapeHtml(it.sub)}</em></span>
        <span class="mh-item-cta${it.pending ? " pending" : ""}">${it.cta}</span>
      </a>`;
    }).join("") : '<div class="mh-empty">Rien de prévu pour le moment. Les prochains matchs, événements et réunions apparaîtront ici.</div>';
  }
  const start = () => summary().catch(() => {});
  if (document.readyState === "complete") start(); else window.addEventListener("load", start);
})();
