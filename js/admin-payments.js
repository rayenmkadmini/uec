/* ============================================================
   GESTION DES COLLECTES — individual contributions
   Financial maths lives in collections-core.js (integer millimes).
   ============================================================ */
const CC = window.CollectionsCore;

const PAGE_SIZE = 25;

const STATUS_LABELS = {
    DRAFT: ["Brouillon", ""],
    ACTIVE: ["Active", "success"],
    COMPLETED: ["Terminée", "info"],
    CANCELLED: ["Annulée", "danger"]
};

const METHOD_LABELS = {
    CASH: "Espèces",
    TRANSFER: "Virement",
    CHEQUE: "Chèque",
    CARD: "Carte",
    MOBILE: "Paiement mobile",
    OTHER: "Autre"
};

const MEMBER_STATUS = {
    NOT_PAID: ["Non payé", "warning"],
    PAID: ["Payé", "success"],
    PARTIAL: ["Partiel", "info"],
    TARGET_REACHED: ["Objectif perso. atteint", "success"]
};

const state = {
    ctx: null,
    canConfigure: false,
    canRecord: false,
    events: [],
    totals: new Map(),
    subscribers: [],
    subscriberById: new Map(),
    activeMemberCount: 0,
    current: null,
    payments: [],
    targets: new Map(),
    memberPage: 1,
    ledgerPage: 1,
    paymentRequestId: null,
    savingPayment: false,
    drawerMember: null
};

/* ------------------------------------------------------------
   Formatting helpers
------------------------------------------------------------ */
const fmt = m => CC.formatDT(m);
const fmtAmount = value => CC.formatDT(CC.toMillimes(value) || 0);

function fmtDate(value) {
    if (!value) return "—";
    const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
    const date = new Date(y, m - 1, d);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function badge(label, tone = "") {
    return `<span class="status-badge ${tone}">${escapeHtml(label)}</span>`;
}

function statusBadgeFor(status) {
    const [label, tone] = STATUS_LABELS[status] || [status, ""];
    return badge(label, tone);
}

// SUPERADMIN only may record a payment on their own member record (enforced server-side).
function canRecordFor(sub) {
    return state.canRecord && (!sub?.is_self || state.canConfigure);
}

function memberName(sub) {
    if (!sub) return "Membre inconnu";
    return `${sub.nom || ""} ${sub.prenom || ""}`.trim() || "Sans nom";
}

function initials(sub) {
    return `${(sub?.nom || "?").charAt(0)}${(sub?.prenom || "").charAt(0)}`.toUpperCase();
}

function facultyOf(sub) {
    if (!sub) return "";
    return sub.faculty_name || "";
}

function pct(n) {
    return `${(Math.round(n * 10) / 10).toLocaleString("fr-FR")} %`;
}

function progressBar(progress, reached) {
    const width = Math.min(100, Math.max(0, progress));
    return `<div class="progress ${reached ? "done" : ""}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(width)}"><span style="width:${width}%"></span></div>`;
}

function errorMessage(error) {
    const msg = error?.message || String(error);
    if (error?.code === "42501") return "Vous n’avez pas l’autorisation d’effectuer cette action.";
    if (error?.code === "22023") return "Données invalides : vérifiez le montant, la date et le motif.";
    if (error?.code === "P0002") return "Élément introuvable : rechargez la page.";
    if (error?.code === "23503" || /violates foreign key/i.test(msg)) {
        return "Cette collecte contient des paiements : elle ne peut pas être supprimée. Passez-la en « Annulée ».";
    }
    if (error?.code === "42P01" || error?.code === "PGRST205" || /does not exist|schema cache/i.test(msg)) {
        return "La migration supabase/collections.sql n'a pas encore été appliquée.";
    }
    return msg;
}

/* Supabase limits a select to 1000 rows: page through everything. */
async function fetchAll(buildQuery) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await buildQuery().range(from, from + 999);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < 1000) return rows;
    }
}

/* ------------------------------------------------------------
   Data loading
------------------------------------------------------------ */
async function loadSubscribers() {
    if (state.subscribers.length) return;
    // Minimal member list for payment screens (identity fields withheld by the database).
    const { data, error } = await sb.rpc("list_payment_members");
    if (error) throw error;
    state.subscribers = data || [];
    state.subscriberById = new Map(state.subscribers.map(s => [s.id, s]));
    state.activeMemberCount = state.subscribers.filter(s => s.status === "ACTIVE").length;
}

async function loadEvents() {
    try {
        const [events, totals] = await Promise.all([
            fetchAll(() => sb
                .from("events")
                .select("id,title,description,amount,target_amount,suggested_amount,event_date,start_date,deadline,collection_status,organizer,category,is_active,created_at")
                .order("created_at", { ascending: false })),

            fetchAll(() => sb.from("collection_totals").select("event_id,total_collected,payments_count,contributors_count"))
        ]);
        state.events = events;
        state.totals = new Map(totals.map(t => [t.event_id, t]));
        renderCategories();
        renderGlobalKpis();
        renderEvents();
    } catch (error) {
        $("#eventsGrid").innerHTML = `<div class="empty-card">${escapeHtml(errorMessage(error))}</div>`;
    }
}

async function loadCollectionData(eventId) {
    const [payments, targets] = await Promise.all([
        fetchAll(() => sb
            .from("collection_contributions")
            .select("id,event_id,subscriber_id,amount,paid_on,method,reference,notes,status,cancelled_at,cancel_reason,source,recorded_by,created_at,updated_at")
            .eq("event_id", eventId)
            .order("paid_on", { ascending: false })
            .order("created_at", { ascending: false })),

        fetchAll(() => sb.from("collection_member_targets").select("subscriber_id,target_amount").eq("event_id", eventId))
    ]);
    state.payments = payments;
    state.targets = new Map(targets.map(t => [t.subscriber_id, t.target_amount]));
}

/* ------------------------------------------------------------
   LIST VIEW
------------------------------------------------------------ */
function renderCategories() {
    const cats = [...new Set(state.events.map(e => e.category).filter(Boolean))];
    $("#categoryList").innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">`).join("");
}

function eventSummary(event) {
    const t = state.totals.get(event.id);
    const target = CC.toMillimes(event.target_amount) || 0;
    const collected = CC.toMillimes(t?.total_collected ?? 0) || 0;
    return {
        target,
        collected,
        remaining: Math.max(0, target - collected),
        surplus: Math.max(0, collected - target),
        progress: target > 0 ? (collected / target) * 100 : (collected > 0 ? 100 : 0),
        reached: target > 0 && collected >= target,
        contributors: t?.contributors_count || 0,
        payments: t?.payments_count || 0
    };
}

