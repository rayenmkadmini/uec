import { requireSuperAdmin, json, options, audit } from "./_shared/security.ts";
import { buildLoginBase, generateUniqueLogin, hasRequiredMemberFields, normalizeGender, normalizeLogin } from "./_shared/import-utils.mjs";

function norm(v: unknown) {
  return String(v ?? "").trim();
}

async function refId(db: any, table: "faculties" | "zones", value: string) {
  const name = norm(value);
  if (!name) return null;

  let { data } = await db.from(table).select("id,name").ilike("name", name).limit(1).maybeSingle();
  if (data) return data.id;

  const inserted = await db.from(table).insert({ name }).select("id").single();
  if (inserted.error) throw new Error(`${table}: ${inserted.error.message}`);
  return inserted.data.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  let ctx;
  try {
    ctx = await requireSuperAdmin(req);
    const body = await req.json();
    const rows = Array.isArray(body.rows) ? body.rows : [];

    if (!rows.length) return json(req, { error: "Aucune ligne à importer." }, 400);
    if (rows.length > 500) return json(req, { error: "Maximum 500 lignes par import." }, 400);

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let invalid = 0;
    let withoutSubscription = 0;
    let duplicates = 0;
    const errors: any[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const nom = norm(row.nom);
      const prenom = norm(row.prenom);
      const cin = norm(row.cin);
      const numero = norm(row.numero_abonnement);
      const gender = normalizeGender(row.gender);

      if (!hasRequiredMemberFields(row)) {
        invalid += 1;
        errors.push({ line: i + 2, error: "Nom, prénom, CIN et sexe sont obligatoires." });
        continue;
      }

      if (!numero) withoutSubscription += 1;

      try {
        let existing: any = null;
        let byCin: any = null;
        let byNumber: any = null;

        const { data: cinMatches, error: cinError } = await ctx.admin
            .from("subscribers")
            .select("id,user_id,login_name,cin,numero_abonnement")
            .eq("cin", cin)
            .limit(2);
        if (cinError) throw new Error(cinError.message);
        if ((cinMatches || []).length > 1) {
          duplicates += 1;
          throw new Error("Plusieurs membres correspondent à ce CIN. Vérification manuelle nécessaire.");
        }
        byCin = cinMatches?.[0] || null;

        if (numero) {
          const { data: numberMatches, error: numberError } = await ctx.admin
            .from("subscribers")
            .select("id,user_id,login_name,cin,numero_abonnement")
            .eq("numero_abonnement", numero)
            .limit(2);
          if (numberError) throw new Error(numberError.message);
          if ((numberMatches || []).length > 1) {
            duplicates += 1;
            throw new Error("Plusieurs membres correspondent à ce numéro d’abonnement. Vérification manuelle nécessaire.");
          }
          byNumber = numberMatches?.[0] || null;
        }

        if (byCin && byNumber && byCin.id !== byNumber.id) {
          duplicates += 1;
          throw new Error("Le CIN et le numéro d’abonnement correspondent à deux membres différents. Aucune donnée n’a été modifiée.");
        }

        existing = byCin || byNumber;
        if (existing && byNumber && existing.cin && existing.cin !== cin) {
          duplicates += 1;
          throw new Error("Le numéro d’abonnement appartient à un membre dont le CIN est différent. Vérification manuelle nécessaire.");
        }

        if (existing) {
          const update = {
            nom,
            prenom,
            numero_abonnement: numero || existing.numero_abonnement || null,
            cin,
            gender
          } as Record<string, unknown>;
          const phone = norm(row.phone);
          const email = norm(row.email);
          const adresse = norm(row.adresse);
          const faculty = norm(row.faculty);
          const zone = norm(row.zone);
          if (phone) update.phone = phone;
          if (email) update.email = email;
          if (adresse) update.adresse = adresse;
          if (faculty) update.faculty_id = await refId(ctx.admin, "faculties", faculty);
          if (zone) update.zone_id = await refId(ctx.admin, "zones", zone);

          const { error: updateErr } = await ctx.admin.from("subscribers").update(update).eq("id", existing.id);

          if (updateErr) throw new Error(updateErr.message);
          updated += 1;
          continue;
        }

        const loginFromCsv = normalizeLogin(row.login);
        const loginExists = async (login: string) => {
          const { data, error } = await ctx.admin.from("subscribers").select("id").eq("login_name", login).limit(1).maybeSingle();
          if (error) throw new Error(error.message);
          return !!data;
        };

        const loginBase = loginFromCsv.length >= 3 ? loginFromCsv : buildLoginBase(nom, prenom);
        const resolvedLogin = await generateUniqueLogin(loginBase, loginExists);

        const authEmail = `${resolvedLogin.toLowerCase()}@login.ueclubiste.local`;
        const createUser = await ctx.admin.auth.admin.createUser({
          email: authEmail,
          password: cin,
          email_confirm: true,
          user_metadata: { display_name: `${prenom} ${nom}`, role: "SUBSCRIBER", gender }
        });

        if (createUser.error || !createUser.data.user) throw new Error(createUser.error?.message || "Création du compte impossible");

        const insert = await ctx.admin.from("subscribers").insert({
          user_id: createUser.data.user.id,
          nom,
          prenom,
          login_name: resolvedLogin,
          numero_abonnement: numero || null,
          cin,
          gender,
          phone: norm(row.phone) || null,
          email: norm(row.email) || null,
          adresse: norm(row.adresse) || null,
          faculty_id: await refId(ctx.admin, "faculties", norm(row.faculty)),
          zone_id: await refId(ctx.admin, "zones", norm(row.zone)),
          status: "ACTIVE"
        }).select("id").single();

        if (insert.error) {
          await ctx.admin.auth.admin.deleteUser(createUser.data.user.id);
          throw new Error(insert.error.message);
        }

        const { error: profileError } = await ctx.admin.from("profiles").update({
          display_name: `${prenom} ${nom}`,
          must_change_password: true,
          is_active: true
        }).eq("id", createUser.data.user.id);
        if (profileError) {
          await ctx.admin.auth.admin.deleteUser(createUser.data.user.id);
          throw new Error(profileError.message);
        }

        const { error: roleError } = await ctx.admin.from("user_roles").upsert({
          user_id: createUser.data.user.id,
          role: "MEMBER"
        }, { onConflict: "user_id,role" });
        if (roleError) {
          await ctx.admin.auth.admin.deleteUser(createUser.data.user.id);
          throw new Error("Le rôle membre n’a pas pu être attribué.");
        }

        created += 1;
      } catch (e) {
        skipped += 1;
        errors.push({ line: i + 2, error: e instanceof Error ? e.message : String(e) });
      }
    }

    await audit(ctx.admin, ctx.caller.id, "IMPORT_SUBSCRIBERS", null, errors.length === 0, {
      rows: rows.length,
      created,
      updated,
      skipped,
      invalid,
      withoutSubscription,
      duplicates,
      errors: errors.length
    });

    return json(req, {
      ok: true,
      total: rows.length,
      created,
      updated,
      skipped,
      invalid,
      withoutSubscription,
      duplicates,
      errors
    });
  } catch (e) {
    if (e instanceof Response) return e;
    if (ctx) await audit(ctx.admin, ctx.caller.id, "IMPORT_SUBSCRIBERS", null, false, { error: String(e) });
    return json(req, { error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

