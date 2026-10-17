// D3: browser queries must use the LIVE production column names. The column
// lists below come from the schema-only dump of qwlbbfyhjdeekmrxtzjf taken on
// 2026-10-15 (no data). The archived scripts in
// supabase/obsolete_migrations/legacy_scripts/ describe events.name /
// event_payments.paid, which do NOT exist in production.
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const LIVE = {
  events: ["id", "title", "description", "event_date", "location", "image_url", "amount", "capacity", "is_active", "created_at", "updated_at",
    // added by 20261018120000_smart_collections
    "target_amount", "suggested_amount", "start_date", "deadline", "collection_status", "organizer", "category"],
  collection_contributions: ["id", "event_id", "subscriber_id", "amount", "paid_on", "method", "reference", "notes", "status", "cancelled_at", "cancel_reason", "source", "request_id", "recorded_by", "created_at", "updated_at"],
  collection_member_targets: ["event_id", "subscriber_id", "target_amount", "updated_at"],
  event_payments: ["id", "event_id", "subscriber_id", "amount", "status", "payment_method", "transaction_reference", "paid_at", "notes", "created_at", "updated_at"],
  card_payments: ["id", "subscriber_id", "amount", "status", "payment_method", "transaction_reference", "paid_at", "notes", "created_at", "updated_at"]
};
const PAYMENT_STATUS = ["PENDING", "PAID", "FAILED", "REFUNDED", "CANCELLED"];
// events.collection_status, collection_contributions.status and the per-member summary
// computed in js/collections-core.js (20261018120000_smart_collections).
const COLLECTION_STATUS = ["DRAFT", "ACTIVE", "COMPLETED", "CANCELLED", "VALID", "NOT_PAID", "PARTIAL", "TARGET_REACHED", "CONTRIBUTED"];

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
    if (COLLECTION_STATUS.includes(status)) continue; // collection / contribution / member-summary status
    assert.ok(PAYMENT_STATUS.includes(status), status);
  }
});

test("event payments are never written by the browser; contributions go through RPCs", () => {
  const payments = source("admin-payments.js");
  assert.match(payments, /rpc\("record_collection_contribution"/);
  for (const table of ["event_payments", "collection_contributions", "collection_member_targets"]) {
    for (const { chain } of chains(table)) assert.doesNotMatch(chain, /\.(insert|update|upsert|delete)\(/, table);
  }
});

test("no runnable SQL script outside migrations defines events.name or event_payments.paid", () => {
  const dir = path.join(root, "supabase");
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".sql"))) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    assert.doesNotMatch(sql, /create table[^;]*public\.events\s*\([^;]*\bname text\b/i, file);
    assert.doesNotMatch(sql, /\bpaid boolean\b/i, file);
  }
  assert.ok(fs.existsSync(path.join(dir, "obsolete_migrations", "legacy_scripts", "README.md")));
});