function renderGlobalKpis() {
    const active = state.events.filter(e => e.collection_status === "ACTIVE");
    let collected = 0;
    let target = 0;
    for (const e of active) {
        const s = eventSummary(e);
        collected += s.collected;
        target += s.target;
    }
    const overdue = state.events.filter(e => CC.deadlineState(e) === "OVERDUE").length;
    const reached = state.events.filter(e => eventSummary(e).reached).length;

    $("#globalKpis").innerHTML = `
        ${kpi("Collectes actives", active.length, `${state.events.length} au total`)}
        ${kpi("Collecté (actives)", fmt(collected), target ? `sur ${fmt(target)} d'objectif` : "Aucun objectif défini", "money")}
        ${kpi("Objectifs atteints", reached, "collectes")}
        ${kpi("En retard", overdue, "date limite dépassée", overdue ? "alert" : "")}
    `;
}

function kpi(label, value, sub = "", tone = "") {
    return `<div class="kpi ${tone}"><span class="kpi-label">${escapeHtml(label)}</span><strong class="kpi-value">${escapeHtml(String(value))}</strong>${sub ? `<small>${escapeHtml(sub)}</small>` : ""}</div>`;
}

function deadlineChip(event) {
    const d = CC.deadlineState(event);
    if (d === "OVERDUE") return badge(`Échue le ${fmtDate(event.deadline)}`, "danger");
    if (d === "SOON") return badge(`Échéance ${fmtDate(event.deadline)}`, "warning");
    if (event.deadline) return `<span class="muted-chip">Jusqu'au ${fmtDate(event.deadline)}</span>`;
    return "";
}

function renderEvents() {
    const container = $("#eventsGrid");
    const q = ($("#collectionSearch").value || "").trim().toLowerCase();
    const status = $("#collectionStatusFilter").value;

    const list = state.events.filter(e =>
        (!status || e.collection_status === status) &&
        (!q || [e.title, e.description, e.category, e.organizer].some(v => (v || "").toLowerCase().includes(q)))
    );

    if (!state.events.length) {
        container.innerHTML = `
            <div class="empty-card big">
                <strong>Aucune collecte pour le moment</strong>
                <p>Créez une collecte avec un objectif global, puis enregistrez les montants réellement versés par chaque membre.</p>
                <button type="button" class="btn primary needs-configure" data-action="create">+ Nouvelle collecte</button>
            </div>`;
        return;
    }
    if (!list.length) {
        container.innerHTML = `<div class="empty-card">Aucune collecte ne correspond à ces filtres.</div>`;
        return;
    }

    container.innerHTML = list.map(e => {
        const s = eventSummary(e);
        const id = escapeHtml(String(e.id));
        return `
        <article class="collection-card" data-action="open" data-id="${id}" tabindex="0" aria-label="Ouvrir ${escapeHtml(e.title)}">
            <header>
                <div>
                    ${e.category ? `<span class="mini-label">${escapeHtml(e.category.toUpperCase())}</span>` : ""}
                    <h3>${escapeHtml(e.title || "Sans nom")}</h3>
                </div>
                ${statusBadgeFor(e.collection_status)}
            </header>
            <div class="cc-amounts">
                <div><small>Collecté</small><strong>${fmt(s.collected)}</strong></div>
                <div class="right"><small>Objectif</small><strong>${s.target ? fmt(s.target) : "—"}</strong></div>
            </div>
            ${progressBar(s.progress, s.reached)}
            <div class="cc-foot">
                <span>${s.target ? pct(s.progress) : "Pas d'objectif"}${s.surplus ? ` · <b class="pos">+${fmt(s.surplus)}</b>` : ""}</span>
                <span>${s.contributors} contributeur${s.contributors > 1 ? "s" : ""}</span>
            </div>
            <div class="cc-meta">${deadlineChip(e)}</div>
            <div class="cc-actions">
                <button type="button" class="btn primary sm needs-record" data-action="pay" data-id="${id}">+ Paiement</button>
                <button type="button" class="btn ghost sm needs-configure" data-action="edit" data-id="${id}">Modifier</button>
                <button type="button" class="btn ghost sm danger-text needs-configure" data-action="delete" data-id="${id}">Supprimer</button>
            </div>
        </article>`;
    }).join("");
}

/* ------------------------------------------------------------
   COLLECTION FORM
------------------------------------------------------------ */
function setFieldError(form, field, message) {
    const el = form.querySelector(`.field-error[data-for="${field}"]`);
    if (el) el.textContent = message || "";
    const input = form.querySelector(`#${field}`) || form.querySelector(`#${field}Search`);
    input?.setAttribute("aria-invalid", message ? "true" : "false");
}

function clearErrors(form) {
    form.querySelectorAll(".field-error").forEach(el => (el.textContent = ""));
    form.querySelectorAll("[aria-invalid]").forEach(el => el.removeAttribute("aria-invalid"));
}

function openModal(id) {
    const modal = $(id);
    modal.classList.remove("hidden");
    setTimeout(() => modal.querySelector("input:not([type=hidden]),select,textarea")?.focus(), 30);
}

function closeModal(el) {
    el.closest(".modal, .drawer-backdrop")?.classList.add("hidden");
}

function openEventForm(event = null) {
    const form = $("#eventForm");
    form.reset();
    clearErrors(form);
    $("#eventFormTitle").textContent = event ? "Modifier la collecte" : "Nouvelle collecte";
    $("#eventId").value = event?.id || "";
    $("#eventName").value = event?.title || "";
    $("#eventDescription").value = event?.description || "";
    $("#eventTarget").value = event ? CC.fromMillimes(CC.toMillimes(event.target_amount) || 0) : "";
    $("#eventSuggested").value = event?.suggested_amount ? CC.fromMillimes(CC.toMillimes(event.suggested_amount)) : "";
    $("#eventStart").value = (event?.start_date || "").slice(0, 10);
    $("#eventDeadline").value = (event?.deadline || "").slice(0, 10);
    $("#eventStatus").value = event?.collection_status || "ACTIVE";
    $("#eventCategory").value = event?.category || "";
    $("#eventOrganizer").value = event?.organizer || "";
    openModal("#eventFormModal");
}

