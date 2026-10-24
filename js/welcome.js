/* Phone welcome screen on the login page (after the splash). "Se connecter"
   reveals the login form; desktop never shows it (CSS). */
(function () {
    const screen = document.getElementById("welcomeScreen");
    if (!screen) return;
    const start = document.getElementById("welcomeStart");
    const reveal = () => {
        screen.classList.add("leaving");
        document.body.classList.add("welcome-done");
        setTimeout(() => { screen.hidden = true; document.getElementById("login")?.focus(); }, 380);
    };
    start?.addEventListener("click", reveal);

    // Current season (starts in July).
    const now = new Date();
    const y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    const season = document.getElementById("wsSeason");
    if (season) season.textContent = `Saison ${y}-${y + 1}`;

    // Install shortcut when the site is not installed yet (js/install.js).
    const install = document.getElementById("wsInstall");
    const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    if (install && !standalone) {
        install.hidden = false;
        install.addEventListener("click", () => window.uecInstallApp?.());
    }

    // The mascot follows the finger / mouse (and the phone tilt), in 3D.
    const mascot = document.getElementById("wsMascot");
    if (mascot && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const tilt = (x, y) => {
            mascot.style.setProperty("--rx", `${(-y * 14).toFixed(2)}deg`);
            mascot.style.setProperty("--ry", `${(x * 18).toFixed(2)}deg`);
            mascot.classList.add("tilting");
        };
        screen.addEventListener("pointermove", e => tilt(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5));
        screen.addEventListener("pointerleave", () => mascot.classList.remove("tilting"));
        window.addEventListener("deviceorientation", e => {
            if (e.gamma == null || screen.hidden) return;
            tilt(Math.max(-1, Math.min(1, e.gamma / 30)) / 2, Math.max(-1, Math.min(1, (e.beta - 45) / 30)) / 2);
        });
    }
    // An Auth error in the URL (expired link...) must be visible at once.
    if (location.hash.includes("error") || location.search.includes("error")) reveal();
})();
