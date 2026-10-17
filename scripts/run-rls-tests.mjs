// Runs supabase/tests/rls_role_matrix.sql (local test container by default,
// --linked for the linked project — approval required) INSIDE a
// transaction that always ends in a forced error, so nothing is ever committed.
//
//   node scripts/run-rls-tests.mjs            # migration + tests (pre-apply check)
//   node scripts/run-rls-tests.mjs --no-migration   # tests only (after applying)
//
// --linked requires `npx supabase login` and `npx supabase link --project-ref <ref>`.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describeTarget, runSqlFile, runSqlText } from "./lib/sql-target.mjs";
import { RELEASED_PROBE_SQL, migrationPath, parseProbe, replayList } from "./lib/pending-migrations.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const withMigration = !process.argv.includes("--no-migration");

const work = mkdtempSync(join(tmpdir(), "ue-rls-"));
// Replays only what the target does not hold yet (the release, then the pending migrations).
const replay = withMigration
  ? replayList(parseProbe(runSqlText(RELEASED_PROBE_SQL, { root, tmp: join(work, "probe.sql") }), "UE_RELEASED"))
  : [];
const migrations = replay.map(name => readFileSync(join(root, migrationPath(name)), "utf8"));

const report = `
do $report$
declare
  v_total int;
  v_failed int;
  v_lines text;
begin
  select count(*), count(*) filter (where not passed) into v_total, v_failed from rls_results;
  select string_agg(case when passed then 'PASS ' else 'FAIL ' end || test || ' [' || translate(detail, '"' || chr(10) || chr(92), '''  ') || ']', ' || ' order by n)
    into v_lines from rls_results;
  raise exception 'RLS_TEST_REPORT total=% failed=% :: %', v_total, v_failed, v_lines;
end
$report$;
`;

const test = rel => readFileSync(join(root, "supabase", "tests", rel), "utf8");
const sql = ["begin;", test("pre_migration_fixtures.sql"), ...migrations, test("rls_role_matrix.sql"), report].join("\n");
const file = join(work, "run.sql");
writeFileSync(file, sql);

console.log(`Target: ${describeTarget()}`);
console.log(`Replayed in the transaction: ${replay.length ? replay.join(", ") : "none"}`);
const output = runSqlFile(file, { root });

const match = output.match(/RLS_TEST_REPORT total=(\d+) failed=(\d+) :: (.*?)(?:"|\\n|$)/s);
if (!match) {
  console.error("Could not find the test report. Raw output:\n" + output);
  process.exit(2);
}

const [, total, failed, lines] = match;
for (const line of lines.split(" || ")) console.log(line);
console.log(`\n${total} checks, ${failed} failed. (Transaction rolled back — no changes were committed.)`);
process.exit(Number(failed) === 0 ? 0 : 1);
