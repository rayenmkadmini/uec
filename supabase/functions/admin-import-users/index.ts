import { requireSuperAdmin, json, options, audit, rateLimit } from "./_shared/security.ts";
import { buildLoginBase, generateTemporaryPassword, generateUniqueLogin, validateImportBatch } from "./_shared/import-utils.mjs";

// SUPERADMIN-only member import. All-or-nothing validation:
//   1. every row is validated (required fields, sex, formats, in-file duplicates,
//      faculty / zone must already exist — nothing is auto-created);
//   2. every row is checked against the database (CIN / subscription number
//      conflicts, explicit logins already taken);
//   3. only if both passes are clean are rows written.
// New accounts get a random password nobody knows (never the CIN) and must be
// activated by a SUPERADMIN with admin-reset-password { generate: true }.
// Error messages carry line + column only, never cell values.

type Member = { id: string; user_id: string | null; login_name: string | null; cin: string | null; numero_abonnement: string | null };

async function selectIn(db: any, column: string, values: string[]): Promise<Member[]> {
  const out: Member[] = [];
  for (let i = 0; i < values.length; i += 100) {
    const chunk = values.slice(i, i + 100);
    const { data, error } = await db.from("subscribers").select("id,user_id,login_name,cin,numero_abonnement").in(column, chunk);
    if (error) throw new Error("Vérification des membres existants impossible.");
    out.push(...(data || []));
  }
  return out;
}

function groupBy(rows: Member[], key: keyof Member) {
  const map = new Map<string, Member[]>();
  for (const row of rows) {
    const value = row[key];
    if (!value) continue;
    map.set(value, [...(map.get(value) || []), row]);
  }
  return map;
}

