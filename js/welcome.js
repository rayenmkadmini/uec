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
    // An Auth error in the URL (expired link...) must be visible at once.
    if (location.hash.includes("error") || location.search.includes("error")) reveal();
})();
