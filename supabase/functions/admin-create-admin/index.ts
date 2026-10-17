import { requireSuperAdmin, json, options, validateStrongPassword, rateLimit, audit, errorResponse, failureCode, readJson } from "./_shared/security.ts";
import { normalizeRoles, replaceRoles } from "./_shared/roles.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  let ctx;
  try {
    ctx = await requireSuperAdmin(req);
    await rateLimit(ctx.admin, ctx.caller.id, "CREATE_ADMIN", 10, 60);
    const b = await readJson(req);
    const email = String(b.email || "").trim().toLowerCase();
    const displayName = String(b.display_name || "").trim();
    const password = String(b.password || "");
    const requestedRoles = normalizeRoles(b.roles ?? b.role ?? ["ADMIN"]);
    if (!requestedRoles.length) return json(req, { error: "Sélectionnez au moins un rôle." }, 400);
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) return json(req, { error: "Email invalide." }, 400);
    if (!displayName || displayName.length > 100) return json(req, { error: "Nom invalide." }, 400);
    const passwordError = validateStrongPassword(password);
    if (passwordError) return json(req, { error: passwordError }, 400);
    const { data: newUser, error } = await ctx.admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: displayName } });
    if (error || !newUser?.user) {
      // Details go to the function logs (project owners only), never to the browser.
      if (error) console.error("admin-create-admin: createUser failed:", error.message);
      const exists = /already|exists|registered/i.test(String(error?.message || "")) || String((error as any)?.code || "") === "email_exists";
      await audit(ctx.admin, ctx.caller.id, "CREATE_ADMIN", null, false, { code: exists ? "email_exists" : "create_failed" });
      return json(req, { error: exists ? "Un compte existe déjà avec cet email." : "Création impossible. Vérifiez l’email et le mot de passe." }, exists ? 409 : 400);
    }
    const { data: updatedProfile, error: profileError } = await ctx.admin.from("profiles").update({ display_name: displayName, email, must_change_password: true, is_active: true }).eq("id", newUser.user.id).select("id").single();
    if (profileError || !updatedProfile) {
      if (profileError) console.error("admin-create-admin: profile update failed:", profileError.message);
      await ctx.admin.auth.admin.deleteUser(newUser.user.id);
      return json(req, { error: "Le profil utilisateur n’a pas pu être créé." }, 400);
    }
    let roleError: Error | null = null;
    try { await replaceRoles(ctx.admin, newUser.user.id, requestedRoles); } catch (e) { roleError = e instanceof Error ? e : new Error(String(e)); }
    if (roleError) {
      console.error("admin-create-admin: role assignment failed:", roleError.message);
      await ctx.admin.auth.admin.deleteUser(newUser.user.id);
      return json(req, { error: "Les rôles du nouveau compte n’ont pas pu être enregistrés." }, 400);
    }
    await audit(ctx.admin, ctx.caller.id, "CREATE_ADMIN", newUser.user.id, true, { roles: requestedRoles });
    return json(req, { ok: true, user_id: newUser.user.id, roles: requestedRoles });
  } catch (e) {
    // Details go to the function logs (project owners only), never to audit_logs (readable by ADMIN).
    if (ctx && !(e instanceof Response)) await audit(ctx.admin, ctx.caller.id, "CREATE_ADMIN", null, false, { code: failureCode(e) });
    return errorResponse(req, "admin-create-admin", e);
  }
});
