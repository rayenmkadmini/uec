// Guarded production apply of the PENDING migrations (scripts/lib/pending-migrations.mjs) to
// qwlbbfyhjdeekmrxtzjf (login.uec). The 2026-10-17 release (RELEASED) is already applied;
// pending now:
//   20261017120000_session_revocation_and_grant_tightening
//
//   node scripts/apply-migration.mjs --dry-run             # read-only production checks + full local rehearsal
//   node scripts/apply-migration.mjs --confirm-production  # same, then ONE production transaction (explicit approval)
//
// Order. Nothing is written to production before step 6, and nothing after its COMMIT:
//   1. Target: linked ref, js/config.js; the deleted project astsvxyqyyzqvuioqsnq is refused.
//   2. History: `migration list --output-format json`, parsed with JSON.parse. Remote must be exactly
//      the applied versions (BASE_APPLIED + RELEASED) and local exactly applied + pending; anything
//      else aborts.
//   3. Replica = production: the read-only catalog fingerprint (scripts/lib/schema-fingerprint.sql)
//      of production and of the disposable replica must match in every category.
//   4. Rehearsal on the replica: the exact production transaction with COMMIT replaced by ROLLBACK,
//      then the full role matrix (run-rls-tests.mjs) and the rollback-exactness check
//      (run-rollback-check.mjs). The replica fingerprint must be unchanged afterwards.
//   5. --dry-run stops here.
//   6. Production: one file = one Management API message = one session and one transaction
//      (verified 2026-10-17 with read-only probes; an error aborts the transaction and COMMIT is
//      never reached). BEFORE COMMIT it runs the migrations, the row-count and catalog assertions,
//      and records the migration history. The role matrix is NOT run on production: it writes
//      fixture rows. It runs in step 4 on a replica proven identical in step 3.
//   7. After COMMIT: read-only checks only. On failure the script reports and prints the rollback
//      files; it never runs a rollback by itself.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkAfterApply, checkBeforeApply, parseMigrationList } from "./lib/migration-history.mjs";
import { APPLIED_VERSIONS, PENDING, PENDING_PROBE_SQL, RELEASED_PROBE_SQL, migrationPath, parseProbe, rollbackPath, versionOf } from "./lib/pending-migrations.mjs";

const PROJECT_REF = "qwlbbfyhjdeekmrxtzjf";
const FORBIDDEN_REF = "astsvxyqyyzqvuioqsnq";
const APPLIED = APPLIED_VERSIONS;
if (!PENDING.length) {
  console.error("ABORTED: no pending migration (scripts/lib/pending-migrations.mjs). Nothing to apply.");
  process.exit(1);
}
const VERSIONS = PENDING.map(versionOf);
const REPLICA = process.env.UE_TEST_DB_CONTAINER || "ue-phaseb-testdb";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const confirmed = args.includes("--confirm-production");
const expectedHash = (args.find(a => a.startsWith("--expect-sha256=")) || "").slice("--expect-sha256=".length);
const read = rel => readFileSync(join(root, rel), "utf8");
// Serializes this transaction with the outcome probe (and with any second run).
const APPLY_LOCK = 726101512;

function fail(message, code = 1) {
  console.error(`ABORTED: ${message}`);
  process.exit(code);
}

if (args.some(a => a !== "--dry-run" && a !== "--confirm-production" && !a.startsWith("--expect-sha256=")) || dryRun === confirmed) {
  fail("pass exactly one of --dry-run or --confirm-production --expect-sha256=<hash printed by the dry run>.");
}
if (confirmed && !/^[0-9a-f]{64}$/.test(expectedHash)) {
  fail("--confirm-production requires --expect-sha256=<the 64-hex hash of the approved transaction from --dry-run>.");
}

// Work files go to the temp folder (8.3 path, no spaces): the CLI is started through the shell on Windows.
const work = mkdtempSync(join(tmpdir(), "ue-apply-"));
if (/\s/.test(work)) fail(`temporary folder path contains spaces (${work}); set TEMP to a path without spaces.`);

