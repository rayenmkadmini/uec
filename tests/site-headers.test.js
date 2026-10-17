// Browser-side hardening of the deployed site (vercel.json + pages). Sessions live in
// localStorage, so these headers and pinned scripts are the main XSS / supply-chain defences.
// The browser e2e (staging-local/tests/browser-e2e.mjs) serves the site with these exact headers.
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
const headers = Object.fromEntries(vercel.headers.filter(r => r.source === "/(.*)").flatMap(r => r.headers).map(h => [h.key.toLowerCase(), h.value]));
const csp = Object.fromEntries((headers["content-security-policy"] || "").split(";").map(d => d.trim().split(/\s+/)).filter(d => d[0]).map(([k, ...v]) => [k, v]));
const pages = fs.readdirSync(root).filter(f => f.endsWith(".html"));

test("vercel.json publishes only the allowlist build", () => {
  assert.equal(vercel.buildCommand, "node scripts/build-public.mjs");
  assert.equal(vercel.outputDirectory, "public");
});

test("every page gets anti-framing, nosniff and referrer headers", () => {
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["referrer-policy"], "strict-origin-when-cross-origin");
  assert.deepEqual(csp["frame-ancestors"], ["'none'"]);
  assert.deepEqual(csp["object-src"], ["'none'"]);
  assert.deepEqual(csp["base-uri"], ["'self'"]);
});

test("CSP: scripts only from the site and jsDelivr; API calls only to the project", () => {
  assert.deepEqual(csp["default-src"], ["'self'"]);
  assert.deepEqual(csp["script-src"].filter(s => s !== "'unsafe-inline'").sort(), ["'self'", "https://cdn.jsdelivr.net"]);
  assert.ok(!csp["script-src"].includes("'unsafe-eval'"));
  assert.deepEqual(csp["connect-src"].sort(), ["'self'", "https://qwlbbfyhjdeekmrxtzjf.supabase.co", "wss://qwlbbfyhjdeekmrxtzjf.supabase.co"]);
});

test("every external script is pinned to an exact version with SRI", () => {
  let count = 0;
  for (const page of pages) {
    for (const tag of fs.readFileSync(path.join(root, page), "utf8").match(/<script\b[^>]*\bsrc="https?:[^"]+"[^>]*>/g) || []) {
      count++;
      assert.match(tag, /src="https:\/\/cdn\.jsdelivr\.net\/npm\/(@[\w-]+\/)?[\w.-]+@\d+\.\d+\.\d+\/[^"]+"/, `${page}: unpinned ${tag}`);
      assert.match(tag, /integrity="sha384-[A-Za-z0-9+/]{64}"/, `${page}: no SRI ${tag}`);
      assert.match(tag, /crossorigin="anonymous"/, `${page}: SRI needs crossorigin ${tag}`);
    }
  }
  assert.ok(count >= pages.length, `expected the library scripts on every page, found ${count}`);
});

test("pinned-version check catches an unpinned script (positive control)", () => {
  assert.doesNotMatch('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>', /src="https:\/\/cdn\.jsdelivr\.net\/npm\/(@[\w-]+\/)?[\w.-]+@\d+\.\d+\.\d+\/[^"]+"/);
});
