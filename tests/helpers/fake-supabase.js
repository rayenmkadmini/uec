// Minimal in-memory stand-in for the parts of supabase-js used by
// supabase/functions/_shared/member-lifecycle.mjs (service-role client).
// Emulates: unique constraints, handle_new_user (profile + MEMBER role on
// account creation), cascade on user deletion, and injectable failures.
// Test data is synthetic only.
let counter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

const UNIQUE = { subscribers: ["login_name", "numero_abonnement", "user_id"], faculties: ["name"], zones: ["name"] };

function createFake({ tables = {}, failures = {} } = {}) {
  const db = { subscribers: [], profiles: [], user_roles: [], faculties: [], zones: [], ...structuredClone(tables) };
  const users = [];
  const calls = [];
  const shouldFail = (key, payload) => typeof failures[key] === "function" ? failures[key](payload) : Boolean(failures[key]);

  function query(table) {
    const filters = [];
    let op = "select";
    let payload = null;
    let returning = false;
    let mode = "many";
    let limit = null;

    const rows = () => (db[table] ||= []).filter(row => filters.every(f => f(row)));
    const builder = {
      select() { if (op !== "select") returning = true; return builder; },
      insert(value) { op = "insert"; payload = value; return builder; },
      update(value) { op = "update"; payload = value; return builder; },
      upsert(value) { op = "upsert"; payload = value; return builder; },
      delete() { op = "delete"; return builder; },
      eq(column, value) { filters.push(row => row[column] === value); return builder; },
      is(column, value) { filters.push(row => (row[column] ?? null) === value); return builder; },
      in(column, values) { filters.push(row => values.includes(row[column])); return builder; },
      limit(n) { limit = n; return builder; },
      single() { mode = "single"; return builder; },
      maybeSingle() { mode = "maybe"; return builder; },
      then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); }
    };

    function shape(data) {
      if (mode === "single") return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: "not single" } };
      if (mode === "maybe") return { data: data[0] || null, error: null };
      return { data, error: null };
    }

    function run() {
      calls.push({ table, op, payload });
      if (shouldFail(`${op}:${table}`, payload)) return { data: null, error: { message: `injected ${op} failure` } };
      if (op === "select") {
        const data = rows();
        return shape(limit == null ? data : data.slice(0, limit));
      }
      if (op === "insert" || op === "upsert") {
        const list = Array.isArray(payload) ? payload : [payload];
        const out = [];
        for (const value of list) {
          if (op === "upsert" && table === "user_roles" && db.user_roles.some(r => r.user_id === value.user_id && r.role === value.role)) continue;
          const row = { id: value.id || uuid(), ...value };
          for (const column of UNIQUE[table] || []) {
            if (row[column] != null && db[table].some(r => r[column] === row[column])) {
              return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint "${table}_${column}_key"` } };
            }
          }
          db[table].push(row);
          out.push(row);
        }
        return returning ? shape(out) : { data: null, error: null };
      }
      if (op === "update") {
        const matched = rows();
        for (const row of matched) Object.assign(row, payload);
        return returning ? shape(matched) : { data: null, error: null };
      }
      if (op === "delete") {
        const matched = new Set(rows());
        db[table] = db[table].filter(row => !matched.has(row));
        return { data: null, error: null };
      }
      throw new Error(`unsupported op ${op}`);
    }
    return builder;
  }

  const auth = {
    async createUser({ email, password, user_metadata }) {
      calls.push({ auth: "createUser", email });
      if (shouldFail("createUser", { email })) return { data: { user: null }, error: { message: "injected createUser failure" } };
      if (users.some(u => u.email === email)) return { data: { user: null }, error: { code: "email_exists", message: "A user with this email address has already been registered" } };
      const user = { id: uuid(), email, password, user_metadata };
      users.push(user);
      // handle_new_user trigger
      db.profiles.push({ id: user.id, display_name: user_metadata?.display_name || null, must_change_password: true, is_active: true });
      db.user_roles.push({ user_id: user.id, role: "MEMBER" });
      return { data: { user }, error: null };
    },
    async deleteUser(id) {
      calls.push({ auth: "deleteUser", id });
      const index = users.findIndex(u => u.id === id);
      if (index >= 0) users.splice(index, 1);
      db.profiles = db.profiles.filter(p => p.id !== id);
      db.user_roles = db.user_roles.filter(r => r.user_id !== id);
      return { data: {}, error: null };
    },
    async generateLink({ type, email, options }) {
      calls.push({ auth: "generateLink", type, email, redirectTo: options?.redirectTo });
      if (shouldFail("generateLink", { email })) return { data: null, error: { message: "injected generateLink failure" } };
      if (!users.some(u => u.email === email)) return { data: null, error: { message: "User not found" } };
      return { data: { properties: { action_link: `https://example.invalid/auth/v1/verify?token=synthetic-${uuid()}&type=${type}` } }, error: null };
    },
    async updateUserById(id, { password }) {
      calls.push({ auth: "updateUserById", id });
      const user = users.find(u => u.id === id);
      if (!user || shouldFail("updateUserById", { id })) return { data: null, error: { message: "update failed" } };
      user.password = password;
      return { data: { user }, error: null };
    },
    async getUserById(id) {
      const user = users.find(u => u.id === id);
      return user ? { data: { user: { id: user.id, email: user.email } }, error: null } : { data: { user: null }, error: { message: "User not found" } };
    }
  };

  return { db: { from: query }, auth, tables: db, users, calls };
}

module.exports = { createFake };