function supabase(cliArgs) {
  return execFileSync("npx", ["--no-install", "supabase", ...cliArgs], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32", timeout: 600000
  });
}

// SQL on production through the Management API. Returns the rows of the last statement; throws on
// any error, non-JSON output or missing rows.
function prodQuery(sql, label) {
  const file = join(work, `${label}.sql`);
  writeFileSync(file, sql);
  let raw;
  try {
    raw = supabase(["db", "query", "--linked", "-f", file, "--output-format", "json"]);
  } catch (error) {
    raw = error.stdout || "";
    if (!raw.trim()) throw new Error(`${label}: ${String(error.stderr || error.message).trim().split("\n")[0]}`);
  }
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(`${label}: the CLI did not return JSON`); }
  if (!data || !Array.isArray(data.rows)) throw new Error(`${label}: ${JSON.stringify(data?.error ?? data).slice(0, 400)}`);
  return data.rows;
}

function replicaPsql(sql, tuples = false) {
  return execFileSync("docker", ["exec", "-i", REPLICA, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q",
    "-v", "ON_ERROR_STOP=1", ...(tuples ? ["-A", "-t", "-F", " "] : [])],
    { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 600000 });
}

function runNode(script) {
  return execFileSync(process.execPath, [join(root, "scripts", script)], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, UE_TEST_DB_CONTAINER: REPLICA }
  });
}

// ---------------------------------------------------------------- 1) target
const linkedRef = read("supabase/.temp/project-ref").trim();
if (linkedRef !== PROJECT_REF) fail(`linked project is ${linkedRef}, expected ${PROJECT_REF}.`);
try {
  const linked = JSON.parse(read("supabase/.temp/linked-project.json"));
  if (linked.ref !== PROJECT_REF) fail(`supabase/.temp/linked-project.json names ${linked.ref}, expected ${PROJECT_REF}.`);
} catch (error) {
  if (error?.code !== "ENOENT") fail(`supabase/.temp/linked-project.json is unreadable: ${error.message}`);
}
const config = read("js/config.js");
if (!config.includes(`https://${PROJECT_REF}.supabase.co`)) fail("js/config.js does not point at the target project.");
if (config.includes(FORBIDDEN_REF) || linkedRef === FORBIDDEN_REF) fail(`${FORBIDDEN_REF} (deleted project) is referenced.`);

// ---------------------------------------------------------------- 2) migration history
// Throws (never exits) so that callers before and after COMMIT can report correctly.
function migrationHistory() {
  let raw;
  try {
    raw = supabase(["migration", "list", "--linked", "--output-format", "json"]);
  } catch (error) {
    throw new Error(`migration list failed: ${String(error.stderr || error.message).trim().split("\n")[0]}`);
  }
  return parseMigrationList(raw);
}

try {
  checkBeforeApply(migrationHistory(), APPLIED, VERSIONS);
} catch (error) {
  fail(error.message);
}
console.log(`Target OK: ${PROJECT_REF} (login.uec). Remote history: ${APPLIED.join(", ")}. Pending: ${VERSIONS.join(", ")}.`);

// ---------------------------------------------------------------- 3) replica = production
const FINGERPRINT = read("scripts/lib/schema-fingerprint.sql");
function fingerprint(rows) {
  const map = Object.fromEntries(rows.map(([category, n, digest]) => [category, `${n}:${digest}`]));
  if (Object.keys(map).length !== 13) fail(`fingerprint returned ${Object.keys(map).length} categories, expected 13.`);
  return map;
}
const differing = (a, b) => Object.keys(a).filter(category => a[category] !== b[category]);

let prodPrint;
let replicaPrint;
try {
  prodPrint = fingerprint(prodQuery(FINGERPRINT, "fingerprint").map(r => [r.category, r.n, r.digest]));
} catch (error) {
  fail(`production fingerprint (read-only) failed: ${error.message}`);
}
try {
  replicaPrint = fingerprint(replicaPsql(FINGERPRINT, true).trim().split("\n").map(line => line.trim().split(" ")));
} catch (error) {
  fail(`replica ${REPLICA} is not available: ${String(error.stderr || error.message).trim().split("\n")[0]}`);
}
const drift = differing(prodPrint, replicaPrint);
if (drift.length) {
  fail(`replica ${REPLICA} differs from production in: ${drift.join(", ")}. Rebuild it from the production schema and apply supabase/tests/replica_alignment.sql (docs/security/LOCAL_TEST_DATABASE.md).`);
}
console.log(`Replica OK: ${REPLICA} matches production in all 13 catalog categories.`);

