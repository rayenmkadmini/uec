const ALLOWED = new Set(["SUPERADMIN", "ADMIN", "TREASURER", "MEMBER"]);

export function normalizeRoles(value: unknown): string[] {
  const input = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(input.map((r: unknown) => String(r || "").trim().toUpperCase()).filter((r) => ALLOWED.has(r)))];
}

// Adds the new roles first, then removes the ones no longer wanted, so a failed
// write never leaves the account without any role (user_roles key: user_id, role).
export async function replaceRoles(db: any, userId: string, roles: string[]) {
  const normalized = normalizeRoles(roles);
  if (!normalized.length) throw new Error("Au moins un rôle valide est requis.");

  const { error: addError } = await db.from("user_roles").upsert(
    normalized.map((role) => ({ user_id: userId, role })),
    { onConflict: "user_id,role", ignoreDuplicates: true },
  );
  if (addError) throw new Error(addError.message);

  const { error: removeError } = await db.from("user_roles").delete().eq("user_id", userId).not("role", "in", `(${normalized.join(",")})`);
  if (removeError) throw new Error(removeError.message);
  return normalized;
}
