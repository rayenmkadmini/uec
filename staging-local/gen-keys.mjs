// Generates a FRESH JWT secret and the anon / service_role keys for the local
// staging stack. Never the Supabase CLI demo keys, never production values.
// Writes staging-local/.secrets/stack.env (git-ignored). Prints nothing secret.
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, ".secrets", "stack.env");
if (existsSync(out) && !process.argv.includes("--force")) {
  console.log("keys already exist (use --force to rotate)");
  process.exit(0);
}

const b64url = buf => Buffer.from(buf).toString("base64url");
const secret = randomBytes(48).toString("base64url");
const sign = payload => {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
};
const now = Math.floor(Date.now() / 1000);
const exp = now + 60 * 60 * 24 * 30; // 30 days: local test stack only

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, [
  `JWT_SECRET=${secret}`,
  `ANON_KEY=${sign({ iss: "ue-local-staging", role: "anon", iat: now, exp })}`,
  `SERVICE_ROLE_KEY=${sign({ iss: "ue-local-staging", role: "service_role", iat: now, exp })}`,
  `POSTGRES_PASSWORD=${randomBytes(24).toString("base64url")}`,
  ""
].join("\n"), { mode: 0o600 });
console.log("generated fresh local staging keys -> staging-local/.secrets/stack.env");
