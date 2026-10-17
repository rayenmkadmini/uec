import { requireSuperAdmin, json, options, audit, rateLimit, errorResponse, failureCode, readJson } from "./_shared/security.ts";
import { importMembers } from "./_shared/member-lifecycle.mjs";

// SUPERADMIN-only member import (logic in _shared/member-lifecycle.mjs):
//   - all-or-nothing validation (content, then database conflicts) before any write;
//   - unknown faculty / zone rejected, nothing auto-created;
//   - creates or updates member RECORDS only — no Auth accounts. New members stay
//     "not activated" until a SUPERADMIN activates each one (admin-activate-member).
// Responses and audit rows carry line numbers, statuses and codes, never values.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  let ctx;
  try {
    ctx = await requireSuperAdmin(req);
    await rateLimit(ctx.admin, ctx.caller.id, "IMPORT_SUBSCRIBERS", 20, 60);
    const body = await readJson(req);
    const rows = Array.isArray(body?.rows) ? body.rows : [];

    const result = await importMembers(ctx.admin, rows);
    const b = result.body;
    await audit(ctx.admin, ctx.caller.id, "IMPORT_SUBSCRIBERS", null, result.status === 200 && b.ok, {
      rows: rows.length,
      code: b.code || "ok",
      created: b.created ?? 0,
      updated: b.updated ?? 0,
      failed: b.failed ?? 0,
      pending_activation: b.pending_activation ?? 0,
      errors: b.error_count ?? (b.errors || []).length,
      failed_lines: (b.results || []).filter((r: any) => r.status === "failed").map((r: any) => r.line).slice(0, 100),
    });
    return json(req, b, result.status);
  } catch (e) {
    if (ctx && !(e instanceof Response)) await audit(ctx.admin, ctx.caller.id, "IMPORT_SUBSCRIBERS", null, false, { code: failureCode(e) });
    return errorResponse(req, "admin-import-users", e);
  }
});
