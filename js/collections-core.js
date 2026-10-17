/* ============================================================
   COLLECTIONS — pure financial logic (browser + Node tests)
   All arithmetic is done in integer millimes (1 DT = 1000 millimes)
   so totals never suffer from floating-point drift.
   ============================================================ */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.CollectionsCore = factory();
    }
})(typeof self !== "undefined" ? self : this, function () {

    const MAX_AMOUNT_MILLIMES = 1000000 * 1000;

    /* "12,5" | "12.500" | 12.5 -> 12500 ; invalid -> null */
    function toMillimes(value) {
        if (value === null || value === undefined) return null;

        let text = String(value).trim().replace(/\s/g, "").replace(",", ".");

        if (!/^-?\d+(\.\d{0,3})?$/.test(text)) return null;

        const negative = text.startsWith("-");
        if (negative) text = text.slice(1);

        const [whole, frac = ""] = text.split(".");
        const millimes = Number(whole) * 1000 + Number((frac + "000").slice(0, 3));

        return negative ? -millimes : millimes;
    }

    function fromMillimes(millimes) {
        return (Number(millimes) || 0) / 1000;
    }

    /* Server-shaped string ("12.500") for numeric(12,3) columns. */
    function millimesToDecimalString(millimes) {
        const sign = millimes < 0 ? "-" : "";
        const abs = Math.abs(millimes);
        return `${sign}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, "0")}`;
    }

    function formatDT(millimes, opts = {}) {
        const value = fromMillimes(millimes);
        const hasFraction = Math.abs(millimes) % 1000 !== 0;
        const text = value.toLocaleString("fr-FR", {
            minimumFractionDigits: hasFraction ? 1 : 0,
            maximumFractionDigits: 3
        });
        return opts.unit === false ? text : `${text} DT`;
    }

    /* Validates a payment amount typed by an admin. */
    function validateAmount(value) {
        const m = toMillimes(value);
        if (m === null) return { ok: false, error: "Montant invalide (max. 3 décimales)." };
        if (m <= 0) return { ok: false, error: "Le montant doit être supérieur à 0." };
        if (m > MAX_AMOUNT_MILLIMES) return { ok: false, error: "Montant trop élevé." };
        return { ok: true, millimes: m };
    }

    function isValid(payment) {
        return payment && payment.status !== "CANCELLED" && !payment.deleted;
    }

    /* Global financial summary of a collection. */
    function summarize(collection, payments, memberCount) {
        const target = toMillimes(collection?.target_amount ?? 0) || 0;
        const valid = (payments || []).filter(isValid);
        const amounts = valid.map(p => toMillimes(p.amount) || 0);

        const collected = amounts.reduce((sum, a) => sum + a, 0);
        const contributors = new Set(valid.map(p => p.subscriber_id));
        const participants = contributors.size;

        const progress = target > 0 ? (collected / target) * 100 : (collected > 0 ? 100 : 0);

        const byMethod = {};
        for (const p of valid) {
            byMethod[p.method || "OTHER"] = (byMethod[p.method || "OTHER"] || 0) + (toMillimes(p.amount) || 0);
        }

        return {
            target,
            collected,
            remaining: Math.max(0, target - collected),
            surplus: Math.max(0, collected - target),
            progress,
            reached: target > 0 && collected >= target,
            paymentsCount: valid.length,
            participants,
            nonContributors: Math.max(0, (memberCount || 0) - participants),
            average: participants ? Math.round(collected / participants) : 0,
            largest: amounts.length ? Math.max(...amounts) : 0,
            smallest: amounts.length ? Math.min(...amounts) : 0,
            byMethod
        };
    }

    /*
     * Per-member aggregation. A member with no personal target has no
     * debt: status is PAID once they gave anything, NOT_PAID otherwise.
     */
    function memberSummary(subscriberId, payments, personalTarget) {
        const own = (payments || []).filter(p => p.subscriber_id === subscriberId);
        const valid = own.filter(isValid);
        const total = valid.reduce((sum, p) => sum + (toMillimes(p.amount) || 0), 0);
        const target = personalTarget != null ? toMillimes(personalTarget) : null;

        let status;
        if (total === 0) status = "NOT_PAID";
        else if (target && target > 0) status = total >= target ? "TARGET_REACHED" : "PARTIAL";
        else status = "PAID";

        const lastPaid = valid
            .map(p => p.paid_on || p.created_at)
            .filter(Boolean)
            .sort()
            .pop() || null;

        return {
            subscriberId,
            total,
            count: valid.length,
            cancelledCount: own.length - valid.length,
            lastPaid,
            personalTarget: target,
            personalRemaining: target ? Math.max(0, target - total) : null,
            status
        };
    }

    function deadlineState(collection, today = new Date()) {
        if (!collection?.deadline) return "NONE";
        if (["COMPLETED", "CANCELLED"].includes(collection.status)) return "CLOSED";
        const iso = today.toISOString().slice(0, 10);
        const days = Math.round((Date.parse(collection.deadline) - Date.parse(iso)) / 86400000);
        if (days < 0) return "OVERDUE";
        if (days <= 7) return "SOON";
        return "OK";
    }

    function newRequestId() {
        if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
            const r = (Math.random() * 16) | 0;
            return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
        });
    }

    function toCsv(rows) {
        const esc = v => {
            const s = v === null || v === undefined ? "" : String(v);
            const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
            return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
        };
        return "﻿" + rows.map(r => r.map(esc).join(";")).join("\r\n");
    }

    return {
        toMillimes,
        fromMillimes,
        millimesToDecimalString,
        formatDT,
        validateAmount,
        isValid,
        summarize,
        memberSummary,
        deadlineState,
        newRequestId,
        toCsv
    };
});
