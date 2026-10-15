let currentStaffCtx = null;
let canManageEvents = false;
let canManageEventPayments = false;
let events = [];
let paymentCounts = new Map();
let collectedTotals = new Map();
const pendingPaymentToggles = new Set();
let activeSubscribersCount = 0;

let currentEvent = null;
let currentSubscribers = [];
let currentPayments = new Map();
let eventSaveInProgress = false;

function formatAmount(amount) {
    const n = Number(amount) || 0;

    return `${n.toLocaleString("fr-TN", {
        minimumFractionDigits: n % 1 ? 2 : 0,
        maximumFractionDigits: 2
    })} DT`;
}

function getDateInputValue(value) {
    if (!value) return "";

    const text = String(value);

    if (text.length >= 10) {
        return text.substring(0, 10);
    }

    return "";
}

function formatEventDate(value) {
    if (!value) return "Date non définie";

    const datePart = getDateInputValue(value);

    if (!datePart) return "Date non définie";

    const parts = datePart.split("-");

    if (parts.length !== 3) {
        return "Date non définie";
    }

    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);

    const date = new Date(year, month - 1, day);

    if (Number.isNaN(date.getTime())) {
        return "Date non définie";
    }

    return date.toLocaleDateString("fr-TN", {
        day: "2-digit",
        month: "long",
        year: "numeric"
    });
}

function getFacultyName(subscriber) {
    if (!subscriber) return "";

    if (subscriber.faculty_name) return subscriber.faculty_name;

    if (Array.isArray(subscriber.faculties)) {
        return subscriber.faculties[0]?.name || "";
    }

    return subscriber.faculties?.name || "";
}

async function loadEvents() {
    const eventsResult = await sb
        .from("events")
        .select("id,title,description,amount,event_date,is_active")
        .order("event_date", {
            ascending: false
        });

    if (eventsResult.error) {
        showAlert(
            "#pageAlert",
            eventsResult.error.message,
            "error"
        );
        return false;
    }

    const paymentsResult = await sb
        .from("event_payments")
        .select("event_id,amount")
        .eq("status", "PAID");

    if (paymentsResult.error) {
        showAlert(
            "#pageAlert",
            paymentsResult.error.message,
            "error"
        );
        return false;
    }

    const subscribersLoaded =
        await loadSubscribersOnce();

    if (!subscribersLoaded) {
        return false;
    }

    events = eventsResult.data || [];

    activeSubscribersCount = currentSubscribers.length;

    paymentCounts = new Map();
    collectedTotals = new Map();

    for (const payment of paymentsResult.data || []) {
        const eventId = payment.event_id;

        paymentCounts.set(
            eventId,
            (paymentCounts.get(eventId) || 0) + 1
        );
        collectedTotals.set(
            eventId,
            (collectedTotals.get(eventId) || 0) + (Number(payment.amount) || 0)
        );
    }

    renderEvents();

    return true;
}

function renderEvents() {
    const container = $("#eventsGrid");

    if (!container) return;

    if (!events.length) {
        container.innerHTML = `
            <div class="panel">
                ${canManageEvents
                    ? "Aucun événement pour le moment. Ajoutez-en un pour commencer une collecte."
                    : "Aucun événement enregistré pour le moment."}
            </div>
        `;

        return;
    }

    container.innerHTML = events.map(event => {
        const paidCount =
            paymentCounts.get(event.id) || 0;

        const amount = formatAmount(event.amount);
        const collected = formatAmount(collectedTotals.get(event.id) || 0);
        const expected = formatAmount((Number(event.amount) || 0) * activeSubscribersCount);

        const status = event.is_active
            ? `<span class="status-badge success">Actif</span>`
            : `<span class="status-badge">Inactif</span>`;

        return `
            <article class="panel event-card">

                <div class="event-card-header">
                    <div>
                        <h3>${escapeHtml(event.title || "Sans nom")}</h3>

                        <p>
                            ${formatEventDate(event.event_date)}
                        </p>
                    </div>

                    ${status}
                </div>

                <div class="event-card-body">

                    <p>
                        ${escapeHtml(
                            event.description || "Aucune description"
                        )}
                    </p>

                    <div class="event-meta">
                        <span>
                            Montant :
                            <strong>${amount}</strong>
                        </span>

                        <span>
                            Paiements :
                            <strong>
                                ${paidCount} / ${activeSubscribersCount}
                            </strong>
                        </span>

                        <span>
                            Collecté :
                            <strong>${collected}</strong>
                            <small>sur ${expected}</small>
                        </span>
                    </div>

                </div>

                <div class="admin-card-actions">

                    <button
                        type="button"
                        class="btn primary"
                        data-action="payments"
                        data-id="${escapeHtml(String(event.id))}"
                    >
                        ${canManageEventPayments ? "Gérer les paiements" : "Voir les paiements"}
                    </button>

                    ${canManageEvents ? `<button type="button" class="btn secondary" data-action="edit" data-id="${escapeHtml(String(event.id))}">${window.ICONS?.edit || ""} Modifier</button>
                    <button type="button" class="btn danger-btn" data-action="delete" data-id="${escapeHtml(String(event.id))}">${window.ICONS?.trash || ""} Supprimer</button>` : ""}

                </div>

            </article>
        `;
    }).join("");
}