// The in-transaction history INSERT targets production's table, which the replica cannot show.
try {
  const columns = prodQuery(`select column_name, data_type, is_nullable from information_schema.columns
where table_schema = 'supabase_migrations' and table_name = 'schema_migrations' order by ordinal_position;`, "history-table");
  const byName = Object.fromEntries(columns.map(c => [c.column_name, c]));
  const ok = byName.version?.data_type === "text" && byName.name?.data_type === "text" && byName.created_by?.data_type === "text"
    && byName.statements?.data_type === "ARRAY"
    && columns.every(c => c.column_name === "version" || c.is_nullable === "YES");
  if (!ok) fail(`production supabase_migrations.schema_migrations has an unexpected shape: ${JSON.stringify(columns).slice(0, 300)}`);
} catch (error) {
  fail(`could not check production's migration-history table (read-only): ${error.message}`);
}

// ---------------------------------------------------------------- production transaction
const migrations = PENDING.map(name => ({ name, version: name.split("_")[0], label: name.slice(name.indexOf("_") + 1), sql: read(migrationPath(name)) }));
const TAG = "$ue_stmt$";
for (const m of migrations) {
  if (m.sql.includes(TAG)) fail(`${m.name} contains ${TAG}; choose another dollar-quote tag.`);
  if (/^\s*(begin|commit|rollback)\s*;/im.test(m.sql)) fail(`${m.name} contains transaction control; migrations must not.`);
}
const versionList = VERSIONS.map(v => `'${v}'`).join(", ");

// Catalog and data-state assertions (read-only); used before COMMIT and again after it.
const ASSERTIONS = `
  if to_regclass('public.clubs') is null then raise exception 'VERIFY: clubs table missing'; end if;

  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in
      ('set_card_payment_status','set_event_payment_status','set_match_participation',
       'remove_match_participation','complete_password_change','list_payment_members',
       'get_member_private_fields','get_account_contacts','list_match_participants')) <> 9 then
    raise exception 'VERIFY: RPC functions missing';
  end if;

  if exists (select 1 from pg_policies where schemaname = 'public' and policyname like '%\\_staff\\_%' escape '\\'
             and cmd in ('INSERT','UPDATE')) then
    raise exception 'VERIFY: staff write policies still present';
  end if;

  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon') then
    raise exception 'VERIFY: anon still has table grants';
  end if;

  if (select public from storage.buckets where id = 'subscriber-photos') then
    raise exception 'VERIFY: subscriber-photos bucket still public';
  end if;

  if has_table_privilege('authenticated', 'public.subscribers', 'SELECT')
     or has_column_privilege('authenticated', 'public.subscribers', 'cin', 'SELECT')
     or has_column_privilege('authenticated', 'public.subscribers', 'adresse', 'SELECT') then
    raise exception 'VERIFY: protected member columns still selectable by authenticated';
  end if;

  if to_regclass('private.password_change_marks') is null
     or exists (select 1 from public.profiles p where p.must_change_password
                and not exists (select 1 from private.password_change_marks m where m.user_id = p.id)) then
    raise exception 'VERIFY: password-change marks missing';
  end if;

  if to_regprocedure('private.account_ok()') is null
     or has_column_privilege('authenticated', 'public.subscribers', 'phone', 'SELECT')
     or has_column_privilege('authenticated', 'public.profiles', 'email', 'SELECT')
     or has_column_privilege('authenticated', 'public.audit_logs', 'ip_address', 'SELECT')
     or has_column_privilege('authenticated', 'public.event_payments', 'notes', 'SELECT')
     or has_column_privilege('authenticated', 'public.subscribers', 'gender', 'SELECT')
     or has_column_privilege('authenticated', 'public.subscribers', 'photo_url', 'SELECT') then
    raise exception 'VERIFY: account-state helpers or contact-data restrictions missing';
  end if;

  if exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
             and has_function_privilege('anon', p.oid, 'EXECUTE')) then
    raise exception 'VERIFY: functions still executable by anon';
  end if;

  if exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'p')
             and (has_table_privilege('authenticated', c.oid, 'MAINTAIN')
                  or has_table_privilege('authenticated', c.oid, 'TRUNCATE'))) then
    raise exception 'VERIFY: authenticated still holds MAINTAIN or TRUNCATE';
  end if;

  if exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
             and not c.relrowsecurity) then
    raise exception 'VERIFY: a public table has RLS disabled';
  end if;

  -- 20261017120000
  if to_regprocedure('public.admin_revoke_user_sessions(uuid)') is null
     or not has_function_privilege('service_role', 'public.admin_revoke_user_sessions(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.admin_revoke_user_sessions(uuid)', 'EXECUTE') then
    raise exception 'VERIFY: session revocation function missing or executable by authenticated';
  end if;

  if has_column_privilege('authenticated', 'public.notifications', 'title', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.notifications', 'is_read', 'UPDATE')
     or has_sequence_privilege('authenticated', 'public.audit_logs_id_seq', 'USAGE') then
    raise exception 'VERIFY: notification or sequence privileges not tightened';
  end if;

  if (select 'image/svg+xml' = any(coalesce(allowed_mime_types, array[]::text[])) from storage.buckets where id = 'match-logos') then
    raise exception 'VERIFY: match-logos still accepts SVG';
  end if;`;

