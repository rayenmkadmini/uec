const ALLOWED = new Set(["SUPERADMIN", "ADMIN", "TREASURER", "MEMBER"]);

export function normalizeRoles(value: unknown): string[] {
  const input = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(input.map((r: unknown) => String(r || "").trim().toUpperCase()).filter((r) => ALLOWED.has(r)))];
}

export async function replaceRoles(db: any, userId: string, roles: string[]) {
  const normalized = normalizeRoles(roles);
  if (!normalized.length) throw new Error("Au moins un rôle valide est requis.");

  const { error: delError } = await db.from("user_roles").delete().eq("user_id", userId);
  if (delError) throw new Error(delError.message);

  const { error: insError } = await db.from("user_roles").insert(
    normalized.map((role) => ({ user_id: userId, role })),
  );
  if (insError) throw new Error(insError.message);
  return normalized;
}
