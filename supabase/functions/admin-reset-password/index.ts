import { requireSuperAdmin, json, options, audit, rateLimit, validateStrongPassword, corsHeaders } from "./_shared/security.ts";
import { generateTemporaryPassword } from "./_shared/import-utils.mjs";

// SUPERADMIN-only. Sets a new password through the Supabase Auth Admin API
// (never by SQL) and flags the account for a mandatory change at next login.
//   { user_id, generate: true }   server generates a random temporary password and
//                                 returns it ONCE (no-store); used to activate imported
//                                 accounts and for member resets.
//   { user_id, new_password }     SUPERADMIN-chosen password (strong-password policy).
// The password is never logged or written to audit rows.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  let ctx;
  try {
    ctx = await requireSuperAdmin(req);
    await rateLimit(ctx.admin, ctx.caller.id, "RESET_PASSWORD", 100, 60);
    const body = await req.json().catch(() => ({}));
    const userId = String(body?.user_id || "");
    const generate = body?.generate === true;
    if (!userId) return json(req, { error: "user_id required" }, 400);

    const password = generate ? generateTemporaryPassword() : String(body?.new_password || "");
    if (!generate) {
      const problem = validateStrongPassword(password);
      if (problem) return json(req, { error: problem }, 400);
    }

    const { data: target, error: targetError } = await ctx.admin.from("profiles").select("id,is_active").eq("id", userId).single();
    if (targetError || !target) return json(req, { error: "Utilisateur introuvable." }, 404);

    const { error } = await ctx.admin.auth.admin.updateUserById(userId, { password });
    if (error) return json(req, { error: error.message }, 400);

    // Setting the flag also snapshots the new password digest (profiles trigger),
    // so the member cannot clear it without really changing the password.
    const { error: profileError } = await ctx.admin.from("profiles").update({ must_change_password: true }).eq("id", userId);
    if (profileError) {
      await audit(ctx.admin, ctx.caller.id, "RESET_PASSWORD", userId, false, { generated: generate, error: "profile flag" });
      return json(req, { error: "Le mot de passe a été réinitialisé, mais le profil n’a pas pu être marqué pour un changement obligatoire." }, 500);
    }

    await audit(ctx.admin, ctx.caller.id, "RESET_PASSWORD", userId, true, { generated: generate });
    if (!generate) return json(req, { ok: true });
    return new Response(JSON.stringify({ ok: true, temporary_password: password }), {
      status: 200,
      headers: { ...corsHeaders(req), "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof Response) return e;
    if (ctx) await audit(ctx.admin, ctx.caller.id, "RESET_PASSWORD", null, false, { error: "unexpected" });
    return json(req, { error: e instanceof Error ? e.message : "Erreur inattendue." }, 500);
  }
});
