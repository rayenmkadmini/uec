import { requireSuperAdmin, json, options, rateLimit, audit } from "./_shared/security.ts";
import { normalizeOptionalSubscriptionNumber } from "./_shared/import-utils.mjs";


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  let ctx;
  try {
    ctx = await requireSuperAdmin(req);
    await rateLimit(ctx.admin, ctx.caller.id, "CREATE_SUBSCRIBER", 50, 60);
    const b = await req.json();
    for (const key of ["nom", "prenom", "login_name", "cin", "gender"]) {
      if (typeof b[key] !== "string" || !b[key].trim()) return json(req, { error: `Missing ${key}` }, 400);
    }
    const subscriptionNumber = normalizeOptionalSubscriptionNumber(b.numero_abonnement);
    if (!subscriptionNumber.valid) {
      return json(req, { error: "Numero d'abonnement doit être un texte." }, 400);
    }
    const numeroAbonnement = subscriptionNumber.value;
    const gender = b.gender.trim().toUpperCase();
    if (!['MALE','FEMALE'].includes(gender)) return json(req, { error: "Le sexe est invalide." }, 400);
    const loginName = b.login_name.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,40}$/.test(loginName)) return json(req, { error: "Login invalide." }, 400);
    const email = `${loginName.toLowerCase()}@login.ueclubiste.local`;
    const { data: newUser, error: createError } = await ctx.admin.auth.admin.createUser({
      email, password: String(b.cin).trim(), email_confirm: true,
      user_metadata: { display_name: `${b.prenom.trim()} ${b.nom.trim()}`, role: "SUBSCRIBER", gender }
    });
    if (createError || !newUser?.user) return json(req, { error: createError?.message || "Impossible de créer le compte." }, 400);
    const { error: subError } = await ctx.admin.from("subscribers").insert({
      user_id: newUser.user.id, nom: b.nom.trim(), prenom: b.prenom.trim(), login_name: loginName,
      numero_abonnement: numeroAbonnement, cin: b.cin.trim(), gender,
      phone: b.phone ? String(b.phone).trim() : null, email: b.email ? String(b.email).trim() : null,
      adresse: b.adresse ? String(b.adresse).trim() : null, faculty_id: b.faculty_id || null,
      zone_id: b.zone_id || null, status: b.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
      photo_url: b.photo_url ? String(b.photo_url).trim() : null
    });
    if (subError) { await ctx.admin.auth.admin.deleteUser(newUser.user.id); return json(req, { error: subError.message }, 400); }
    const { error: profileError } = await ctx.admin.from("profiles").update({ display_name: `${b.prenom.trim()} ${b.nom.trim()}`, must_change_password: true, is_active: true }).eq("id", newUser.user.id);
    if (profileError) {
      await ctx.admin.from("subscribers").delete().eq("user_id", newUser.user.id);
      await ctx.admin.auth.admin.deleteUser(newUser.user.id);
      return json(req, { error: profileError.message }, 400);
    }
    const { error: roleError } = await ctx.admin.from("user_roles").upsert({
      user_id: newUser.user.id,
      role: "MEMBER"
    }, { onConflict: "user_id,role" });
    if (roleError) {
      await ctx.admin.from("subscribers").delete().eq("user_id", newUser.user.id);
      await ctx.admin.auth.admin.deleteUser(newUser.user.id);
      return json(req, { error: "Le rôle membre n’a pas pu être attribué." }, 400);
    }
    await audit(ctx.admin, ctx.caller.id, "CREATE_SUBSCRIBER", newUser.user.id, true);
    const { data: createdSubscriber } = await ctx.admin.from("subscribers").select("id").eq("user_id", newUser.user.id).maybeSingle();
    return json(req, { ok: true, user_id: newUser.user.id, subscriber_id: createdSubscriber?.id || null });
  } catch (e) {
    if (e instanceof Response) return e;
    if (ctx) await audit(ctx.admin, ctx.caller.id, "CREATE_SUBSCRIBER", null, false, { error: String(e) });
    return json(req, { error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
