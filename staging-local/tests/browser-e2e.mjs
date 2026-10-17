// Browser tests of the real frontend against the LOCAL staging stack.
// Headless Microsoft Edge driven over the DevTools protocol (Node's built-in
// WebSocket; nothing installed). Site served on 127.0.0.1:5500 from
// staging-local/.build/web; API on 127.0.0.1:54321. Synthetic data only.
// Prints check names and statuses; never tokens, passwords or links.
//
//   node staging-local/tests/browser-e2e.mjs
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const stackDir = join(here, "..");
const API = "http://127.0.0.1:54321";
const SITE = "http://127.0.0.1:5500";
const EDGE_BIN = process.env.UE_EDGE_BIN || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const env = Object.fromEntries(readFileSync(join(stackDir, ".secrets", "stack.env"), "utf8").trim().split("\n").map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- reporting
const results = [];
let section = "";
const begin = name => { section = name; };
const check = (name, ok, detail = "") => {
  results.push({ ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${section} — ${name}${detail !== "" ? ` [${detail}]` : ""}`);
};

// ---------------------------------------------------------------- API helpers (setup only)
const svcHeaders = { apikey: env.SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };
const service = async (method, path, body) => {
  const r = await fetch(`${API}${path}`, { method, headers: { ...svcHeaders, Prefer: "return=representation" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  return { status: r.status, json: t ? JSON.parse(t) : null };
};
const anonPost = async (path, body, token) => {
  const r = await fetch(`${API}${path}`, { method: "POST", headers: { apikey: env.ANON_KEY, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const t = await r.text();
  return { status: r.status, json: t ? JSON.parse(t) : null };
};
const P = n => `Synthetic-Pass-${n}!x9Q`;
const signIn = async (email, password) => (await anonPost("/auth/v1/token?grant_type=password", { email, password })).json?.access_token || null;

async function staff(key, roles) {
  const email = `${key}@staging.invalid`;
  const u = await service("POST", "/auth/v1/admin/users", { email, password: P(`${key}-0`), email_confirm: true, user_metadata: { display_name: `Staging ${key}` } });
  await service("DELETE", `/rest/v1/user_roles?user_id=eq.${u.json.id}`);
  for (const role of roles) await service("POST", "/rest/v1/user_roles", { user_id: u.json.id, role });
  const t = await signIn(email, P(`${key}-0`));
  await fetch(`${API}/auth/v1/user`, { method: "PUT", headers: { apikey: env.ANON_KEY, Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify({ password: P(`${key}-1`) }) });
  await anonPost("/rest/v1/rpc/complete_password_change", {}, t);
  return { id: u.json.id, email, password: P(`${key}-1`), token: await signIn(email, P(`${key}-1`)) };
}
const edgeFn = (token, fn, body) => fetch(`${API}/functions/v1/${fn}`, { method: "POST", headers: { apikey: env.ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Origin: SITE }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));

// ---------------------------------------------------------------- processes
const webRoot = join(stackDir, ".build", "web");
// Static server with the response headers of vercel.json. The production Supabase origin in
// the CSP is replaced by the local API, exactly as the stack does for js/config.js.
const PROD_API = "https://qwlbbfyhjdeekmrxtzjf.supabase.co";
const siteHeaders = Object.fromEntries((JSON.parse(readFileSync(join(stackDir, "..", "vercel.json"), "utf8")).headers || [])
  .flatMap(rule => rule.headers)
  .map(({ key, value }) => [key, value.replaceAll(PROD_API, API).replaceAll(PROD_API.replace("https:", "wss:"), API.replace("http:", "ws:"))]));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  const file = join(webRoot, normalize(decodeURIComponent(new URL(req.url, SITE).pathname)).replace(/^[\\/]+/, "") || "index.html");
  if (!file.startsWith(webRoot) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404, siteHeaders); res.end("not found"); return; }
  res.writeHead(200, { ...siteHeaders, "Content-Type": TYPES[extname(file).toLowerCase()] || "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(5500, "127.0.0.1");
const profile = mkdtempSync(join(tmpdir(), "ue-edge-profile-"));
const browser = spawn(EDGE_BIN, ["--headless=new", "--remote-debugging-port=9222", "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync", "about:blank"], { stdio: "ignore" });

async function cleanup() {
  // msedge hands off to child processes: stop only those using this run's
  // throw-away profile directory (never the user's own Edge windows).
  try { browser.kill(); } catch {}
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${profile.replace(/'/g, "''")}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
      { stdio: "ignore" });
  } catch {}
  try { server.close(); } catch {}
  await sleep(1500);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}

// ---------------------------------------------------------------- DevTools protocol
let ws;
let nextId = 1;
const pending = new Map();
const listeners = new Set();
async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const v = await (await fetch("http://127.0.0.1:9222/json/version")).json();
      ws = new WebSocket(v.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
      ws.onmessage = e => {
        const msg = JSON.parse(e.data);
        if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); }
        else for (const l of listeners) l(msg);
      };
      return;
    } catch { await sleep(500); }
  }
  throw new Error("Edge DevTools endpoint not reachable");
}
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

// One isolated browser context per user (separate storage / session).
async function openPage() {
  const { browserContextId } = await send("Target.createBrowserContext");
  const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const page = { sessionId, errors: [], failed: [] };
  listeners.add(msg => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === "Runtime.exceptionThrown") page.errors.push(msg.params.exceptionDetails?.exception?.description?.split("\n")[0] || msg.params.exceptionDetails?.text);
    if (msg.method === "Network.responseReceived") {
      const { url, status } = msg.params.response;
      if (url.startsWith(API) && status >= 400) page.failed.push(`${status} ${new URL(url).pathname}`);
    }
    // CSP violations and SRI mismatches are browser log entries, not exceptions.
    if (msg.method === "Log.entryAdded" && /Content Security Policy|integrity/i.test(msg.params.entry?.text || "")) page.errors.push(`CSP: ${msg.params.entry.text.slice(0, 160)}`);
  });
  await send("Log.enable", {}, sessionId);
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Network.enable", {}, sessionId);
  page.eval = async expr => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
    return r.result?.value;
  };
  page.goto = async url => { page.errors.length = 0; page.failed.length = 0; await send("Page.navigate", { url }, sessionId); await sleep(300); };
  page.waitFor = async (expr, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { try { if (await page.eval(expr)) return true; } catch {} await sleep(250); }
    return false;
  };
  page.path = () => page.eval("location.pathname");
  page.close = () => send("Target.disposeBrowserContext", { browserContextId });
  return page;
}

async function login(page, login, password) {
  await page.goto(`${SITE}/index.html`);
  await page.waitFor("document.readyState === 'complete' && !!document.querySelector('#loginForm')");
  await page.eval(`(() => { document.querySelector('#login').value = ${JSON.stringify(login)}; document.querySelector('#password').value = ${JSON.stringify(password)}; document.querySelector('#loginForm').requestSubmit(); return true; })()`);
  await page.waitFor("!location.pathname.endsWith('index.html') || !document.querySelector('#loginError').classList.contains('hidden')", 15000);
  await sleep(1500);
}
const clean = page => page.errors.length === 0 && page.failed.length === 0;
const problems = page => [...page.errors.map(e => `js: ${e}`), ...page.failed].slice(0, 4).join(" | ");

// ================================================================= run
try {
  await connect();
  const run = Date.now().toString(36);
  begin("Setup (API, synthetic)");
  const sa = await staff(`bsa-${run}`, ["SUPERADMIN"]);
  await staff(`badmin0-${run}`, ["ADMIN"]);
  const admin = await staff(`badmin-${run}`, ["ADMIN"]);
  const treasurer = await staff(`btreas-${run}`, ["TREASURER"]);
  const fac = "FSEG Tunis — Faculté des Sciences Economiques et de Gestion de Tunis";
  const L = n => `B${run}${n}`.toUpperCase();
  const imp = await edgeFn(sa.token, "admin-import-users", { rows: [1, 2].map(n => ({ line: n + 1, nom: "BROWSER", prenom: `SYNTH_${n}`, cin: `B${run}${n}`, gender: n === 1 ? "M" : "F",
    login: L(n), numero_abonnement: `B-${run}-${n}`, phone: `+216 00 000 01${n}`, email: `bmember${n}-${run}@example.invalid`, adresse: "Rue Fictive", faculty: fac, zone: "ZONE B" })) });
  check("synthetic members imported", imp.status === 200 && imp.json.created === 2, imp.status);
  const subs = Object.fromEntries((await service("GET", `/rest/v1/subscribers?select=id,login_name&login_name=in.(${L(1)},${L(2)})`)).json.map(s => [s.login_name, s.id]));
  const pelouse = (await service("GET", "/rest/v1/match_zones?select=id&zone_key=eq.PELOUSE&match_id=eq.10000000-0000-4000-8000-0000000000d1")).json[0].id;
  await service("POST", "/rest/v1/match_participations", { match_id: "10000000-0000-4000-8000-0000000000d1", subscriber_id: subs[L(2)], zone_id: pelouse }); // seat fixture

  begin("Security headers (vercel.json): CSP, SRI, anti-framing");
  const head = await fetch(`${SITE}/index.html`);
  check("CSP and anti-framing headers served", (head.headers.get("content-security-policy") || "").includes("frame-ancestors 'none'")
    && head.headers.get("x-frame-options") === "DENY" && head.headers.get("x-content-type-options") === "nosniff");
  let page = await openPage();
  await page.goto(`${SITE}/index.html`);
  check("pinned libraries load under CSP + SRI", await page.waitFor("typeof window.supabase?.createClient === 'function' && typeof window.Swal === 'function' && !!window.sb"));
  check("login page: no CSP / SRI / JS error", clean(page), problems(page));
  const blocked = await page.eval(`new Promise(r => { document.addEventListener("securitypolicyviolation", e => r(e.effectiveDirective), { once: true }); fetch("https://example.invalid/x").catch(() => {}); setTimeout(() => r(null), 4000); })`);
  check("CSP blocks requests to other origins", blocked === "connect-src", blocked);
  await sleep(500);
  check("CSP violations reach the per-page error checks", page.errors.some(e => e.startsWith("CSP:")), page.errors.length);
  await page.close();

  begin("SUPERADMIN pages");
  page = await openPage();
  await login(page, sa.email, sa.password);
  check("login lands on dashboard", (await page.path()).endsWith("dashboard.html"), await page.path());
  await page.goto(`${SITE}/subscribers.html`);
  check("members list renders", await page.waitFor("document.querySelectorAll('#rows tr td').length > 3 && !document.querySelector('#rows').textContent.includes('Impossible')"));
  const saHeaders = await page.eval("[...document.querySelectorAll('thead th')].map(t => t.textContent.trim())");
  check("CIN, photo and gender columns shown", ["CIN", "Photo", "Sexe"].every(h => saHeaders.includes(h)), saHeaders.join(","));
  const saControls = await page.eval(`(() => {
    const visible = el => !!el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
    return { edit: document.querySelectorAll('#rows button[title="Modifier"]').length, add: visible(document.querySelector("#addBtn")), import: visible(document.querySelector("#importCsvBtn")) };
  })()`);
  check("add / import / edit controls shown", saControls && saControls.edit > 0 && saControls.add && saControls.import, JSON.stringify(saControls));
  // Filter on this run's member: earlier runs' members accumulate in the stack and,
  // sorted by surname with 10 per page, can push it off the first page.
  await page.eval(`(() => { const s = document.querySelector('#search'); s.value = ${JSON.stringify(`B-${run}-1`)}; s.dispatchEvent(new Event('input')); return true; })()`);
  check("imported members shown as 'Non activé'", await page.waitFor(`[...document.querySelectorAll('#rows tr')].some(r => r.textContent.includes(${JSON.stringify(`B-${run}-1`)}) && r.textContent.includes('Non activé'))`, 5000));
  await page.eval(`(() => { const s = document.querySelector('#search'); s.value = ''; s.dispatchEvent(new Event('input')); return true; })()`);
  check("no JS error / failed API call", clean(page), problems(page));
  await page.goto(`${SITE}/admin-users.html`);
  await page.waitFor("document.querySelectorAll('#adminRows tr td').length > 2");
  check("staff page shows account emails", await page.eval("document.querySelector('#adminRows').textContent.includes('@staging.invalid')"));
  check("staff page: no JS error / failed API call", clean(page), problems(page));
  await page.goto(`${SITE}/profile.html`);
  check("own profile shows own email (RPC)", await page.waitFor(`document.querySelector('#pEmail')?.value === ${JSON.stringify(sa.email)}`));
  check("profile: no JS error / failed API call", clean(page), problems(page));
  await page.goto(`${SITE}/admin-matchs.html`);
  await page.waitFor("typeof window.showStats === 'function' && document.readyState === 'complete'");
  await sleep(1500);
  await page.eval("window.showStats('10000000-0000-4000-8000-0000000000d1')");
  check("seat statistics include gender counts for SUPERADMIN", await page.waitFor("document.querySelector('#statsContent')?.textContent.includes('Hommes')"));
  check("matches page: no JS error / failed API call", clean(page), problems(page));

  // Stored-XSS regression (2026-10-17 audit): a faculty name with quotes used to
  // break out of the inline onclick of its "Modifier" button.
  const evilName = `ZZ ${run} x');window.__ueXss=1;//"<img src=x onerror=window.__ueXss=2>`;
  const evil = await service("POST", "/rest/v1/faculties", { name: evilName });
  await page.goto(`${SITE}/faculties.html`);
  await page.waitFor("document.querySelectorAll('#refGrid button[title=Modifier]').length > 0");
  const clicked = await page.eval(`(() => { const card = [...document.querySelectorAll('#refGrid .ref-card')].find(c => c.textContent.includes(${JSON.stringify(`ZZ ${run}`)})); const button = card?.querySelector('button[title=Modifier]'); button?.click(); return Boolean(button); })()`);
  await sleep(500);
  check("hostile faculty name: edit button found and clicked", clicked === true);
  check("hostile faculty name: no script runs on render or on edit", (await page.eval("window.__ueXss === undefined")) === true);
  check("hostile faculty name: edit form shows the exact name", (await page.eval("document.querySelector('#refName')?.value")) === evilName);
  check("faculties page: no inline handlers in the list", (await page.eval("document.querySelectorAll('#refGrid [onclick]').length")) === 0);
  if (evil.json?.[0]?.id) await service("DELETE", `/rest/v1/faculties?id=eq.${evil.json[0].id}`);
  await page.close();

  begin("ADMIN pages (read-only, minimized)");
  page = await openPage();
  await login(page, admin.email, admin.password);
  check("login lands on dashboard", (await page.path()).endsWith("dashboard.html"), await page.path());
  check("dashboard: no JS error / failed API call", clean(page), problems(page));
  await page.goto(`${SITE}/subscribers.html`);
  check("members list renders", await page.waitFor("document.querySelectorAll('#rows tr td').length > 3 && !document.querySelector('#rows').textContent.includes('Impossible')"));
  const adHeaders = await page.eval("[...document.querySelectorAll('thead th')].map(t => t.textContent.trim())");
  check("no CIN / photo / gender column", !["CIN", "Photo", "Sexe"].some(h => adHeaders.includes(h)), adHeaders.join(","));
  check("no gender filter", await page.eval("!document.querySelector('#genderFilter')"));
  const adminControls = await page.eval(`(() => {
    const visible = el => !!el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
    return { edit: document.querySelectorAll('#rows button[title="Modifier"]').length, add: visible(document.querySelector("#addBtn")), import: visible(document.querySelector("#importCsvBtn")) };
  })()`);
  check("no add / import / edit controls", adminControls && adminControls.edit === 0 && !adminControls.add && !adminControls.import, JSON.stringify(adminControls));
  const adminText = await page.eval("document.body.innerText");
  check("no CIN, phone or email in the page", !adminText.includes(`B${run}1`) && !adminText.includes("+216 00 000 01") && !adminText.includes("example.invalid"));
  check("members page: no JS error / failed API call", clean(page), problems(page));
  await page.eval(`window.showMemberCard(${JSON.stringify(subs[L(1)])})`);
  await sleep(500);
  const card = await page.eval("document.querySelector('#memberCardContent')?.innerText || ''");
  check("member card without CIN / contact / gender", card.length > 0 && !/CIN|Téléphone|Email|Sexe|Adresse/.test(card));
  await page.goto(`${SITE}/admin-users.html`);
  await page.waitFor("document.querySelectorAll('#adminRows tr td').length > 2");
  check("staff emails masked", await page.eval("document.querySelector('#adminRows').textContent.includes('Masqué') && !document.querySelector('#adminRows').textContent.includes('@staging.invalid')"));
  check("staff page: no JS error / failed API call", clean(page), problems(page));
  await page.goto(`${SITE}/admin-matchs.html`);
  await page.waitFor("typeof window.showStats === 'function' && document.readyState === 'complete'");
  await sleep(1500);
  await page.eval("window.showStats('10000000-0000-4000-8000-0000000000d1')");
  await page.waitFor("document.querySelector('#statsContent')?.textContent.includes('Total participants')");
  check("seat statistics without gender counts", await page.eval("!document.querySelector('#statsContent').textContent.includes('Hommes')"));
  check("matches page: no JS error / failed API call", clean(page), problems(page));
  await page.goto(`${SITE}/payments.html`);
  await page.waitFor("document.readyState === 'complete'");
  await sleep(2000);
  check("payments page: no JS error / failed API call", clean(page), problems(page));
  await page.close();

  begin("TREASURER pages");
  page = await openPage();
  await login(page, treasurer.email, treasurer.password);
  check("login lands on payments", (await page.path()).endsWith("payments.html"), await page.path());
  await sleep(2000);
  check("payments page: no JS error / failed API call", clean(page), problems(page));
  await page.goto(`${SITE}/subscribers.html`);
  check("members list renders (payment view)", await page.waitFor("document.querySelectorAll('#rows tr td').length > 3"));
  const trText = await page.eval("document.body.innerText");
  check("no CIN, phone or email in the page", !trText.includes(`B${run}1`) && !trText.includes("+216 00 000 01") && !trText.includes("example.invalid"));
  check("members page: no JS error / failed API call", clean(page), problems(page));
  await page.close();

  begin("Member activation link in the browser");
  const act = await edgeFn(sa.token, "admin-activate-member", { subscriber_id: subs[L(1)], method: "link" });
  const link = act.json?.activation_link;
  check("activation link issued", act.status === 200 && Boolean(link));
  page = await openPage();
  await page.goto(link);
  check("link lands on the password page, signed in", await page.waitFor("location.pathname.endsWith('change-password.html') && typeof document.querySelector('#changeForm')?.onsubmit === 'function'"));
  await page.eval(`(() => { document.querySelector('#p1').value = 'short'; document.querySelector('#p2').value = 'short'; document.querySelector('#changeForm').requestSubmit(); return true; })()`);
  check("short password rejected (12-character rule)", await page.waitFor("(document.querySelector('.swal2-title')?.textContent || '').includes('12')", 6000));
  await page.eval("document.querySelectorAll('.swal2-container').forEach(e => e.remove())");
  await page.eval(`(() => { document.querySelector('#p1').value = 'abcdefghijkl'; document.querySelector('#p2').value = 'abcdefghijkl'; document.querySelector('#changeForm').requestSubmit(); return true; })()`);
  check("password without required characters rejected", await page.waitFor("(document.querySelector('.swal2-title')?.textContent || '').includes('majuscule')", 6000));
  check("still on the password page", (await page.path()).endsWith("change-password.html"));
  await page.eval("document.querySelectorAll('.swal2-container').forEach(e => e.remove())");
  await page.eval(`(() => { document.querySelector('#p1').value = ${JSON.stringify(P(`bm1-${run}`))}; document.querySelector('#p2').value = ${JSON.stringify(P(`bm1-${run}`))}; document.querySelector('#changeForm').requestSubmit(); return true; })()`);
  check("password set; redirected to member home", await page.waitFor("location.pathname.endsWith('subscriber.html')", 20000), await page.path());
  check("member card shows own CIN", await page.waitFor(`document.body.innerText.includes(${JSON.stringify(`B${run}1`)})`));
  check("member page: no JS error / failed API call", clean(page), problems(page));
  await page.goto(`${SITE}/matchs.html`);
  check("seat page shows own gender", await page.waitFor("['Homme','Femme'].includes(document.querySelector('#genderBadge')?.textContent)"));
  check("seat page: no JS error / failed API call", clean(page), problems(page));
  await page.goto(`${SITE}/dashboard.html`);
  const leftDashboard = await page.waitFor("!location.pathname.endsWith('dashboard.html')");
  check("member sent away from the admin dashboard", leftDashboard, leftDashboard ? await page.path() : `${await page.path()} ${problems(page)}`);
  await page.close();

  page = await openPage();
  await page.goto(link);
  check("reused link: persistent explanation on the password page", await page.waitFor("!document.querySelector('#linkError').classList.contains('hidden') && document.querySelector('#linkError').textContent.includes('expiré ou a déjà été utilisé')", 8000));
  check("reused link: no session created", await page.eval("!Object.keys(localStorage).some(k => k.includes('ueclubiste-auth') && (localStorage.getItem(k) || '').includes('access_token'))"));
  check("reused link: no password form", await page.eval("document.querySelector('#changeForm').classList.contains('hidden')"));
  await page.close();

  begin("Temporary password (fallback) and first login");
  const tmp = await edgeFn(sa.token, "admin-activate-member", { subscriber_id: subs[L(2)], method: "temporary_password" });
  page = await openPage();
  await login(page, L(2), tmp.json?.temporary_password || "x");
  check("first login forced to the password page", (await page.path()).endsWith("change-password.html"), await page.path());
  await page.goto(`${SITE}/subscriber.html`);
  check("cannot open member pages before changing", await page.waitFor("location.pathname.endsWith('change-password.html')"));
  await page.close();

  begin("Deactivated account");
  await service("PATCH", `/rest/v1/profiles?id=eq.${admin.id}`, { is_active: false });
  page = await openPage();
  await login(page, admin.email, admin.password);
  check("deactivated ADMIN cannot enter the app", (await page.path()).endsWith("index.html"), await page.path());
  check("no session kept", await page.eval("!Object.keys(localStorage).some(k => k.includes('ueclubiste-auth') && localStorage.getItem(k) && localStorage.getItem(k) !== 'null')"));
  await page.close();
  await service("PATCH", `/rest/v1/profiles?id=eq.${admin.id}`, { is_active: true });

  begin("Mobile layout (390 px wide): no horizontal page overflow");
  const phone = async () => {
    const p = await openPage();
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, p.sessionId);
    return p;
  };
  const fits = async (label, file) => {
    await page.goto(`${SITE}/${file}`);
    await page.waitFor("document.readyState === 'complete'");
    await sleep(1500);
    const extra = await page.eval("document.documentElement.scrollWidth - window.innerWidth");
    const at = await page.path();
    check(`${label} ${file}`, extra <= 1 && at.endsWith(file), `${extra}px wider than the screen; at ${at}`);
  };
  page = await phone();
  await fits("anonymous", "index.html");
  await login(page, sa.email, sa.password);
  for (const file of ["dashboard.html", "subscribers.html", "payments.html", "admin-users.html", "admin-matchs.html", "faculties.html", "zones.html", "profile.html"]) await fits("SUPERADMIN", file);
  await page.close();
  page = await phone();
  await login(page, L(1), P(`bm1-${run}`));
  for (const file of ["subscriber.html", "matchs.html"]) await fits("MEMBER", file);
  await page.goto(`${SITE}/profile.html`);
  check("MEMBER sent from the staff profile page to the member area", await page.waitFor("location.pathname.endsWith('subscriber.html')"), await page.path());
  await page.close();
} catch (error) {
  check("runner", false, error instanceof Error ? error.message : String(error));
} finally {
  await cleanup();
}

const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length} checks, ${failed} failed.`);
process.exit(failed ? 1 : 0);
