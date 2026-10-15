import { requireSuperAdmin, json, options, audit, rateLimit, validateStrongPassword, corsHeaders } from "./_shared/security.ts";
import { activationRedirect, resetAccess } from "./_shared/member-lifecycle.mjs";

// SUPERADMIN-only. Issues new access to an existing account through the Supabase
// Auth Admin API (never by SQL) and flags it for a mandatory, server-verified
// password change. Never reactivates a deactivated account.
//   { user_id, method: "link" }                single-use, expiring recovery link
//   { user_id, generate: true }                random temporary password, returned once
//   { user_id, new_password }                  SUPERADMIN-chosen password (strong policy)
// Secrets are returned with Cache-Control: no-store and never logged or audited.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  let ctx;
  try {
    ctx = await requireSuperAdmin(req);
    await rateLimit(ctx.admin, ctx.caller.id, "RESET_PASSWORD", 100, 60);
    const body = await req.json().catch(() => ({}));
    const userId = String(body?.user_id || "");
    const method = body?.method === "link" ? "link" : body?.generate === true ? "temporary_password" : "chosen_password";

    if (method === "chosen_password") {
      const problem = validateStrongPassword(body?.new_password);
      if (problem) return json(req, { error: problem }, 400);
    }

    const result = await resetAccess(
      { db: ctx.admin, auth: ctx.admin.auth.admin },
      { userId, method, newPassword: body?.new_password ?? null, redirectTo: activationRedirect(Deno.env.get("PUBLIC_SITE_URL")) },
    );
    await audit(ctx.admin, ctx.caller.id, "RESET_PASSWORD", userId || null, result.status === 200, { method, code: result.body.code || "ok" });
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { ...corsHeaders(req), "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof Response) return e;
    if (ctx) await audit(ctx.admin, ctx.caller.id, "RESET_PASSWORD", null, false, { code: "unexpected" });
    return json(req, { error: e instanceof Error ? e.message : "Erreur inattendue." }, 500);
  }
});
