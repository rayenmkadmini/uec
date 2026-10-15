import { requireSuperAdmin, json, options, audit } from "./_shared/security.ts";
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
    const body = await req.json().catch(() => ({}));
    const subscriberId = String(body?.subscriber_id || "");
    const result = await deleteMember({ db: ctx.admin, auth: ctx.admin.auth.admin }, { subscriberId });
    await audit(ctx.admin, ctx.caller.id, "DELETE_SUBSCRIBER", null, result.status === 200, {
      subscriber_id: subscriberId, code: result.body.code || "ok", account_deleted: Boolean(result.body.account_deleted),
    });
    return json(req, result.body, result.status);
  } catch (e) {
    if (e instanceof Response) return e;
    if (ctx) await audit(ctx.admin, ctx.caller.id, "DELETE_SUBSCRIBER", null, false, { code: "unexpected" });
    return json(req, { error: e instanceof Error ? e.message : "Erreur inattendue." }, 500);
  }
});
