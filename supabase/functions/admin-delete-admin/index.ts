import { requireSuperAdmin, json, options, audit, rateLimit, errorResponse, failureCode, readJson } from "./_shared/security.ts";

Deno.serve(async req => {
  if (req.method === "OPTIONS") return options(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  let ctx;
  try {
    ctx = await requireSuperAdmin(req);
    await rateLimit(ctx.admin, ctx.caller.id, "DELETE_ADMIN", 10, 60);
    const { user_id } = await readJson(req);
    const userId = String(user_id || "");
    if (!userId) return json(req, { error: "user_id required" }, 400);
    if (userId === ctx.caller.id) return json(req, { error: "Vous ne pouvez pas supprimer votre propre compte." }, 400);

    const { data: target, error: targetError } = await ctx.admin.from("profiles").select("id,is_active").eq("id", userId).single();
    if (targetError || !target) return json(req, { error: "Compte introuvable." }, 404);

    let { data: rolesRows, error: rolesError } = await ctx.admin.from("user_roles").select("role").eq("user_id", userId);
    if (rolesError) {
      const legacyRoles = await ctx.admin.from("user_roles").select("role_name").eq("user_id", userId);
      rolesRows = (legacyRoles.data || []).map((row: any) => ({ role: row.role_name ?? row.role }));
      rolesError = legacyRoles.error;
    }
    if (rolesError) return json(req, { error: "Les rôles du compte ne sont pas disponibles." }, 503);
    const roles = new Set((rolesRows || []).map((row: any) => String(row.role ?? row.role_name ?? "").toUpperCase()));
    const roleList = [...roles];
    const hasAdminRole = roleList.some((role) => ["ADMIN", "SUPERADMIN"].includes(role));
    if (!hasAdminRole) return json(req, { error: "Seuls les comptes ADMIN/SUPERADMIN peuvent être supprimés ici." }, 404);

    // Same rule as admin-update-admin (a SUPERADMIN cannot be deactivated or
    // demoted): one SUPERADMIN cannot remove another. The project owner does it
    // in the Supabase Dashboard.
    if (roles.has("SUPERADMIN")) {
      return json(req, { error: "Un compte SUPERADMIN ne peut pas être supprimé ici.", code: "protected_account" }, 403);
    }

    if (roles.has("MEMBER")) {
      return json(req, { error: "Ce compte est aussi membre. Gérez d’abord son dossier membre depuis la page des abonnés." }, 409);
    }

    if (target.is_active !== false) {
      const { data: activeProfiles, error: profilesError } = await ctx.admin.from("profiles").select("id").eq("is_active", true);
      if (profilesError) return json(req, { error: "Impossible de vérifier les comptes administratifs actifs." }, 503);
      const activeIds = (activeProfiles || []).map((row: any) => row.id);
      let { data: activeAdminRoles, error: activeRolesError } = activeIds.length
        ? await ctx.admin.from("user_roles").select("user_id").in("user_id", activeIds).in("role", ["ADMIN", "SUPERADMIN"])
        : { data: [], error: null };
      if (activeRolesError && activeIds.length) {
        const legacyRoles = await ctx.admin.from("user_roles").select("user_id").in("user_id", activeIds).in("role_name", ["ADMIN", "SUPERADMIN"]);
        activeAdminRoles = legacyRoles.data;
        activeRolesError = legacyRoles.error;
      }
      if (activeRolesError) return json(req, { error: "Impossible de vérifier les comptes administratifs actifs." }, 503);
      const activeAdmins = new Set((activeAdminRoles || []).map((row: any) => row.user_id));
      if (activeAdmins.size <= 1) return json(req, { error: "Impossible de supprimer le dernier compte administrateur actif." }, 400);
    }

    const { error } = await ctx.admin.auth.admin.deleteUser(userId);
    if (error) {
      console.error("admin-delete-admin: deleteUser failed:", error.message);
      await audit(ctx.admin, ctx.caller.id, "DELETE_ADMIN", userId, false, { code: "delete_failed" });
      return json(req, { error: "Le compte n’a pas pu être supprimé. Réessayez." }, 502);
    }
    await audit(ctx.admin, ctx.caller.id, "DELETE_ADMIN", userId, true, { roles: [...roleList] });
    return json(req, { ok: true });
  } catch (e) {
    // Details go to the function logs (project owners only), never to audit_logs (readable by ADMIN).
    if (ctx && !(e instanceof Response)) await audit(ctx.admin, ctx.caller.id, "DELETE_ADMIN", null, false, { code: failureCode(e) });
    return errorResponse(req, "admin-delete-admin", e);
  }
});