function openEventForm(event = null) {
    const modal = $("#eventFormModal");

    if (!modal) return;

    $("#eventFormTitle").textContent =
        event
            ? "Modifier un événement"
            : "Ajouter un événement";

    $("#eventId").value =
        event?.id || "";

    $("#eventName").value =
        event?.title || "";

    $("#eventDescription").value =
        event?.description || "";

    $("#eventDate").value =
        getDateInputValue(event?.event_date);

    $("#eventAmount").value =
        event?.amount ?? "";

    $("#eventActive").value =
        String(event?.is_active ?? true);

    $("#eventFormAlert").textContent = "";

    modal.classList.remove("hidden");
}

function closeEventForm() {
    $("#eventFormModal")?.classList.add("hidden");
}

async function deleteEvent(id) {
    const event = events.find(
        item => String(item.id) === String(id)
    );

    if (!event) return;

    const paidCount = paymentCounts.get(event.id) || 0;
    const confirmed = await confirmDialog(
        paidCount
            ? `Supprimer l'événement "${event.title}" ? ${paidCount} paiement(s) enregistré(s) seront également supprimés. Cette action est irréversible.`
            : `Voulez-vous supprimer l'événement "${event.title}" ?`,
        { confirmText: "Supprimer" }
    );

    if (!confirmed) return;

    const failure = writeError(await sb
        .from("events")
        .delete()
        .eq("id", id)
        .select("id"));

    if (failure) {
        showAlert(
            "#pageAlert",
            failure,
            "error"
        );

        return;
    }

    showAlert(
        "#pageAlert",
        "Événement supprimé.",
        "success"
    );

    await loadEvents();
}

async function saveEvent(event) {
    if (eventSaveInProgress || !canManageEvents) return;

    const name =
        $("#eventName").value.trim();

    const description =
        $("#eventDescription").value.trim();

    const eventDate =
        $("#eventDate").value || null;

    const amountText =
        $("#eventAmount").value.trim();
    const amount = Number(amountText);

    const isActive =
        $("#eventActive").value === "true";

    if (!name) {
        showAlert(
            "#eventFormAlert",
            "Le nom de l'événement est obligatoire.",
            "error"
        );

        return;
    }

    if (!amountText || !Number.isFinite(amount) || amount < 0) {
        showAlert(
            "#eventFormAlert",
            "Le montant doit être un nombre positif ou nul.",
            "error"
        );

        return;
    }

    const button =
        $("#saveEventBtn");
    const originalButtonText = button?.textContent || "Enregistrer";

    eventSaveInProgress = true;

    if (button) {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        button.textContent = "Enregistrement…";
    }

    try {
        let result;

        if (event) {
            result = await sb
                .from("events")
                .update({
                    title: name,
                    description: description || null,
                    event_date: eventDate,
                    amount: amount,
                    is_active: isActive
                })
                .eq("id", event.id)
                .select("id");
        } else {
            result = await sb
                .from("events")
                .insert({
                    title: name,
                    description: description || null,
                    event_date: eventDate,
                    amount: amount,
                    is_active: isActive
                })
                .select("id");
        }

        const failure = writeError(result);

        if (failure) {
            showAlert(
                "#eventFormAlert",
                failure,
                "error"
            );

            return;
        }

        closeEventForm();

        showAlert(
            "#pageAlert",
            event
                ? "Événement modifié."
                : "Événement ajouté.",
            "success"
        );

        await loadEvents();
    } catch (_) {
        showAlert(
            "#eventFormAlert",
            "L’enregistrement de l’événement a échoué. Vérifiez votre connexion puis réessayez.",
            "error"
        );
    } finally {
        eventSaveInProgress = false;
        if (button) {
            button.disabled = false;
            button.removeAttribute("aria-busy");
            button.textContent = originalButtonText;
        }
    }
}

async function loadSubscribersOnce() {
    if (currentSubscribers.length > 0) {
        return true;
    }

    // Identification + payment fields only (no personal data), for every staff role.
    const { data, error } = await sb.rpc("list_payment_members");

    if (error) {
        showAlert(
            "#pageAlert",
            error.message,
            "error"
        );

        return false;
    }

    currentSubscribers = (data || []).filter(subscriber => subscriber.status === "ACTIVE");

    return true;
}

