// Import / activation / reset behaviour (supabase/functions/_shared/member-lifecycle.mjs)
// against an in-memory fake of the service-role client. Synthetic data only.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createFake } = require("./helpers/fake-supabase.js");

const lifecycle = import("../supabase/functions/_shared/member-lifecycle.mjs");
const REDIRECT = "https://example.invalid/change-password.html";
const REFS = {
  faculties: [{ id: "f1", name: "FSEG Tunis — Faculté des Sciences Economiques et de Gestion de Tunis" }],
  zones: [{ id: "z1", name: "ZONE A" }]
};
const row = (n, extra = {}) => ({ line: n + 1, nom: "TEST", prenom: `SYNTHETIC_MEMBER_00${n}`, cin: `0000000${n}`, gender: "M",
  login: "", numero_abonnement: "", phone: "", email: "", adresse: "", faculty: "FSEG Tunis", zone: "ZONE A", ...extra });
const noSecrets = (body, values) => { const text = JSON.stringify(body); for (const v of values) assert.ok(!text.includes(v), `leaked ${v}`); };

test("import creates member records only — no Auth identities, nothing activated", async () => {
  const { importMembers } = await lifecycle;
  const fake = createFake({ tables: REFS });
  const { status, body } = await importMembers(fake.db, [row(1), row(2, { login: "SYNTH_LOGIN" })]);
  assert.equal(status, 200);
  assert.deepEqual([body.created, body.updated, body.failed, body.pending_activation], [2, 0, 0, 2]);
  assert.equal(fake.users.length, 0);
  assert.ok(fake.tables.subscribers.every(s => s.user_id === null && s.faculty_id === "f1" && s.zone_id === "z1"));
  assert.deepEqual(fake.tables.subscribers.map(s => s.login_name).sort(), ["SYNTH_LOGIN", "TESTSYNTHETICMEMBER001"].sort());
  assert.deepEqual(body.results.map(r => r.status), ["created", "created"]);
  noSecrets(body, ["00000001", "00000002"]);
});

test("invalid references or duplicate identities in the file reject the whole batch", async () => {
  const { importMembers } = await lifecycle;
  const fake = createFake({ tables: REFS });
  const unknown = await importMembers(fake.db, [row(1), row(2, { faculty: "Faculté Inexistante" })]);
  assert.equal(unknown.status, 400);
  assert.deepEqual(unknown.body.errors.map(e => e.code), ["unknown_reference"]);
  const dup = await importMembers(fake.db, [row(1), row(2, { cin: "00000001" })]);
  assert.equal(dup.status, 400);
  assert.equal(dup.body.errors[0].code, "duplicate_in_file");
  assert.equal(fake.tables.subscribers.length, 0, "nothing written");
});

test("ambiguous database mappings are refused instead of guessed", async () => {
  const { importMembers } = await lifecycle;
  const fake = createFake({ tables: { ...REFS, subscribers: [
    { id: "s1", user_id: null, login_name: "A1", cin: "00000001", numero_abonnement: "TEST-0001" },
    { id: "s2", user_id: null, login_name: "A2", cin: "00000009", numero_abonnement: "TEST-0002" },
    { id: "s3", user_id: null, login_name: "SYNTH_TAKEN", cin: "00000008", numero_abonnement: null }
  ] } });
  const cinVsNumber = await importMembers(fake.db, [row(1, { numero_abonnement: "TEST-0002" })]);
  assert.equal(cinVsNumber.status, 409);
  assert.equal(cinVsNumber.body.errors[0].code, "conflict");
  const numberOtherCin = await importMembers(fake.db, [row(3, { numero_abonnement: "TEST-0001" })]);
  assert.equal(numberOtherCin.body.errors[0].code, "conflict");
  const loginTaken = await importMembers(fake.db, [row(4, { login: "SYNTH_TAKEN" })]);
  assert.equal(loginTaken.body.errors[0].code, "taken");
  assert.equal(fake.tables.subscribers.length, 3, "nothing written");
  noSecrets(cinVsNumber.body, ["00000001", "00000009"]);
});