async function saveEvent(submitEvent) {
    submitEvent.preventDefault();
    const form = $("#eventForm");
    clearErrors(form);

    const id = $("#eventId").value;
    const name = $("#eventName").value.trim();
    const target = CC.toMillimes($("#eventTarget").value);
    const suggestedRaw = $("#eventSuggested").value.trim();
    const suggested = suggestedRaw ? CC.toMillimes(suggestedRaw) : null;
    const start = $("#eventStart").value || null;
    const deadline = $("#eventDeadline").value || null;

    let ok = true;
    if (!name) { setFieldError(form, "eventName", "Le nom est obligatoire."); ok = false; }
    if (target === null || target < 0) { setFieldError(form, "eventTarget", "Indiquez un objectif valide (0 si aucun)."); ok = false; }
    if (suggestedRaw && (suggested === null || suggested <= 0)) { setFieldError(form, "eventSuggested", "Montant invalide."); ok = false; }
    if (start && deadline && deadline < start) { setFieldError(form, "eventDeadline", "La date limite doit suivre la date de début."); ok = false; }
    if (!ok) return;

    const payload = {
        title: name,
        description: $("#eventDescription").value.trim() || null,
        target_amount: CC.millimesToDecimalString(target),
        suggested_amount: suggested ? CC.millimesToDecimalString(suggested) : null,
        start_date: start,
        event_date: start,
        deadline,
        collection_status: $("#eventStatus").value,
        category: $("#eventCategory").value.trim() || null,
        organizer: $("#eventOrganizer").value.trim() || null
    };
    // Legacy column kept in sync for older screens: it is a suggestion, not a debt.
    payload.amount = suggested ? CC.fromMillimes(suggested) : 0;

    const button = $("#saveEventBtn");
    button.disabled = true;
    const result = id
        ? await sb.from("events").update(payload).eq("id", id).select("id")
        : await sb.from("events").insert(payload).select("id");
    button.disabled = false;

    const failure = result.error ? errorMessage(result.error) : writeError(result);
    if (failure) {
        showAlert("#pageAlert", failure, "error");
        return;
    }

    closeModal(form);
    showAlert("#pageAlert", id ? "Collecte mise à jour." : "Collecte créée.", "success");
    await loadEvents();
    if (state.current && state.current.id === id) {
        state.current = state.events.find(e => e.id === id) || state.current;
        renderDetail();
    }
}

async function deleteEvent(id) {
    const event = state.events.find(e => String(e.id) === String(id));
    if (!event) return;
    const s = eventSummary(event);
    if (s.payments > 0) {
        await confirmDialog(
            `« ${event.title} » contient ${s.payments} paiement(s). Pour préserver l'historique financier, elle ne peut pas être supprimée : modifiez son statut en « Annulée ».`,
            { title: "Suppression impossible", icon: "info", confirmText: "Compris" }
        );
        return;
    }
    if (!(await confirmDialog(`Supprimer définitivement la collecte « ${event.title} » ?`, { title: "Supprimer la collecte", confirmText: "Supprimer" }))) return;

    const result = await sb.from("events").delete().eq("id", id).select("id");
    const failure = result.error ? errorMessage(result.error) : writeError(result);
    if (failure) return showAlert("#pageAlert", failure, "error");
    showAlert("#pageAlert", "Collecte supprimée.", "success");
    await loadEvents();
}

/* ------------------------------------------------------------
   DETAIL VIEW (dashboard)
------------------------------------------------------------ */
async function openDetail(eventId, { pay = false } = {}) {
    const event = state.events.find(e => String(e.id) === String(eventId));
    if (!event) return;
    state.current = event;
    state.memberPage = 1;
    state.ledgerPage = 1;

    $("#listView").classList.add("hidden");
    $("#detailView").classList.remove("hidden");
    $("#finHero").innerHTML = `<div class="skeleton-card"></div>`;
    $("#memberRows").innerHTML = rowsMessage(8, "Chargement…");
    history.replaceState(null, "", `#collecte=${event.id}`);
    window.scrollTo({ top: 0 });

    try {
        await Promise.all([loadSubscribers(), loadCollectionData(event.id)]);
    } catch (error) {
        showAlert("#pageAlert", errorMessage(error), "error");
        return;
    }
    renderDetail();
    if (pay) openPaymentForm();
}

function backToList() {
    state.current = null;
    $("#detailView").classList.add("hidden");
    $("#listView").classList.remove("hidden");
    history.replaceState(null, "", location.pathname);
    loadEvents();
}

function currentSummary() {
    return CC.summarize(state.current, state.payments, state.activeMemberCount);
}

function memberRowsData() {
    // Active members + anyone who paid (even if their account is now inactive).
    const ids = new Set(state.subscribers.filter(s => s.status === "ACTIVE").map(s => s.id));
    state.payments.forEach(p => ids.add(p.subscriber_id));
    return [...ids].map(id => {
        const sub = state.subscriberById.get(id);
        return { sub, id, ...CC.memberSummary(id, state.payments, state.targets.get(id) ?? null) };
    });
}

function renderDetail() {
    const e = state.current;
    const s = currentSummary();

    $("#detailTitle").textContent = e.title || "Collecte";
    $("#detailStatus").innerHTML = statusBadgeFor(e.collection_status);
    $("#detailMeta").textContent = [
        e.category,
        e.organizer && `Organisé par ${e.organizer}`,
        e.start_date && `Début ${fmtDate(e.start_date)}`,
        e.deadline && `Échéance ${fmtDate(e.deadline)}`,
        e.suggested_amount && `Contribution suggérée ${fmtAmount(e.suggested_amount)}`
    ].filter(Boolean).join(" · ") || (e.description || "");

    const alerts = [];
    if (s.reached) alerts.push(`<div class="notice success"><b>Objectif atteint 🎉</b> ${fmt(s.collected)} collectés sur ${fmt(s.target)}${s.surplus ? ` — excédent de <b>${fmt(s.surplus)}</b>` : ""}.</div>`);
    const d = CC.deadlineState(e);
    if (d === "OVERDUE" && !s.reached) alerts.push(`<div class="notice danger"><b>Collecte en retard.</b> La date limite (${fmtDate(e.deadline)}) est dépassée et il manque ${fmt(s.remaining)}.</div>`);
    if (d === "SOON" && !s.reached) alerts.push(`<div class="notice warning"><b>Échéance proche :</b> ${fmtDate(e.deadline)} — reste ${fmt(s.remaining)} à collecter.</div>`);
    if (e.collection_status === "CANCELLED") alerts.push(`<div class="notice">Cette collecte est annulée. Les paiements existants restent consultables.</div>`);
    if (!s.target) alerts.push(`<div class="notice">Aucun objectif global n'est défini pour cette collecte.</div>`);
    $("#detailAlerts").innerHTML = alerts.join("");

    $("#finHero").innerHTML = `
        <div class="fin-main">
            <span class="kpi-label">Total collecté</span>
            <strong class="fin-amount">${fmt(s.collected)}</strong>
            ${progressBar(s.progress, s.reached)}
            <div class="fin-progress-meta">
                <span><b>${s.target ? pct(s.progress) : "—"}</b> de l'objectif</span>
                <span>${s.paymentsCount} paiement${s.paymentsCount > 1 ? "s" : ""} valide${s.paymentsCount > 1 ? "s" : ""}</span>
            </div>
        </div>
        <div class="fin-side">
            <div class="fin-cell"><span class="kpi-label">Objectif global</span><strong>${s.target ? fmt(s.target) : "—"}</strong></div>
            ${s.surplus
                ? `<div class="fin-cell pos"><span class="kpi-label">Excédent</span><strong>+${fmt(s.surplus)}</strong></div>`
                : `<div class="fin-cell"><span class="kpi-label">Reste à collecter (objectif)</span><strong>${fmt(s.remaining)}</strong></div>`}
        </div>`;

    $("#detailKpis").innerHTML = `
        ${kpi("Contributeurs", s.participants, `sur ${state.activeMemberCount} membres actifs`)}
        ${kpi("Sans contribution", s.nonContributors, "membres actifs")}
        ${kpi("Moyenne / contributeur", fmt(s.average))}
        ${kpi("Plus grande contribution", fmt(s.largest))}
        ${kpi("Plus petite contribution", fmt(s.smallest))}
    `;

    renderBreakdowns(s);
    renderActivity();
    renderMembers();
    renderLedgerFilters();
    renderLedger();
}

