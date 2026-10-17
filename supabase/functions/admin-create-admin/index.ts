import { requireSuperAdmin, json, options, validateStrongPassword, rateLimit, audit } from "./_shared/security.ts";
import { normalizeRoles, replaceRoles } from "./_shared/roles.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  let ctx;
  try {
    ctx = await requireSuperAdmin(req);
    await rateLimit(ctx.admin, ctx.caller.id, "CREATE_ADMIN", 10, 60);
    const b = await req.json();
    const email = String(b.email || "").trim().toLowerCase();
    const displayName = String(b.display_name || "").trim();
    const password = String(b.password || "");
    const requestedRoles = normalizeRoles(b.roles ?? b.role ?? ["ADMIN"]);
    if (!requestedRoles.length) return json(req, { error: "Sélectionnez au moins un rôle." }, 400);
    if (!/^\S+@\S+\.\S+$/.test(email)) return json(req, { error: "Email invalide." }, 400);
    if (!displayName || displayName.length > 100) return json(req, { error: "Nom invalide." }, 400);
    const passwordError = validateStrongPassword(password);
    if (passwordError) return json(req, { error: passwordError }, 400);
    const { data: newUser, error } = await ctx.admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: displayName } });
    if (error || !newUser?.user) return json(req, { error: error?.message || "Création impossible." }, 400);
    const { data: updatedProfile, error: profileError } = await ctx.admin.from("profiles").update({ display_name: displayName, email, must_change_password: true, is_active: true }).eq("id", newUser.user.id).select("id").single();
    if (profileError || !updatedProfile) { await ctx.admin.auth.admin.deleteUser(newUser.user.id); return json(req, { error: profileError?.message || "Le profil utilisateur n’a pas pu être créé." }, 400); }
    let roleError: Error | null = null;
    try { await replaceRoles(ctx.admin, newUser.user.id, requestedRoles); } catch (e) { roleError = e instanceof Error ? e : new Error(String(e)); }
    if (roleError) {
      await ctx.admin.auth.admin.deleteUser(newUser.user.id);
      return json(req, { error: "Les rôles du nouveau compte n’ont pas pu être enregistrés." }, 400);
    }
    await audit(ctx.admin, ctx.caller.id, "CREATE_ADMIN", newUser.user.id, true, { roles: requestedRoles });
    return json(req, { ok: true, user_id: newUser.user.id, roles: requestedRoles });
  } catch (e) {
    if (e instanceof Response) return e;
    // Details go to the function logs (project owners only), never to audit_logs (readable by ADMIN).
    console.error("admin-create-admin failed:", e instanceof Error ? e.message : String(e));
    if (ctx) await audit(ctx.admin, ctx.caller.id, "CREATE_ADMIN", null, false, { code: "unexpected" });
    return json(req, { error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