test("existing members are updated without overwriting optional data with blanks", async () => {
  const { importMembers } = await lifecycle;
  const fake = createFake({ tables: { ...REFS, subscribers: [
    { id: "s1", user_id: "u1", login_name: "OLD", cin: "00000001", numero_abonnement: "TEST-0001", phone: "+216 00 000 001", nom: "OLD" }
  ] } });
  const { body } = await importMembers(fake.db, [row(1, { nom: "NEW" })]);
  assert.deepEqual([body.updated, body.created, body.pending_activation], [1, 0, 0]);
  const s = fake.tables.subscribers[0];
  assert.deepEqual([s.nom, s.phone, s.numero_abonnement, s.login_name], ["NEW", "+216 00 000 001", "TEST-0001", "OLD"]);
});

test("a failed write affects only its line and is reported with a code", async () => {
  const { importMembers } = await lifecycle;
  const fake = createFake({ tables: REFS, failures: { "insert:subscribers": p => p.prenom === "SYNTHETIC_MEMBER_002" } });
  const { status, body } = await importMembers(fake.db, [row(1), row(2), row(3)]);
  assert.equal(status, 200);
  assert.equal(body.ok, false);
  assert.deepEqual(body.results.map(r => [r.line, r.status]), [[2, "created"], [3, "failed"], [4, "created"]]);
  assert.deepEqual(body.errors.map(e => [e.line, e.code]), [[3, "insert_failed"]]);
});

test("activation by link: account created, member linked, flagged, single link returned", async () => {
  const { importMembers, activateMember } = await lifecycle;
  const fake = createFake({ tables: REFS });
  await importMembers(fake.db, [row(1)]);
  const member = fake.tables.subscribers[0];
  const { status, body } = await activateMember(fake, { subscriberId: member.id, method: "link", redirectTo: REDIRECT });
  assert.equal(status, 200);
  assert.match(body.activation_link, /^https:\/\/example\.invalid\/auth\/v1\/verify\?token=/);
  assert.equal(body.temporary_password, undefined, "no password is returned with a link");
  assert.equal(member.user_id, body.user_id);
  assert.equal(fake.tables.profiles.find(p => p.id === body.user_id).must_change_password, true);
  assert.deepEqual(fake.tables.user_roles.filter(r => r.user_id === body.user_id).map(r => r.role), ["MEMBER"]);
  assert.equal(fake.users[0].email, "testsyntheticmember001@login.ueclubiste.local");
  assert.ok(fake.users[0].password.length >= 20, "random, unknown password");
  assert.notEqual(fake.users[0].password, member.cin);
  assert.equal(fake.calls.find(c => c.auth === "generateLink").redirectTo, REDIRECT);
});

test("activation without a configured redirect fails before creating anything", async () => {
  const { activateMember } = await lifecycle;
  const fake = createFake({ tables: { subscribers: [{ id: "s1", user_id: null, nom: "TEST", prenom: "X", login_name: "SYNTHX", status: "ACTIVE" }] } });
  const { status, body } = await activateMember(fake, { subscriberId: "s1", method: "link", redirectTo: null });
  assert.deepEqual([status, body.code], [503, "link_unavailable"]);
  assert.equal(fake.users.length, 0);
});

test("invitation (link) failure rolls back the account and the link", async () => {
  const { activateMember } = await lifecycle;
  const fake = createFake({ tables: { subscribers: [{ id: "s1", user_id: null, nom: "TEST", prenom: "X", login_name: "SYNTHX", status: "ACTIVE" }] },
    failures: { generateLink: true } });
  const { status, body } = await activateMember(fake, { subscriberId: "s1", method: "link", redirectTo: REDIRECT });
  assert.deepEqual([status, body.code], [502, "link_failed"]);
  assert.equal(fake.users.length, 0);
  assert.equal(fake.tables.subscribers[0].user_id, null);
  assert.equal(fake.tables.profiles.length, 0);
});

