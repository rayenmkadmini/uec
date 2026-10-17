import { requireSuperAdmin, json, options, audit, rateLimit, validateStrongPassword, corsHeaders, errorResponse, failureCode, readJson, revokeSessions } from "./_shared/security.ts";
import { activationRedirect, resetAccess } from "./_shared/member-lifecycle.mjs";

// SUPERADMIN-only. Issues new access to an existing account through the Supabase
// Auth Admin API (never by SQL) and flags it for a mandatory, server-verified
// password change. Never reactivates a deactivated account. Never applies to
// another SUPERADMIN account. Every existing session of the account is ended,
// so whoever held it before the reset cannot set a password of their own.
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
    const body = await readJson(req);
    const userId = String(body.user_id || "");
    const method = body.method === "link" ? "link" : body.generate === true ? "temporary_password" : "chosen_password";

    if (method === "chosen_password") {
      const problem = validateStrongPassword(body.new_password);
      if (problem) return json(req, { error: problem }, 400);
    }

    const result = await resetAccess(
      { db: ctx.admin, auth: ctx.admin.auth.admin },
      { userId, callerId: ctx.caller.id, method, newPassword: body.new_password ?? null, redirectTo: activationRedirect(Deno.env.get("PUBLIC_SITE_URL")) },
    );
    // The caller resetting their own access keeps the session they are using.
    if (result.status === 200 && userId !== ctx.caller.id) result.body.sessions_revoked = await revokeSessions(ctx.admin, userId);
    await audit(ctx.admin, ctx.caller.id, "RESET_PASSWORD", userId || null, result.status === 200, {
      method, code: result.body.code || "ok", sessions_revoked: result.body.sessions_revoked ?? null,
    });
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { ...corsHeaders(req), "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (ctx && !(e instanceof Response)) await audit(ctx.admin, ctx.caller.id, "RESET_PASSWORD", null, false, { code: failureCode(e) });
    return errorResponse(req, "admin-reset-password", e);
  }
});