const sql = `begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- Held until COMMIT/ROLLBACK: the outcome probe waits on it, and a second run cannot overlap.
select pg_advisory_xact_lock(${APPLY_LOCK});

create temp table _before_counts on commit drop as
select 'subscribers' t, count(*) n from public.subscribers union all
select 'profiles', count(*) from public.profiles union all
select 'user_roles', count(*) from public.user_roles union all
select 'events', count(*) from public.events union all
select 'event_payments', count(*) from public.event_payments union all
select 'matches', count(*) from public.matches union all
select 'match_participations', count(*) from public.match_participations union all
select 'auth_users', count(*) from auth.users;

${migrations.map(m => `-- ==== ${m.name}\n${m.sql}`).join("\n")}

do $verify$
declare
  v_problem text;
begin
  select string_agg(b.t, ', ') into v_problem
  from _before_counts b
  where b.n <> case b.t
    when 'subscribers' then (select count(*) from public.subscribers)
    when 'profiles' then (select count(*) from public.profiles)
    when 'user_roles' then (select count(*) from public.user_roles)
    when 'events' then (select count(*) from public.events)
    when 'event_payments' then (select count(*) from public.event_payments)
    when 'matches' then (select count(*) from public.matches)
    when 'match_participations' then (select count(*) from public.match_participations)
    when 'auth_users' then (select count(*) from auth.users)
  end;
  if v_problem is not null then raise exception 'VERIFY: row counts changed: %', v_problem; end if;

  -- From 20261015160000, accounts that are inactive or must change their password lose all
  -- their roles. If SUPERADMIN accounts exist, at least one must stay usable after COMMIT.
  if exists (select 1 from public.user_roles where role = 'SUPERADMIN') and not exists (
       select 1 from public.user_roles r join public.profiles p on p.id = r.user_id
       where r.role = 'SUPERADMIN' and p.is_active and not p.must_change_password) then
    raise exception 'VERIFY: no usable SUPERADMIN account would remain';
  end if;
${ASSERTIONS}
end
$verify$;

-- Migration history, in the same transaction (same format as the existing rows).
insert into supabase_migrations.schema_migrations (version, name, statements, created_by) values
${migrations.map(m => `  ('${m.version}', '${m.label}', array[${TAG}${m.sql}${TAG}], 'scripts/apply-migration.mjs')`).join(",\n")};

commit;
select 'UE_APPLY_RESULT' as marker,
       (select count(*) from supabase_migrations.schema_migrations where version in (${versionList}))::int as recorded;
`;