async function openPayments(eventId) {
    const event = events.find(
        item => String(item.id) === String(eventId)
    );

    if (!event) return;

    currentEvent = event;

    $("#payEventTitle").textContent =
        event.title || "Événement";

    $("#payEventMeta").textContent =
        `${formatEventDate(event.event_date)} • ${formatAmount(event.amount)}`;

    const rowsContainer = $("#payRows");
    if (rowsContainer) {
        rowsContainer.innerHTML = '<tr><td colspan="6" class="loading-state">Chargement des paiements…</td></tr>';
    }
    $("#payStats").innerHTML = "";
    $("#eventPayModal")?.classList.remove("hidden");

    const loaded =
        await loadSubscribersOnce();

    if (!loaded) return closePaymentModal();

    const { data, error } = await sb
        .from("event_payments")
        .select("subscriber_id,status,paid_at,amount")
        .eq("event_id", event.id);

    if (error) {
        showAlert(
            "#pageAlert",
            error.message,
            "error"
        );

        return closePaymentModal();
    }

    currentPayments = new Map();

    for (const payment of data || []) {
        currentPayments.set(
            payment.subscriber_id,
            payment
        );
    }

    renderPayRows();
    renderPayStats();
}

function isPaid(payment) {
    return payment?.status === "PAID";
}

function closePaymentModal() {
    $("#eventPayModal")?.classList.add("hidden");
}

function renderPayStats() {
    const stats = $("#payStats");

    if (!stats) return;

    const total =
        currentSubscribers.length;

    const paidSubscribers =
        currentSubscribers.filter(subscriber => isPaid(currentPayments.get(subscriber.id)));

    const paid =
        paidSubscribers.length;

    const unpaid =
        total - paid;

    const collected =
        paidSubscribers.reduce((sum, subscriber) => sum + (Number(currentPayments.get(subscriber.id)?.amount) || 0), 0);

    stats.innerHTML = `
        <div class="stat-card">
            <strong>${total}</strong>
            <span>Total</span>
        </div>

        <div class="stat-card">
            <strong>${paid}</strong>
            <span>Payés</span>
        </div>

        <div class="stat-card">
            <strong>${unpaid}</strong>
            <span>Non payés</span>
        </div>

        <div class="stat-card">
            <strong>${formatAmount(collected)}</strong>
            <span>Collecté</span>
        </div>
    `;
}

function renderPayRows() {
    const container = $("#payRows");

    if (!container) return;

    const search =
        ($("#paySearch")?.value || "")
            .trim()
            .toLowerCase();

    const filter =
        $("#payFilter")?.value || "all";

    const rows =
        currentSubscribers.filter(subscriber => {

            const fullName =
                `${subscriber.nom || ""} ${subscriber.prenom || ""}`
                    .toLowerCase();

            const number =
                String(
                    subscriber.numero_abonnement || ""
                ).toLowerCase();

            const faculty =
                getFacultyName(subscriber)
                    .toLowerCase();

            const matchesSearch =
                !search ||
                fullName.includes(search) ||
                number.includes(search) ||
                faculty.includes(search);

            const payment =
                currentPayments.get(
                    subscriber.id
                );

            const paid =
                isPaid(payment);

            let matchesFilter = true;

            if (filter === "paid") {
                matchesFilter = paid;
            }

            if (filter === "unpaid") {
                matchesFilter = !paid;
            }

            return (
                matchesSearch &&
                matchesFilter
            );
        });

    if (!rows.length) {
        container.innerHTML = `
            <tr>
                <td colspan="6" class="empty">
                    Aucun adhérent trouvé.
                </td>
            </tr>
        `;

        return;
    }

    container.innerHTML = rows.map(subscriber => {

        const payment =
            currentPayments.get(
                subscriber.id
            );

        const paid =
            isPaid(payment);

        const busy =
            pendingPaymentToggles.has(subscriber.id);

        // Separation of duties: a treasurer cannot change their own cotisation.
        const ownRowLocked =
            subscriber.is_self && !canManageEvents;

        const paidDate =
            paid && payment?.paid_at
                ? new Date(payment.paid_at).toLocaleDateString("fr-TN")
                : "";

        return `
            <tr>
                <td>${escapeHtml(subscriber.nom || "")}</td>
                <td>${escapeHtml(subscriber.prenom || "")}</td>
                <td>${escapeHtml(subscriber.numero_abonnement || "—")}</td>
                <td>${escapeHtml(facultyShort(getFacultyName(subscriber)) || "—")}</td>
                <td>
                    <span class="status-badge ${paid ? "success" : "warning"}" title="${escapeHtml(paidDate ? `Payé le ${paidDate}` : "")}">
                        ${paid ? "Payé" : "Non payé"}
                    </span>
                </td>
                <td>
                    ${canManageEventPayments && ownRowLocked
                        ? `<span class="muted-text" title="Votre propre cotisation doit être validée par un super administrateur.">🔒 Super admin requis</span>`
                        : canManageEventPayments
                        ? `<button type="button" class="btn ${paid ? "secondary" : "primary"}" data-action="toggle-payment" data-subscriber-id="${escapeHtml(String(subscriber.id))}" ${busy ? 'disabled aria-busy="true"' : ""}>${paid ? "Marquer non payé" : "Marquer payé"}</button>`
                        : "—"}
                </td>
            </tr>
        `;
    }).join("");
}

