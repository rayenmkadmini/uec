// Proves, for EACH pending migration applied on top of the ones before it
// (local test container by default; --linked = linked project, approval required):
//   1. the migration changes no data (every table's full content hash is unchanged), and
//   2. its rollback restores every policy, function, table/column ACL, default
//      privilege, private table, trigger and bucket setting to the exact
//      pre-migration state.
// Each check runs in ONE transaction that always ends in a forced error, so
// nothing is ever committed.
//
//   node scripts/run-rollback-check.mjs
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describeTarget, runSqlFile, runSqlText } from "./lib/sql-target.mjs";
import { RELEASED_PROBE_SQL, migrationPath, parseProbe, replayList, rollbackPath } from "./lib/pending-migrations.mjs";

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

console.log(`Target: ${describeTarget()}`);
let failures = 0;

// Checks every migration the target does not hold yet (the release, then the pending ones).
const replay = replayList(parseProbe(runSqlText(RELEASED_PROBE_SQL, { root, tmp: join(mkdtempSync(join(tmpdir(), "ue-probe-")), "probe.sql") }), "UE_RELEASED"));
console.log(`Migrations checked: ${replay.length}`);

replay.forEach((name, index) => {
  const sql = [
    "begin;",
    ...replay.slice(0, index).map(earlier => file(migrationPath(earlier))),
    file("supabase/tests/rollback_fingerprint.sql"),
    "select pg_temp.snap('before');",
    file(migrationPath(name)),
    "select pg_temp.snap('migrated');",
    file(rollbackPath(name)),
    "select pg_temp.snap('rolled_back');",
    report
  ].join("\n");

  const path = join(mkdtempSync(join(tmpdir(), "ue-rollback-")), "run.sql");
  writeFileSync(path, sql);
  const output = runSqlFile(path, { root });

  console.log(`\n${name}`);
  const match = output.match(/ROLLBACK_CHECK items=(\d+) data_changed_by_migration=\[(.*?)\] not_restored_by_rollback=\[(.*?)\]/s);
  if (!match) {
    console.error("  Could not find the check report. Raw output:\n" + output);
    failures += 1;
    return;
  }
  const [, items, dataChanged, notRestored] = match;
  console.log(`  Fingerprinted objects: ${items}`);
  console.log(`  Data changed by migration: ${dataChanged || "none"}`);
  console.log(`  Not restored by rollback: ${notRestored || "none"}`);
  if (dataChanged || notRestored) failures += 1;
});

console.log("\n(Every check ran in a transaction that was rolled back — no changes were committed.)");
process.exit(failures ? 1 : 0);
