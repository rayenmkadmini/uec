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
        try {
            const url = new URL(String(customUrl).trim(), window.location.href);
            if (url.protocol === "http:" || url.protocol === "https:") {
                return escapeHtml(url.href);
            }
        } catch (_) {
            // Invalid or unsafe stored URLs fall back to the generated logo.
        }
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
                ${escapeHtml(initials)}
            </text>

        </svg>
    `;

    // encodeURIComponent leaves ' as is; this URL is also placed inside a quoted onerror handler.
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg).replace(/'/g, "%27")}`;
}

function clubKey(name) {
    return String(name || "").trim().toLowerCase();
}

// Club logos are stored once per club (public.clubs) and reused by every match.
// Returns an empty map if the table is unavailable so matches still render.
async function loadClubLogos() {
    const { data, error } = await sb.from("clubs").select("name,logo_url");
    if (error) {
        console.warn("Logos des clubs indisponibles.", error);
        return new Map();
    }
    return new Map((data || []).filter(club => club.logo_url).map(club => [clubKey(club.name), club.logo_url]));
}

// <img> for a team: match logo → club logo → generated initials (also on load error).
function teamLogoImg(teamName, fallbackLabel, matchLogoUrl, clubLogos) {
    const fallback = getTeamLogo(teamName, fallbackLabel, null);
    const src = getTeamLogo(teamName, fallbackLabel, matchLogoUrl || clubLogos?.get(clubKey(teamName)));
    return `<img class="team-logo" src="${src}" alt="Logo ${escapeHtml(teamName || fallbackLabel || "")}" loading="lazy" onerror="this.onerror=null;this.src='${fallback}'">`;
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

const PERMS = window.UE_PERMISSIONS;

function normalizeRoleNames(roles) {
    return PERMS.normalizeRoles(roles);
}

// public.user_roles is the only authorization source. If it cannot be read the
// user gets no roles (fail closed) — never a fallback from profile/metadata.
async function fetchUserRolesForUser(userId) {
    if (!userId) return [];

    const { data, error } = await sb.from("user_roles").select("role").eq("user_id", userId);
    if (error) {
        console.error("Impossible de lire les rôles utilisateur.", error);
        return [];
    }
    return normalizeRoleNames((data || []).map(item => item?.role));
}

function hasContextRole(ctx, roleName) {
    return normalizeRoleNames(ctx?.roles || []).includes(String(roleName).trim().toUpperCase());
}

function can(ctx, permission) {
    return PERMS.can(ctx, permission);
}

function homePageFor(ctx) {
    return PERMS.homePage(ctx);
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

    const { data: profile, error: profileError } = await sb
        .from("profiles")
        .select("display_name,avatar_url,must_change_password,is_active")
        .eq("id", user.id)
        .maybeSingle();

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

// Single route guard. Every protected page calls this with the permission it
// needs. Unauthorized users are sent to their own home page (never in a loop:
// a home page is always accessible to the role it belongs to).
async function requirePermission(permission) {
    let ctx = null;
    try {
        ctx = await getCurrentContext();
    } catch (error) {
        // Fail closed: an unexpected error must never leave the page open.
        console.error("Session indisponible:", error);
    }

    if (!ctx) {
        location.href = "index.html";
        return null;
    }

    if (ctx.profile.must_change_password && !location.pathname.endsWith("change-password.html")) {
        location.href = "change-password.html";
        return null;
    }

    if (permission && !can(ctx, permission)) {
        const home = homePageFor(ctx);
        if (!home) {
            await sb.auth.signOut();
            location.href = "index.html";
        } else if (PERMS.pageName(location.pathname) !== home) {
            location.href = home;
        }
        return null;
    }

    return ctx;
}

// Supabase Auth redirects back with an error in the URL fragment (or query) when
// a recovery / activation link is expired, already used or invalid. Returns a
// user-facing message, or null when there is no such error. Values from the URL
// are never displayed.
function authLinkError(loc = window.UE_AUTH_REDIRECT || location) {
    const params = new URLSearchParams(`${String(loc.hash || "").replace(/^#/, "")}&${String(loc.search || "").replace(/^\?/, "")}`);
    if (!params.get("error") && !params.get("error_code")) return null;
    const code = params.get("error_code") || params.get("error");
    if (code === "otp_expired") return "Ce lien a expiré ou a déjà été utilisé. Demandez un nouveau lien à l’administration.";
    return "Ce lien n’est pas valide. Demandez un nouveau lien à l’administration.";
}

async function requireAuthenticated() {
    return requirePermission(null);
}

// Supabase returns success with 0 rows when RLS filters an UPDATE/DELETE.
// Treat that as a refusal so the UI never reports a write that did not happen.
function writeError(result, deniedMessage = "Vous n’avez pas l’autorisation d’effectuer cette action.") {
    if (result?.error) return result.error.message || "Une erreur est survenue.";
    if (Array.isArray(result?.data) && result.data.length === 0) return deniedMessage;
    return null;
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

        const nav = sidebar?.querySelector("nav");
        const adminSidebar = Boolean(nav?.querySelector('a[href="dashboard.html"], a[href="payments.html"]'));
        const currentPage = PERMS.pageName(location.pathname);

        // Staff get a profile page backed by public.profiles (not the member area).
        if (nav && adminSidebar && can(ctx, "viewStaffProfile") && !nav.querySelector('a[href="profile.html"]')) {
            const profileLink = document.createElement("a");
            profileLink.href = "profile.html";
            if (currentPage === "profile.html") profileLink.classList.add("active");
            profileLink.innerHTML = '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.5 2.8-5.8 7-5.8s7 2.3 7 5.8"/></svg><span>Mon profil</span>';
            nav.appendChild(profileLink);
        }

        // Only show links to pages this user may open (guards still enforce it).
        nav?.querySelectorAll("a").forEach(link => {
            const href = link.getAttribute("href") || "";
            if (href.startsWith("#")) return;
            if (!PERMS.canAccessPage(ctx, href)) link.remove();
        });

        nav?.querySelectorAll("a").forEach(link => {
            if (link.classList.contains("active")) link.setAttribute("aria-current", "page");
            else link.removeAttribute("aria-current");
        });

        if (topUser && PERMS.isReadOnlyStaff(ctx) && adminSidebar && !topUser.querySelector(".readonly-pill")) {
            const pill = document.createElement("span");
            pill.className = "readonly-pill";
            pill.textContent = "Lecture seule";
            pill.title = "Votre rôle Superviseur permet uniquement la consultation.";
            topUser.insertAdjacentElement("beforebegin", pill);
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
