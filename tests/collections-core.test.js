const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/collections-core.js");

const pay = (subscriber_id, amount, extra = {}) => ({ subscriber_id, amount, status: "VALID", method: "CASH", ...extra });

test("parses amounts to integer millimes without float drift", () => {
    assert.equal(C.toMillimes("0.1"), 100);
    assert.equal(C.toMillimes("12,5"), 12500);
    assert.equal(C.toMillimes(2.005), 2005);
    assert.equal(C.toMillimes("1.2345"), null);
    assert.equal(C.toMillimes("abc"), null);
    const total = Array(10).fill("0.1").reduce((s, a) => s + C.toMillimes(a), 0);
    assert.equal(total, 1000);
    assert.equal(C.millimesToDecimalString(12500), "12.500");
});

test("rejects negative, zero and invalid payments", () => {
    assert.equal(C.validateAmount("-5").ok, false);
    assert.equal(C.validateAmount("0").ok, false);
    assert.equal(C.validateAmount("").ok, false);
    assert.equal(C.validateAmount("5000000").ok, false);
    assert.deepEqual(C.validateAmount("2"), { ok: true, millimes: 2000 });
});

test("different members pay different amounts; target is never split", () => {
    const payments = [pay("A", "2"), pay("B", "5"), pay("C", "10"), pay("D", "50"), pay("E", "100")];
    const s = C.summarize({ target_amount: "2500" }, payments, 20);
    assert.equal(s.collected, 167000);
    assert.equal(s.remaining, 2333000);
    assert.equal(s.participants, 5);
    assert.equal(s.nonContributors, 15);
    assert.equal(s.largest, 100000);
    assert.equal(s.smallest, 2000);
    assert.equal(s.average, 33400);
    assert.ok(Math.abs(s.progress - 6.68) < 1e-9);
    // A member who paid 2 DT owes nothing: no personal target configured.
    const a = C.memberSummary("A", payments, null);
    assert.equal(a.status, "PAID");
    assert.equal(a.personalRemaining, null);
});

test("partial payments are summed per member", () => {
    const payments = [pay("A", "10"), pay("A", "15.250"), pay("B", "1")];
    const a = C.memberSummary("A", payments, "50");
    assert.equal(a.total, 25250);
    assert.equal(a.count, 2);
    assert.equal(a.status, "PARTIAL");
    assert.equal(a.personalRemaining, 24750);
    assert.equal(C.memberSummary("A", [...payments, pay("A", "30")], "50").status, "TARGET_REACHED");
    assert.equal(C.memberSummary("Z", payments, null).status, "NOT_PAID");
});

test("cancelled payments are excluded from totals", () => {
    const payments = [pay("A", "100"), pay("B", "50", { status: "CANCELLED" })];
    const s = C.summarize({ target_amount: 100 }, payments, 2);
    assert.equal(s.collected, 100000);
    assert.equal(s.participants, 1);
    assert.equal(C.memberSummary("B", payments, null).status, "NOT_PAID");
});

test("overpayment shows a surplus instead of negative remaining", () => {
    const s = C.summarize({ target_amount: "100" }, [pay("A", "80"), pay("B", "45")], 2);
    assert.equal(s.remaining, 0);
    assert.equal(s.surplus, 25000);
    assert.equal(s.reached, true);
    assert.ok(s.progress > 100);
});

test("zero target is handled safely", () => {
    const empty = C.summarize({ target_amount: 0 }, [], 3);
    assert.equal(empty.progress, 0);
    assert.equal(empty.average, 0);
    assert.equal(empty.largest, 0);
    assert.equal(C.summarize({ target_amount: 0 }, [pay("A", 1)], 3).progress, 100);
});

test("idempotency keys are unique per submission", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => C.newRequestId()));
    assert.equal(ids.size, 1000);
});

test("deadline state", () => {
    const today = new Date("2026-10-17T10:00:00Z");
    assert.equal(C.deadlineState({ deadline: "2026-10-10", status: "ACTIVE" }, today), "OVERDUE");
    assert.equal(C.deadlineState({ deadline: "2026-10-20", status: "ACTIVE" }, today), "SOON");
    assert.equal(C.deadlineState({ deadline: "2026-10-10", status: "COMPLETED" }, today), "CLOSED");
});

test("CSV export escapes separators and formula injection", () => {
    const csv = C.toCsv([["Nom", "Note"], ["Ben; Ali", "=HYPERLINK()"]]);
    assert.ok(csv.includes('"Ben; Ali"'));
    assert.ok(csv.includes("'=HYPERLINK()"));
});
