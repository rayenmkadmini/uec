// Where the SQL test runners execute.
//
// Default: a LOCAL Docker container (no network) holding the production schema
// only — see docs/security/LOCAL_TEST_DATABASE.md. Name it with
// UE_TEST_DB_CONTAINER (default "ue-phaseb-testdb").
//
// --linked: the project linked with `supabase link`. This reaches a REMOTE
// database (even though the runners always roll back) and must only be used
// with explicit approval.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function describeTarget(argv = process.argv) {
  return argv.includes("--linked")
    ? "linked Supabase project (REMOTE)"
    : `local container ${process.env.UE_TEST_DB_CONTAINER || "ue-phaseb-testdb"}`;
}

// Runs a SQL file and returns stdout+stderr (the runners read their report from
// a forced final error, so a non-zero exit is expected).
export function runSqlFile(file, { root, argv = process.argv } = {}) {
  try {
    if (argv.includes("--linked")) {
      return execFileSync("npx", ["supabase", "db", "query", "--linked", "-f", file], {
        cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32"
      });
    }
    const container = process.env.UE_TEST_DB_CONTAINER || "ue-phaseb-testdb";
    return execFileSync("docker", [
      "exec", "-i", "-e", "PGOPTIONS=-c client_min_messages=warning", container,
      "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-v", "VERBOSITY=terse", "-v", "ON_ERROR_STOP=1"
    ], { input: readFileSync(file, "utf8"), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  } catch (error) {
    return `${error.stdout || ""}${error.stderr || ""}`;
  }
}
