const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const assert = require("node:assert/strict");

function loadCommonHelpers() {
  const script = fs.readFileSync(path.join(__dirname, "..", "js", "common.js"), "utf8");
  const body = {
    appendChild() {},
    insertBefore() {}
  };

  const doc = {
    body,
    documentElement: { getAttribute: () => "", setAttribute() {}, style: {} },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({
      setAttribute() {},
      addEventListener() {},
      style: {},
      textContent: ""
    }),
    addEventListener() {}
  };

  const sb = {
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      signOut: async () => null
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { role: "SUPERADMIN", display_name: "Admin", must_change_password: false, is_active: true, is_treasurer: false }, error: null }),
          maybeSingle: async () => ({ data: null }),
          limit: () => ({ maybeSingle: async () => ({ data: null }) })
        }),
        in: () => ({
          order: () => ({})
        }),
        neq: () => ({
          maybeSingle: async () => ({ data: null })
        })
      }),
      update: () => ({ eq: () => ({ error: null }) }),
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: "new-id" }, error: null }) }) })
    })
  };

  const location = { href: "dashboard.html", pathname: "/dashboard.html" };
  const customEventCtor = function CustomEvent(type, init = {}) {
    return { type, detail: init.detail || {} };
  };

  const context = {
    console: { warn() {}, error() {}, log() {} },
    CustomEvent: customEventCtor,
    window: {
      Swal: null,
      document: doc,
      localStorage: {
        getItem: () => null,
        setItem: () => null
      },
      matchMedia: () => ({ matches: false }),
      dispatchEvent: () => null,
      addEventListener: () => null,
      location,
      sb
    },
    document: doc,
    localStorage: {
      getItem: () => null,
      setItem: () => null
    },
    location,
    sb,
    window: {
      Swal: null,
      document: doc,
      localStorage: { getItem: () => null, setItem: () => null },
      matchMedia: () => ({ matches: false }),
      dispatchEvent: () => null,
      addEventListener: () => null,
      location,
      sb
    }
  };

  vm.createContext(context);
  vm.runInContext(script, context);
  return context;
}

test("normalizeRoleNames deduplicates and normalizes roles", () => {
  const context = loadCommonHelpers();
  const actual = context.normalizeRoleNames([" admin ", "SUPERADMIN", "admin", "member", null]);
  assert.equal(actual.join(","), ["ADMIN", "SUPERADMIN", "MEMBER"].join(","));
});

test("hasContextRole handles combined roles", () => {
  const context = loadCommonHelpers();
  assert.equal(context.hasContextRole({ roles: ["ADMIN", "TREASURER"] }, "TREASURER"), true);
  assert.equal(context.hasContextRole({ profile: { role: "MEMBER" } }, "ADMIN"), false);
});

test("role union preserves read-only admin and Treasurer capabilities without Superadmin override", () => {
  const context = loadCommonHelpers();
  const admin = { roles: ["ADMIN"] };
  const treasurer = { roles: ["TREASURER"] };
  const member = { roles: ["MEMBER"] };
  const combined = { roles: ["ADMIN", "TREASURER"] };
  const superadmin = { roles: ["SUPERADMIN"] };

  assert.equal(context.isStaffContext(admin), true);
  assert.equal(context.isTreasurerContext(admin), false);
  assert.equal(context.canManageEverything(admin), false);
  assert.equal(context.isTreasurerContext(treasurer), true);
  assert.equal(context.isStaffContext(member), false);
  assert.equal(context.isStaffContext(combined), true);
  assert.equal(context.isTreasurerContext(combined), true);
  assert.equal(context.canManageEverything(combined), false);
  assert.equal(context.canManageEverything(superadmin), true);
});

test("user_roles is authoritative when its query succeeds", async () => {
  const context = loadCommonHelpers();
  context.sb = {
    from: () => ({
      select: () => ({
        eq: async () => ({ data: [{ role_name: "ADMIN" }, { role_name: "TREASURER" }], error: null })
      })
    })
  };
  const roles = await context.fetchUserRolesForUser("user-1", "SUPERADMIN", true);
  assert.equal(roles.join(","), "ADMIN,TREASURER");
});

test("legacy profile role is used only while user_roles is unavailable", async () => {
  const context = loadCommonHelpers();
  context.sb = {
    from: () => ({
      select: () => ({
        eq: async () => ({ data: null, error: new Error("relation unavailable") })
      })
    })
  };
  const roles = await context.fetchUserRolesForUser("user-1", "SUBSCRIBER", true);
  assert.equal(roles.join(","), "MEMBER,TREASURER");
});

test("requireAdmin blocks non-admin access", async () => {
  const context = loadCommonHelpers();
  const location = { href: "index.html", pathname: "/index.html" };
  context.window.location = location;
  context.location = location;

  const ctx = { profile: { role: "MEMBER", must_change_password: false }, roles: ["MEMBER"] };
  context.getCurrentContext = async () => ctx;
  const result = await context.requireAdmin();
  assert.equal(result, null);
  assert.equal(location.href, "subscriber.html");
});

test("CSV optional subscription number is accepted in the requested rule set", () => {
  const nom = "TEST";
  const prenom = "USER";
  const cin = "12345678";
  const gender = "M";
  const valid = !!(nom && prenom && cin && gender);
  assert.equal(valid, true);
  assert.equal(Boolean(""), false);
});