function barList(items, total) {
    if (!items.length || !total) return `<p class="empty-inline">Aucun paiement enregistré.</p>`;
    return `<ul class="bars">${items.map(([label, value, count]) => `
        <li>
            <div class="bar-label"><span>${escapeHtml(label)}</span><span>${fmt(value)}${count != null ? ` · ${count}` : ""}</span></div>
            <div class="bar"><span style="width:${(value / total) * 100}%"></span></div>
        </li>`).join("")}</ul>`;
}

function renderBreakdowns(s) {
    const methods = Object.entries(s.byMethod).sort((a, b) => b[1] - a[1]).map(([k, v]) => [METHOD_LABELS[k] || k, v]);
    $("#methodBreakdown").innerHTML = barList(methods, s.collected);

    // Per-member totals grouped into amount ranges.
    const ranges = [[0, 5000, "≤ 5 DT"], [5000, 20000, "5 – 20 DT"], [20000, 50000, "20 – 50 DT"], [50000, 100000, "50 – 100 DT"], [100000, Infinity, "> 100 DT"]];
    const totals = memberRowsData().filter(r => r.total > 0).map(r => r.total);
    const buckets = ranges.map(([min, max, label]) => {
        const inRange = totals.filter(t => (min === 0 ? t > 0 : t > min) && t <= max);
        return [label, inRange.reduce((a, b) => a + b, 0), `${inRange.length} membre${inRange.length > 1 ? "s" : ""}`];
    }).filter(b => b[1] > 0);
    $("#amountBreakdown").innerHTML = barList(buckets, s.collected);
}

function renderActivity() {
    const recent = [...state.payments].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")).slice(0, 6);
    $("#recentActivity").innerHTML = recent.length
        ? recent.map(p => {
            const sub = state.subscriberById.get(p.subscriber_id);
            const cancelled = p.status === "CANCELLED";
            return `<li class="${cancelled ? "cancelled" : ""}">
                <span class="initials">${escapeHtml(initials(sub))}</span>
                <div><b>${escapeHtml(memberName(sub))}</b><small>${fmtDate(p.paid_on)} · ${escapeHtml(METHOD_LABELS[p.method] || p.method)}${cancelled ? " · annulé" : ""}</small></div>
                <strong>${fmtAmount(p.amount)}</strong>
            </li>`;
        }).join("")
        : `<li class="empty-inline">Aucune activité pour l'instant.</li>`;
}

function rowsMessage(cols, text) {
    return `<tr><td colspan="${cols}" class="empty">${escapeHtml(text)}</td></tr>`;
}

function renderPager(el, page, total, onChange) {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (total <= PAGE_SIZE) { el.innerHTML = total ? `<span>${total} résultat${total > 1 ? "s" : ""}</span>` : ""; return; }
    el.innerHTML = `
        <span>${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} sur ${total}</span>
        <div>
            <button type="button" class="btn ghost sm" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>← Préc.</button>
            <span class="page-num">${page} / ${pages}</span>
            <button type="button" class="btn ghost sm" data-page="${page + 1}" ${page >= pages ? "disabled" : ""}>Suiv. →</button>
        </div>`;
    el.onclick = ev => {
        const b = ev.target.closest("button[data-page]");
        if (b && !b.disabled) onChange(Number(b.dataset.page));
    };
}

