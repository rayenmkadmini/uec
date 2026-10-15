// Proves, against the linked project, that:
//   1. the migration changes no data (every table's full content hash is unchanged), and
//   2. the rollback script restores every policy, function, ACL, default privilege,
//      trigger and bucket setting to its exact pre-migration state.
// Everything runs in ONE transaction that always ends in a forced error, so
// nothing is ever committed.
//
//   node scripts/run-rollback-check.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const file = rel => readFileSync(join(root, rel), "utf8");

const report = `
do $report$
declare
  v_data_changed text;
  v_not_restored text;
  v_items int;
begin
  select string_agg(b.item, ', ' order by b.item) into v_data_changed
  from fp b join fp m on m.item = b.item and m.stage = 'migrated'
  where b.stage = 'before' and b.item like 'data %' and m.hash is distinct from b.hash;

  select string_agg(coalesce(b.item, r.item) || case when b.item is null then ' (extra)' when r.item is null then ' (missing)' else ' (differs)' end, ', ' order by coalesce(b.item, r.item))
    into v_not_restored
  from (select * from fp where stage = 'before') b
  full join (select * from fp where stage = 'rolled_back') r on r.item = b.item
  where b.hash is distinct from r.hash;

  select count(*) into v_items from fp where stage = 'before';

  raise exception 'ROLLBACK_CHECK items=% data_changed_by_migration=[%] not_restored_by_rollback=[%]',
    v_items, coalesce(v_data_changed, ''), coalesce(v_not_restored, '');
end
$report$;
`;

const sql = [
  "begin;",
  file("supabase/tests/rollback_fingerprint.sql"),
  "select pg_temp.snap('before');",
  file("supabase/migrations/20261015120000_role_permissions_repair.sql"),
  "select pg_temp.snap('migrated');",
  file("supabase/rollback/20261015120000_role_permissions_repair_rollback.sql"),
  "select pg_temp.snap('rolled_back');",
  report
].join("\n");

const path = join(mkdtempSync(join(tmpdir(), "ue-rollback-")), "run.sql");
writeFileSync(path, sql);

let output = "";
try {
  output = execFileSync("npx", ["supabase", "db", "query", "--linked", "-f", path], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32"
  });
} catch (error) {
  output = `${error.stdout || ""}${error.stderr || ""}`;
}

const match = output.match(/ROLLBACK_CHECK items=(\d+) data_changed_by_migration=\[(.*?)\] not_restored_by_rollback=\[(.*?)\]/s);
if (!match) {
  console.error("Could not find the check report. Raw output:\n" + output);
  process.exit(2);
}
const [, items, dataChanged, notRestored] = match;
console.log(`Fingerprinted objects: ${items}`);
console.log(`Data changed by migration: ${dataChanged || "none"}`);
console.log(`Not restored by rollback: ${notRestored || "none"}`);
console.log("(Transaction rolled back — no changes were committed.)");
process.exit(dataChanged || notRestored ? 1 : 0);
