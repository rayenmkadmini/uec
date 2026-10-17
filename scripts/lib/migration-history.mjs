// Parses and checks the output of `supabase migration list --output-format json`.
// Fails closed: any unexpected shape or history throws an Error with the reason.

// Returns { remote: string[], local: string[] } from the CLI's JSON text.
export function parseMigrationList(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("migration list did not return valid JSON.");
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.migrations)) {
    throw new Error("migration list JSON has no 'migrations' array.");
  }
  const remote = [];
  const local = [];
  for (const record of data.migrations) {
    if (!record || typeof record !== "object" || typeof record.local !== "string" || typeof record.remote !== "string") {
      throw new Error(`unexpected migration record: ${JSON.stringify(record)?.slice(0, 200)}`);
    }
    for (const version of [record.local, record.remote]) {
      if (version && !/^\d{14}$/.test(version)) throw new Error(`unexpected migration version: ${JSON.stringify(version)}`);
    }
    if (record.remote) remote.push(record.remote);
    if (record.local) local.push(record.local);
  }
  return { remote, local };
}

const sameSet = (a, b) => a.length === b.length && new Set(a).size === a.length && a.every(v => b.includes(v));

// Before applying: remote must be exactly `applied`, local exactly `applied` + `pending`.
export function checkBeforeApply({ remote, local }, applied, pending) {
  const alreadyApplied = pending.filter(v => remote.includes(v));
  if (alreadyApplied.length) throw new Error(`already recorded as applied: ${alreadyApplied.join(", ")}.`);
  if (!sameSet(remote, applied)) throw new Error(`remote history is [${remote.join(", ")}], expected exactly [${applied.join(", ")}].`);
  if (!sameSet(local, [...applied, ...pending])) {
    throw new Error(`local migrations are [${local.join(", ")}], expected [${[...applied, ...pending].join(", ")}].`);
  }
}

// After applying: remote must be exactly `applied` + `pending`.
export function checkAfterApply({ remote }, applied, pending) {
  if (!sameSet(remote, [...applied, ...pending])) {
    throw new Error(`remote history is [${remote.join(", ")}], expected [${[...applied, ...pending].join(", ")}].`);
  }
}