function filteredMembers() {
    const q = ($("#memberSearch").value || "").trim().toLowerCase();
    const status = $("#memberStatusFilter").value;
    const sort = $("#memberSort").value;

    const rows = memberRowsData().filter(r => {
        if (q) {
            const hay = `${memberName(r.sub)} ${r.sub?.prenom || ""} ${r.sub?.nom || ""} ${r.sub?.numero_abonnement || ""} ${facultyOf(r.sub)}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        if (status === "CONTRIBUTED") return r.total > 0;
        if (status) return r.status === status;
        return true;
    });

    const byName = (a, b) => memberName(a.sub).localeCompare(memberName(b.sub), "fr");
    const sorters = {
        name: byName,
        total_desc: (a, b) => b.total - a.total || byName(a, b),
        total_asc: (a, b) => a.total - b.total || byName(a, b),
        last_desc: (a, b) => (b.lastPaid || "").localeCompare(a.lastPaid || "") || byName(a, b),
        count_desc: (a, b) => b.count - a.count || byName(a, b)
    };
    return rows.sort(sorters[sort] || byName);
}

function renderMembers() {
    const rows = filteredMembers();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.memberPage = Math.min(state.memberPage, pages);
    const slice = rows.slice((state.memberPage - 1) * PAGE_SIZE, state.memberPage * PAGE_SIZE);

    $("#memberRows").innerHTML = slice.length ? slice.map(r => {
        const [label, tone] = MEMBER_STATUS[r.status];
        const inactive = r.sub && r.sub.status !== "ACTIVE";
        return `<tr data-member="${escapeHtml(r.id)}" class="clickable" tabindex="0">
            <td><div class="member-cell"><span class="initials">${escapeHtml(initials(r.sub))}</span><div><b>${escapeHtml(memberName(r.sub))}</b><small>N° ${escapeHtml(r.sub?.numero_abonnement || "—")}${facultyOf(r.sub) ? ` · ${escapeHtml(facultyOf(r.sub))}` : ""}${inactive ? " · inactif" : ""}</small></div></div></td>
            <td class="num"><b>${r.total ? fmt(r.total) : "—"}</b></td>
            <td class="num">${r.count || "—"}</td>
            <td>${fmtDate(r.lastPaid)}</td>
            <td class="num">${r.personalTarget ? fmt(r.personalTarget) : '<span class="muted">—</span>'}</td>
            <td class="num">${r.personalRemaining != null ? (r.personalRemaining ? fmt(r.personalRemaining) : "0 DT") : '<span class="muted">—</span>'}</td>
            <td>${badge(label, tone)}</td>
            <td class="no-print actions-cell">${canRecordFor(r.sub) ? `
                <button type="button" class="btn ghost sm needs-record" data-action="member-pay" data-member="${escapeHtml(r.id)}" aria-label="Ajouter un paiement pour ${escapeHtml(memberName(r.sub))}">+ Paiement</button>` : ""}
            </td>
            <td class="m-summary">
                <div class="m-head">
                    <span class="m-avatar">${escapeHtml(initials(r.sub))}</span>
                    <div class="m-id"><strong>${escapeHtml(memberName(r.sub))}</strong><small>N° ${escapeHtml(r.sub?.numero_abonnement || "—")}${facultyOf(r.sub) ? ` · ${escapeHtml(facultyOf(r.sub))}` : ""}${inactive ? " · inactif" : ""}</small></div>
                    <span class="m-amount">${r.total ? fmt(r.total) : "—"}</span>
                </div>
                <div class="m-chips">${badge(label, tone)}${r.count ? `<span class="m-chip">${r.count} paiement${r.count > 1 ? "s" : ""}</span>` : ""}${r.lastPaid ? `<span class="m-chip">Dernier : ${fmtDate(r.lastPaid)}</span>` : ""}${r.personalTarget ? `<span class="m-chip">Objectif ${fmt(r.personalTarget)} · reste ${fmt(r.personalRemaining)}</span>` : ""}</div>
                ${canRecordFor(r.sub) ? `<div class="m-actions m-actions-single"><button type="button" class="btn secondary sm needs-record" data-action="member-pay" data-member="${escapeHtml(r.id)}">+ Enregistrer un paiement</button></div>` : ""}
            </td>
        </tr>`;
    }).join("") : rowsMessage(8, state.subscribers.length ? "Aucun membre ne correspond à ces filtres." : "Aucun membre dans la base.");

    renderPager($("#memberPager"), state.memberPage, rows.length, p => { state.memberPage = p; renderMembers(); });
}

function renderLedgerFilters() {
    const sel = $("#ledgerMethod");
    const current = sel.value;
    sel.innerHTML = `<option value="">Tous les modes</option>` + Object.entries(METHOD_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
    sel.value = current;
}

function filteredLedger() {
    const q = ($("#ledgerSearch").value || "").trim().toLowerCase();
    const method = $("#ledgerMethod").value;
    const status = $("#ledgerStatus").value;
    const from = $("#ledgerFrom").value;
    const to = $("#ledgerTo").value;
    const min = CC.toMillimes($("#ledgerMin").value);

    return state.payments.filter(p => {
        if (status && p.status !== status) return false;
        if (method && p.method !== method) return false;
        if (from && p.paid_on < from) return false;
        if (to && p.paid_on > to) return false;
        if (min && (CC.toMillimes(p.amount) || 0) < min) return false;
        if (q) {
            const sub = state.subscriberById.get(p.subscriber_id);
            const hay = `${memberName(sub)} ${sub?.numero_abonnement || ""} ${p.reference || ""} ${p.notes || ""}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });
}

function renderLedger() {
    const rows = filteredLedger();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.ledgerPage = Math.min(state.ledgerPage, pages);
    const slice = rows.slice((state.ledgerPage - 1) * PAGE_SIZE, state.ledgerPage * PAGE_SIZE);

    $("#ledgerRows").innerHTML = slice.length ? slice.map(p => ledgerRow(p, true)).join("") : rowsMessage(8, state.payments.length ? "Aucun paiement ne correspond à ces filtres." : "Aucun paiement enregistré pour cette collecte.");
    renderPager($("#ledgerPager"), state.ledgerPage, rows.length, n => { state.ledgerPage = n; renderLedger(); });
}

function ledgerRow(p, withMember) {
    const sub = state.subscriberById.get(p.subscriber_id);
    const cancelled = p.status === "CANCELLED";
    return `<tr class="${cancelled ? "row-cancelled" : ""}">
        <td>${fmtDate(p.paid_on)}</td>
        ${withMember ? `<td><button type="button" class="link-btn" data-action="open-member" data-member="${escapeHtml(p.subscriber_id)}">${escapeHtml(memberName(sub))}</button></td>` : ""}
        <td class="num"><b>${fmtAmount(p.amount)}</b></td>
        <td>${escapeHtml(METHOD_LABELS[p.method] || p.method)}</td>
        <td>${escapeHtml(p.reference || "—")}</td>
        <td class="note-cell">${escapeHtml(cancelled ? `Annulé : ${p.cancel_reason || "—"}` : p.notes || "—")}</td>
        <td>${cancelled ? badge("Annulé", "danger") : p.source === "LEGACY" ? badge("Importé", "info") : badge("Valide", "success")}</td>
        <td class="no-print actions-cell">${cancelled ? "" : `
            <button type="button" class="btn ghost sm needs-record" data-action="edit-payment" data-id="${escapeHtml(p.id)}">Modifier</button>
            <button type="button" class="btn ghost sm danger-text needs-record" data-action="cancel-payment" data-id="${escapeHtml(p.id)}">Annuler</button>`}
        </td>
        <td class="m-summary">
            <div class="m-head">
                <div class="m-id"><strong>${withMember ? escapeHtml(memberName(sub)) : fmtDate(p.paid_on)}</strong><small>${withMember ? `${fmtDate(p.paid_on)} · ` : ""}${escapeHtml(METHOD_LABELS[p.method] || p.method)}${p.reference ? ` · ${escapeHtml(p.reference)}` : ""}</small></div>
                <span class="m-amount${cancelled ? " is-cancelled" : ""}">${fmtAmount(p.amount)}</span>
            </div>
            <div class="m-chips">${cancelled ? badge("Annulé", "danger") : p.source === "LEGACY" ? badge("Importé", "info") : badge("Valide", "success")}${(cancelled ? p.cancel_reason : p.notes) ? `<span class="m-note">${escapeHtml(cancelled ? `Motif : ${p.cancel_reason}` : p.notes)}</span>` : ""}</div>
            ${cancelled ? "" : `<div class="m-actions m-actions-two">
                ${withMember ? `<button type="button" class="btn secondary sm" data-action="open-member" data-member="${escapeHtml(p.subscriber_id)}">Fiche</button>` : ""}
                <button type="button" class="btn secondary sm needs-record" data-action="edit-payment" data-id="${escapeHtml(p.id)}">Modifier</button>
                <button type="button" class="btn secondary sm danger-text needs-record" data-action="cancel-payment" data-id="${escapeHtml(p.id)}">Annuler</button>
            </div>`}
        </td>
    </tr>`;
}

/* ------------------------------------------------------------
   MEMBER SIDE PANEL
------------------------------------------------------------ */
function openMemberDrawer(subscriberId) {
    state.drawerMember = subscriberId;
    renderDrawer();
    $("#memberDrawer").classList.remove("hidden");
    $("#memberDrawer .close").focus();
}

function renderDrawer() {
    const id = state.drawerMember;
    if (!id) return;
    const sub = state.subscriberById.get(id);
    const m = CC.memberSummary(id, state.payments, state.targets.get(id) ?? null);
    const history = state.payments.filter(p => p.subscriber_id === id);
    const [label, tone] = MEMBER_STATUS[m.status];

    $("#drawerInitials").textContent = initials(sub);
    $("#drawerTitle").textContent = memberName(sub);
    $("#drawerMeta").textContent = `N° ${sub?.numero_abonnement || "—"}${facultyOf(sub) ? ` · ${facultyOf(sub)}` : ""}`;

    $("#drawerBody").innerHTML = `
        <div class="drawer-stats">
            <div><span class="kpi-label">Total versé</span><strong>${fmt(m.total)}</strong></div>
            <div><span class="kpi-label">Paiements</span><strong>${m.count}</strong></div>
            <div><span class="kpi-label">Statut</span>${badge(label, tone)}</div>
        </div>

        <div class="personal-target">
            <div>
                <span class="kpi-label">Objectif personnel (optionnel)</span>
                ${m.personalTarget
                    ? `<p><b>${fmt(m.personalTarget)}</b> — reste <b>${fmt(m.personalRemaining)}</b></p>${progressBar((m.total / m.personalTarget) * 100, m.status === "TARGET_REACHED")}`
                    : `<p class="muted">Aucun objectif personnel : ce membre ne doit aucun montant fixe.</p>`}
            </div>
            <div class="pt-actions">
                <button type="button" class="btn ghost sm needs-record" data-action="set-target">${m.personalTarget ? "Modifier" : "Définir"}</button>
                ${m.personalTarget ? `<button type="button" class="btn ghost sm danger-text needs-record" data-action="clear-target">Retirer</button>` : ""}
            </div>
        </div>

        <div class="drawer-section-head">
            <h3>Historique des paiements</h3>
            <button type="button" class="btn primary sm needs-record" data-action="drawer-pay">+ Paiement</button>
        </div>
        ${history.length ? `
        <div class="table-wrap"><table class="data-table compact">
            <thead><tr><th>Date</th><th class="num">Montant</th><th>Mode</th><th>Réf.</th><th>Note</th><th>Statut</th><th></th></tr></thead>
            <tbody>${history.map(p => ledgerRow(p, false)).join("")}</tbody>
        </table></div>` : `<div class="empty-card">Ce membre n'a encore rien versé pour cette collecte.</div>`}
    `;
}

async function setPersonalTarget(clear = false) {
    const id = state.drawerMember;
    const eventId = state.current.id;
    if (clear) {
        if (!(await confirmDialog("Retirer l'objectif personnel de ce membre ?", { confirmText: "Retirer" }))) return;
        const { error } = await sb.rpc("set_collection_member_target", { p_event_id: eventId, p_subscriber_id: id, p_target: null });
        if (error) return showAlert("#pageAlert", errorMessage(error), "error");
        state.targets.delete(id);
    } else {
        const existing = state.targets.get(id);
        const value = await promptDialog("Objectif personnel (DT)", {
            input: "text",
            value: existing ? String(CC.fromMillimes(CC.toMillimes(existing))) : "",
            placeholder: "Ex : 50",
            validator: v => (CC.validateAmount(v).ok ? undefined : CC.validateAmount(v).error)
        });
        if (value === null) return;
        const m = CC.validateAmount(value).millimes;
        const amount = CC.millimesToDecimalString(m);
        const { error } = await sb.rpc("set_collection_member_target", { p_event_id: eventId, p_subscriber_id: id, p_target: amount });
        if (error) return showAlert("#pageAlert", errorMessage(error), "error");
        state.targets.set(id, amount);
    }
    showAlert("#pageAlert", "Objectif personnel mis à jour.", "success");
    renderDrawer();
    renderMembers();
}

/* ------------------------------------------------------------
   PAYMENT FORM
------------------------------------------------------------ */
function selectPaymentMember(id) {
    const sub = state.subscriberById.get(id);
    $("#paymentMember").value = id || "";
    $("#paymentMemberResults").classList.add("hidden");
    const picked = $("#paymentMemberSelected");
    if (!sub) {
        picked.classList.add("hidden");
        $("#paymentMemberSearch").classList.remove("hidden");
        return;
    }
    const m = CC.memberSummary(id, state.payments, state.targets.get(id) ?? null);
    picked.innerHTML = `
        <span class="initials">${escapeHtml(initials(sub))}</span>
        <div><b>${escapeHtml(memberName(sub))}</b><small>N° ${escapeHtml(sub.numero_abonnement || "—")} · déjà versé : ${fmt(m.total)}${m.personalTarget ? ` · reste perso. ${fmt(m.personalRemaining)}` : ""}</small></div>
        ${$("#paymentId").value ? "" : `<button type="button" class="link-btn" data-action="change-member">Changer</button>`}`;
    picked.classList.remove("hidden");
    $("#paymentMemberSearch").classList.add("hidden");
    setFieldError($("#paymentForm"), "paymentMember", "");
}

function renderMemberResults() {
    const q = $("#paymentMemberSearch").value.trim().toLowerCase();
    const box = $("#paymentMemberResults");
    if (!q) { box.classList.add("hidden"); return; }
    const matches = state.subscribers
        .filter(s => canRecordFor(s))
        .filter(s => `${s.nom || ""} ${s.prenom || ""} ${s.prenom || ""} ${s.nom || ""} ${s.numero_abonnement || ""}`.toLowerCase().includes(q))
        .slice(0, 8);
    box.innerHTML = matches.length
        ? matches.map(s => `<button type="button" role="option" data-pick="${escapeHtml(s.id)}"><span class="initials">${escapeHtml(initials(s))}</span><span><b>${escapeHtml(memberName(s))}</b><small>N° ${escapeHtml(s.numero_abonnement || "—")}${s.status !== "ACTIVE" ? " · inactif" : ""}</small></span></button>`).join("")
        : `<div class="combo-empty">Aucun membre trouvé.</div>`;
    box.classList.remove("hidden");
}

function openPaymentForm({ memberId = null, payment = null } = {}) {
    if (!state.current) return;
    const form = $("#paymentForm");
    form.reset();
    clearErrors(form);

    // A fresh idempotency key per form opening: retries of the same submit reuse it.
    state.paymentRequestId = payment ? null : CC.newRequestId();

    $("#paymentId").value = payment?.id || "";
    $("#paymentFormTitle").textContent = payment ? "Modifier le paiement" : "Enregistrer un paiement";
    $("#paymentFormSub").textContent = state.current.title;
    $("#paymentAmount").value = payment ? CC.fromMillimes(CC.toMillimes(payment.amount)) : "";
    $("#paymentDate").value = payment?.paid_on || todayIso();
    $("#paymentDate").max = todayIso();
    $("#paymentMethod").value = payment?.method || "CASH";
    $("#paymentReference").value = payment?.reference || "";
    $("#paymentNotes").value = payment?.notes || "";
    $("#paymentMemberSearch").value = "";
    $("#paymentAmountHint").textContent = state.current.suggested_amount
        ? `Montant réellement versé. Suggestion : ${fmtAmount(state.current.suggested_amount)} (non obligatoire).`
        : "Le montant réellement payé par ce membre.";

    selectPaymentMember(payment?.subscriber_id || memberId);
    openModal("#paymentModal");
    if (payment || memberId) setTimeout(() => $("#paymentAmount").focus(), 40);
}

async function savePayment(ev) {
    ev.preventDefault();
    if (state.savingPayment) return; // double-submit guard
    const form = $("#paymentForm");
    clearErrors(form);

    const id = $("#paymentId").value;
    const subscriberId = $("#paymentMember").value;
    const amount = CC.validateAmount($("#paymentAmount").value);
    const date = $("#paymentDate").value;

    let ok = true;
    if (!subscriberId) { setFieldError(form, "paymentMember", "Sélectionnez un membre."); ok = false; }
    if (!amount.ok) { setFieldError(form, "paymentAmount", amount.error); ok = false; }
    if (!date) { setFieldError(form, "paymentDate", "La date est obligatoire."); ok = false; }
    else if (date > todayIso()) { setFieldError(form, "paymentDate", "La date ne peut pas être dans le futur."); ok = false; }
    if (!ok) return;

    const payload = {
        amount: CC.millimesToDecimalString(amount.millimes),
        paid_on: date,
        method: $("#paymentMethod").value,
        reference: $("#paymentReference").value.trim() || null,
        notes: $("#paymentNotes").value.trim() || null
    };

    const button = $("#savePaymentBtn");
    state.savingPayment = true;
    button.disabled = true;
    button.textContent = "Enregistrement…";

    let error;
    if (id) {
        const before = state.payments.find(p => p.id === id);
        if (before && CC.toMillimes(before.amount) !== amount.millimes &&
            !(await confirmDialog(`Modifier le montant de ${fmtAmount(before.amount)} à ${fmt(amount.millimes)} ? La modification sera tracée dans l'historique.`, { confirmText: "Modifier" }))) {
            state.savingPayment = false; button.disabled = false; button.textContent = "Enregistrer le paiement";
            return;
        }
        ({ error } = await sb.rpc("update_collection_contribution", {
            p_id: id,
            p_amount: payload.amount,
            p_paid_on: payload.paid_on,
            p_method: payload.method,
            p_reference: payload.reference,
            p_notes: payload.notes
        }));
    } else {
        // The server returns the stored row when this request id was already saved
        // (double click, network retry), so a payment is never counted twice.
        ({ error } = await sb.rpc("record_collection_contribution", {
            p_event_id: state.current.id,
            p_subscriber_id: subscriberId,
            p_amount: payload.amount,
            p_paid_on: payload.paid_on,
            p_method: payload.method,
            p_reference: payload.reference,
            p_notes: payload.notes,
            p_request_id: state.paymentRequestId
        }));

    }

    state.savingPayment = false;
    button.disabled = false;
    button.textContent = "Enregistrer le paiement";

    if (error) {
        showAlert("#pageAlert", errorMessage(error), "error");
        return;
    }

    state.paymentRequestId = null;
    closeModal(form);
    showAlert("#pageAlert", id ? "Paiement modifié." : `Paiement de ${fmt(amount.millimes)} enregistré.`, "success");
    await refreshCurrent();
}