if ((sql.match(/^begin;$/gm) || []).length !== 1 || (sql.match(/^commit;$/gm) || []).length !== 1) {
  fail("the generated transaction must contain exactly one BEGIN and one COMMIT.");
}
const sqlFile = join(work, "apply.sql");
writeFileSync(sqlFile, sql);
const sqlHash = createHash("sha256").update(sql).digest("hex");
console.log(`Production transaction: ${sqlFile} (sha256 ${sqlHash}, ${sql.length} bytes).`);

// ---------------------------------------------------------------- 4) rehearsal on the replica
// The replica must be where production is: release applied, pending migrations not.
try {
  if (!parseProbe(replicaPsql(RELEASED_PROBE_SQL, true), "UE_RELEASED")) fail(`replica ${REPLICA} does not hold the 2026-10-17 release; build a post-release replica (docs/security/LOCAL_TEST_DATABASE.md).`);
  if (parseProbe(replicaPsql(PENDING_PROBE_SQL, true), "UE_PENDING_PRESENT")) fail(`replica ${REPLICA} already holds pending objects.`);
} catch (error) {
  fail(`replica baseline check failed: ${error.message}`);
}
replicaPsql(`create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations
  (version text primary key, statements text[], name text, created_by text, idempotency_key text, rollback text[]);`);

const rehearsal = sql.replace(/^commit;$/m, "rollback;");
let rehearsalOut;
try {
  rehearsalOut = replicaPsql(rehearsal, true);
} catch (error) {
  fail(`REHEARSAL FAILED on ${REPLICA} (production untouched):\n${String(error.stderr || error.stdout || error.message).trim().slice(0, 2000)}`);
}
if (!/UE_APPLY_RESULT 0\s*$/.test(rehearsalOut.trim())) {
  fail(`rehearsal did not end with 'UE_APPLY_RESULT 0' (rollback not confirmed): ${rehearsalOut.trim().slice(-200)}`);
}
console.log("Rehearsal: the exact production transaction ran on the replica (COMMIT -> ROLLBACK); all assertions passed.");

// Each sub-check must report real work, not merely exit 0.
const subChecks = [
  ["run-rls-tests.mjs", "role matrix", out => {
    const m = out.match(/(\d+) checks, (\d+) failed\./);
    return m && Number(m[1]) > 0 && Number(m[2]) === 0 ? `${m[1]} checks, 0 failed` : null;
  }],
  ["run-rollback-check.mjs", "rollback exactness", out => {
    // On a post-release replica the checker replays exactly the pending migrations.
    const checked = Number((out.match(/Migrations checked: (\d+)/) || [])[1]);
    const exact = (out.match(/Not restored by rollback: none/g) || []).length;
    const unchanged = (out.match(/Data changed by migration: none/g) || []).length;
    return checked === PENDING.length && PENDING.every(name => out.includes(name)) && exact === checked && unchanged === checked
      ? `${exact}/${checked} rollbacks exact, no data changed` : null;
  }],
];
for (const [script, label, verdict] of subChecks) {
  let out = "";
  try {
    out = runNode(script);
  } catch (error) {
    fail(`REHEARSAL FAILED: ${label} (production untouched):\n${String(error.stdout || "").trim().split("\n").filter(l => /FAIL|differs|Not restored|failed/.test(l)).slice(0, 20).join("\n")}`);
  }
  const summary = verdict(out);
  if (!summary) fail(`REHEARSAL FAILED: ${label} did not report the expected results (production untouched):\n${out.trim().split("\n").slice(-6).join("\n")}`);
  console.log(`Rehearsal: ${label} OK — ${summary}`);
}
const replicaAfter = fingerprint(replicaPsql(FINGERPRINT, true).trim().split("\n").map(line => line.trim().split(" ")));
const changed = differing(replicaPrint, replicaAfter);
if (changed.length) fail(`the rehearsal left the replica changed in: ${changed.join(", ")}.`);
console.log("Rehearsal: replica unchanged afterwards.");