test("account creation failure and existing Auth login leave the record unactivated", async () => {
  const { activateMember } = await lifecycle;
  const member = { id: "s1", user_id: null, nom: "TEST", prenom: "X", login_name: "SYNTHX", status: "ACTIVE" };
  const broken = createFake({ tables: { subscribers: [member] }, failures: { createUser: true } });
  assert.equal((await activateMember(broken, { subscriberId: "s1", method: "link", redirectTo: REDIRECT })).body.code, "account_creation_failed");
  const taken = createFake({ tables: { subscribers: [member] } });
  await taken.auth.createUser({ email: "synthx@login.ueclubiste.local", password: "x", user_metadata: {} });
  const result = await activateMember(taken, { subscriberId: "s1", method: "link", redirectTo: REDIRECT });
  assert.deepEqual([result.status, result.body.code], [409, "login_in_use"]);
  assert.equal(taken.tables.subscribers[0].user_id, null);
});

test("profile / role setup failure rolls back everything", async () => {
  const { activateMember } = await lifecycle;
  const fake = createFake({ tables: { subscribers: [{ id: "s1", user_id: null, nom: "TEST", prenom: "X", login_name: "SYNTHX", status: "ACTIVE" }] },
    failures: { "update:profiles": true } });
  const { body } = await activateMember(fake, { subscriberId: "s1", method: "link", redirectTo: REDIRECT });
  assert.equal(body.code, "account_setup_failed");
  assert.equal(fake.users.length, 0);
  assert.equal(fake.tables.subscribers[0].user_id, null);
});

test("activation refuses already-active, deactivated, unknown or login-less members", async () => {
  const { activateMember } = await lifecycle;
  const fake = createFake({ tables: { subscribers: [
    { id: "a", user_id: "u", nom: "T", prenom: "A", login_name: "SYNTHA", status: "ACTIVE" },
    { id: "b", user_id: null, nom: "T", prenom: "B", login_name: "SYNTHB", status: "INACTIVE" },
    { id: "c", user_id: null, nom: "T", prenom: "C", login_name: null, status: "ACTIVE" }
  ] } });
  const code = async id => (await activateMember(fake, { subscriberId: id, method: "link", redirectTo: REDIRECT })).body.code;
  assert.equal(await code("a"), "already_active");
  assert.equal(await code("b"), "inactive_member");
  assert.equal(await code("c"), "invalid_login");
  assert.equal(await code("zzz"), "not_found");
  assert.equal((await activateMember(fake, { subscriberId: "a", method: "sms" })).body.code, "invalid_method");
  assert.equal(fake.users.length, 0);
});

test("two concurrent activations cannot both link the record", async () => {
  const { activateMember } = await lifecycle;
  const fake = createFake({ tables: { subscribers: [{ id: "s1", user_id: null, nom: "TEST", prenom: "X", login_name: "SYNTHX", status: "ACTIVE" }] } });
  // Simulate another activation linking the record right after our lookup.
  const original = fake.db.from;
  let raced = false;
  fake.db.from = table => {
    const q = original(table);
    if (table === "subscribers" && !raced) {
      const select = q.select;
      q.select = (...args) => { const r = select(...args); const then = r.then; r.then = (res, rej) => then.call(r, v => { if (v.data && !Array.isArray(v.data)) { raced = true; fake.tables.subscribers[0].user_id = "other"; } return res(v); }, rej); return r; };
    }
    return q;
  };
  const { body } = await activateMember(fake, { subscriberId: "s1", method: "link", redirectTo: REDIRECT });
  assert.equal(body.code, "already_active");
  assert.equal(fake.users.length, 0, "our account was removed");
  assert.equal(fake.tables.subscribers[0].user_id, "other");
});

test("temporary-password activation is an explicit fallback and returns one password", async () => {
  const { activateMember } = await lifecycle;
  const fake = createFake({ tables: { subscribers: [{ id: "s1", user_id: null, nom: "TEST", prenom: "X", login_name: "SYNTHX", status: "ACTIVE", cin: "00000001" }] } });
  const { body } = await activateMember(fake, { subscriberId: "s1", method: "temporary_password" });
  assert.equal(body.temporary_password, fake.users[0].password);
  assert.notEqual(body.temporary_password, "00000001");
  assert.equal(body.activation_link, undefined);
});

