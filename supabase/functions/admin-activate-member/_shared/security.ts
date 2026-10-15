import { createClient } from "npm:@supabase/supabase-js@2";

export const allowedOrigins = new Set([
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://login.ueclubistes.tn",
  "https://ueclubistes.tn",
  "https://www.ueclubistes.tn",
]);

export function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowOrigin = allowedOrigins.has(origin) ? origin : "";
  return {
    ...(allowOrigin ? { "Access-Control-Allow-Origin": allowOrigin, "Vary": "Origin" } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json",
  };
}

export function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(req) });
}

export function options(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

async function readUserRoles(admin: ReturnType<typeof createClient>, userId: string) {
  const preferred = await admin.from("user_roles").select("role").eq("user_id", userId);
  if (!preferred.error) return { data: (preferred.data || []).map((row: any) => ({ role_name: row.role ?? row.role_name })), error: null };
  const canonical = await admin.from("user_roles").select("role_name").eq("user_id", userId);
  if (!canonical.error) return { data: (canonical.data || []).map((row: any) => ({ role_name: row.role_name ?? row.role })), error: null };
  return { data: null, error: preferred.error || canonical.error };
}

export function getSecretKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const entries = Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string");
    const secretEntry = entries.find(([name, value]) => /service[_-]?role|secret/i.test(name) || value.startsWith("sb_secret_"));
    return secretEntry?.[1] || null;
  } catch {
    return null;
  }
}

export function createAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = getSecretKey();
  if (!url || !key) throw new Error("Server Supabase secret key is not configured.");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function isMissingAuditContract(error: any) {
  return ["PGRST205", "42P01", "42703"].includes(String(error?.code || ""));
}

async function countRecentAuditRows(admin: ReturnType<typeof createClient>, callerId: string, action: string, since: string) {
  const preferred = await admin.from("audit_logs").select("id", { count: "exact", head: true }).eq("user_id", callerId).eq("action", action).gte("created_at", since);
  if (!preferred.error || !isMissingAuditContract(preferred.error)) return preferred;
  return admin.from("security_audit_logs").select("id", { count: "exact", head: true }).eq("actor_id", callerId).eq("action", action).gte("created_at", since);
}

export async function requireSuperAdmin(req: Request) {
  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders(req) });

  const admin = createAdminClient();
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) throw new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders(req) });

  const [{ data: profile, error: profileError }, { data: rolesData, error: rolesError }] = await Promise.all([
    admin.from("profiles").select("id,is_active,must_change_password").eq("id", user.id).maybeSingle(),
    readUserRoles(admin, user.id),
  ]);

  if (profileError || rolesError) {
    throw new Response(JSON.stringify({ error: "Authorization roles are unavailable." }), { status: 503, headers: corsHeaders(req) });
  }

  const roles = new Set((rolesData || []).map((row: any) => String(row.role_name || "").toUpperCase()));
  // Same account rule as the database (private.account_ok): active, password re-secured.
  if (!profile || profile.is_active !== true || profile.must_change_password !== false || !roles.has("SUPERADMIN")) {
    throw new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders(req) });
  }

  return { admin, caller: user, profile, roles };
}

export function validateStrongPassword(password: unknown) {
  const p = String(password ?? "");
  if (p.length < 12) return "Le mot de passe doit contenir au moins 12 caractères.";
  if (!/[A-Z]/.test(p) || !/[a-z]/.test(p) || !/[0-9]/.test(p) || !/[^A-Za-z0-9]/.test(p)) {
    return "Le mot de passe doit contenir une majuscule, une minuscule, un chiffre et un caractère spécial.";
  }
  return null;
}

export async function rateLimit(admin: ReturnType<typeof createClient>, callerId: string, action: string, max: number, minutes: number) {
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const { count, error } = await countRecentAuditRows(admin, callerId, action, since);
  if (error) throw new Error("Rate-limit verification unavailable; request denied.");
  if ((count || 0) >= max) throw new Error("Trop de requêtes. Réessayez plus tard.");
}

export async function audit(
  admin: ReturnType<typeof createClient>,
  actorId: string,
  action: string,
  targetId: string | null,
  success: boolean,
  metadata: Record<string, unknown> = {},
) {
  const preferred = await admin.from("audit_logs").insert({
    user_id: actorId,
    action,
    table_name: "edge_function",
    record_id: targetId,
    new_data: { success, ...metadata },
  });
  if (!preferred.error || !isMissingAuditContract(preferred.error)) {
    if (preferred.error) console.error("Audit write failed:", preferred.error.message);
    return;
  }
  const canonical = await admin.from("security_audit_logs").insert({ actor_id: actorId, action, target_id: targetId, success, metadata });
  if (canonical.error) console.error("Audit write failed:", canonical.error.message);
}
