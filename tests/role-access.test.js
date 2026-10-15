const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const PERMS = require("../js/permissions.js");

function loadCommonHelpers({ roles = [], profile = {} } = {}) {
  const doc = {
    body: { appendChild() {}, insertBefore() {} },
    documentElement: { getAttribute: () => "", setAttribute() {}, style: {} },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ setAttribute() {}, addEventListener() {}, style: {}, textContent: "" }),
    addEventListener() {}
  };

  let signedOut = false;
  const sb = {
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      signOut: async () => { signedOut = true; }
    },
    from: table => ({
      select: () => ({
        eq: field => {
          if (table === "user_roles") return Promise.resolve({ data: roles.map(role => ({ role })), error: null });
          return {
            maybeSingle: async () => ({ data: { display_name: "Test", must_change_password: false, is_active: true, ...profile }, error: null })
          };
        }
      })
    })
  };

  const location = { href: "index.html", pathname: "/index.html" };
  const window = {
    Swal: null,
    document: doc,
    localStorage: { getItem: () => null, setItem: () => null },
    matchMedia: () => ({ matches: false }),
    dispatchEvent: () => null,
    addEventListener: () => null,
    location,
    sb
  };

  const context = {
    console: { warn() {}, error() {}, log() {} },
    URL,
    URLSearchParams,
    CustomEvent: function CustomEvent(type, init = {}) { return { type, detail: init.detail || {} }; },
    window,
    document: doc,
    localStorage: window.localStorage,
    location,
    sb,
    wasSignedOut: () => signedOut
  };

  vm.createContext(context);
  vm.runInContext(read("js/permissions.js"), context);
  vm.runInContext(read("js/common.js"), context);
  return context;
}

function goTo(context, page) {
  context.location.pathname = `/${page}`;
  context.location.href = page;
}

/* ------------------------------------------------------------------ */
/* Permission matrix                                                   */
/* ------------------------------------------------------------------ */

const EXPECTED = {
  SUPERADMIN: Object.keys(PERMS.PERMISSIONS).filter(p => !["useMemberArea", "editOwnProfile", "chooseOwnSeat"].includes(p)),
  ADMIN: ["viewDashboard", "viewMembers", "viewMemberDetails", "viewEvents", "viewFinancialReports", "viewMatches", "viewUsers", "viewReferences", "viewStaffProfile"],
  TREASURER: ["viewMembers", "manageCardPayments", "viewEvents", "manageEventPaymentStatuses", "viewFinancialReports", "viewStaffProfile"],
  MEMBER: ["useMemberArea", "editOwnProfile", "chooseOwnSeat"]
};

for (const [role, allowed] of Object.entries(EXPECTED)) {
  test(`${role} has exactly the expected permissions`, () => {
    const actual = Object.keys(PERMS.PERMISSIONS).filter(permission => PERMS.can({ roles: [role] }, permission));
    assert.deepEqual(actual.sort(), [...allowed].sort());
  });
}

test("ADMIN / SUPERVISOR has no write permission at all", () => {
  const writes = Object.keys(PERMS.PERMISSIONS).filter(p => /^(manage|edit|choose)/.test(p));
  for (const permission of writes) assert.equal(PERMS.can({ roles: ["ADMIN"] }, permission), false, permission);
  assert.equal(PERMS.isReadOnlyStaff({ roles: ["ADMIN"] }), true);
});

test("TREASURER cannot create/edit events, collections, members, users or settings", () => {
  for (const permission of ["manageEvents", "manageCollections", "manageMembers", "manageUsers", "manageSettings", "manageMatches", "manageClubLogos", "viewDashboard"]) {
    assert.equal(PERMS.can({ roles: ["TREASURER"] }, permission), false, permission);
  }
});

test("MEMBER cannot reach any administrative page", () => {
  for (const page of ["dashboard.html", "subscribers.html", "payments.html", "admin-matchs.html", "admin-users.html", "faculties.html", "zones.html", "profile.html"]) {
    assert.equal(PERMS.canAccessPage({ roles: ["MEMBER"] }, page), false, page);
  }
  assert.equal(PERMS.canAccessPage({ roles: ["MEMBER"] }, "subscriber.html"), true);
  assert.equal(PERMS.canAccessPage({ roles: ["MEMBER"] }, "matchs.html"), true);
});

