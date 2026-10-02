let currentStaffCtx = null;
let canManageEvents = false;
let canManageEventPayments = false;
let events = [];
let paymentCounts = new Map();
let activeSubscribersCount = 0;

let currentEvent = null;
let currentSubscribers = [];
let currentPayments = new Map();

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

    if (Array.isArray(subscriber.faculties)) {
        return subscriber.faculties[0]?.name || "";
    }

    return subscriber.faculties?.name || "";
}

async function loadEvents() {
    const eventsResult = await sb
        .from("events")
        .select("id,name,description,amount,event_date,is_active")
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
        .select("event_id,paid")
        .eq("paid", true);

    if (paymentsResult.error) {
        showAlert(
            "#pageAlert",
            paymentsResult.error.message,
            "error"
        );
        return false;
    }

    const subscribersResult = await sb
        .from("subscribers")
        .select("id", {
            count: "exact",
            head: true
        })
        .eq("status", "ACTIVE");

    if (subscribersResult.error) {
        showAlert(
            "#pageAlert",
            subscribersResult.error.message,
            "error"
        );
        return false;
    }

    events = eventsResult.data || [];

    activeSubscribersCount = subscribersResult.count || 0;

    paymentCounts = new Map();

    for (const payment of paymentsResult.data || []) {
        const eventId = payment.event_id;

        paymentCounts.set(
            eventId,
            (paymentCounts.get(eventId) || 0) + 1
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

        const status = event.is_active
            ? `<span class="status-badge success">Actif</span>`
            : `<span class="status-badge">Inactif</span>`;

        return `
            <article class="panel event-card">

                <div class="event-card-header">
                    <div>
                        <h3>${escapeHtml(event.name || "Sans nom")}</h3>

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
                    </div>

                </div>

                <div class="admin-card-actions">

                    <button
                        type="button"
                        class="btn primary"
                        data-action="payments"
                        data-id="${escapeHtml(String(event.id))}"
                    >
                        Gérer les paiements
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
        event?.name || "";

    $("#eventDescription").value =
        event?.description || "";

    $("#eventDate").value =
        getDateInputValue(event?.event_date);

    $("#eventAmount").value =
        event?.amount ?? "";

    $("#eventActive").value =
        String(event?.is_active ?? true);

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

    const confirmed = await confirmDialog(
        `Voulez-vous supprimer l'événement "${event.name}" ?`
    );

    if (!confirmed) return;

    const { error } = await sb
        .from("events")
        .delete()
        .eq("id", id);

    if (error) {
        showAlert(
            "#pageAlert",
            error.message,
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
    const name =
        $("#eventName").value.trim();

    const description =
        $("#eventDescription").value.trim();

    const eventDate =
        $("#eventDate").value || null;

    const amount =
        Number($("#eventAmount").value) || 0;

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

    const button =
        $("#saveEventBtn");

    if (button) {
        button.disabled = true;
    }

    let result;

    if (event) {
        result = await sb
            .from("events")
            .update({
                name: name,
                description: description || null,
                event_date: eventDate,
                amount: amount,
                is_active: isActive
            })
            .eq("id", event.id);
    } else {
        result = await sb
            .from("events")
            .insert({
                name: name,
                description: description || null,
                event_date: eventDate,
                amount: amount,
                is_active: isActive
            });
    }

    if (button) {
        button.disabled = false;
    }

    if (result.error) {
        showAlert(
            "#eventFormAlert",
            result.error.message,
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
}

async function loadSubscribersOnce() {
    if (currentSubscribers.length > 0) {
        return true;
    }

    const { data, error } = await sb
        .from("subscribers")
        .select(`
            id,
            nom,
            prenom,
            numero_abonnement,
            status,
            card_paid,
            faculties(name)
        `)
        .eq("status", "ACTIVE")
        .order("nom", {
            ascending: true
        });

    if (error) {
        showAlert(
            "#pageAlert",
            error.message,
            "error"
        );

        return false;
    }

    currentSubscribers = data || [];

    return true;
}

async function openPayments(eventId) {
    const event = events.find(
        item => String(item.id) === String(eventId)
    );

    if (!event) return;

    currentEvent = event;

    $("#payEventTitle").textContent =
        event.name || "Événement";

    $("#payEventMeta").textContent =
        `${formatEventDate(event.event_date)} • ${formatAmount(event.amount)}`;

    const loaded =
        await loadSubscribersOnce();

    if (!loaded) return;

    const { data, error } = await sb
        .from("event_payments")
        .select("subscriber_id,paid,paid_at")
        .eq("event_id", event.id);

    if (error) {
        showAlert(
            "#pageAlert",
            error.message,
            "error"
        );

        return;
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

    $("#eventPayModal")
        ?.classList
        .remove("hidden");
}

function closePaymentModal() {
    $("#eventPayModal")?.classList.add("hidden");
}

function renderPayStats() {
    const stats = $("#payStats");

    if (!stats) return;

    const total =
        currentSubscribers.length;

    const paid =
        [...currentPayments.values()]
            .filter(payment => payment.paid)
            .length;

    const unpaid =
        total - paid;

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
                payment?.paid === true;

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
            <div class="empty-state">
                Aucun adhérent trouvé.
            </div>
        `;

        return;
    }

    container.innerHTML = rows.map(subscriber => {

        const payment =
            currentPayments.get(
                subscriber.id
            );

        const paid =
            payment?.paid === true;

        const statusClass =
            paid
                ? "success"
                : "warning";

        const statusText =
            paid
                ? "Payé"
                : "Non payé";

        return `
            <div class="payment-row">

                <div class="payment-member">

                    <strong>
                        ${escapeHtml(
                            subscriber.nom || ""
                        )}
                        ${escapeHtml(
                            subscriber.prenom || ""
                        )}
                    </strong>

                    <small>
                        N° :
                        ${escapeHtml(
                            subscriber.numero_abonnement || "-"
                        )}
                    </small>

                    <small>
                        ${escapeHtml(
                            getFacultyName(subscriber)
                        )}
                    </small>

                </div>

                <div class="payment-status">
                    <span class="status-badge ${statusClass}">
                        ${statusText}
                    </span>
                </div>

                <div class="payment-action">

                    ${canManageEventPayments ? `<button type="button" class="btn ${paid ? "secondary" : "primary"}" data-action="toggle-payment" data-subscriber-id="${escapeHtml(String(subscriber.id))}">${paid ? "Annuler paiement" : "Marquer payé"}</button>` : ""}

                </div>

            </div>
        `;
    }).join("");
}

async function togglePayment(subscriberId, button = null) {
    if (!currentEvent || !canManageEventPayments) return showAlert("#pageAlert","Vous n’avez pas la permission de modifier les cotisations.","error");

    const existing =
        currentPayments.get(subscriberId);

    const nextPaid =
        !existing?.paid;

    if (button) {
        button.disabled = true;
    }

    const payload = {
        event_id: currentEvent.id,
        subscriber_id: subscriberId,
        paid: nextPaid,
        paid_at: nextPaid
            ? new Date().toISOString()
            : null
    };

    const { data, error } = await sb
        .from("event_payments")
        .upsert(
            payload,
            {
                onConflict:
                    "event_id,subscriber_id"
            }
        )
        .select(
            "subscriber_id,paid,paid_at"
        )
        .single();

    if (button) {
        button.disabled = false;
    }

    if (error) {
        console.error(
            "togglePayment error:",
            error
        );

        showAlert(
            "#pageAlert",
            error.message,
            "error"
        );

        return;
    }

    currentPayments.set(
        subscriberId,
        data
    );

    paymentCounts.set(
        currentEvent.id,
        [...currentPayments.values()]
            .filter(payment => payment.paid)
            .length
    );

    renderPayRows();
    renderPayStats();
    renderEvents();
}

function setupEvents() {

    $("#addEventBtn")?.addEventListener(
        "click",
        () => {
            openEventForm();
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
                subscriberId,
                button
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

    const ctx = await requireStaff();
    if (!ctx) return;
    currentStaffCtx = ctx;
    canManageEvents = hasContextRole(ctx, "SUPERADMIN");
    canManageEventPayments = canManageEvents || hasContextRole(ctx, "TREASURER");
    setupShell(ctx);
    $("#addEventBtn")?.classList.toggle("hidden", !canManageEvents);
    setupEvents();

    await loadEvents();
}

document.addEventListener(
    "DOMContentLoaded",
    init
);