const unique = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => Boolean(v)))];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  let ctx;
  try {
    ctx = await requireSuperAdmin(req);
    await rateLimit(ctx.admin, ctx.caller.id, "IMPORT_SUBSCRIBERS", 20, 60);
    const body = await req.json().catch(() => ({}));
    const rows = Array.isArray(body?.rows) ? body.rows : [];

    // 1) Content validation (no database writes)
    const [faculties, zones] = await Promise.all([
      ctx.admin.from("faculties").select("id,name"),
      ctx.admin.from("zones").select("id,name"),
    ]);
    if (faculties.error || zones.error) throw new Error("Références (facultés / zones) indisponibles.");

    const batch = validateImportBatch(rows, { faculties: faculties.data, zones: zones.data });
    if (!batch.ok) {
      await audit(ctx.admin, ctx.caller.id, "IMPORT_SUBSCRIBERS", null, false, { rows: rows.length, rejected: "validation", errors: batch.errors.length });
      return json(req, {
        error: "Import refusé : corrigez les erreurs puis réimportez le fichier. Aucune donnée n’a été modifiée.",
        errors: batch.errors.slice(0, 200),
        error_count: batch.errors.length,
      }, 400);
    }

    // 2) Database conflicts for the whole batch (still no writes)
    const prepared = batch.prepared;
    const byCin = groupBy(await selectIn(ctx.admin, "cin", unique(prepared.map((r: any) => r.cin))), "cin");
    const byNumber = groupBy(await selectIn(ctx.admin, "numero_abonnement", unique(prepared.map((r: any) => r.numero_abonnement))), "numero_abonnement");
    const byLogin = groupBy(await selectIn(ctx.admin, "login_name", unique(prepared.map((r: any) => r.login || null))), "login_name");

    const conflicts: { line: number; field: string; code: string; message: string }[] = [];
    const conflict = (line: number, field: string, code: string, message: string) =>
      conflicts.push({ line, field, code, message: `Ligne ${line} — ${message}` });

    const plan = prepared.map((row: any) => {
      const cinMatches = byCin.get(row.cin) || [];
      const numberMatches = row.numero_abonnement ? byNumber.get(row.numero_abonnement) || [] : [];
      if (cinMatches.length > 1) conflict(row.line, "cin", "duplicate_in_database", "plusieurs membres ont déjà ce CIN. Vérification manuelle nécessaire.");
      if (numberMatches.length > 1) conflict(row.line, "numero_abonnement", "duplicate_in_database", "plusieurs membres ont déjà ce N° d’abonnement. Vérification manuelle nécessaire.");
      const a = cinMatches[0] || null;
      const b = numberMatches[0] || null;
      if (a && b && a.id !== b.id) conflict(row.line, "numero_abonnement", "conflict", "le CIN et le N° d’abonnement correspondent à deux membres différents.");
      if (!a && b && b.cin && b.cin !== row.cin) conflict(row.line, "numero_abonnement", "conflict", "ce N° d’abonnement appartient à un membre dont le CIN est différent.");
      const existing = a || b;
      if (!existing && row.login && byLogin.has(row.login)) conflict(row.line, "login", "taken", "ce login est déjà utilisé par un autre membre.");
      return { row, existing };
    });

    if (conflicts.length) {
      await audit(ctx.admin, ctx.caller.id, "IMPORT_SUBSCRIBERS", null, false, { rows: rows.length, rejected: "conflicts", errors: conflicts.length });
      return json(req, {
        error: "Import refusé : conflits avec des membres existants. Aucune donnée n’a été modifiée.",
        errors: conflicts.slice(0, 200),
        error_count: conflicts.length,
      }, 409);
    }

    // 3) Writes. Auth accounts and database rows cannot share one transaction, so
    // a write can still fail individually; it is reported per line.
    const reservedLogins = new Set<string>(prepared.map((r: any) => r.login).filter(Boolean));
    let created = 0;
    let updated = 0;
    let failed = 0;
    const errors: { line: number; message: string }[] = [];

    for (const { row, existing } of plan) {
      try {
        if (existing) {
          const update: Record<string, unknown> = {
            nom: row.nom,
            prenom: row.prenom,
            cin: row.cin,
            gender: row.gender,
            numero_abonnement: row.numero_abonnement || existing.numero_abonnement || null,
          };
          for (const key of ["phone", "email", "adresse", "faculty_id", "zone_id"]) {
            if (row[key]) update[key] = row[key];
          }
          const { error } = await ctx.admin.from("subscribers").update(update).eq("id", existing.id);
          if (error) throw new Error("mise à jour impossible.");
          updated += 1;
          continue;
        }

        const login = row.login || await generateUniqueLogin(buildLoginBase(row.nom, row.prenom), async (candidate: string) => {
          if (reservedLogins.has(candidate)) return true;
          const { data, error } = await ctx.admin.from("subscribers").select("id").eq("login_name", candidate).limit(1).maybeSingle();
          if (error) throw new Error("vérification du login impossible.");
          return Boolean(data);
        });
        reservedLogins.add(login);

        const createUser = await ctx.admin.auth.admin.createUser({
          email: `${login.toLowerCase()}@login.ueclubiste.local`,
          password: generateTemporaryPassword(),
          email_confirm: true,
          user_metadata: { display_name: `${row.prenom} ${row.nom}`, gender: row.gender },
        });
        if (createUser.error || !createUser.data.user) throw new Error("création du compte impossible.");
        const userId = createUser.data.user.id;

        const insert = await ctx.admin.from("subscribers").insert({
          user_id: userId,
          nom: row.nom,
          prenom: row.prenom,
          login_name: login,
          numero_abonnement: row.numero_abonnement,
          cin: row.cin,
          gender: row.gender,
          phone: row.phone,
          email: row.email,
          adresse: row.adresse,
          faculty_id: row.faculty_id,
          zone_id: row.zone_id,
          status: "ACTIVE",
        }).select("id").single();
        if (insert.error) {
          await ctx.admin.auth.admin.deleteUser(userId);
          throw new Error("enregistrement du membre impossible.");
        }

        const { data: profile, error: profileError } = await ctx.admin.from("profiles").update({
          display_name: `${row.prenom} ${row.nom}`,
          must_change_password: true,
          is_active: true,
        }).eq("id", userId).select("id").single();
        const { error: roleError } = await ctx.admin.from("user_roles").upsert({ user_id: userId, role: "MEMBER" }, { onConflict: "user_id,role" });
        if (profileError || !profile || roleError) {
          await ctx.admin.from("subscribers").delete().eq("user_id", userId);
          await ctx.admin.auth.admin.deleteUser(userId);
          throw new Error("profil ou rôle membre non attribué.");
        }

        created += 1;
      } catch (e) {
        failed += 1;
        errors.push({ line: row.line, message: `Ligne ${row.line} — ${e instanceof Error ? e.message : "erreur inattendue."}` });
      }
    }

    const withoutSubscription = prepared.filter((r: any) => !r.numero_abonnement).length;
    await audit(ctx.admin, ctx.caller.id, "IMPORT_SUBSCRIBERS", null, failed === 0, {
      rows: rows.length, created, updated, failed, withoutSubscription,
    });

    return json(req, { ok: failed === 0, total: rows.length, created, updated, failed, withoutSubscription, activation_required: created, errors });
  } catch (e) {
    if (e instanceof Response) return e;
    if (ctx) await audit(ctx.admin, ctx.caller.id, "IMPORT_SUBSCRIBERS", null, false, { error: "unexpected" });
    return json(req, { error: e instanceof Error ? e.message : "Erreur inattendue." }, 500);
  }
});
