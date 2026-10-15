import { requireSuperAdmin, json, options, rateLimit, audit, corsHeaders } from "./_shared/security.ts";
import { normalizeOptionalSubscriptionNumber } from "./_shared/import-utils.mjs";
import { activateMember, activationRedirect } from "./_shared/member-lifecycle.mjs";

// SUPERADMIN-only. Creates ONE member record, then activates it through the same
// path as imported members (admin-activate-member): random unknown password,
// access returned once as a recovery link (default) or, if requested, a
// temporary password. Never the CIN. If activation fails the record is kept,
// unactivated, and the response says so.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  let ctx;
  try {
    ctx = await requireSuperAdmin(req);
    await rateLimit(ctx.admin, ctx.caller.id, "CREATE_SUBSCRIBER", 50, 60);
    const b = await req.json().catch(() => ({}));
    for (const key of ["nom", "prenom", "login_name", "cin", "gender"]) {
      if (typeof b[key] !== "string" || !b[key].trim()) return json(req, { error: `Champ obligatoire manquant : ${key}` }, 400);
    }
    const subscriptionNumber = normalizeOptionalSubscriptionNumber(b.numero_abonnement);
    if (!subscriptionNumber.valid) return json(req, { error: "Numero d'abonnement doit être un texte." }, 400);
    const gender = b.gender.trim().toUpperCase();
    if (!["MALE", "FEMALE"].includes(gender)) return json(req, { error: "Le sexe est invalide." }, 400);
    const loginName = b.login_name.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,40}$/.test(loginName)) return json(req, { error: "Login invalide." }, 400);
    if (!/^[A-Za-z0-9-]+$/.test(b.cin.trim())) return json(req, { error: "CIN invalide (lettres, chiffres ou tiret)." }, 400);

    const { data: record, error: insertError } = await ctx.admin.from("subscribers").insert({
      user_id: null, nom: b.nom.trim(), prenom: b.prenom.trim(), login_name: loginName,
      numero_abonnement: subscriptionNumber.value, cin: b.cin.trim(), gender,
      phone: b.phone ? String(b.phone).trim() : null, email: b.email ? String(b.email).trim() : null,
      adresse: b.adresse ? String(b.adresse).trim() : null, faculty_id: b.faculty_id || null,
      zone_id: b.zone_id || null, status: b.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
      photo_url: b.photo_url ? String(b.photo_url).trim() : null,
    }).select("id").single();
    if (insertError || !record) {
      const duplicate = String(insertError?.code || "") === "23505";
      await audit(ctx.admin, ctx.caller.id, "CREATE_SUBSCRIBER", null, false, { code: duplicate ? "duplicate" : "insert_failed" });
      return json(req, { error: duplicate ? "Login ou N° d’abonnement déjà utilisé." : "Création du membre impossible." }, duplicate ? 409 : 400);
    }

    const method = b.method === "temporary_password" ? "temporary_password" : "link";
    const activation = b.status === "INACTIVE"
      ? { status: 409, body: { ok: false, code: "inactive_member" } }
      : await activateMember(
        { db: ctx.admin, auth: ctx.admin.auth.admin },
        { subscriberId: record.id, method, redirectTo: activationRedirect(Deno.env.get("PUBLIC_SITE_URL")) },
      );
    const activated = activation.status === 200;
    await audit(ctx.admin, ctx.caller.id, "CREATE_SUBSCRIBER", activated ? activation.body.user_id : null, true, {
      subscriber_id: record.id, activated, method, code: activation.body.code || "ok",
    });

    const body = activated
      ? { ok: true, subscriber_id: record.id, activated: true, ...activation.body }
      : { ok: true, subscriber_id: record.id, activated: false, activation_code: activation.body.code, activation_error: activation.body.error || null };
    return new Response(JSON.stringify(body), { status: 200, headers: { ...corsHeaders(req), "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof Response) return e;
    if (ctx) await audit(ctx.admin, ctx.caller.id, "CREATE_SUBSCRIBER", null, false, { code: "unexpected" });
    return json(req, { error: e instanceof Error ? e.message : "Erreur inattendue." }, 500);
  }
});