// ---------------------------------------------------------------- 5) dry run ends here
if (dryRun) {
  console.log(`DRY RUN complete. Nothing was written to production. Approve the transaction by its hash: ${sqlHash}`);
  process.exit(0);
}

// ---------------------------------------------------------------- 6) production: one transaction
if (sqlHash !== expectedHash) {
  fail(`the transaction to apply (sha256 ${sqlHash}) is not the approved one (${expectedHash}). Nothing was applied.`);
}
// Re-check immediately before applying: history and catalog must not have changed since step 2/3.
try {
  checkBeforeApply(migrationHistory(), APPLIED, VERSIONS);
  const again = differing(prodPrint, fingerprint(prodQuery(FINGERPRINT, "fingerprint-again").map(r => [r.category, r.n, r.digest])));
  if (again.length) fail(`production changed since the rehearsal (${again.join(", ")}). Nothing was applied.`);
} catch (error) {
  fail(`final pre-apply check failed: ${error.message}. Nothing was applied.`);
}
console.log(`Applying ${VERSIONS.length} migrations to ${PROJECT_REF} in ONE transaction (sha256 ${sqlHash})...`);
let rows = null;
let problem = null;
try {
  rows = prodQuery(sql, "apply");
} catch (error) {
  problem = error.message;
}
const result = rows?.find(r => r.marker === "UE_APPLY_RESULT");
if (!result || Number(result.recorded) !== VERSIONS.length) {
  console.error(`The apply request did not confirm a commit: ${problem ?? JSON.stringify(rows).slice(0, 300)}`);
  // Wait on the transaction's advisory lock first: the state is read only after the apply
  // transaction has ended (committed or rolled back), never while it may still be running.
  let state;
  try {
    [state] = prodQuery(`begin;
set local lock_timeout = '300s';
select pg_advisory_xact_lock(${APPLY_LOCK});
select (select count(*) from supabase_migrations.schema_migrations where version in (${versionList}))::int as recorded,
       to_regprocedure('public.admin_revoke_user_sessions(uuid)') is not null as pending_present;`, "outcome");
  } catch (error) {
    fail(`could not determine the outcome (${error.message}). Do NOT retry; check 'migration list' and the schema manually.`, 3);
  }
  if (Number(state.recorded) === 0 && state.pending_present === false) {
    fail("no commit observed after the apply transaction ended: production is unchanged (no version recorded, no new object). Nothing to undo.");
  }
  if (Number(state.recorded) !== VERSIONS.length || state.pending_present !== true) {
    fail(`INCONSISTENT state (recorded=${state.recorded}, pending_present=${state.pending_present}). Stop and investigate; do not retry.`, 3);
  }
  console.log("The response was lost, but production confirms the commit (all versions recorded).");
}
console.log(`COMMITTED: ${VERSIONS.join(", ")} applied and recorded on ${PROJECT_REF}.`);

// ---------------------------------------------------------------- 7) after COMMIT: read-only checks
const rollbackHint = `Rollback files (exact on the replica), to run only after a decision, in this order:\n${[...PENDING].reverse().map(name => `  ${rollbackPath(name)}${name.startsWith("20261015120000") ? "   <- do NOT run unchanged: it re-opens public photos and anon grants (DEPLOYMENT_PLAN.md §5)" : ""}`).join("\n")}\nAfter a database rollback, also remove the ${VERSIONS.length} history row(s) (supabase migration repair --status reverted <version>).`;
try {
  checkAfterApply(migrationHistory(), APPLIED, VERSIONS);
} catch (error) {
  fail(`COMMITTED, but ${error.message} Investigate before anything else.\n${rollbackHint}`, 2);
}
try {
  prodQuery(`do $post$
begin
${ASSERTIONS}
end
$post$;
select 'UE_POST_OK' as marker;`, "post-check");
} catch (error) {
  fail(`COMMITTED, but the read-only post-check failed: ${error.message}\nNothing was rolled back automatically.\n${rollbackHint}`, 2);
}
console.log("Post-commit read-only checks passed. Done.");