async function togglePayment(subscriberId) {
    if (!currentEvent || !canManageEventPayments) {
        return showAlert("#pageAlert", "Vous n’avez pas la permission de modifier les cotisations.", "error");
    }

    if (pendingPaymentToggles.has(subscriberId)) return;

    const target = currentSubscribers.find(subscriber => String(subscriber.id) === String(subscriberId));
    if (target?.is_self && !canManageEvents) {
        return showAlert("#pageAlert", "Votre propre cotisation doit être validée par un super administrateur.", "error");
    }

    const nextPaid =
        !isPaid(currentPayments.get(subscriberId));

    pendingPaymentToggles.add(subscriberId);
    renderPayRows();

    const eventId = currentEvent.id;
    const { data, error } = await sb.rpc("set_event_payment_status", {
        p_event_id: eventId,
        p_subscriber_id: subscriberId,
        p_paid: nextPaid
    });

    pendingPaymentToggles.delete(subscriberId);

    if (error) {
        console.error("togglePayment error:", error);
        showAlert("#pageAlert", error.message, "error");
        renderPayRows();
        return;
    }

    currentPayments.set(subscriberId, {
        subscriber_id: subscriberId,
        status: data.status,
        paid_at: data.paid_at,
        amount: data.amount
    });

    const paidPayments =
        [...currentPayments.values()].filter(isPaid);

    paymentCounts.set(eventId, paidPayments.length);
    collectedTotals.set(eventId, paidPayments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0));

    renderPayRows();
    renderPayStats();
    renderEvents();
}

function setupEvents() {

    $("#addEventBtn")?.addEventListener(
        "click",
        () => {
            if (canManageEvents) openEventForm();
        }
    );

    $("#closeEventFormModal")?.addEventListener(
        "click",
        closeEventForm
    );

    $("#cancelEventForm")?.addEventListener(
        "click",
        closeEventForm
    );

    $("#closePayModal")?.addEventListener(
        "click",
        closePaymentModal
    );

    $("#eventForm")?.addEventListener(
        "submit",
        async event => {
            event.preventDefault();

            const id =
                $("#eventId")?.value;

            const existingEvent =
                id
                    ? events.find(
                        item =>
                            String(item.id) ===
                            String(id)
                    )
                    : null;

            await saveEvent(
                existingEvent
            );
        }
    );

    $("#eventsGrid")?.addEventListener(
        "click",
        async event => {

            const button =
                event.target.closest(
                    "button[data-action]"
                );

            if (!button) return;

            const action =
                button.dataset.action;

            const id =
                button.dataset.id;

            if (action === "payments") {
                await openPayments(id);
            }

            if (action === "edit" && canManageEvents) {
                const selected =
                    events.find(
                        item =>
                            String(item.id) ===
                            String(id)
                    );

                if (selected) {
                    openEventForm(selected);
                }
            }

            if (action === "delete" && canManageEvents) {
                await deleteEvent(id);
            }
        }
    );

    $("#payRows")?.addEventListener(
        "click",
        async event => {

            const button =
                event.target.closest(
                    "button[data-action='toggle-payment']"
                );

            if (!button) return;

            const subscriberId =
                button.dataset.subscriberId;

            await togglePayment(
                subscriberId
            );
        }
    );

    $("#paySearch")?.addEventListener(
        "input",
        renderPayRows
    );

    $("#payFilter")?.addEventListener(
        "change",
        renderPayRows
    );

    [
        $("#eventFormModal"),
        $("#eventPayModal")
    ].forEach(modal => {

        if (!modal) return;

        modal.addEventListener(
            "click",
            event => {

                if (event.target !== modal) {
                    return;
                }

                modal.classList.add("hidden");
            }
        );
    });
}

async function init() {

    if (!window.sb) {
        console.error(
            "Supabase client 'sb' introuvable."
        );

        return;
    }

    const ctx = await requirePermission("viewEvents");
    if (!ctx) return;
    currentStaffCtx = ctx;
    canManageEvents = can(ctx, "manageEvents");
    canManageEventPayments = can(ctx, "manageEventPaymentStatuses");
    setupShell(ctx);
    $("#addEventBtn")?.classList.toggle("hidden", !canManageEvents);
    setupEvents();

    await loadEvents();
}

document.addEventListener(
    "DOMContentLoaded",
    init
);
