// Main service for the local staging edge-runtime. Mirrors what the Supabase
// platform does for functions with verify_jwt = true (supabase/config.toml):
// reject requests without a valid HS256 JWT signed by the stack's secret, then
// run /home/deno/functions/<name>/index.ts in a user worker.
const SECRET = Deno.env.get("JWT_SECRET") ?? "";
const FUNCTIONS = new Set(["admin-create-user", "admin-import-users", "admin-create-admin", "admin-update-admin",
  "admin-delete-admin", "admin-delete-user", "admin-reset-password", "admin-activate-member"]);

const b64urlDecode = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), c => c.charCodeAt(0));

async function validJwt(token: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3 || !SECRET) return false;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
    if (header.alg !== "HS256") return false;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("HMAC", key, b64urlDecode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return false;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
    return typeof payload.exp !== "number" || payload.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  const name = new URL(req.url).pathname.split("/")[1] ?? "";
  if (!FUNCTIONS.has(name)) return new Response(JSON.stringify({ error: "Function not found" }), { status: 404 });

  // Preflight is answered by the function itself (its own CORS allow-list).
  if (req.method !== "OPTIONS") {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!(await validJwt(token))) {
      return new Response(JSON.stringify({ msg: "Invalid JWT" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
  }

  const worker = await EdgeRuntime.userWorkers.create({
    servicePath: `/home/deno/functions/${name}`,
    memoryLimitMb: 150,
    workerTimeoutMs: 60_000,
    noModuleCache: false,
    importMapPath: null,
    envVars: [
      ["SUPABASE_URL", Deno.env.get("SUPABASE_URL") ?? ""],
      ["SUPABASE_ANON_KEY", Deno.env.get("SUPABASE_ANON_KEY") ?? ""],
      ["SUPABASE_SERVICE_ROLE_KEY", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""],
      ["PUBLIC_SITE_URL", Deno.env.get("PUBLIC_SITE_URL") ?? ""],
    ],
  });
  return await worker.fetch(req);
});
