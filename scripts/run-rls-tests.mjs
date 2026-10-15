// Runs supabase/tests/rls_role_matrix.sql against the linked project INSIDE a
// transaction that always ends in a forced error, so nothing is ever committed.
//
//   node scripts/run-rls-tests.mjs            # migration + tests (pre-apply check)
//   node scripts/run-rls-tests.mjs --no-migration   # tests only (after applying)
//
// Requires: `npx supabase login` and `npx supabase link --project-ref <ref>`.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const withMigration = !process.argv.includes("--no-migration");

// Only the migration(s) not yet in the remote history (20261001194746 and
// 20261001194845 are already applied on qwlbbfyhjdeekmrxtzjf).
const PENDING = ["20261015120000_role_permissions_repair.sql"];
const migrationsDir = join(root, "supabase", "migrations");
const migrations = withMigration
  ? PENDING.map(name => readFileSync(join(migrationsDir, name), "utf8"))
  : [];

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

const sql = ["begin;", ...migrations, readFileSync(join(root, "supabase", "tests", "rls_role_matrix.sql"), "utf8"), report].join("\n");
const file = join(mkdtempSync(join(tmpdir(), "ue-rls-")), "run.sql");
writeFileSync(file, sql);

let output = "";
try {
  output = execFileSync("npx", ["supabase", "db", "query", "--linked", "-f", file], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32"
  });
} catch (error) {
  output = `${error.stdout || ""}${error.stderr || ""}`;
}

const match = output.match(/RLS_TEST_REPORT total=(\d+) failed=(\d+) :: (.*?)(?:"|\\n|$)/s);
if (!match) {
  console.error("Could not find the test report. Raw output:\n" + output);
  process.exit(2);
}

const [, total, failed, lines] = match;
for (const line of lines.split(" || ")) console.log(line);
console.log(`\n${total} checks, ${failed} failed. (Transaction rolled back — no changes were committed.)`);
process.exit(Number(failed) === 0 ? 0 : 1);
