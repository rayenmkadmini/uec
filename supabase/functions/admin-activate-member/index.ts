import { requireSuperAdmin, json, options, audit, rateLimit, corsHeaders, errorResponse, failureCode, readJson, isUuid } from "./_shared/security.ts";
import { activateMember, activationRedirect } from "./_shared/member-lifecycle.mjs";

// SUPERADMIN-only. Creates the Auth account of ONE member record that has none
// yet and returns access once (no-store):
//   { subscriber_id, method: "link" }                single-use, expiring recovery link (default)
//   { subscriber_id, method: "temporary_password" }  fallback when links are unavailable
// The link / password is never logged or written to audit rows.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  let ctx;
  try {
    ctx = await requireSuperAdmin(req);
    await rateLimit(ctx.admin, ctx.caller.id, "ACTIVATE_MEMBER", 200, 60);
    const body = await readJson(req);
    const method = body.method === "temporary_password" ? "temporary_password" : body.method === undefined || body.method === "link" ? "link" : "invalid";
    const subscriberId = String(body.subscriber_id || "");
    if (!isUuid(subscriberId)) return json(req, { error: "subscriber_id invalide.", code: "invalid_subscriber" }, 400);
    const result = await activateMember(
      { db: ctx.admin, auth: ctx.admin.auth.admin },
      { subscriberId, method, redirectTo: activationRedirect(Deno.env.get("PUBLIC_SITE_URL")) },
    );
    await audit(ctx.admin, ctx.caller.id, "ACTIVATE_MEMBER", result.body.user_id || null, result.status === 200, {
      subscriber_id: subscriberId, method, code: result.body.code || "ok",
    });
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { ...corsHeaders(req), "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (ctx && !(e instanceof Response)) await audit(ctx.admin, ctx.caller.id, "ACTIVATE_MEMBER", null, false, { code: failureCode(e) });
    return errorResponse(req, "admin-activate-member", e);
  }
});
