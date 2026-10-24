/* ============================================================
   INSTALL THE APP (PWA) — iPhone and Android
   A floating "Installer l'app" button on every page while the site is not
   installed. Android/Chrome: native install prompt when available, otherwise
   the menu steps. iPhone/iPad: Safari "Share > Add to Home Screen" steps.
============================================================ */
(function () {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (standalone) return;

  const ua = navigator.userAgent || "";
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = isIOS && !/crios|fxios|edgios|opios/i.test(ua);
  const isAndroid = /android/i.test(ua);
  const HIDE_KEY = "uec-install-hidden-until";
  let deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredPrompt = event;
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    document.getElementById("installAppBtn")?.remove();
    closeSheet();
  });

  const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>';
  const shareIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a2 2 0 00-2 2v6a2 2 0 002 2h14a2 2 0 002-2v-6a2 2 0 00-2-2h-1"/></svg>';

  function hiddenNow() {
    try { return Number(localStorage.getItem(HIDE_KEY) || 0) > Date.now(); } catch (_) { return false; }
  }

  function steps() {
    if (isIOS && !isSafari) {
      return { title: "Ouvrez le site dans Safari", items: [
        "Sur iPhone, l’installation se fait uniquement depuis <b>Safari</b>.",
        "Copiez l’adresse <b>login.ueclubistes.tn</b> et ouvrez-la dans Safari.",
        "Appuyez ensuite à nouveau sur <b>Installer l’app</b>."
      ] };
    }
    if (isIOS) {
      return { title: "Installer sur iPhone", items: [
        `Appuyez sur le bouton <b>Partager</b> <span class="ia-inline">${shareIcon}</span> en bas de Safari.`,
        "Faites défiler et choisissez <b>« Sur l’écran d’accueil »</b>.",
        "Appuyez sur <b>Ajouter</b> en haut à droite.",
        "Ouvrez <b>UEC21</b> depuis votre écran d’accueil : l’app s’ouvre en plein écran."
      ] };
    }
    if (isAndroid) {
      return { title: "Installer sur Android", items: [
        "Ouvrez le site dans <b>Chrome</b>.",
        "Appuyez sur le menu <b>⋮</b> en haut à droite.",
        "Choisissez <b>« Installer l’application »</b> ou <b>« Ajouter à l’écran d’accueil »</b>.",
        "Confirmez avec <b>Installer</b> : l’icône UEC21 apparaît sur votre téléphone."
      ] };
    }
    return { title: "Installer sur ordinateur", items: [
      "Dans Chrome ou Edge, cliquez sur l’icône <b>Installer</b> à droite de la barre d’adresse.",
      "Ou ouvrez le menu <b>⋮</b> puis <b>« Installer UEC21 »</b>.",
      "Sur téléphone, ouvrez ce site et appuyez sur <b>Installer l’app</b>."
    ] };
  }

  function closeSheet() {
    document.getElementById("installSheet")?.remove();
  }

  function openSheet() {
    closeSheet();
    const { title, items } = steps();
    const sheet = document.createElement("div");
    sheet.id = "installSheet";
    sheet.className = "ia-backdrop";
    sheet.innerHTML = `
      <div class="ia-sheet" role="dialog" aria-modal="true" aria-labelledby="iaTitle">
        <div class="ia-head">
          <img src="assets/app-icon-192.png" alt="">
          <div><small>Application UEC21</small><h2 id="iaTitle">${title}</h2></div>
          <button type="button" class="ia-close" aria-label="Fermer">✕</button>
        </div>
        <ol class="ia-steps">${items.map(item => `<li>${item}</li>`).join("")}</ol>
        <p class="ia-note">Gratuit, sans Play Store ni App Store. Les mises à jour sont automatiques.</p>
        <div class="ia-actions">
          <button type="button" class="btn secondary ia-later">Plus tard</button>
          <button type="button" class="btn primary ia-ok">J’ai compris</button>
        </div>
        ${isIOS && isSafari ? '<div class="ia-arrow" aria-hidden="true">⬇</div>' : ""}
      </div>`;
    sheet.addEventListener("click", event => {
      if (event.target === sheet || event.target.closest(".ia-close, .ia-ok")) closeSheet();
      if (event.target.closest(".ia-later")) {
        try { localStorage.setItem(HIDE_KEY, String(Date.now() + 7 * 86400000)); } catch (_) {}
        document.getElementById("installAppBtn")?.remove();
        closeSheet();
      }
    });
    document.body.appendChild(sheet);
    sheet.querySelector(".ia-ok").focus();
  }

  async function install() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch (_) {}
      deferredPrompt = null;
      return;
    }
    openSheet();
  }
  window.uecInstallApp = install;

  function addButton() {
    if (hiddenNow() || document.getElementById("installAppBtn")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.id = "installAppBtn";
    button.className = "install-app-btn";
    button.innerHTML = `${icon}<span>Installer l’app</span>`;
    button.addEventListener("click", install);
    document.body.appendChild(button);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addButton);
  else addButton();
})();
