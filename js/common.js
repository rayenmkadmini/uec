const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

/* ============================================================
   UE CLUBISTE — ICONS
============================================================ */

const ICONS = {
    edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 20l.9-3.9L16.6 4.4a1.8 1.8 0 012.6 0l.4.4a1.8 1.8 0 010 2.6L8 19l-4 1z"/>
        <path d="M14.5 6.5l3 3"/>
    </svg>`,

    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 7h14"/>
        <path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2"/>
        <path d="M7 7l1 12.5A1.5 1.5 0 009.5 21h5a1.5 1.5 0 001.5-1.5L17 7"/>
        <path d="M10 11v6M14 11v6"/>
    </svg>`,

    play: `<svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5.5v13l11-6.5z"/>
    </svg>`,

    pause: `<svg viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="5" width="4.5" height="14" rx="1"/>
        <rect x="13.5" y="5" width="4.5" height="14" rx="1"/>
    </svg>`,

    refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 12a8 8 0 10-2.6 5.9"/>
        <path d="M20 7v5h-5"/>
    </svg>`,

    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <path d="M6 6l12 12M18 6L6 18"/>
    </svg>`,

    menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <path d="M4 7h16M4 12h16M4 17h16"/>
    </svg>`,

    logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M13.5 4H18a2 2 0 012 2v12a2 2 0 01-2 2h-4.5"/>
        <path d="M3 12h11.5"/>
        <path d="M11 8l4 4-4 4"/>
    </svg>`
};

window.ICONS = ICONS;


/* ============================================================
   SWEETALERT
============================================================ */

function swalBase() {
    const dark =
        document.documentElement.getAttribute("data-theme") === "dark";

    return {
        background: dark ? "#15171b" : "#ffffff",
        color: dark ? "#f2f3f5" : "#111214",
        confirmButtonColor: "#c8102e",
        cancelButtonColor: dark ? "#24272e" : "#f1f1f3",
        buttonsStyling: true
    };
}

function showAlert(target, message, type = "success") {
    const displayMessage = type === "error" ? userFacingError(message) : String(message || "");

    if (!window.Swal) {
        alert(displayMessage);
        return;
    }

    Swal.fire({
        ...swalBase(),
        toast: true,
        position: "top-end",
        icon: type === "error" ? "error" : "success",
        title: displayMessage,
        showConfirmButton: false,
        timer: type === "error" ? 4500 : 3000,
        timerProgressBar: true
    });
}

function userFacingError(message) {
    const text = String(message || "").trim();
    const lower = text.toLowerCase();

    if (/permission|not authorized|forbidden|42501/.test(lower)) {
        return "Vous n’avez pas l’autorisation d’effectuer cette action.";
    }
    if (/jwt|token|session expir|auth session/.test(lower)) {
        return "Votre session a expiré. Reconnectez-vous pour continuer.";
    }
    if (/network|fetch|timeout|offline|connexion impossible/.test(lower)) {
        return "Connexion impossible. Vérifiez votre réseau puis réessayez.";
    }
    if (/numero.?abonnement|subscription number/.test(lower)) {
        return "Le numéro d’abonnement est optionnel, mais le service d’inscription doit accepter cette valeur absente. Contactez l’administration.";
    }
    if (/postgres|postgrest|pgrst|sqlstate|\b[0-9]{5}\b|relation .* does not exist|column .* does not exist|constraint|stack trace|status code|authapierror|storageapierror|functionshttperror|invalid api key|bucket .*not found|duplicate key|violates/.test(lower)) {
        return "Une erreur technique est survenue. Veuillez réessayer ou contacter l’administration.";
    }

    return text.length > 220
        ? "Une erreur est survenue. Veuillez réessayer ou contacter l’administration."
        : text || "Une erreur est survenue. Veuillez réessayer.";
}

async function confirmDialog(message, opts = {}) {
    if (!window.Swal) {
        return confirm(message);
    }

    const result = await Swal.fire({
        ...swalBase(),
        title: opts.title || "Confirmer",
        text: message,
        icon: opts.icon || "warning",
        showCancelButton: true,
        confirmButtonText: opts.confirmText || "Oui, confirmer",
        cancelButtonText: "Annuler",
        reverseButtons: true,
        focusCancel: true
    });

    return result.isConfirmed;
}