test("unknown role strings never grant privileges; legacy names are mapped safely", () => {
  assert.deepEqual(PERMS.normalizeRoles(["OWNER", "root", "", null, "admin ", "SUBSCRIBER", "supervisor"]), ["ADMIN", "MEMBER"]);
  assert.equal(PERMS.can({ roles: ["OWNER"] }, "viewMembers"), false);
  assert.equal(PERMS.can({ roles: ["SUPERADMIN "] }, "manageUsers"), true);
  assert.equal(PERMS.homePage({ roles: ["GOD"] }), null);
});

test("home page per role, and every home page is accessible to its role (no redirect loop)", () => {
  const cases = [
    [["SUPERADMIN"], "dashboard.html"],
    [["ADMIN"], "dashboard.html"],
    [["TREASURER"], "payments.html"],
    [["MEMBER"], "subscriber.html"],
    [["SUPERADMIN", "ADMIN", "TREASURER", "MEMBER"], "dashboard.html"],
    [["TREASURER", "MEMBER"], "payments.html"],
    [["ADMIN", "TREASURER"], "dashboard.html"]
  ];
  for (const [roles, home] of cases) {
    assert.equal(PERMS.homePage({ roles }), home, roles.join("+"));
    assert.equal(PERMS.canAccessPage({ roles }, home), true, roles.join("+"));
  }
});

test("combined ADMIN + TREASURER keeps payment-status rights but gains no management rights", () => {
  const ctx = { roles: ["ADMIN", "TREASURER"] };
  assert.equal(PERMS.can(ctx, "manageEventPaymentStatuses"), true);
  assert.equal(PERMS.can(ctx, "manageCardPayments"), true);
  assert.equal(PERMS.can(ctx, "manageEvents"), false);
  assert.equal(PERMS.can(ctx, "manageMembers"), false);
  assert.equal(PERMS.isReadOnlyStaff(ctx), false);
});

/* ------------------------------------------------------------------ */
/* Route guard                                                         */
/* ------------------------------------------------------------------ */

test("requirePermission redirects each role away from forbidden pages to its own home", async () => {
  const cases = [
    { roles: ["MEMBER"], page: "dashboard.html", permission: "viewDashboard", expected: "subscriber.html" },
    { roles: ["TREASURER"], page: "dashboard.html", permission: "viewDashboard", expected: "payments.html" },
    { roles: ["TREASURER"], page: "admin-users.html", permission: "viewUsers", expected: "payments.html" },
    { roles: ["ADMIN"], page: "subscriber.html", permission: "useMemberArea", expected: "dashboard.html" }
  ];
  for (const { roles, page, permission, expected } of cases) {
    const context = loadCommonHelpers({ roles });
    goTo(context, page);
    const ctx = await context.requirePermission(permission);
    assert.equal(ctx, null);
    assert.equal(context.location.href, expected, `${roles} on ${page}`);
  }
});

test("requirePermission admits authorized roles", async () => {
  for (const [roles, page, permission] of [
    [["ADMIN"], "subscribers.html", "viewMembers"],
    [["TREASURER"], "payments.html", "viewEvents"],
    [["SUPERADMIN"], "admin-users.html", "viewUsers"],
    [["MEMBER"], "matchs.html", "chooseOwnSeat"]
  ]) {
    const context = loadCommonHelpers({ roles });
    goTo(context, page);
    const ctx = await context.requirePermission(permission);
    assert.ok(ctx, `${roles} on ${page}`);
    assert.equal(context.location.href, page);
  }
});

test("a user with no valid role is signed out", async () => {
  const context = loadCommonHelpers({ roles: [] });
  goTo(context, "dashboard.html");
  assert.equal(await context.requirePermission("viewDashboard"), null);
  assert.equal(context.location.href, "index.html");
  assert.equal(context.wasSignedOut(), true);
});

test("first-login users are forced to change their password", async () => {
  const context = loadCommonHelpers({ roles: ["SUPERADMIN"], profile: { must_change_password: true } });
  goTo(context, "dashboard.html");
  assert.equal(await context.requirePermission("viewDashboard"), null);
  assert.equal(context.location.href, "change-password.html");
});

test("roles fail closed when user_roles cannot be read", async () => {
  const context = loadCommonHelpers();
  context.sb.from = () => ({ select: () => ({ eq: async () => ({ data: null, error: new Error("unavailable") }) }) });
  assert.equal((await context.fetchUserRolesForUser("user-1")).length, 0);
});

test("writeError treats an RLS-filtered write (0 rows) as a refusal", () => {
  const context = loadCommonHelpers();
  assert.match(context.writeError({ data: [], error: null }), /autorisation/);
  assert.equal(context.writeError({ data: [{ id: 1 }], error: null }), null);
  assert.equal(context.writeError({ data: null, error: { message: "boom" } }), "boom");
});