async function cancelPayment(paymentId) {
    const p = state.payments.find(x => x.id === paymentId);
    if (!p) return;
    const sub = state.subscriberById.get(p.subscriber_id);
    const reason = await promptDialog(`Annuler le paiement de ${fmtAmount(p.amount)} (${memberName(sub)}) ?`, {
        placeholder: "Motif de l'annulation (obligatoire)",
        confirmText: "Annuler le paiement",
        validator: v => (v && v.trim().length >= 3 ? undefined : "Indiquez un motif.")
    });
    if (reason === null) return;
    const { error } = await sb.rpc("cancel_collection_contribution", { p_id: paymentId, p_reason: reason.trim() });
    if (error) return showAlert("#pageAlert", errorMessage(error), "error");
    showAlert("#pageAlert", "Paiement annulé (conservé dans l'historique).", "success");
    await refreshCurrent();
}

async function refreshCurrent() {
    try {
        await loadCollectionData(state.current.id);
    } catch (error) {
        showAlert("#pageAlert", errorMessage(error), "error");
    }
    renderDetail();
    if (!$("#memberDrawer").classList.contains("hidden")) renderDrawer();
}

/* ------------------------------------------------------------
   EXPORT / PRINT
------------------------------------------------------------ */
function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsv() {
    const e = state.current;
    const s = currentSummary();
    const num = m => CC.fromMillimes(m).toLocaleString("fr-FR", { minimumFractionDigits: 3 });
    const rows = [
        ["Collecte", e.title],
        ["Objectif (DT)", num(s.target)],
        ["Total collecté (DT)", num(s.collected)],
        ["Reste (DT)", num(s.remaining)],
        ["Excédent (DT)", num(s.surplus)],
        ["Progression (%)", s.target ? s.progress.toFixed(1) : ""],
        [],
        ["MEMBRES"],
        ["Nom", "Prénom", "N° abonnement", "Faculté", "Total versé (DT)", "Nb paiements", "Dernier paiement", "Objectif perso. (DT)", "Reste perso. (DT)", "Statut"],
        ...memberRowsData().sort((a, b) => b.total - a.total).map(r => [
            r.sub?.nom || "", r.sub?.prenom || "", r.sub?.numero_abonnement || "", facultyOf(r.sub),
            num(r.total), r.count, r.lastPaid || "",
            r.personalTarget ? num(r.personalTarget) : "", r.personalRemaining != null ? num(r.personalRemaining) : "",
            MEMBER_STATUS[r.status][0]
        ]),
        [],
        ["JOURNAL DES PAIEMENTS"],
        ["Date", "Nom", "Prénom", "N° abonnement", "Montant (DT)", "Mode", "Référence", "Note", "Statut", "Motif annulation", "Enregistré le"],
        ...state.payments.map(p => {
            const sub = state.subscriberById.get(p.subscriber_id);
            return [p.paid_on, sub?.nom || "", sub?.prenom || "", sub?.numero_abonnement || "", num(CC.toMillimes(p.amount)),
                METHOD_LABELS[p.method] || p.method, p.reference || "", p.notes || "",
                p.status === "VALID" ? "Valide" : "Annulé", p.cancel_reason || "", (p.created_at || "").slice(0, 19).replace("T", " ")];
        })
    ];
    const slug = (e.title || "collecte").normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
    download(`collecte-${slug}-${todayIso()}.csv`, CC.toCsv(rows), "text/csv;charset=utf-8");
}