async function promptDialog(message, opts = {}) {
    if (!window.Swal) {
        const value = prompt(message);
        return value || null;
    }

    const result = await Swal.fire({
        ...swalBase(),
        title: message,
        input: opts.input || "text",
        inputPlaceholder: opts.placeholder || "",
        inputValue: opts.value || "",
        showCancelButton: true,
        confirmButtonText: opts.confirmText || "Valider",
        cancelButtonText: "Annuler",
        reverseButtons: true,
        inputValidator: opts.validator
    });

    return result.isConfirmed ? result.value : null;
}


/* ============================================================
   HELPERS
============================================================ */

function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, char => {
        const map = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        };

        return map[char];
    });
}

function syntheticEmail(login) {
    return `${String(login)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, "-")}@login.ueclubiste.local`;
}

async function getSubscriberPhotoUrl(storedPath) {
    if (!storedPath || !window.sb?.storage) return "";

    let path = String(storedPath).trim();
    const marker = "/storage/v1/object/public/subscriber-photos/";
    const markerIndex = path.indexOf(marker);
    if (markerIndex >= 0) path = path.slice(markerIndex + marker.length);
    else if (/^https?:\/\//i.test(path)) return "";
    path = path.replace(/^subscriber-photos\//, "").replace(/^\/+/, "");
    if (!path || path.split("/").some(part => part === "..")) return "";

    const { data, error } = await sb.storage.from("subscriber-photos").createSignedUrl(path, 3600);
    return error ? "" : data?.signedUrl || "";
}

function facultyShort(name) {
    if (!name) return name;

    const index = name.indexOf(" — ");

    return index === -1
        ? name
        : name.slice(0, index);
}

function getTeamLogo(teamName, fallbackLabel, customUrl) {
    if (customUrl && String(customUrl).trim()) {
        return customUrl;
    }

    const team = (teamName || fallbackLabel || "TEAM").trim();

    const initials = team
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(word => word.charAt(0).toUpperCase())
        .join("") || "T";

    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg"
             width="120"
             height="120"
             viewBox="0 0 120 120">

            <defs>
                <linearGradient id="g"
                    x1="0"
                    x2="1"
                    y1="0"
                    y2="1">

                    <stop offset="0%" stop-color="#c8102e"/>
                    <stop offset="100%" stop-color="#3b0b16"/>

                </linearGradient>
            </defs>

            <rect
                width="120"
                height="120"
                rx="28"
                fill="#0f1012"/>

            <circle
                cx="60"
                cy="60"
                r="38"
                fill="url(#g)"
                opacity="0.95"/>

            <text
                x="60"
                y="69"
                text-anchor="middle"
                font-family="Arial, sans-serif"
                font-size="28"
                font-weight="700"
                fill="#ffffff">
                ${initials}
            </text>

        </svg>
    `;

    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function statusBadge(status) {
    return `
        <span class="badge ${status === "ACTIVE" ? "active" : "inactive"}">
            ${status === "ACTIVE" ? "Actif" : "Désactivé"}
        </span>
    `;
}


/* ============================================================
   AUTHENTICATION
============================================================ */

function normalizeRoleNames(roles) {
    return [...new Set((roles || [])
        .map(role => String(role || "").trim().toUpperCase())
        .filter(Boolean))];
}

async function fetchUserRolesForUser(userId) {
    if (!userId) return [];

    try {
        const { data, error } = await sb.from("user_roles").select("role").eq("user_id", userId);
        if (error) throw error;
        return normalizeRoleNames((data || []).map(item => item?.role));
    } catch (error) {
        console.error("Canonical user roles are unavailable; access denied.", error);
        return [];
    }
}

function hasContextRole(ctx, roleName) {
    const roles = normalizeRoleNames(ctx?.roles || []);
    return roles.includes(String(roleName).trim().toUpperCase());
}

async function getCurrentContext() {
    if (!window.sb) {
        console.error("Supabase client 'sb' introuvable.");
        return null;
    }

    const {
        data: { user },
        error
    } = await sb.auth.getUser();

    if (error || !user) {
        return null;
    }

    const { data: profile, error: profileError } =
        await sb
            .from("profiles")
            .select("display_name,must_change_password,is_active")
            .eq("id", user.id)
            .single();

    if (profileError) {
        console.error("Erreur profile:", profileError);
        return null;
    }

    if (!profile || profile.is_active === false) {
        await sb.auth.signOut();
        return null;
    }

    const roles = await fetchUserRolesForUser(user.id);

    return {
        user,
        profile,
        roles
    };
}

async function requireSuperAdmin() {
    const ctx = await getCurrentContext();
    if (!ctx) { location.href = "index.html"; return null; }
    if (!hasContextRole(ctx, "SUPERADMIN")) {
        location.href = "dashboard.html";
        return null;
    }
    if (ctx.profile.must_change_password && !location.pathname.endsWith("change-password.html")) {
        location.href = "change-password.html";
        return null;
    }
    return ctx;
}

function canManageEverything(ctx) {
    return hasContextRole(ctx, "SUPERADMIN");
}

function isTreasurerContext(ctx) {
    return hasContextRole(ctx, "TREASURER");
}

function isStaffContext(ctx) {
    return ["ADMIN", "SUPERADMIN", "TREASURER"].some(role => hasContextRole(ctx, role));
}

async function requireStaff() {
    const ctx = await getCurrentContext();
    if (!ctx) { location.href = "index.html"; return null; }
    if (!isStaffContext(ctx)) {
        location.href = hasContextRole(ctx, "MEMBER") ? "subscriber.html" : "index.html";
        return null;
    }
    if (ctx.profile.must_change_password && !location.pathname.endsWith("change-password.html")) {
        location.href = "change-password.html";
        return null;
    }
    return ctx;
}

async function requireTreasurer() {
    const ctx = await getCurrentContext();
    if (!ctx) { location.href = "index.html"; return null; }
    if (!(hasContextRole(ctx, "SUPERADMIN") || hasContextRole(ctx, "TREASURER"))) {
        location.href = "dashboard.html";
        return null;
    }
    if (ctx.profile.must_change_password && !location.pathname.endsWith("change-password.html")) {
        location.href = "change-password.html";
        return null;
    }
    return ctx;
}

async function requireAdmin() {
    const ctx = await getCurrentContext();

    if (!ctx) {
        location.href = "index.html";
        return null;
    }

    if (!["ADMIN", "SUPERADMIN"].some(role => hasContextRole(ctx, role))) {
        location.href = "subscriber.html";
        return null;
    }

    if (
        ctx.profile.must_change_password &&
        !location.pathname.endsWith("change-password.html")
    ) {
        location.href = "change-password.html";
        return null;
    }

    return ctx;
}

async function requireSubscriber() {
    const ctx = await getCurrentContext();

    if (!ctx) {
        location.href = "index.html";
        return null;
    }

    const isMember = hasContextRole(ctx, "MEMBER");
    if (!isMember) {
        location.href = "dashboard.html";
        return null;
    }

    if (
        ctx.profile.must_change_password &&
        !location.pathname.endsWith("change-password.html")
    ) {
        location.href = "change-password.html";
        return null;
    }

    return ctx;
}

async function requireAuthenticated() {
    const ctx = await getCurrentContext();

    if (!ctx) {
        location.href = "index.html";
        return null;
    }

    if (
        ctx.profile.must_change_password &&
        !location.pathname.endsWith("change-password.html")
    ) {
        location.href = "change-password.html";
        return null;
    }

    return ctx;
}


/* ============================================================
   SHELL
============================================================ */

function setupShell(ctx = null) {
    const sidebar = $(".sidebar");
    const menuButton = $("#menuBtn");
    sidebar?.querySelector("nav")?.setAttribute("aria-label", "Navigation principale");
    sidebar?.setAttribute("aria-label", "Navigation UE Clubiste");
    const brandLogo = sidebar?.querySelector(".side-brand img");
    if (brandLogo && !brandLogo.hasAttribute("alt")) brandLogo.setAttribute("alt", "UE Clubiste");

    if (ctx) {
        const roles = normalizeRoleNames(ctx.roles || []).filter(role => ["SUPERADMIN", "ADMIN", "TREASURER", "MEMBER"].includes(role));
        const displayName = ctx.profile?.display_name || ctx.user?.user_metadata?.display_name || "Utilisateur";
        const topUser = $(".top-user");
        const nameNode = topUser?.querySelector("span:not(.role-summary)");
        const avatar = topUser?.querySelector(".avatar");

        if (nameNode) {
            nameNode.textContent = displayName;
            if (!nameNode.closest(".top-user-meta")) {
                const meta = document.createElement("div");
                meta.className = "top-user-meta";
                nameNode.insertAdjacentElement("beforebegin", meta);
                meta.appendChild(nameNode);
            }
        }
        if (avatar) {
            avatar.textContent = Array.from(displayName.trim())[0]?.toLocaleUpperCase() || "U";
            avatar.setAttribute("aria-hidden", "true");
        }

        if (topUser && roles.length) {
            let roleSummary = topUser.querySelector(".role-summary");
            if (!roleSummary) {
                roleSummary = document.createElement("span");
                roleSummary.className = "role-summary";
                (nameNode?.closest(".top-user-meta") || topUser).appendChild(roleSummary);
            }
            roleSummary.textContent = roles.join(" · ");
            roleSummary.setAttribute("aria-label", `Rôles : ${roles.join(", ")}`);
            if (avatar) avatar.title = `${displayName} — ${roles.join(" · ")}`;
        }

        if (sidebar && roles.length) {
            let sidebarRoles = sidebar.querySelector(".side-role-summary");
            if (!sidebarRoles) {
                sidebarRoles = document.createElement("span");
                sidebarRoles.className = "side-role-summary";
                sidebar.querySelector(".side-brand > div")?.appendChild(sidebarRoles);
            }
            if (sidebarRoles) sidebarRoles.textContent = roles.join(" · ");
        }

        const treasurerOnly = isTreasurerContext(ctx) &&
            !hasContextRole(ctx, "ADMIN") &&
            !hasContextRole(ctx, "SUPERADMIN");
        const adminSidebar = [...(sidebar?.querySelectorAll("nav a") || [])]
            .some(link => (link.getAttribute("href") || "").endsWith("dashboard.html"));
        const memberRole = hasContextRole(ctx, "MEMBER");
        if (adminSidebar && memberRole && !sidebar.querySelector('nav a[href="subscriber.html"]')) {
            const memberLink = document.createElement("a");
            memberLink.href = "subscriber.html";
            if (location.pathname.endsWith("subscriber.html")) memberLink.classList.add("active");
            memberLink.innerHTML = '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.5 2.8-5.8 7-5.8s7 2.3 7 5.8"/></svg><span>Mon profil</span>';
            sidebar.querySelector("nav")?.appendChild(memberLink);
        }
        sidebar?.querySelectorAll("nav a").forEach(link => {
            if (link.classList.contains("active")) link.setAttribute("aria-current", "page");
            else link.removeAttribute("aria-current");
        });
        if (treasurerOnly && adminSidebar) {
            sidebar.querySelectorAll("nav a").forEach(link => {
                const href = link.getAttribute("href") || "";
                const allowed = ["subscribers.html", "payments.html", "subscriber.html", "matchs.html"];
                if (!allowed.some(page => href.endsWith(page))) link.classList.add("hidden");
            });
        }
    }

    $("#logoutBtn")?.addEventListener("click", async () => {
        await sb.auth.signOut();
        location.href = "index.html";
    });

    if (sidebar && menuButton && !menuButton.dataset.drawerReady) {
        menuButton.dataset.drawerReady = "true";
        if (!sidebar.id) sidebar.id = "appSidebar";
        menuButton.setAttribute("aria-controls", sidebar.id);
        menuButton.setAttribute("aria-label", "Ouvrir le menu");
        menuButton.setAttribute("aria-expanded", "false");

        let backdrop = $(".sidebar-backdrop");
        if (!backdrop) {
            backdrop = document.createElement("button");
            backdrop.type = "button";
            backdrop.className = "sidebar-backdrop";
            backdrop.setAttribute("aria-label", "Fermer le menu");
            backdrop.setAttribute("tabindex", "-1");
            sidebar.insertAdjacentElement("afterend", backdrop);
        }

        const closeDrawer = (restoreFocus = true) => {
            sidebar.classList.remove("open");
            backdrop.classList.remove("visible");
            document.body.classList.remove("nav-open");
            menuButton.setAttribute("aria-expanded", "false");
            menuButton.setAttribute("aria-label", "Ouvrir le menu");
            if (restoreFocus && window.matchMedia("(max-width: 900px)").matches) menuButton.focus();
        };

        const openDrawer = () => {
            sidebar.classList.add("open");
            backdrop.classList.add("visible");
            document.body.classList.add("nav-open");
            menuButton.setAttribute("aria-expanded", "true");
            menuButton.setAttribute("aria-label", "Fermer le menu");
            sidebar.querySelector("nav a:not(.hidden)")?.focus();
        };

        menuButton.addEventListener("click", () => {
            sidebar.classList.contains("open") ? closeDrawer() : openDrawer();
        });
        backdrop.addEventListener("click", () => closeDrawer());
        sidebar.querySelectorAll("nav a").forEach(link => link.addEventListener("click", () => closeDrawer(false)));
        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && sidebar.classList.contains("open")) closeDrawer();
        });
        window.matchMedia("(min-width: 901px)").addEventListener?.("change", event => {
            if (event.matches) closeDrawer(false);
        });
    }

    setupAccessibleDialogs();
}

function setupAccessibleDialogs() {
    if (window.__ueDialogsReady || !document.body) return;
    window.__ueDialogsReady = true;

    const focusableSelector = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const openers = new WeakMap();

    const prepareDialog = modal => {
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        const title = modal.querySelector(".modal-head h2");
        if (title) {
            if (!title.id) title.id = `dialog-title-${Math.random().toString(36).slice(2, 9)}`;
            modal.setAttribute("aria-labelledby", title.id);
        }
        modal.querySelector(".modal-box")?.setAttribute("tabindex", "-1");
    };

    document.querySelectorAll(".modal").forEach(prepareDialog);

    const observer = new MutationObserver(records => {
        for (const record of records) {
            const modal = record.target;
            const isOpen = !modal.classList.contains("hidden");
            const hasOpenDialog = document.querySelector(".modal:not(.hidden)");

            if (isOpen) {
                if (!openers.has(modal)) openers.set(modal, document.activeElement);
                document.body.classList.add("modal-open");
                const first = modal.querySelector("[autofocus], .close, input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])");
                (first || modal.querySelector(".modal-box"))?.focus();
            } else if (!hasOpenDialog) {
                document.body.classList.remove("modal-open");
                const opener = openers.get(modal);
                if (opener?.isConnected) opener.focus();
                openers.delete(modal);
            }
        }
    });

    document.querySelectorAll(".modal").forEach(modal => observer.observe(modal, { attributes: true, attributeFilter: ["class"] }));

    document.addEventListener("click", event => {
        if (event.target instanceof HTMLElement && event.target.classList.contains("modal")) {
            event.target.classList.add("hidden");
        }
    });

    document.addEventListener("keydown", event => {
        const modal = document.querySelector(".modal:not(.hidden)");
        if (!modal || window.Swal?.isVisible?.()) return;

        if (event.key === "Escape") {
            event.preventDefault();
            modal.classList.add("hidden");
            return;
        }

        if (event.key === "Tab") {
            const items = [...modal.querySelectorAll(focusableSelector)].filter(item => item.getClientRects().length);
            if (!items.length) {
                event.preventDefault();
                modal.querySelector(".modal-box")?.focus();
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    });

    document.querySelectorAll("#pageAlert, #loginError, #passwordAlert, #alert").forEach(node => {
        node.setAttribute("aria-live", "polite");
        node.setAttribute("aria-atomic", "true");
    });
}


/* ============================================================
   THEME
============================================================ */

(function initTheme() {
    const storageKey = "ueclubiste-theme";

    const saved = localStorage.getItem(storageKey);

    const prefersDark =
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;

    const initial =
        saved === "dark" || saved === "light"
            ? saved
            : prefersDark
                ? "dark"
                : "light";

    function applyTheme(theme) {
        document.documentElement.setAttribute("data-theme", theme);

        document.documentElement.style.colorScheme = theme;

        localStorage.setItem(storageKey, theme);

        const buttons =
            document.querySelectorAll(".theme-toggle");

        buttons.forEach(button => {
            const dark = theme === "dark";

            button.textContent = dark ? "☀" : "☾";

            button.setAttribute(
                "aria-label",
                dark
                    ? "Activer le mode clair"
                    : "Activer le mode sombre"
            );

            button.setAttribute(
                "title",
                dark
                    ? "Mode clair"
                    : "Mode sombre"
            );
        });

        window.dispatchEvent(
            new CustomEvent("ue-theme-change", {
                detail: { theme }
            })
        );
    }

    function addToggle() {
        if (document.querySelector(".theme-toggle")) {
            return;
        }

        const button = document.createElement("button");

        button.type = "button";
        button.className = "theme-toggle";

        button.addEventListener("click", () => {
            const current =
                document.documentElement.getAttribute("data-theme") ||
                "light";

            applyTheme(
                current === "dark"
                    ? "light"
                    : "dark"
            );
        });

        const topbar =
            document.querySelector(".topbar");

        if (topbar) {
            const user =
                topbar.querySelector(".top-user");

            if (user) {
                topbar.insertBefore(button, user);
            } else {
                topbar.appendChild(button);
            }
        } else {
            document.body.appendChild(button);
        }

        applyTheme(
            document.documentElement.getAttribute("data-theme") ||
            initial
        );
    }

    document.documentElement.setAttribute(
        "data-theme",
        initial
    );

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            addToggle,
            { once: true }
        );
    } else {
        addToggle();
    }
})();