// D3: browser queries must use the LIVE production column names. The column
// lists below come from the schema-only dump of qwlbbfyhjdeekmrxtzjf taken on
// 2026-10-15 (no data). Older SQL files in supabase/ (payments.sql,
// fix_existing_installation.sql) describe events.name / event_payments.paid,
// which do NOT exist in production.
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const LIVE = {
  events: ["id", "title", "description", "event_date", "location", "image_url", "amount", "capacity", "is_active", "created_at", "updated_at"],
  event_payments: ["id", "event_id", "subscriber_id", "amount", "status", "payment_method", "transaction_reference", "paid_at", "notes", "created_at", "updated_at"],
  card_payments: ["id", "subscriber_id", "amount", "status", "payment_method", "transaction_reference", "paid_at", "notes", "created_at", "updated_at"]
};
const PAYMENT_STATUS = ["PENDING", "PAID", "FAILED", "REFUNDED", "CANCELLED"];

const jsFiles = fs.readdirSync(path.join(root, "js")).filter(f => f.endsWith(".js"));
const source = file => fs.readFileSync(path.join(root, "js", file), "utf8");

// Every .from("<table>") call followed (within the same chain) by select / eq /
// order / insert / update / upsert.
function chains(table) {
  const out = [];
  for (const file of jsFiles) {
    const text = source(file);
    for (const match of text.matchAll(new RegExp(`from\\("${table}"\\)([\\s\\S]{0,600}?)(;|\\n\\s*\\n)`, "g"))) {
      out.push({ file, chain: match[1] });
    }
  }
  return out;
}

for (const table of Object.keys(LIVE)) {
  test(`${table}: every selected / filtered / ordered column exists in production`, () => {
    for (const { file, chain } of chains(table)) {
      for (const select of chain.matchAll(/\.select\("([^"]*)"/g)) {
        for (const column of select[1].split(",").map(c => c.trim()).filter(c => c && !c.includes("("))) {
          assert.ok(LIVE[table].includes(column), `${file}: ${table}.${column} does not exist`);
        }
      }
      for (const filter of chain.matchAll(/\.(eq|neq|order|gte|lte|is|in)\("([^"]+)"/g)) {
        assert.ok(LIVE[table].includes(filter[2]), `${file}: ${table}.${filter[2]} does not exist`);
      }
    }
  });
}

test("events use title (not name); event payments use status (not paid)", () => {
  const payments = source("admin-payments.js");
  assert.doesNotMatch(payments, /\bevent\??\.name\b/);
  assert.doesNotMatch(payments, /\bpayment\??\.paid\b(?!_)/);
  assert.doesNotMatch(payments, /\.eq\("paid"/);
  assert.doesNotMatch(payments, /\bname:\s*name\b/);
  for (const value of payments.matchAll(/status === "([A-Z]+)"|\.eq\("status", "([A-Z]+)"\)/g)) {
    const status = value[1] || value[2];
    if (["ACTIVE", "INACTIVE", "SUSPENDED"].includes(status)) continue; // member status, not payment
    assert.ok(PAYMENT_STATUS.includes(status), status);
  }
});

test("event payment status changes go through the RPC (amount is set server-side)", () => {
  const payments = source("admin-payments.js");
  assert.match(payments, /rpc\("set_event_payment_status"/);
  for (const { chain } of chains("event_payments")) assert.doesNotMatch(chain, /\.(insert|update|upsert)\(/);
});
