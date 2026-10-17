// Post-deployment check of the Edge Functions. Safe by design: no credentials are sent, so no
// function body runs past its authentication and no data is read or changed. Checks:
//   - every admin-* function directory is registered in supabase/config.toml with verify_jwt = true;
//   - CORS preflight from each production site origin: 204, that origin echoed back, and the
//     request headers the browser client sends are allowed;
//   - preflight from an unknown origin: no Access-Control-Allow-Origin;
//   - POST without a JWT: 401 answered by the platform gateway (code UNAUTHORIZED_*), which proves
//     gateway JWT verification is on (the functions' own 401 has a different body);
//   - with --with-cli: `supabase functions list` reports every function ACTIVE with verify_jwt true.
// Usage: node scripts/check-edge-functions.mjs [--with-cli] [project-ref]
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const withCli = args.includes("--with-cli");
const ref = args.find(a => !a.startsWith("--")) || "qwlbbfyhjdeekmrxtzjf";
if (ref === "astsvxyqyyzqvuioqsnq") throw new Error("deleted project");
const root = fileURLToPath(new URL("..", import.meta.url));
const base = `https://${ref}.supabase.co/functions/v1`;
const SITE_ORIGINS = ["https://login.ueclubistes.tn", "https://www.login.ueclubistes.tn", "https://uec-five.vercel.app"];
const CLIENT_HEADERS = ["authorization", "apikey", "content-type", "x-client-info"];

let failed = 0;
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); };

// Expected set: the function directories, and their [functions.<name>] sections in config.toml.
const dirs = readdirSync(`${root}supabase/functions`).filter(n => n.startsWith("admin-") && statSync(`${root}supabase/functions/${n}`).isDirectory()).sort();
const sections = {};
let current = null;
for (const line of readFileSync(`${root}supabase/config.toml`, "utf8").split(/\r?\n/)) {
  const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
  if (header) { current = header[1].startsWith("functions.") ? header[1].slice("functions.".length) : null; if (current) sections[current] = {}; continue; }
  const setting = current && line.match(/^\s*verify_jwt\s*=\s*(true|false)\s*(#.*)?$/);
  if (setting) sections[current].verifyJwt = setting[1] === "true";
}
check(dirs.length > 0 && JSON.stringify(Object.keys(sections).sort()) === JSON.stringify(dirs),
  `config.toml registers exactly the ${dirs.length} function directories (${dirs.join(", ")})`);

const preflight = origin => ({ method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": CLIENT_HEADERS.join(",") } });
for (const name of dirs) {
  check(sections[name]?.verifyJwt === true, `${name}: verify_jwt = true in config.toml`);
  for (const origin of SITE_ORIGINS) {
    const r = await fetch(`${base}/${name}`, preflight(origin));
    const allowed = (r.headers.get("access-control-allow-headers") || "").toLowerCase().split(",").map(h => h.trim());
    check(r.status === 204 && r.headers.get("access-control-allow-origin") === origin && CLIENT_HEADERS.every(h => allowed.includes(h)),
      `${name}: preflight from ${origin} -> ${r.status}, allow-origin=${r.headers.get("access-control-allow-origin") ?? "-"}, client headers allowed=${CLIENT_HEADERS.every(h => allowed.includes(h))}`);
  }
  const unknown = await fetch(`${base}/${name}`, preflight("https://unknown-origin.example"));
  check(!unknown.headers.get("access-control-allow-origin"), `${name}: unknown origin not allowed (allow-origin=${unknown.headers.get("access-control-allow-origin") ?? "-"})`);
  const anonymous = await fetch(`${base}/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const body = await anonymous.json().catch(() => ({}));
  check(anonymous.status === 401 && /^UNAUTHORIZED_/.test(String(body.code || "")),
    `${name}: POST without JWT -> ${anonymous.status} ${body.code || body.error || ""} (expected 401 from the gateway)`);
}

if (withCli) {
  let listed = [];
  try {
    const raw = execFileSync("npx", ["--no-install", "supabase", "functions", "list", "--project-ref", ref, "--output-format", "json"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32", timeout: 120000 });
    const data = JSON.parse(raw);
    listed = Array.isArray(data) ? data : data.functions || [];
  } catch (error) {
    check(false, `supabase functions list failed: ${String(error.message).split("\n")[0]}`);
  }
  for (const name of dirs) {
    const f = listed.find(x => x.slug === name);
    check(f && f.status === "ACTIVE" && f.verify_jwt === true, `${name}: deployed ${f ? `v${f.version} ${f.status} verify_jwt=${f.verify_jwt}` : "(missing)"}`);
  }
}
console.log(failed ? `${failed} check(s) FAILED` : "all Edge Function checks passed");
process.exit(failed ? 1 : 0);
