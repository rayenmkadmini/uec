/* ============================================================
   UEC21 MEMBERS — phone splash screen
   Shown once per browser session, on phones only, when the site is
   opened: 5 seconds (tap to skip). Loaded in <head> so it covers the
   page before anything else is painted.
============================================================ */
(function () {
    try {
        if (!window.matchMedia("(max-width: 900px)").matches) return;
        if (sessionStorage.getItem("uec-splash-seen")) return;
        sessionStorage.setItem("uec-splash-seen", "1");
    } catch (_) {
        return; // storage blocked: never risk showing it on every page
    }

    const DURATION = 5000;
    const css = `
#uec-splash{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;
  background:radial-gradient(520px 420px at 50% 38%,rgba(229,28,63,.32),transparent 70%),#07080a;color:#fff;
  font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;transition:opacity .5s ease,visibility .5s ease;
  padding:env(safe-area-inset-top) 24px env(safe-area-inset-bottom)}
#uec-splash.out{opacity:0;visibility:hidden}
#uec-splash::before{content:"";position:absolute;left:0;right:0;top:0;height:6px;background:repeating-linear-gradient(90deg,#e31b23 0 26px,#fff 26px 52px)}
#uec-splash::after{content:"";position:absolute;left:0;right:0;bottom:0;height:6px;background:repeating-linear-gradient(90deg,#fff 0 26px,#e31b23 26px 52px)}
#uec-splash .sp-logo{position:relative;width:148px;height:148px;border-radius:50%;animation:spIn .9s cubic-bezier(.2,.9,.3,1.2) both}
#uec-splash .sp-logo img{width:100%;height:100%;border-radius:50%;object-fit:cover;box-shadow:0 0 0 4px rgba(255,255,255,.08),0 20px 60px rgba(229,28,63,.45)}
#uec-splash .sp-logo::after{content:"";position:absolute;inset:-12px;border-radius:50%;border:2px solid rgba(229,28,63,.55);animation:spPulse 1.8s ease-out infinite}
#uec-splash .sp-title{margin:0;font-size:30px;font-weight:900;letter-spacing:.06em;line-height:1;animation:spUp .7s .35s both}
#uec-splash .sp-title span{color:#e51c3f}
#uec-splash .sp-sub{margin:0;font-size:12px;font-weight:700;letter-spacing:.32em;color:#b8bcc6;animation:spUp .7s .55s both}
#uec-splash .sp-bar{width:160px;height:4px;border-radius:99px;background:rgba(255,255,255,.12);overflow:hidden;margin-top:8px;animation:spUp .7s .7s both}
#uec-splash .sp-bar i{display:block;height:100%;width:100%;border-radius:inherit;background:linear-gradient(90deg,#e51c3f,#ff6b82);transform-origin:left;animation:spLoad ${DURATION}ms linear both}
#uec-splash .sp-skip{position:absolute;bottom:calc(26px + env(safe-area-inset-bottom));font-size:11px;letter-spacing:.12em;color:#7d828d}
@keyframes spIn{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}
@keyframes spUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes spPulse{from{opacity:.9;transform:scale(.92)}to{opacity:0;transform:scale(1.25)}}
@keyframes spLoad{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@media(prefers-reduced-motion:reduce){#uec-splash *{animation-duration:.01ms!important}#uec-splash .sp-bar i{animation:spLoad ${DURATION}ms linear both!important}}`;

    const style = document.createElement("style");
    style.textContent = css;
    document.documentElement.appendChild(style);

    const splash = document.createElement("div");
    splash.id = "uec-splash";
    splash.setAttribute("role", "status");
    splash.setAttribute("aria-label", "UEC21 Members, chargement");
    splash.innerHTML = `
      <div class="sp-logo"><img src="assets/uec-logo-192.webp" alt="" width="148" height="148"></div>
      <p class="sp-title">UEC<span>21</span></p>
      <p class="sp-sub">MEMBERS</p>
      <div class="sp-bar"><i></i></div>
      <span class="sp-skip">Touchez pour continuer</span>`;
    document.documentElement.appendChild(splash);

    let done = false;
    const hide = () => {
        if (done) return;
        done = true;
        splash.classList.add("out");
        setTimeout(() => { splash.remove(); style.remove(); }, 600);
    };
    splash.addEventListener("click", hide);
    setTimeout(hide, DURATION);
})();
