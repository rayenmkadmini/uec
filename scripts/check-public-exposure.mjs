// Post-deployment check of the public site (incident D1). HEAD requests only: no response body is
// downloaded. Fails if a sensitive path answers 200 on any production domain, or if a core page
// does not answer 200. Usage: node scripts/check-public-exposure.mjs [domain ...]
const domains = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["login.ueclubistes.tn", "www.login.ueclubistes.tn", "uec-five.vercel.app"];

// Paths that must never be publicly readable (403/404 are both acceptable).
const SENSITIVE = ["CSV_MEMBRES_TEMPLATE.csv", "a.id%29", "x.id", "supabaseconfig.txt", ".env", ".git/config", ".git/HEAD"];
const PAGES = ["", "index.html", "dashboard.html", "subscribers.html", "payments.html", "matchs.html", "change-password.html", "js/config.js"];

async function head(domain, path) {
  const res = await fetch(`https://${domain}/${path}`, { method: "HEAD", redirect: "manual" });
  return res.status;
}

let failed = 0;
for (const domain of domains) {
  for (const path of SENSITIVE) {
    const status = await head(domain, path);
    const ok = status !== 200;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${domain}/${path} -> ${status} (must not be 200)`);
  }
  for (const path of PAGES) {
    const status = await head(domain, path);
    const ok = status === 200;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${domain}/${path} -> ${status} (expected 200)`);
  }
}
console.log(failed ? `${failed} check(s) FAILED` : "all public-exposure checks passed");
process.exit(failed ? 1 : 0);
