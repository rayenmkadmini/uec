/* ============================================================
   PRÉSENTER MA CARTE — full-screen member card for the stadium gate or
   a check by the bureau: live clock (seconds) and a moving hologram so a
   screenshot is easy to spot, the screen kept awake (Wake Lock), tap the
   card to flip it. Closes with ✕, Escape or the back gesture.
============================================================ */
/* Manifesto under the card: read aloud (speech synthesis) and share. */
(function () {
  const text = () => `${document.getElementById("manifestoText")?.textContent || ""} ${document.querySelector(".um-motto")?.textContent || ""}`.trim();
  const listen = document.getElementById("manifestoListen");
  if (listen && "speechSynthesis" in window) {
    listen.addEventListener("click", () => {
      if (speechSynthesis.speaking) { speechSynthesis.cancel(); listen.classList.remove("on"); return; }
      const say = new SpeechSynthesisUtterance(text());
      say.lang = "fr-FR";
      say.rate = 0.95;
      say.onend = () => listen.classList.remove("on");
      listen.classList.add("on");
      speechSynthesis.speak(say);
    });
  } else listen?.remove();
  document.getElementById("manifestoShare")?.addEventListener("click", async () => {
    const data = { title: "UEC21 — Union des Étudiants Clubistes", text: text() };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(data.text); showAlert("#pageAlert", "Texte copié.", "success"); }
    } catch (_) { /* cancelled */ }
  });
  window.addEventListener("hashchange", () => { if (window.speechSynthesis?.speaking) { speechSynthesis.cancel(); listen?.classList.remove("on"); } });
})();

// "Retourner" button + current season on the card view.
(function () {
  document.getElementById("flipCardBtn")?.addEventListener("click", () => document.querySelector("#subscriberMemberCard .vcard")?.classList.toggle("flipped"));
  const now = new Date();
  const y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const season = document.getElementById("mcSeason");
  if (season) season.textContent = `Saison ${y}-${y + 1}`;
})();

(function () {
  const button = document.getElementById("presentCardBtn");
  if (!button) return;
  let wakeLock = null;
  let timer = null;

  async function keepAwake() {
    try { wakeLock = await navigator.wakeLock?.request("screen"); } catch (_) { wakeLock = null; }
  }

  function close() {
    document.getElementById("cardPresent")?.remove();
    clearInterval(timer);
    try { wakeLock?.release(); } catch (_) {}
    wakeLock = null;
    document.removeEventListener("keydown", onKey);
    if (history.state?.cardPresent) history.back();
  }
  const onKey = e => { if (e.key === "Escape") close(); };

  function open() {
    const card = document.querySelector("#subscriberMemberCard .vcard");
    if (!card) return showAlert("#pageAlert", "Votre carte n’est pas encore chargée.", "error");
    const overlay = document.createElement("div");
    overlay.id = "cardPresent";
    overlay.className = "cp-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Carte membre en plein écran");
    overlay.innerHTML = `
      <button type="button" class="cp-close" aria-label="Fermer">✕</button>
      <div class="cp-top"><img src="assets/uec-logo-96.webp" alt="" width="34" height="34"><div><b>UEC21 · Carte membre</b><small>Union des Étudiants Clubistes</small></div></div>
      <div class="cp-card">${card.outerHTML}<span class="cp-holo" aria-hidden="true"></span></div>
      <div class="cp-live"><span class="cp-pulse" aria-hidden="true"></span><span>Carte en direct</span><b id="cpClock">--:--:--</b></div>
      <p class="cp-date" id="cpDate"></p>
      <p class="cp-hint">Touchez la carte pour la retourner · l’écran reste allumé</p>`;
    document.body.appendChild(overlay);
    overlay.querySelector(".cp-card .vcard")?.classList.remove("flipped");
    overlay.querySelector(".cp-close").addEventListener("click", close);
    const tick = () => {
      const now = new Date();
      const clock = document.getElementById("cpClock");
      if (clock) clock.textContent = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const date = document.getElementById("cpDate");
      if (date) date.textContent = now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    };
    tick();
    timer = setInterval(tick, 1000);
    keepAwake();
    document.addEventListener("keydown", onKey);
    history.pushState({ cardPresent: true }, "");
  }

  button.addEventListener("click", open);
  window.addEventListener("popstate", () => {
    if (document.getElementById("cardPresent")) {
      document.getElementById("cardPresent").remove();
      clearInterval(timer);
      try { wakeLock?.release(); } catch (_) {}
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && document.getElementById("cardPresent")) keepAwake();
  });
})();
