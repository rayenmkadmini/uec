import { requireSuperAdmin, json, options, audit, rateLimit, errorResponse, failureCode, readJson, isUuid } from "./_shared/security.ts";
import { deleteMember } from "./_shared/member-lifecycle.mjs";

// SUPERADMIN-only. Deletes a member record AND its login account (if any).
// The record must be deleted explicitly: subscribers.user_id is ON DELETE SET
// NULL, so deleting only the Auth user would keep the member's personal data.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  let ctx;
  try {
    ctx = await requireSuperAdmin(req);
    await rateLimit(ctx.admin, ctx.caller.id, "DELETE_SUBSCRIBER", 100, 60);
    const body = await readJson(req);
    const subscriberId = String(body.subscriber_id || "");
    if (!isUuid(subscriberId)) return json(req, { error: "subscriber_id invalide.", code: "invalid_subscriber" }, 400);
    const result = await deleteMember({ db: ctx.admin, auth: ctx.admin.auth.admin }, { subscriberId });
    await audit(ctx.admin, ctx.caller.id, "DELETE_SUBSCRIBER", null, result.status === 200, {
      subscriber_id: subscriberId, code: result.body.code || "ok", account_deleted: Boolean(result.body.account_deleted),
    });
    return json(req, result.body, result.status);
  } catch (e) {
    if (ctx && !(e instanceof Response)) await audit(ctx.admin, ctx.caller.id, "DELETE_SUBSCRIBER", null, false, { code: failureCode(e) });
    return errorResponse(req, "admin-delete-user", e);
  }
});