test("reset by link flags the account and never reactivates it", async () => {
  const { resetAccess } = await lifecycle;
  const fake = createFake();
  const { data } = await fake.auth.createUser({ email: "synthx@login.ueclubiste.local", password: "old", user_metadata: {} });
  const profile = fake.tables.profiles[0];
  Object.assign(profile, { must_change_password: false, is_active: false });
  const { status, body } = await resetAccess(fake, { userId: data.user.id, method: "link", redirectTo: REDIRECT });
  assert.equal(status, 200);
  assert.ok(body.activation_link);
  assert.deepEqual([profile.must_change_password, profile.is_active], [true, false]);
  assert.equal(fake.users[0].password, "old", "a link does not change the password");
});

test("reset with a temporary password changes it first, then flags (digest snapshot order)", async () => {
  const { resetAccess } = await lifecycle;
  const fake = createFake();
  const { data } = await fake.auth.createUser({ email: "synthx@login.ueclubiste.local", password: "old", user_metadata: {} });
  const { body } = await resetAccess(fake, { userId: data.user.id, method: "temporary_password" });
  const order = fake.calls.filter(c => c.auth === "updateUserById" || (c.table === "profiles" && c.op === "update")).map(c => c.auth || "flag");
  assert.deepEqual(order, ["updateUserById", "flag"]);
  assert.equal(fake.users[0].password, body.temporary_password);
  assert.equal((await resetAccess(fake, { userId: "missing", method: "temporary_password" })).body.code, "not_found");
  assert.equal((await resetAccess(fake, { userId: data.user.id, method: "link" })).body.code, "link_unavailable");
});

test("activation redirect accepts only https origins (or local development)", async () => {
  const { activationRedirect } = await lifecycle;
  assert.equal(activationRedirect("https://login.example.invalid/some/path"), "https://login.example.invalid/change-password.html");
  assert.equal(activationRedirect("http://localhost:5500"), "http://localhost:5500/change-password.html");
  for (const bad of [null, "", "http://example.invalid", "javascript:alert(1)", "not a url"]) assert.equal(activationRedirect(bad), null, String(bad));
});

test("deleting a member removes the record too (user_id is ON DELETE SET NULL)", async () => {
  const { deleteMember, importMembers, activateMember } = await lifecycle;
  const fake = createFake({ tables: REFS });
  await importMembers(fake.db, [row(1), row(2)]);
  const [active, pending] = fake.tables.subscribers;
  await activateMember(fake, { subscriberId: active.id, method: "link", redirectTo: REDIRECT });
  const a = await deleteMember(fake, { subscriberId: active.id });
  assert.deepEqual([a.status, a.body.account_deleted], [200, true]);
  assert.equal(fake.users.length, 0);
  const b = await deleteMember(fake, { subscriberId: pending.id });
  assert.deepEqual([b.status, b.body.account_deleted], [200, false], "never-activated records can be deleted");
  assert.equal(fake.tables.subscribers.length, 0);
  assert.equal((await deleteMember(fake, { subscriberId: "missing" })).body.code, "not_found");
});

test("member deletion refuses staff accounts and stops if the account cannot be deleted", async () => {
  const { deleteMember } = await lifecycle;
  const staff = createFake({ tables: { subscribers: [{ id: "s1", user_id: "u1" }], user_roles: [{ user_id: "u1", role: "MEMBER" }, { user_id: "u1", role: "ADMIN" }] } });
  const refused = await deleteMember(staff, { subscriberId: "s1" });
  assert.deepEqual([refused.status, refused.body.code], [409, "staff_account"]);
  assert.equal(staff.tables.subscribers.length, 1);
  assert.ok(!staff.calls.some(c => c.auth === "deleteUser"));

  const broken = createFake({ tables: { subscribers: [{ id: "s1", user_id: "u1" }] } });
  broken.auth.deleteUser = async () => ({ data: null, error: { message: "boom" } });
  const failed = await deleteMember(broken, { subscriberId: "s1" });
  assert.deepEqual([failed.status, failed.body.code], [502, "account_delete_failed"]);
  assert.equal(broken.tables.subscribers.length, 1, "record kept when the account delete fails");

  const recordFails = createFake({ tables: { subscribers: [{ id: "s1", user_id: null }] }, failures: { "delete:subscribers": true } });
  assert.equal((await deleteMember(recordFails, { subscriberId: "s1" })).body.code, "record_delete_failed");
});