/* ------------------------------------------------------------
   EVENTS WIRING
------------------------------------------------------------ */
function setupHandlers() {
    $("#addEventBtn").addEventListener("click", () => openEventForm());
    $("#eventForm").addEventListener("submit", saveEvent);
    $("#paymentForm").addEventListener("submit", savePayment);
    $("#collectionSearch").addEventListener("input", renderEvents);
    $("#collectionStatusFilter").addEventListener("change", renderEvents);

    $("#eventsGrid").addEventListener("click", async ev => {
        const el = ev.target.closest("[data-action]");
        if (!el) return;
        const { action, id } = el.dataset;
        ev.stopPropagation();
        if (action === "create") openEventForm();
        if (action === "open") openDetail(id);
        if (action === "pay") openDetail(id, { pay: true });
        if (action === "edit") openEventForm(state.events.find(e => String(e.id) === String(id)));
        if (action === "delete") deleteEvent(id);
    });
    $("#eventsGrid").addEventListener("keydown", ev => {
        if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches(".collection-card")) {
            ev.preventDefault();
            openDetail(ev.target.dataset.id);
        }
    });

    $("#backToList").addEventListener("click", backToList);
    $("#quickPayBtn").addEventListener("click", () => openPaymentForm());
    $("#editCollectionBtn").addEventListener("click", () => openEventForm(state.current));
    $("#exportBtn").addEventListener("click", exportCsv);
    $("#printBtn").addEventListener("click", () => window.print());

    document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach(t => { t.classList.toggle("active", t === tab); t.setAttribute("aria-selected", String(t === tab)); });
        $("#membersTab").classList.toggle("hidden", tab.dataset.tab !== "members");
        $("#ledgerTab").classList.toggle("hidden", tab.dataset.tab !== "ledger");
    }));

    ["#memberSearch", "#memberStatusFilter", "#memberSort"].forEach(sel =>
        $(sel).addEventListener(sel === "#memberSearch" ? "input" : "change", () => { state.memberPage = 1; renderMembers(); }));
    ["#ledgerSearch", "#ledgerMethod", "#ledgerStatus", "#ledgerFrom", "#ledgerTo", "#ledgerMin"].forEach(sel =>
        $(sel).addEventListener("input", () => { state.ledgerPage = 1; renderLedger(); }));

    $("#memberRows").addEventListener("click", ev => {
        const payBtn = ev.target.closest("[data-action='member-pay']");
        if (payBtn) { openPaymentForm({ memberId: payBtn.dataset.member }); return; }
        const row = ev.target.closest("tr[data-member]");
        if (row) openMemberDrawer(row.dataset.member);
    });
    $("#memberRows").addEventListener("keydown", ev => {
        if (ev.key === "Enter" && ev.target.matches("tr[data-member]")) openMemberDrawer(ev.target.dataset.member);
    });

    const paymentActions = ev => {
        const el = ev.target.closest("[data-action]");
        if (!el) return;
        const { action, id } = el.dataset;
        if (action === "edit-payment") openPaymentForm({ payment: state.payments.find(p => p.id === id) });
        if (action === "cancel-payment") cancelPayment(id);
        if (action === "open-member") openMemberDrawer(el.dataset.member);
        if (action === "drawer-pay") openPaymentForm({ memberId: state.drawerMember });
        if (action === "set-target") setPersonalTarget(false);
        if (action === "clear-target") setPersonalTarget(true);
    };
    $("#ledgerRows").addEventListener("click", paymentActions);
    $("#drawerBody").addEventListener("click", paymentActions);

    $("#paymentMemberSearch").addEventListener("input", renderMemberResults);
    $("#paymentMemberResults").addEventListener("click", ev => {
        const b = ev.target.closest("[data-pick]");
        if (b) { selectPaymentMember(b.dataset.pick); $("#paymentAmount").focus(); }
    });
    $("#paymentMemberSelected").addEventListener("click", ev => {
        if (ev.target.closest("[data-action='change-member']")) {
            selectPaymentMember(null);
            $("#paymentMemberSearch").focus();
        }
    });

    // Close buttons, backdrop clicks and Escape for every overlay.
    document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => closeModal(b)));
    document.querySelectorAll(".modal, .drawer-backdrop").forEach(m => m.addEventListener("mousedown", ev => {
        if (ev.target === m) m.classList.add("hidden");
    }));
    document.addEventListener("keydown", ev => {
        if (ev.key !== "Escape" || document.querySelector(".swal2-container")) return;
        const open = [...document.querySelectorAll(".modal:not(.hidden), .drawer-backdrop:not(.hidden)")].pop();
        open?.classList.add("hidden");
    });
}

async function init() {
    if (!window.sb) {
        console.error("Supabase client 'sb' introuvable.");
        return;
    }
    const ctx = await requirePermission("viewEvents");
    if (!ctx) return;
    state.ctx = ctx;
    // UI gating only: the database enforces the same rules (RLS + RPC checks).
    state.canConfigure = can(ctx, "manageCollections");
    state.canRecord = can(ctx, "manageEventPaymentStatuses");
    document.body.classList.toggle("can-configure", state.canConfigure);
    document.body.classList.toggle("can-record", state.canRecord);

    setupShell(ctx);
    setupHandlers();
    await loadEvents();

    const match = location.hash.match(/collecte=([\w-]+)/);
    if (match) openDetail(match[1]);
}

document.addEventListener("DOMContentLoaded", init);
