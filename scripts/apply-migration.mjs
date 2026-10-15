// Guarded production apply for the pending migrations (scripts/lib/pending-migrations.mjs):
//   20261015120000_role_permissions_repair
//   20261015140000_member_identity_and_password_hardening
//
//   node scripts/apply-migration.mjs --dry-run                 # checks + prints the SQL, writes nothing
//   node scripts/apply-migration.mjs --confirm-production      # applies (requires explicit approval)
//
// Steps when confirmed:
//   1. Refuses unless the target is exactly qwlbbfyhjdeekmrxtzjf (login.uec): checks the
//      linked ref, js/config.js and the remote migration history.
//   2. Applies ALL pending migrations, in order, in ONE transaction with lock/statement timeouts. Inside the
//      same transaction it verifies invariants (row counts unchanged, new functions/table
//      present, old staff write policies gone, anon has no grants, photo bucket private);
//      any failure raises and the whole transaction rolls back.
//   3. Runs the full role matrix against the live schema (in a rolled-back transaction).
//   4. Only if step 3 passes, records each version with `migration repair --status applied`.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PENDING, migrationPath, rollbackPath } from "./lib/pending-migrations.mjs";

const PROJECT_REF = "qwlbbfyhjdeekmrxtzjf";
const FORBIDDEN_REF = "astsvxyqyyzqvuioqsnq";
const VERSIONS = PENDING.map(name => name.split("_")[0]);

const root = fileURLToPath(new URL("..", import.meta.url));
const dryRun = process.argv.includes("--dry-run");
const confirmed = process.argv.includes("--confirm-production");
const read = rel => readFileSync(join(root, rel), "utf8");

function supabase(args) {
  return execFileSync("npx", ["supabase", ...args], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32"
  });
}

function fail(message) {
  console.error(`ABORTED: ${message}`);
  process.exit(1);
}

if (!dryRun && !confirmed) fail("pass --dry-run, or --confirm-production after explicit approval.");

// 1) Target checks
const linkedRef = read("supabase/.temp/project-ref").trim();
if (linkedRef !== PROJECT_REF) fail(`linked project is ${linkedRef}, expected ${PROJECT_REF}.`);
if (!read("js/config.js").includes(`https://${PROJECT_REF}.supabase.co`)) fail("js/config.js does not point at the target project.");
if (read("js/config.js").includes(FORBIDDEN_REF)) fail(`js/config.js references ${FORBIDDEN_REF}.`);

const history = supabase(["migration", "list", "--project-ref", PROJECT_REF]);
if (!history.includes('"remote":"20261001194746"') || !history.includes('"remote":"20261001194845"')) {
  fail("remote migration history is not the expected one (20261001194746, 20261001194845).");
}
for (const version of VERSIONS) {
  if (history.includes(`"remote":"${version}"`)) fail(`${version} is already recorded as applied.`);
}
console.log(`Target OK: ${PROJECT_REF} (login.uec); remote history as expected; pending: ${VERSIONS.join(", ")}.`);

// 2) Build the self-verifying transaction
const sql = `
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create temp table _before_counts on commit drop as
select 'subscribers' t, count(*) n from public.subscribers union all
select 'profiles', count(*) from public.profiles union all
select 'user_roles', count(*) from public.user_roles union all
select 'events', count(*) from public.events union all
select 'event_payments', count(*) from public.event_payments union all
select 'matches', count(*) from public.matches union all
select 'match_participations', count(*) from public.match_participations union all
select 'auth_users', count(*) from auth.users;

${PENDING.map(name => `-- ==== ${name}\n${read(migrationPath(name))}`).join("\n")}

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

  if to_regclass('public.clubs') is null then raise exception 'VERIFY: clubs table missing'; end if;

  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in
      ('set_card_payment_status','set_event_payment_status','set_match_participation',
       'remove_match_participation','complete_password_change','list_payment_members',
       'get_member_private_fields')) <> 7 then
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
end
$verify$;

commit;
`;

const file = join(mkdtempSync(join(tmpdir(), "ue-apply-")), "apply.sql");
writeFileSync(file, sql);

if (dryRun) {
  console.log(`DRY RUN: nothing executed. Transaction written to ${file}`);
  console.log(`Statements: ${sql.split(";").length}, bytes: ${sql.length}`);
  process.exit(0);
}

console.log(`Applying ${PENDING.length} migration(s) in a single transaction...`);
try {
  const out = supabase(["db", "query", "--linked", "--project-ref", PROJECT_REF, "-f", file]);
  console.log(out.trim());
} catch (error) {
  console.error(`${error.stdout || ""}${error.stderr || ""}`);
  fail("migration transaction failed and was rolled back. Nothing was changed.");
}

// 3) Full role matrix against the live schema (rolled back)
console.log("Running role matrix against the applied schema...");
try {
  console.log(execFileSync(process.execPath, [join(root, "scripts", "run-rls-tests.mjs"), "--no-migration", "--linked"], {
    cwd: root, encoding: "utf8"
  }).split("\n").slice(-2).join("\n"));
} catch (error) {
  console.error(error.stdout || "");
  fail(`migrations are APPLIED but the role matrix FAILED. Do not mark them applied; roll back in reverse order:
${[...PENDING].reverse().map(name => `  npx supabase db query --linked --project-ref ${PROJECT_REF} -f ${rollbackPath(name)}`).join("\n")}`);
}

// 4) Record in migration history only after verification
for (const version of VERSIONS) {
  console.log(supabase(["migration", "repair", "--status", "applied", version, "--linked", "--project-ref", PROJECT_REF]).trim());
}
console.log(`Done: ${VERSIONS.join(", ")} applied, verified and recorded on ${PROJECT_REF}.`);
