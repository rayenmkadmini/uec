import { requireSuperAdmin, json, options, audit } from "./_shared/security.ts";
import { normalizeRoles, replaceRoles } from "./_shared/roles.ts";

Deno.serve(async req => {
  if (req.method === "OPTIONS") return options(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  let ctx;
  try {
    ctx = await requireSuperAdmin(req);
    const b = await req.json();
    const userId = String(b.user_id || "");
    if (!userId) return json(req, { error: "user_id required" }, 400);

    const { data: target, error: targetError } = await ctx.admin.from("profiles").select("id,is_active").eq("id", userId).single();
    if (targetError || !target) {
      return json(req, { error: "Administrateur introuvable." }, 404);
    }
    const { data: targetRoleRows, error: targetRolesError } = await ctx.admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (targetRolesError) return json(req, { error: "Les rôles du compte ne sont pas disponibles." }, 503);
    const currentRoles = new Set((targetRoleRows || []).map((row: any) => String(row.role || "").toUpperCase()));
    if (!currentRoles.size) return json(req, { error: "Aucun rôle canonique n’est attribué à ce compte." }, 404);

    const roles = normalizeRoles(b.roles ?? b.role ?? []);
    if (typeof b.display_name !== "undefined" && (typeof b.display_name !== "string" || !b.display_name.trim() || b.display_name.length > 100)) {
      return json(req, { error: "Nom invalide." }, 400);
    }
    if (typeof b.email !== "undefined" && !/^\S+@\S+\.\S+$/.test(String(b.email).trim())) {
      return json(req, { error: "Email invalide." }, 400);
    }
    if (typeof b.is_active !== "undefined" && typeof b.is_active !== "boolean") return json(req, { error: "Statut invalide." }, 400);
    if (typeof b.is_treasurer !== "undefined" && typeof b.is_treasurer !== "boolean") return json(req, { error: "Statut trésorier invalide." }, 400);
    if ((typeof b.roles !== "undefined" || typeof b.role !== "undefined") && !roles.length) {
      return json(req, { error: "Sélectionnez au moins un rôle valide." }, 400);
    }
    if (typeof b.is_treasurer !== "undefined" && typeof b.roles === "undefined" && typeof b.role === "undefined") {
      return json(req, { error: "Attribuez TREASURER via le sélecteur multi-rôle." }, 400);
    }

    if (currentRoles.has("SUPERADMIN")) {
      if (b.is_active === false) return json(req, { error: "Un compte SUPERADMIN ne peut pas être désactivé." }, 403);
      if (roles.length && !roles.includes("SUPERADMIN")) return json(req, { error: "Un compte SUPERADMIN doit conserver le rôle SUPERADMIN." }, 403);
    }
    if (userId === ctx.caller.id && b.is_active === false) return json(req, { error: "Vous ne pouvez pas désactiver votre propre compte." }, 400);

    if (b.is_active === false && target.is_active !== false && currentRoles.has("ADMIN")) {
      const { data: activeProfiles, error: activeProfilesError } = await ctx.admin.from("profiles").select("id").eq("is_active", true);
      if (activeProfilesError) return json(req, { error: "Impossible de vérifier les comptes administrateurs actifs." }, 503);
      const activeIds = (activeProfiles || []).map((row: any) => row.id);
      const { count, error: activeRolesError } = activeIds.length
        ? await ctx.admin.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "ADMIN").in("user_id", activeIds)
        : { count: 0, error: null };
      if (activeRolesError) return json(req, { error: "Impossible de vérifier les comptes administrateurs actifs." }, 503);
      if ((count || 0) <= 1) return json(req, { error: "Impossible de désactiver le dernier administrateur actif." }, 400);
    }

    const patch: Record<string, unknown> = {};
    if (typeof b.display_name !== "undefined") patch.display_name = String(b.display_name).trim();
    if (typeof b.email !== "undefined") patch.email = String(b.email).trim().toLowerCase();
    if (typeof b.is_active !== "undefined") patch.is_active = b.is_active;

    if (roles.length && userId === ctx.caller.id && !roles.includes("SUPERADMIN")) {
      return json(req, { error: "Vous ne pouvez pas retirer votre propre rôle SUPERADMIN." }, 403);
    }

    if (!Object.keys(patch).length && !roles.length) return json(req, { error: "Aucune modification fournie." }, 400);

    if (roles.length) {
      try {
        await replaceRoles(ctx.admin, userId, roles);
      } catch (e) {
        return json(req, { error: e instanceof Error ? e.message : String(e) }, 400);
      }
    }

    const { error } = await ctx.admin.from("profiles").update(patch).eq("id", userId);
    if (error) return json(req, { error: error.message }, 400);

    if (patch.email) {
      const { error: emailError } = await ctx.admin.auth.admin.updateUserById(userId, { email: patch.email as string, email_confirm: true });
      if (emailError) return json(req, { error: emailError.message }, 400);
    }

    await audit(ctx.admin, ctx.caller.id, "UPDATE_ADMIN", userId, true, { fields: Object.keys(patch), roles });
    return json(req, { ok: true, roles });
  } catch (e) {
    if (e instanceof Response) return e;
    if (ctx) await audit(ctx.admin, ctx.caller.id, "UPDATE_ADMIN", null, false, { error: String(e) });
    return json(req, { error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
