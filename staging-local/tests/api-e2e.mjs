// End-to-end tests against the LOCAL staging stack (real GoTrue, PostgREST,
// Storage and Edge runtime behind 127.0.0.1:54321). Synthetic data only.
// Prints check names and HTTP statuses; never tokens, passwords or links.
//
//   node staging-local/tests/api-e2e.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const stackDir = join(here, "..");
const API = "http://127.0.0.1:54321";
const SITE = "http://127.0.0.1:5500";
const env = Object.fromEntries(readFileSync(join(stackDir, ".secrets", "stack.env"), "utf8").trim().split("\n").map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const ANON = env.ANON_KEY;
const SERVICE = env.SERVICE_ROLE_KEY;

if (!/^http:\/\/127\.0\.0\.1:54321$/.test(API)) throw new Error("refusing: not the local stack");

// ---------------------------------------------------------------- reporting
const results = [];
let section = "";
const check = (name, ok, detail = "") => {
  results.push({ name: `${section} — ${name}`, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"} ${section} — ${name}${detail !== "" ? ` [${detail}]` : ""}`);
};
const begin = name => { section = name; };

// ---------------------------------------------------------------- HTTP helpers
async function http(method, path, { token, body, headers = {}, raw = false } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    redirect: "manual",
    headers: { apikey: ANON, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined && !raw ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body)
  });
  let json = null;
  const text = await res.text();
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json, headers: res.headers };
}
const service = (method, path, body) => http(method, path, { token: SERVICE, body, headers: { apikey: SERVICE, Prefer: "return=representation" } });
const rest = (token, path, opts = {}) => http(opts.method || "GET", `/rest/v1/${path}`, { token, body: opts.body, headers: opts.prefer ? { Prefer: opts.prefer } : {} });
const rpc = (token, fn, args = {}) => http("POST", `/rest/v1/rpc/${fn}`, { token, body: args });
const edge = (token, fn, body, headers = {}) => http("POST", `/functions/v1/${fn}`, { token, body, headers: { Origin: SITE, ...headers } });
const rows = r => (Array.isArray(r.json) ? r.json.length : -1);
const denied = r => r.status >= 400 || rows(r) === 0;

