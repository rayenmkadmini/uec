// The production migration runner (scripts/apply-migration.mjs) must refuse to run unless the
// remote history is exactly what it expects. These tests feed it every kind of bad CLI output.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APPLIED = ["20261001194746", "20261001194845"];
const PENDING = ["20261015120000", "20261015140000", "20261015160000", "20261015180000", "20261016120000"];
const load = () => import(pathToFileURL(path.join(__dirname, "..", "scripts", "lib", "migration-history.mjs")).href);
const list = (records) => JSON.stringify({ migrations: records, message: "Migrations listed" });
const current = () => [
  ...APPLIED.map(v => ({ local: v, remote: v, time: "" })),
  ...PENDING.map(v => ({ local: v, remote: "", time: "" }))
];

test("accepts the expected production history (2 applied, 5 pending)", async () => {
  const { parseMigrationList, checkBeforeApply } = await load();
  const history = parseMigrationList(list(current()));
  assert.deepEqual(history.remote, APPLIED);
  assert.doesNotThrow(() => checkBeforeApply(history, APPLIED, PENDING));
});

test("reads the remote field, not the local one", async () => {
  const { parseMigrationList, checkBeforeApply } = await load();
  // Local-only record for an applied version: remote history incomplete -> refuse.
  const records = current();
  records[1] = { local: APPLIED[1], remote: "", time: "" };
  assert.throws(() => checkBeforeApply(parseMigrationList(list(records)), APPLIED, PENDING), /remote history/);
});

test("refuses malformed or unexpected CLI output", async () => {
  const { parseMigrationList } = await load();
  for (const raw of ["", "not json", "Initialising login role...\n{}", "null", "[]", JSON.stringify({ migrations: "x" }), JSON.stringify({})]) {
    assert.throws(() => parseMigrationList(raw), /JSON|migrations/, raw);
  }
  for (const bad of [[null], [{ local: "20261015120000" }], [{ local: 1, remote: "" }], [{ local: "abc", remote: "" }], [{ local: "", remote: "2026" }]]) {
    assert.throws(() => parseMigrationList(list(bad)), /unexpected migration/, JSON.stringify(bad));
  }
});

test("refuses when a pending migration is already applied", async () => {
  const { parseMigrationList, checkBeforeApply } = await load();
  const records = current();
  records[2] = { local: PENDING[0], remote: PENDING[0], time: "" };
  assert.throws(() => checkBeforeApply(parseMigrationList(list(records)), APPLIED, PENDING), /already recorded as applied: 20261015120000/);
});

test("refuses unknown remote versions and unexpected local files", async () => {
  const { parseMigrationList, checkBeforeApply } = await load();
  const extraRemote = [...current(), { local: "", remote: "20261101000000", time: "" }];
  assert.throws(() => checkBeforeApply(parseMigrationList(list(extraRemote)), APPLIED, PENDING), /remote history/);
  const extraLocal = [...current(), { local: "20261101000000", remote: "", time: "" }];
  assert.throws(() => checkBeforeApply(parseMigrationList(list(extraLocal)), APPLIED, PENDING), /local migrations/);
  const missingLocal = current().slice(0, -1);
  assert.throws(() => checkBeforeApply(parseMigrationList(list(missingLocal)), APPLIED, PENDING), /local migrations/);
});

test("after applying, all seven versions must be recorded remotely", async () => {
  const { parseMigrationList, checkAfterApply } = await load();
  const done = [...APPLIED, ...PENDING].map(v => ({ local: v, remote: v, time: "" }));
  assert.doesNotThrow(() => checkAfterApply(parseMigrationList(list(done)), APPLIED, PENDING));
  assert.throws(() => checkAfterApply(parseMigrationList(list(current())), APPLIED, PENDING), /remote history/);
});