/* ------------------------------------------------------------------ */
/* Club logos                                                          */
/* ------------------------------------------------------------------ */

test("team logo prefers the match logo, then the club logo, then generated initials", () => {
  const context = loadCommonHelpers();
  context.window.location.href = "https://login.ueclubistes.tn/matchs.html";
  const clubs = new Map([["club africain", "https://cdn.example.org/ca.png"]]);
  assert.match(context.teamLogoImg("Club Africain", "HOME", "https://cdn.example.org/match.png", clubs), /src="https:\/\/cdn\.example\.org\/match\.png"/);
  assert.match(context.teamLogoImg("  CLUB AFRICAIN ", "HOME", null, clubs), /src="https:\/\/cdn\.example\.org\/ca\.png"/);
  assert.match(context.teamLogoImg("CS Sfaxien", "AWAY", null, clubs), /src="data:image\/svg\+xml/);
  assert.match(context.teamLogoImg("CS Sfaxien", "AWAY", null, clubs), /onerror=/);
});

test("unsafe custom team logo URLs fall back to a generated logo", () => {
  const context = loadCommonHelpers();
  const logo = context.getTeamLogo("Home", "HOME", "javascript:alert(1)");
  assert.match(logo, /^data:image\/svg\+xml/);
  assert.doesNotMatch(logo, /javascript:/i);
  assert.doesNotMatch(context.teamLogoImg("X", "HOME", "javascript:alert(1)", new Map()), /javascript:/i);
});

/* ------------------------------------------------------------------ */
/* Static wiring checks                                                */
/* ------------------------------------------------------------------ */

const PAGE_SCRIPTS = {
  "dashboard.html": "js/admin.js",
  "subscribers.html": "js/subscribers.js",
  "payments.html": "js/admin-payments.js",
  "admin-matchs.html": "js/admin-matchs.js",
  "admin-users.html": "js/admin-users.js",
  "faculties.html": "js/reference.js",
  "zones.html": "js/reference.js",
  "profile.html": "js/profile.js",
  "subscriber.html": "js/subscriber.js",
  "matchs.html": "js/matchs.js"
};

test("every protected page loads permissions.js before common.js and guards with its page permission", () => {
  for (const [page, script] of Object.entries(PAGE_SCRIPTS)) {
    const html = read(page);
    const permIndex = html.indexOf("js/permissions.js");
    assert.ok(permIndex > -1 && permIndex < html.indexOf("js/common.js"), `${page} script order`);
    assert.ok(html.includes(script), `${page} loads ${script}`);
    const permission = PERMS.PAGE_PERMISSIONS[page];
    assert.ok(read(script).includes(`requirePermission("${permission}")`), `${script} guards with ${permission}`);
  }
});

test("no page uses the removed ad-hoc role guards", () => {
  for (const file of fs.readdirSync(path.join(root, "js"))) {
    const source = read(`js/${file}`);
    assert.doesNotMatch(source, /\brequire(Admin|Staff|Subscriber|Treasurer|SuperAdmin)\(/, file);
  }
});

test("collectes module uses the live schema and the payment-status RPC", () => {
  const source = read("js/admin-payments.js");
  assert.match(source, /select\("id,title,description,amount,event_date,is_active"\)/);
  assert.match(source, /\.eq\("status", "PAID"\)/);
  assert.match(source, /rpc\("set_event_payment_status"/);
  assert.doesNotMatch(source, /from\("event_payments"\)\s*\.upsert/);
  assert.doesNotMatch(source, /class="payment-row"/, "rows must be <tr> inside the table body");
});

test("card payment status goes through the narrow RPC", () => {
  const source = read("js/subscribers.js");
  assert.match(source, /rpc\("set_card_payment_status"/);
  assert.doesNotMatch(source, /update\(\{ card_paid/);
});

test("member profile updates only whitelisted fields", () => {
  const source = read("js/subscriber.js");
  const update = source.match(/\.update\(\{([^}]*)\}\)/)[1];
  const keys = [...update.matchAll(/(\w+):/g)].map(match => match[1]).sort();
  assert.deepEqual(keys, ["adresse", "email", "phone", "photo_url"]);
});

test("browser config never contains a service-role or secret key", () => {
  const config = read("js/config.js");
  assert.doesNotMatch(config, /service_role|sb_secret_|eyJhbGciOi[^"]*InNlcnZpY2Vfcm9sZSI/);
});

test("TREASURER never receives member personal data in the UI", () => {
  assert.equal(PERMS.can({ roles: ["TREASURER"] }, "viewMemberDetails"), false);
  assert.equal(PERMS.can({ roles: ["ADMIN"] }, "viewMemberDetails"), true);
  const members = read("js/subscribers.js");
  assert.match(members, /canViewDetails\s*\?\s*sb\.from\("subscribers"\)\.select\(MEMBER_COLUMNS\)/);
  assert.match(members, /:\s*sb\.rpc\("list_payment_members"\)/);
  assert.match(members, /\$\$\("\.col-private"\)\.forEach\(th => th\.remove\(\)\)/);
  const payments = read("js/admin-payments.js");
  assert.match(payments, /rpc\("list_payment_members"\)/);
  assert.doesNotMatch(payments, /from\("subscribers"\)/, "payments page must not read the members table");
  for (const header of ["Photo", "Sexe", "CIN", "Zone"]) {
    assert.match(read("subscribers.html"), new RegExp(`<th class="col-private[^"]*">${header}</th>`));
  }
});

test("only SUPERADMIN sees protected identity fields (CIN, address) in the UI", () => {
  for (const role of ["ADMIN", "TREASURER", "MEMBER"]) {
    assert.equal(PERMS.can({ roles: [role] }, "viewMemberIdentity"), false, role);
  }
  assert.equal(PERMS.can({ roles: ["SUPERADMIN"] }, "viewMemberIdentity"), true);
  assert.equal(PERMS.can({ roles: ["ADMIN", "TREASURER", "MEMBER"] }, "viewMemberIdentity"), false);

  const members = read("js/subscribers.js");
  assert.match(members, /canViewIdentity \? sb\.rpc\("get_member_private_fields"\)/);
  assert.match(members, /\$\$\("\.col-identity"\)\.forEach\(th => th\.remove\(\)\)/);
  assert.match(read("subscribers.html"), /<th class="col-private col-identity">CIN<\/th>/);
  // Every CIN / address cell in the staff list and member card is gated by canViewIdentity.
  const cells = [...members.matchAll(/\$\{escapeHtml\((s|user)\.(cin|adresse)\b/g)];
  assert.ok(cells.length >= 3, "expected the CIN / address cells to be found");
  for (const match of cells) {
    const before = members.slice(Math.max(0, match.index - 120), match.index);
    assert.match(before, /canViewIdentity \?/, `${match[0]} must be inside a canViewIdentity branch`);
  }
});

test("no page selects protected member columns or * from the members table", () => {
  const PROTECTED = /\b(cin|adresse|date_naissance|notes|phone|email|ip_address|transaction_reference)\b/;
  for (const file of fs.readdirSync(path.join(root, "js")).filter(f => f.endsWith(".js"))) {
    const source = read(`js/${file}`);
    for (const match of source.matchAll(/from\("(subscribers|v_member_cards|profiles|audit_logs|event_payments|card_payments)"\)[\s\S]{0,120}?\.select\(([^)]*)\)/g)) {
      const columns = match[2].trim();
      assert.doesNotMatch(columns, /"\*|\*"/, `${file}: select("*") on ${match[1]} is refused by the database`);
      if (columns.startsWith('"')) assert.doesNotMatch(columns, PROTECTED, `${file}: protected column in ${columns}`);
    }
  }
  for (const constant of ["MEMBER_COLUMNS", "OWN_MEMBER_COLUMNS"]) {
    for (const file of ["js/subscribers.js", "js/subscriber.js"]) {
      const match = read(file).match(new RegExp(`const ${constant} = ([^;]+);`));
      if (match) assert.doesNotMatch(match[1], PROTECTED, `${file}: ${constant}`);
    }
  }
  assert.doesNotMatch(read("js/subscriber.js"), /from\("subscribers"\)\.select\("\*/);
});

test("own payment rows are locked for a treasurer in the UI (database enforces it too)", () => {
  assert.match(read("js/subscribers.js"), /return canMarkCard && \(!s\.is_self \|\| canManageMembers\);/);
  assert.match(read("js/admin-payments.js"), /subscriber\.is_self && !canManageEvents/);
});

test("account emails are shown to SUPERADMIN only and loaded through the checked RPC", () => {
  const users = read("js/admin-users.js");
  assert.match(users, /if \(canManageAdmins\) \{\s*const \{ data: contacts, error: contactError \} = await sb\.rpc\("get_account_contacts"\)/);
  assert.match(users, /<td>\$\{superAdmin \? escapeHtml\(a\.email \|\| "—"\) : '<span class="muted-text">Masqué<\/span>'\}<\/td>/);
  // Own id is required: for a SUPERADMIN the RPC without an id returns every account.
  assert.match(read("js/profile.js"), /sb\.rpc\("get_account_contacts", \{ p_user_id: profileCtx\.user\.id \}\)/);
  const members = read("js/subscribers.js");
  const contactCells = [...members.matchAll(/\$\{escapeHtml\(user\.(phone|email)/g)];
  assert.equal(contactCells.length, 2);
  for (const match of contactCells) {
    assert.match(members.slice(Math.max(0, match.index - 220), match.index), /canViewIdentity \?/);
  }
});

test("members without an account are activated per member; no bulk secrets in the page", () => {
  const members = read("js/subscribers.js");
  assert.match(members, /s\.user_id\s*\?\s*`<button[^`]*resetPassword\('\$\{s\.user_id\}'\)/);
  assert.match(members, /:\s*`<button[^`]*activateMember\('\$\{s\.id\}'\)/);
  assert.match(members, /issueAccess\("admin-activate-member", \{ subscriber_id: subscriberId \}/);
  assert.match(members, /callAdminFunction\(functionName, \{ \.\.\.payload, method: "link" \}\)/, "links are tried first");
  assert.doesNotMatch(members, /localStorage|sessionStorage|indexedDB|download|Blob\(/, "secrets are never stored or exported");
  const importFn = members.slice(members.indexOf("async function importMembersCsv"), members.indexOf("async function init()"));
  assert.doesNotMatch(importFn, /temporary_password|activation_link/, "the import never handles secrets");
});

test("expired or invalid activation links are explained on the password page", () => {
  const context = loadCommonHelpers();
  const at = (hash, search = "") => context.authLinkError({ hash, search });
  assert.equal(at(""), null);
  assert.equal(at("#access_token=x&type=recovery"), null);
  assert.match(at("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid"), /expiré ou a déjà été utilisé/);
  assert.match(at("", "?error=server_error"), /n’est pas valide/);
  assert.doesNotMatch(at("#error=x&error_description=<script>"), /script/, "URL text is never echoed");
  assert.match(read("js/change-password.js"), /const linkError=authLinkError\(\);[\s\S]*history\.replaceState/);
});

test("member photos and gender are SUPERADMIN-only in the staff UI; seat pages use RPCs", () => {
  const html = read("subscribers.html");
  for (const header of ["Photo", "Sexe", "CIN"]) assert.match(html, new RegExp(`<th class="col-private col-identity">${header}</th>`), header);
  const members = read("js/subscribers.js");
  assert.match(members, /const photoEntries = canViewIdentity/);
  assert.match(members, /\$\{canViewIdentity \? `<td>\$\{genderLabel\(s\.gender\)\}<\/td>` : ""\}/);
  assert.match(members, /const gender = \$\("#genderFilter"\)\?\.value \|\| "";/, "gender filter may be absent (ADMIN, TREASURER)");
  assert.doesNotMatch(read("js/subscribers.js").match(/const MEMBER_COLUMNS = ([^;]+);/)[1], /gender|photo_url/);
  assert.doesNotMatch(read("js/subscriber.js").match(/const OWN_MEMBER_COLUMNS = ([^;]+);/)[1], /gender|photo_url/);
  const seats = read("js/matchs.js");
  assert.match(seats, /\.select\("id,nom,prenom,status"\)/);
  assert.match(seats, /sb\.rpc\("get_member_private_fields", \{ p_subscriber_id: row\.data\.id \}\)/);
  const stats = read("js/admin-matchs.js");
  assert.match(stats, /sb\.rpc\("list_match_participants", \{ p_match_id: matchId \}\)/);
  assert.doesNotMatch(stats, /subscribers\([^)]*gender/);
});

test("expired-link details survive supabase-js URL handling and stay visible", () => {
  const config = read("js/config.js");
  assert.ok(config.indexOf("window.UE_AUTH_REDIRECT = { hash: location.hash, search: location.search };") < config.indexOf("createClient("),
    "the redirect snapshot must be taken before the client consumes the fragment");
  assert.match(read("js/common.js"), /function authLinkError\(loc = window\.UE_AUTH_REDIRECT \|\| location\)/);
  const page = read("change-password.html");
  assert.ok(page.indexOf('id="linkError"') >= 0 && page.indexOf('id="linkError"') < page.indexOf('<form id="changeForm"'), "outside the hidden form");
  assert.match(read("js/change-password.js"), /box\.textContent=linkError;box\.classList\.remove\("hidden"\)/);
});