async function signIn(email, password) {
  const r = await http("POST", "/auth/v1/token?grant_type=password", { body: { email, password } });
  return r.status === 200 ? r.json.access_token : null;
}
// Full token response (access + refresh); used by the session-revocation checks.
async function signInSession(email, password) {
  const r = await http("POST", "/auth/v1/token?grant_type=password", { body: { email, password } });
  return r.status === 200 ? { access: r.json.access_token, refresh: r.json.refresh_token } : null;
}
const refreshWith = refresh => http("POST", "/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: refresh } });
const setPassword = (token, password) => http("PUT", "/auth/v1/user", { token, body: { password } });
const P = n => `Synthetic-Pass-${n}!x9Q`; // synthetic test passwords (local stack only)

// Users are created through the Auth admin API, then put through the real
// first-login flow (sign in, change password, complete_password_change).
async function createUser(key, roles, { onboard = true } = {}) {
  const email = `${key}@staging.invalid`;
  const created = await service("POST", "/auth/v1/admin/users", { email, password: P(`${key}-0`), email_confirm: true, user_metadata: { display_name: `Staging ${key}` } });
  if (created.status !== 200) throw new Error(`createUser ${key}: ${created.status}`);
  const id = created.json.id;
  if (roles) {
    await service("DELETE", `/rest/v1/user_roles?user_id=eq.${id}`);
    for (const role of roles) await service("POST", "/rest/v1/user_roles", { user_id: id, role });
  }
  let token = await signIn(email, P(`${key}-0`));
  if (onboard) {
    await setPassword(token, P(`${key}-1`));
    await rpc(token, "complete_password_change");
    token = await signIn(email, P(`${key}-1`));
  }
  return { id, email, token, password: onboard ? P(`${key}-1`) : P(`${key}-0`) };
}

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ================================================================= tests
const run = Date.now().toString(36);
const ID = n => `${run.toUpperCase()}${n}`;

begin("Anonymous");
check("signup disabled", (await http("POST", "/auth/v1/signup", { body: { email: `anon-${run}@staging.invalid`, password: P("anon") } })).status >= 400);
check("members table", denied(await rest(null, "subscribers?select=id")), (await rest(null, "subscribers?select=id")).status);
check("reference data", denied(await rest(null, "faculties?select=id&limit=1")));
check("private fields RPC", (await rpc(null, "get_member_private_fields")).status >= 400);
check("Edge Function without JWT", (await edge(null, "admin-import-users", { rows: [] })).status === 401);
check("Edge Function with anon key only", [401, 403].includes((await edge(ANON, "admin-import-users", { rows: [] })).status));

begin("Setup");
const sa = await createUser(`sa-${run}`, ["SUPERADMIN"]);
const admin = await createUser(`admin-${run}`, ["ADMIN"]);
const treasurer = await createUser(`treas-${run}`, ["TREASURER", "MEMBER"]);
check("staff accounts onboarded through real Auth", sa.token && admin.token && treasurer.token);
const firstSa = await http("GET", "/rest/v1/profiles?select=must_change_password&id=eq." + sa.id, { token: sa.token });
check("first-login flag cleared after real password change", firstSa.json?.[0]?.must_change_password === false);

begin("Password policy (GoTrue)");
check("weak password refused by Auth", (await setPassword(sa.token, "short")).status === 422);
check("no-symbol password refused by Auth", (await setPassword(sa.token, "Abcdefghijkl12")).status === 422);

begin("Import");
const fac = "FSEG Tunis — Faculté des Sciences Economiques et de Gestion de Tunis";
const csvRow = (n, extra = {}) => ({ line: n + 1, nom: "STAGING", prenom: `SYNTHETIC_${run}_${n}`, cin: `T${run}${n}`.slice(0, 20), gender: n % 2 ? "M" : "F",
  login: ID(n), numero_abonnement: `S-${run}-${n}`, phone: `+216 00 000 00${n}`, email: `member${n}-${run}@example.invalid`, adresse: "Rue Fictive", faculty: fac, zone: "ZONE A", ...extra });
const authUsersBefore = (await service("GET", "/auth/v1/admin/users?per_page=200")).json?.users?.length ?? -1;
const imported = await edge(sa.token, "admin-import-users", { rows: [csvRow(1), csvRow(2), csvRow(3), csvRow(4)] });
check("valid synthetic rows imported", imported.status === 200 && imported.json.created === 4, `${imported.status} created=${imported.json?.created}`);
const authUsersAfter = (await service("GET", "/auth/v1/admin/users?per_page=200")).json?.users?.length ?? -2;
check("import created no login accounts", authUsersAfter === authUsersBefore, `${authUsersBefore}->${authUsersAfter}`);
check("import response carries no CIN / contact values", !JSON.stringify(imported.json).match(new RegExp(`T${run}|example\\.invalid|\\+216`)));
check("missing CIN rejected (whole file)", (await edge(sa.token, "admin-import-users", { rows: [csvRow(5), csvRow(6, { cin: "" })] })).status === 400);
check("unknown faculty rejected", (await edge(sa.token, "admin-import-users", { rows: [csvRow(7, { faculty: "Faculté Inexistante" })] })).json?.errors?.[0]?.code === "unknown_reference");
check("unknown zone rejected", (await edge(sa.token, "admin-import-users", { rows: [csvRow(7, { zone: "ZONE Z" })] })).json?.errors?.[0]?.code === "unknown_reference");
check("duplicate CIN in file rejected", (await edge(sa.token, "admin-import-users", { rows: [csvRow(8), csvRow(9, { cin: csvRow(8).cin })] })).status === 400);
const conflict = await edge(sa.token, "admin-import-users", { rows: [csvRow(1, { numero_abonnement: `S-${run}-2` })] });
check("ambiguous CIN / number mapping refused", conflict.status === 409, conflict.status);
check("nothing written by refused files", (await service("GET", `/rest/v1/subscribers?select=id&login_name=in.(${ID(5)},${ID(6)},${ID(7)},${ID(8)},${ID(9)})`)).json?.length === 0);
check("import refused for ADMIN", (await edge(admin.token, "admin-import-users", { rows: [csvRow(10)] })).status === 403);
check("import refused for TREASURER", (await edge(treasurer.token, "admin-import-users", { rows: [csvRow(10)] })).status === 403);

const members = Object.fromEntries((await service("GET", `/rest/v1/subscribers?select=id,login_name,user_id&login_name=in.(${ID(1)},${ID(2)},${ID(3)},${ID(4)})`)).json.map(m => [m.login_name, m]));
const m1 = members[ID(1)], m2 = members[ID(2)], m3 = members[ID(3)], m4 = members[ID(4)];
check("imported members are not activated", [m1, m2, m3, m4].every(m => m && m.user_id === null));

begin("Activation link (GoTrue recovery)");
const act = await edge(sa.token, "admin-activate-member", { subscriber_id: m1.id, method: "link" });
check("activation returns a link and no password", act.status === 200 && act.json.activation_link && !act.json.temporary_password, act.status);
check("activation response is no-store", act.headers.get("cache-control") === "no-store");
const link = act.json?.activation_link || "";
const linkUrl = link ? new URL(link) : null;
check("link points at the local Auth verify endpoint", linkUrl?.origin === API && linkUrl?.pathname === "/auth/v1/verify");
check("link redirects to the allow-listed password page", linkUrl?.searchParams.get("redirect_to") === `${SITE}/change-password.html`);
const follow = await fetch(link, { redirect: "manual" });
const location = follow.headers.get("location") || "";
check("link opens a session on change-password.html", follow.status === 303 && location.startsWith(`${SITE}/change-password.html#access_token=`), follow.status);
const m1Token = new URLSearchParams(location.split("#")[1] || "").get("access_token");
const reuse = await fetch(link, { redirect: "manual" });
const reuseLoc = reuse.headers.get("location") || "";
check("link is single-use (second use rejected)", /error_code=otp_expired|error=access_denied/.test(reuseLoc) && !/access_token=/.test(reuseLoc));
check("before choosing a password: own member row hidden", rows(await rest(m1Token, `subscribers?select=id&id=eq.${m1.id}`)) === 0);
check("before choosing a password: completion refused", (await rpc(m1Token, "complete_password_change")).status >= 400);
check("weak new password refused", (await setPassword(m1Token, "weakpass")).status === 422);
check("member sets own password", (await setPassword(m1Token, P("m1"))).status === 200);
check("completion accepted after real change", (await rpc(m1Token, "complete_password_change")).status < 300);
const member1 = { id: null, token: await signIn(`${ID(1).toLowerCase()}@login.ueclubiste.local`, P("m1")) };
check("member signs in with chosen password", Boolean(member1.token));
check("member reads own row after first login", rows(await rest(member1.token, `subscribers?select=id&id=eq.${m1.id}`)) === 1);
const second = await edge(sa.token, "admin-activate-member", { subscriber_id: m1.id, method: "link" });
check("second activation of same member refused", second.status === 409 && second.json.code === "already_active");

const evil = await service("POST", "/auth/v1/admin/generate_link", { type: "recovery", email: `${ID(1).toLowerCase()}@login.ueclubiste.local`, redirect_to: "https://evil.example/steal" });
const evilLink = evil.json?.action_link || evil.json?.properties?.action_link || "";
const evilFollow = evilLink ? await fetch(evilLink, { redirect: "manual" }) : null;
check("non-allow-listed redirect is not honoured", evilFollow && !(evilFollow.headers.get("location") || "").startsWith("https://evil.example"), evilFollow?.status);

begin("Link expiry (Auth recreated with 5 s lifetime)");
execFileSync("bash", [join(stackDir, "stack.sh"), "auth", "5"], { stdio: "ignore", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
const short = await edge(sa.token, "admin-activate-member", { subscriber_id: m4.id, method: "link" });
await sleep(8000);
const expired = short.json?.activation_link ? await fetch(short.json.activation_link, { redirect: "manual" }) : null;
const expiredLoc = expired?.headers.get("location") || "";
check("expired link refused", Boolean(expired) && /error/.test(expiredLoc) && !/access_token=/.test(expiredLoc), expired?.status);
execFileSync("bash", [join(stackDir, "stack.sh"), "auth", "3600"], { stdio: "ignore", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
const reissue = await edge(sa.token, "admin-reset-password", { user_id: short.json?.user_id, method: "link" });
check("new link re-issued after expiry", reissue.status === 200 && Boolean(reissue.json.activation_link));

begin("Temporary-password fallback");
const tmp = await edge(sa.token, "admin-activate-member", { subscriber_id: m2.id, method: "temporary_password" });
check("fallback returns one temporary password", tmp.status === 200 && typeof tmp.json.temporary_password === "string" && tmp.json.temporary_password.length >= 20);
check("temporary password is not the CIN", tmp.json?.temporary_password !== csvRow(2).cin);
let m2Token = await signIn(`${ID(2).toLowerCase()}@login.ueclubiste.local`, tmp.json?.temporary_password || "x");
check("sign-in with temporary password works", Boolean(m2Token));
check("temporary-password account cannot read data", rows(await rest(m2Token, `subscribers?select=id&id=eq.${m2.id}`)) === 0);
check("cannot choose a seat before changing password", (await rpc(m2Token, "set_match_participation", { p_match_id: "10000000-0000-4000-8000-0000000000d1", p_zone_id: (await service("GET", "/rest/v1/match_zones?select=id&zone_key=eq.PELOUSE&match_id=eq.10000000-0000-4000-8000-0000000000d1")).json[0].id })).status >= 400);
await setPassword(m2Token, P("m2"));
check("completion after change", (await rpc(m2Token, "complete_password_change")).status < 300);
const member2 = { token: await signIn(`${ID(2).toLowerCase()}@login.ueclubiste.local`, P("m2")) };

begin("Reset password");
check("reset refused for ADMIN", (await edge(admin.token, "admin-reset-password", { user_id: admin.id, method: "link" })).status === 403);
check("reset for unknown user", (await edge(sa.token, "admin-reset-password", { user_id: "00000000-0000-4000-8000-000000000999", method: "link" })).status === 404);
check("weak chosen password refused", (await edge(sa.token, "admin-reset-password", { user_id: admin.id, new_password: "weak" })).status === 400);
const rs = await edge(sa.token, "admin-reset-password", { user_id: admin.id, generate: true });
check("generated reset returns once (no-store)", rs.status === 200 && rs.json.temporary_password && rs.headers.get("cache-control") === "no-store");
const adminFlagged = await signIn(admin.email, rs.json?.temporary_password || "x");
check("after reset, account has no data access until changed", rows(await rest(adminFlagged, "subscribers?select=id")) === 0);
await setPassword(adminFlagged, P(`admin-${run}-2`));
await rpc(adminFlagged, "complete_password_change");
admin.token = await signIn(admin.email, P(`admin-${run}-2`));
check("ADMIN restored after own change", rows(await rest(admin.token, "subscribers?select=id")) > 0);

begin("Reset ends existing sessions");
const victim = await createUser(`revoke-${run}`, ["MEMBER"]);
const stolen = await signInSession(victim.email, victim.password);
check("positive control: the session can refresh before the reset", (await refreshWith(stolen?.refresh)).status === 200);
const stolen2 = await signInSession(victim.email, victim.password);
const vr = await edge(sa.token, "admin-reset-password", { user_id: victim.id, generate: true });
check("reset reports sessions_revoked", vr.status === 200 && vr.json.sessions_revoked === true, vr.status);
check("old refresh token refused after reset", (await refreshWith(stolen2?.refresh)).status >= 400);
const hijack = await setPassword(stolen2?.access, P(`hijack-${run}`));
check("old session cannot set its own password after reset", hijack.status >= 400, hijack.status);
check("the new temporary password still works", Boolean(await signIn(victim.email, vr.json?.temporary_password || "x")));

begin("ADMIN read-only and minimized");
const one = `id=eq.${m1.id}`;
check("names / number / status / faculty / zone allowed", rows(await rest(admin.token, `subscribers?select=nom,prenom,numero_abonnement,status,card_paid,faculty_id,zone_id&${one}`)) === 1);
for (const col of ["cin", "adresse", "date_naissance", "notes", "phone", "email", "gender", "photo_url"]) {
  const r = await rest(admin.token, `subscribers?select=${col}&${one}`);
  check(`subscribers.${col} refused`, r.status >= 400 && !JSON.stringify(r.json || "").includes(`T${run}`), r.status);
}
check("select * refused", (await rest(admin.token, "subscribers?select=*")).status >= 400);
check("filter on CIN refused", (await rest(admin.token, `subscribers?select=id&cin=eq.${csvRow(1).cin}`)).status >= 400);
check("order by phone refused", (await rest(admin.token, "subscribers?select=id&order=phone")).status >= 400);
check("v_member_cards refused", (await rest(admin.token, "v_member_cards?select=nom")).status >= 400);
check("profiles.email refused", (await rest(admin.token, "profiles?select=email")).status >= 400);
check("audit_logs.ip_address refused", (await rest(admin.token, "audit_logs?select=ip_address")).status >= 400);
check("audit actions readable", (await rest(admin.token, "audit_logs?select=id,action&limit=1")).status === 200);
check("payment notes refused", (await rest(admin.token, "event_payments?select=notes")).status >= 400);
check("private fields of a member refused", (await rpc(admin.token, "get_member_private_fields", { p_subscriber_id: m1.id })).status >= 400);
check("account contacts of others refused", (await rpc(admin.token, "get_account_contacts", { p_user_id: sa.id })).status >= 400);
check("member photo files refused", (await http("GET", `/storage/v1/object/authenticated/subscriber-photos/${ID(1)}/p.png`, { token: admin.token })).status >= 400);
const seats = await rpc(admin.token, "list_match_participants", { p_match_id: "10000000-0000-4000-8000-0000000000d1" });
check("seat list allowed, without gender", seats.status === 200 && (seats.json || []).every(r => r.gender === null), seats.status);
check("update member refused", denied(await rest(admin.token, `subscribers?${one}`, { method: "PATCH", body: { nom: "X" }, prefer: "return=representation" })));
check("create event refused", (await rest(admin.token, "events", { method: "POST", body: { title: "X", amount: 1 } })).status >= 400);
check("card payment RPC refused", (await rpc(admin.token, "set_card_payment_status", { p_subscriber_id: m1.id, p_paid: true })).status >= 400);
check("grant self SUPERADMIN refused", (await rest(admin.token, "user_roles", { method: "POST", body: { user_id: admin.id, role: "SUPERADMIN" } })).status >= 400);
check("Edge Function (admin-create-admin) refused", (await edge(admin.token, "admin-create-admin", { email: `x-${run}@staging.invalid`, display_name: "X", password: P("x"), roles: ["ADMIN"] })).status === 403);

begin("TREASURER");
const tSub = await service("POST", "/rest/v1/subscribers", { user_id: treasurer.id, nom: "STAGING", prenom: "TREASURER", login_name: `T${run}`.toUpperCase().slice(0, 20), gender: "MALE", status: "ACTIVE" });
const treasurerSubId = tSub.json?.[0]?.id;
const payList = await rpc(treasurer.token, "list_payment_members");
check("payment list allowed", payList.status === 200 && rows(payList) > 0);
check("payment list has no contact or identity fields", (payList.json || []).every(r => !("cin" in r) && !("phone" in r) && !("email" in r) && !("gender" in r)));
check("mark another member's card paid", (await rpc(treasurer.token, "set_card_payment_status", { p_subscriber_id: m1.id, p_paid: true })).status === 200);
check("own card refused", (await rpc(treasurer.token, "set_card_payment_status", { p_subscriber_id: treasurerSubId, p_paid: true })).status >= 400);
check("mark cotisation paid", (await rpc(treasurer.token, "set_event_payment_status", { p_event_id: "10000000-0000-4000-8000-0000000000c1", p_subscriber_id: m1.id, p_paid: true })).status === 200);
check("own cotisation refused", (await rpc(treasurer.token, "set_event_payment_status", { p_event_id: "10000000-0000-4000-8000-0000000000c1", p_subscriber_id: treasurerSubId, p_paid: true })).status >= 400);
check("edit event refused", denied(await rest(treasurer.token, "events?id=eq.10000000-0000-4000-8000-0000000000c1", { method: "PATCH", body: { amount: 0 }, prefer: "return=representation" })));
check("edit payment amount refused", denied(await rest(treasurer.token, "event_payments?subscriber_id=eq." + m1.id, { method: "PATCH", body: { amount: 0 }, prefer: "return=representation" })));
check("read other members' rows refused", rows(await rest(treasurer.token, `subscribers?select=id&${one}`)) === 0);
check("read gender / phone refused", (await rest(treasurer.token, "subscribers?select=gender")).status >= 400);
check("seat list refused", (await rpc(treasurer.token, "list_match_participants", { p_match_id: "10000000-0000-4000-8000-0000000000d1" })).status >= 400);

begin("MEMBER");
const own = await rpc(member1.token, "get_member_private_fields");
check("own private fields via RPC", own.status === 200 && rows(own) === 1 && own.json[0].cin === csvRow(1).cin);
check("other member's private fields refused", (await rpc(member1.token, "get_member_private_fields", { p_subscriber_id: m2.id })).status >= 400);
check("other member's row hidden", rows(await rest(member1.token, `subscribers?select=id&id=eq.${m2.id}`)) === 0);
check("edit own phone allowed (explicit columns returned)", rows(await rest(member1.token, `subscribers?id=eq.${m1.id}&select=id`, { method: "PATCH", body: { phone: "+216 00 000 009" }, prefer: "return=representation" })) === 1);
check("update returning * refused (withheld columns)", (await rest(member1.token, `subscribers?id=eq.${m1.id}`, { method: "PATCH", body: { phone: "+216 00 000 008" }, prefer: "return=representation" })).status === 403);
check("edit own name refused", (await rest(member1.token, `subscribers?id=eq.${m1.id}`, { method: "PATCH", body: { nom: "HACK" } })).status >= 400);
check("edit own CIN refused", (await rest(member1.token, `subscribers?id=eq.${m1.id}`, { method: "PATCH", body: { cin: "X1" } })).status >= 400);
check("change own card status refused", (await rest(member1.token, `subscribers?id=eq.${m1.id}`, { method: "PATCH", body: { card_paid: false } })).status >= 400);
const spoof = await http("PUT", "/auth/v1/user", { token: member1.token, body: { data: { role: "SUPERADMIN", roles: ["SUPERADMIN"] } } });
const spoofToken = await signIn(`${ID(1).toLowerCase()}@login.ueclubiste.local`, P("m1"));
check("metadata role spoof grants nothing", spoof.status === 200 && (await rest(spoofToken, "subscribers?select=id")).json?.length === 1 && (await rpc(spoofToken, "list_payment_members")).status >= 400);
check("self-promotion via user_roles refused", (await rest(member1.token, "user_roles", { method: "POST", body: { user_id: "x", role: "SUPERADMIN" } })).status >= 400);
check("change own app_role refused", denied(await rest(member1.token, "profiles?select=id", { method: "PATCH", body: { app_role: "SUPERADMIN" }, prefer: "return=representation" })));
check("clear own password flag directly refused", denied(await rest(member1.token, "profiles?select=id", { method: "PATCH", body: { must_change_password: false }, prefer: "return=representation" })));

begin("Seats");
await service("DELETE", "/rest/v1/match_participations?match_id=eq.10000000-0000-4000-8000-0000000000d1"); // local fixture reset between runs
const zones = Object.fromEntries((await service("GET", "/rest/v1/match_zones?select=id,zone_key,match_id")).json.map(z => [`${z.match_id}:${z.zone_key}`, z.id]));
const U = "10000000-0000-4000-8000-0000000000d1", PAST = "10000000-0000-4000-8000-0000000000d2";
check("choose seat (upcoming)", (await rpc(member1.token, "set_match_participation", { p_match_id: U, p_zone_id: zones[`${U}:ENCEINTE_INF`] })).status === 200);
check("full zone refused (capacity 1)", (await rpc(member2.token, "set_match_participation", { p_match_id: U, p_zone_id: zones[`${U}:ENCEINTE_INF`] })).status >= 400);
check("past match refused", (await rpc(member1.token, "set_match_participation", { p_match_id: PAST, p_zone_id: zones[`${PAST}:PELOUSE`] })).status >= 400);
check("female member refused in virage", (await rpc(member2.token, "set_match_participation", { p_match_id: U, p_zone_id: zones[`${U}:VIRAGE_1`] })).status >= 400);
check("seat list for SUPERADMIN includes gender", ((await rpc(sa.token, "list_match_participants", { p_match_id: U })).json || []).some(r => r.gender));
check("remove own seat", (await rpc(member1.token, "remove_match_participation", { p_match_id: U })).status < 300);

begin("Storage");
const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a6b10000000049454e44ae426082", "hex");
const up = (token, path) => http("POST", `/storage/v1/object/subscriber-photos/${path}`, { token, body: png, raw: true, headers: { "Content-Type": "image/png" } });
check("member uploads into own folder", (await up(member1.token, `${ID(1)}/p.png`)).status === 200);
check("member upload into another folder refused", (await up(member1.token, `${ID(2)}/p.png`)).status >= 400);
check("ADMIN upload refused", (await up(admin.token, `${ID(1)}/a.png`)).status >= 400);
check("member reads own photo", (await http("GET", `/storage/v1/object/authenticated/subscriber-photos/${ID(1)}/p.png`, { token: member1.token })).status === 200);
check("other member cannot read it", (await http("GET", `/storage/v1/object/authenticated/subscriber-photos/${ID(1)}/p.png`, { token: member2.token })).status >= 400);
check("SUPERADMIN reads it", (await http("GET", `/storage/v1/object/authenticated/subscriber-photos/${ID(1)}/p.png`, { token: sa.token })).status === 200);
check("anonymous public URL refused (bucket private)", (await http("GET", `/storage/v1/object/public/subscriber-photos/${ID(1)}/p.png`)).status >= 400);
check("non-image upload refused by bucket", (await http("POST", `/storage/v1/object/subscriber-photos/${ID(1)}/x.txt`, { token: member1.token, body: "hello", raw: true, headers: { "Content-Type": "text/plain" } })).status >= 400);

begin("Deactivation with a live session");
const sa2 = await createUser(`sa2-${run}`, ["SUPERADMIN"]);
for (const r of (await service("GET", "/rest/v1/user_roles?select=user_id&role=eq.ADMIN")).json || []) {
  if (r.user_id !== admin.id) await service("PATCH", `/rest/v1/profiles?id=eq.${r.user_id}`, { is_active: false }); // earlier runs' fixtures
}
const lastAdmin = await edge(sa.token, "admin-update-admin", { user_id: admin.id, is_active: false });
check("the last active ADMIN cannot be deactivated", lastAdmin.status === 400, lastAdmin.status);
await createUser(`admin2-${run}`, ["ADMIN"]);
const off = await edge(sa.token, "admin-update-admin", { user_id: admin.id, is_active: false });
check("SUPERADMIN deactivates ADMIN", off.status === 200, off.status);
check("deactivation ends the ADMIN's Auth sessions", off.json?.sessions_revoked === true);
check("deactivated ADMIN: members table (same token)", rows(await rest(admin.token, "subscribers?select=id")) === 0);
check("deactivated ADMIN: audit log", rows(await rest(admin.token, "audit_logs?select=id")) === 0);
check("deactivated ADMIN: seat list RPC", (await rpc(admin.token, "list_match_participants", { p_match_id: U })).status >= 400);
check("deactivated ADMIN: own profile still readable (UI can sign out)", rows(await rest(admin.token, `profiles?select=is_active&id=eq.${admin.id}`)) === 1);
const refreshed = await signIn(admin.email, P(`admin-${run}-2`));
check("deactivated ADMIN can still obtain a token (no Auth ban) but it grants nothing", Boolean(refreshed) && rows(await rest(refreshed, "subscribers?select=id")) === 0, refreshed ? "token issued" : "no token");
const on = await edge(sa.token, "admin-update-admin", { user_id: admin.id, is_active: true });
check("reactivation restores access immediately (same token)", on.status === 200 && rows(await rest(admin.token, "subscribers?select=id")) > 0);
await service("PATCH", `/rest/v1/profiles?id=eq.${sa2.id}`, { is_active: false });
check("deactivated SUPERADMIN: Edge Function refused", (await edge(sa2.token, "admin-import-users", { rows: [csvRow(11)] })).status === 403);
check("deactivated SUPERADMIN: storage write refused", (await http("POST", "/storage/v1/object/match-logos/x.png", { token: sa2.token, body: png, raw: true, headers: { "Content-Type": "image/png" } })).status >= 400);
check("deactivated SUPERADMIN: event creation refused", (await rest(sa2.token, "events", { method: "POST", body: { title: "X", amount: 1 } })).status >= 400);
await service("PATCH", `/rest/v1/profiles?id=eq.${sa2.id}`, { must_change_password: true, is_active: true });
check("SUPERADMIN with pending password change: Edge Function refused", (await edge(sa2.token, "admin-import-users", { rows: [csvRow(11)] })).status === 403);

begin("Role removed mid-session");
await service("DELETE", `/rest/v1/user_roles?user_id=eq.${admin.id}`);
check("members table refused after role removal", rows(await rest(admin.token, "subscribers?select=id")) === 0);
await service("POST", "/rest/v1/user_roles", { user_id: admin.id, role: "ADMIN" });
check("access back after role restored", rows(await rest(admin.token, "subscribers?select=id")) > 0);

begin("Staff account functions");
const newAdmin = await edge(sa.token, "admin-create-admin", { email: `admin3-${run}@staging.invalid`, display_name: "Staging Admin 3", password: P(`a3-${run}`), roles: ["ADMIN"] });
check("admin-create-admin", newAdmin.status === 200, newAdmin.status);
const a3 = (await service("GET", `/rest/v1/profiles?select=id,must_change_password&display_name=eq.Staging%20Admin%203`)).json?.[0];
check("new admin must change password at first login", a3?.must_change_password === true);
check("admin-update-admin rename", (await edge(sa.token, "admin-update-admin", { user_id: a3?.id, display_name: "Staging Admin 3b" })).status === 200);
check("admin-delete-admin refuses own account", (await edge(sa.token, "admin-delete-admin", { user_id: sa.id })).status >= 400);
const delSa = await edge(sa.token, "admin-delete-admin", { user_id: sa2.id });
check("admin-delete-admin refuses another SUPERADMIN", delSa.status === 403 && delSa.json?.code === "protected_account", delSa.status);
for (const body of [{ method: "link" }, { generate: true }, { new_password: P(`sa2-${run}-x`) }]) {
  const r = await edge(sa.token, "admin-reset-password", { user_id: sa2.id, ...body });
  check(`reset of another SUPERADMIN refused (${Object.keys(body)[0]})`, r.status === 403 && r.json?.code === "protected_account" && !r.json?.temporary_password && !r.json?.activation_link, r.status);
}
check("SUPERADMIN still exists after refused delete", (await service("GET", `/auth/v1/admin/users/${sa2.id}`)).status === 200);
check("admin-delete-admin", (await edge(sa.token, "admin-delete-admin", { user_id: a3?.id })).status === 200);

begin("Create member + deletion");
const created = await edge(sa.token, "admin-create-user", { nom: "STAGING", prenom: "CREATED", login_name: ID(20), cin: `C${run}`.slice(0, 20), gender: "FEMALE", faculty_id: null, zone_id: null });
check("admin-create-user returns an activation link once", created.status === 200 && created.json.activated === true && Boolean(created.json.activation_link) && !created.json.temporary_password, created.status);
check("admin-create-user never uses the CIN as password", (await signIn(`${ID(20).toLowerCase()}@login.ueclubiste.local`, `C${run}`.slice(0, 20))) === null);
const del1 = await edge(sa.token, "admin-delete-user", { subscriber_id: m3.id });
check("delete never-activated member (record removed)", del1.status === 200 && rows(await service("GET", `/rest/v1/subscribers?select=id&id=eq.${m3.id}`)) === 0);
const del2 = await edge(sa.token, "admin-delete-user", { subscriber_id: created.json.subscriber_id });
check("delete activated member removes record and account", del2.status === 200 && del2.json.account_deleted === true && rows(await service("GET", `/rest/v1/subscribers?select=id&id=eq.${created.json.subscriber_id}`)) === 0);
const del3 = await edge(sa.token, "admin-delete-user", { subscriber_id: treasurerSubId });
check("member deletion refuses a staff account", del3.status === 409 && del3.json.code === "staff_account");
check("staff account still exists", (await service("GET", `/auth/v1/admin/users/${treasurer.id}`)).status === 200);

begin("Edge Function input handling");
check("malformed JSON → 400, no crash", (await http("POST", "/functions/v1/admin-import-users", { token: sa.token, body: "{not json", raw: true, headers: { "Content-Type": "application/json", Origin: SITE } })).status === 400);
check("GET not allowed", (await http("GET", "/functions/v1/admin-import-users", { token: sa.token })).status === 405);
for (const fn of ["admin-create-admin", "admin-update-admin", "admin-delete-admin", "admin-reset-password"]) {
  const r = await http("POST", `/functions/v1/${fn}`, { token: sa.token, body: "{not json", raw: true, headers: { "Content-Type": "application/json", Origin: SITE } });
  check(`${fn}: malformed JSON → 400 with a fixed message`, r.status === 400 && r.json?.code === "invalid_body" && !/JSON|Unexpected token/i.test(r.json?.error || ""), r.status);
}
check("admin-delete-user: non-UUID id → 400", (await edge(sa.token, "admin-delete-user", { subscriber_id: "x' or 1=1" })).status === 400);
check("CORS: Vary: Origin on a refused origin", /origin/i.test((await edge(sa.token, "admin-import-users", { rows: [] }, { Origin: "https://evil.example" })).headers.get("vary") || ""));
check("CORS: foreign origin not allowed", !(await edge(sa.token, "admin-import-users", { rows: [] }, { Origin: "https://evil.example" })).headers.get("access-control-allow-origin"));
check("forged JWT rejected at gateway", (await edge(`${sa.token.slice(0, -4)}AAAA`, "admin-import-users", { rows: [] })).status === 401);

begin("Audit");
const audit = (await service("GET", "/rest/v1/audit_logs?select=new_data,old_data&order=id.desc&limit=200")).json || [];
const auditText = JSON.stringify(audit);
check("audit rows written", audit.length > 0, audit.length);
check("audit holds no CIN, contact data, password or link", !new RegExp(`T${run}|C${run}|example\\.invalid|\\+216|access_token|verify\\?token|Synthetic-Pass`).test(auditText));

// ---------------------------------------------------------------- summary
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length} checks, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
