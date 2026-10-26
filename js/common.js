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
        // titleText renders as text: messages can carry server or user-supplied text.
        titleText: displayMessage,
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
    if (/unauthorized|jwt|token|session expir|auth session/.test(lower)) {
        return "Votre session a expiré. Reconnectez-vous pour continuer.";
    }
    if (/network|fetch|timeout|offline|connexion impossible/.test(lower)) {
        return "Connexion impossible. Vérifiez votre réseau puis réessayez.";
    }
    if (/roles are unavailable|not authenticated|user_id required|method not allowed/.test(lower)) {
        return "Le service est momentanément indisponible. Réessayez ou reconnectez-vous.";
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
        titleText: message,
        text: opts.text || undefined,
        input: opts.input || "text",
        inputPlaceholder: opts.placeholder || "",
        inputValue: opts.value || "",
        showCancelButton: true,
        confirmButtonText: opts.confirmText || "Valider",
        cancelButtonText: "Annuler",
        reverseButtons: true,
        inputValidator: opts.validator,
        inputAttributes: opts.inputAttributes || undefined
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

// UEC Discord server: meetings happen there unless a meeting has its own link.
const UEC_DISCORD_URL = "https://discord.gg/chRj5Ycj";
const isDiscordUrl = url => /^https:\/\/(discord\.gg|(www\.|ptb\.|canary\.)?discord(app)?\.com)\//i.test(String(url || ""));

// Optional photo for announcements and events: public bucket "community-media"
// (migration 20261029120000). Images are resized in the browser (max 1600 px,
// WebP) before upload. Returns the public URL.
async function uploadCommunityImage(file, folder = "misc") {
    if (!file) return null;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Format accepté : JPG, PNG ou WebP.");
    if (file.size > 15 * 1024 * 1024) throw new Error("Image trop lourde (15 Mo maximum).");
    let blob = file;
    try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.85)) || file;
    } catch (_) { /* keep the original file */ }
    if (blob.size > 5 * 1024 * 1024) throw new Error("Image trop lourde après compression (5 Mo maximum).");
    const path = `${folder}/${crypto.randomUUID()}.${blob.type === "image/webp" ? "webp" : file.name.split(".").pop().toLowerCase()}`;
    const { error } = await sb.storage.from("community-media").upload(path, blob, { contentType: blob.type || file.type, upsert: false });
    if (error) throw new Error(`Envoi de la photo impossible : ${error.message}`);
    return sb.storage.from("community-media").getPublicUrl(path).data.publicUrl;
}

const BUILT_IN_CLUB_LOGOS = {
    "club africain": "assets/ca-crest.webp",
    "ca": "assets/ca-crest.webp",
    "ca bizertin": "assets/clubs/ca-bizertin.webp",
    "cs hammam-lif": "assets/clubs/cs-hammam-lif.webp",
    "cs hammam lif": "assets/clubs/cs-hammam-lif.webp",
    "cs sfaxien": "assets/clubs/cs-sfaxien.webp",
    "espérance de tunis": "assets/clubs/esperance-tunis.webp",
    "esperance de tunis": "assets/clubs/esperance-tunis.webp",
    "est": "assets/clubs/esperance-tunis.webp",
    "js omrane": "assets/clubs/js-omrane.webp",
    "js el omrane": "assets/clubs/js-omrane.webp",
    "tp mazembe": "assets/clubs/tp-mazembe.webp"
};

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

    // Built-in crest when no logo was uploaded for the club.
    const builtIn = BUILT_IN_CLUB_LOGOS[clubKey(teamName)];
    if (builtIn) return builtIn;

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

// Signed out in another tab, or the session could no longer be refreshed: leave
// the protected page instead of showing data that can no longer be reloaded.
// Not while an Auth link error is shown (supabase-js signs out when it rejects the link).
if (window.sb?.auth && !/(^|\/)(index\.html)?$/i.test(location.pathname) && !authLinkError()) {
    sb.auth.onAuthStateChange(event => {
        if (event === "SIGNED_OUT") location.replace("index.html");
    });
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
        if (nav && adminSidebar && can(ctx, "manageMeetings") && !nav.querySelector('a[href="meetings.html"]')) {
            const link = document.createElement("a");
            link.href = "meetings.html";
            if (location.pathname.endsWith("/meetings.html")) link.className = "active";
            link.innerHTML = '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10.5l5-3v9l-5-3"/></svg> <span>Réunions</span>';
            const after = nav.querySelector('a[href="payments.html"]') || nav.querySelector('a[href="admin-matchs.html"]');
            after ? after.insertAdjacentElement("afterend", link) : nav.appendChild(link);
            const events = document.createElement("a");
            events.href = "events.html";
            if (location.pathname.endsWith("/events.html")) events.className = "active";
            events.innerHTML = '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M9 15l2 2 4-4"/></svg> <span>Événements</span>';
            link.insertAdjacentElement("afterend", events);
            const community = [["annonces.html", "Annonces", '<path d="M3 10v4a1 1 0 001 1h2l5 4V5L6 9H4a1 1 0 00-1 1z"/><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13"/>'],
                ["chat.html", "Discussion", '<path d="M20 12a8 8 0 01-11.8 7L4 20l1.1-3.9A8 8 0 1120 12z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/>']];
            let anchor = events;
            for (const [href, label, path] of community) {
                const a = document.createElement("a");
                a.href = href;
                if (location.pathname.endsWith("/" + href)) a.className = "active";
                a.innerHTML = `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg> <span>${label}</span>`;
                anchor.insertAdjacentElement("afterend", a);
                anchor = a;
            }
        }
        if (nav && adminSidebar && can(ctx, "viewStaffProfile") && !nav.querySelector('a[href="profile.html"]')) {
            const profileLink = document.createElement("a");
            profileLink.href = "profile.html";
            if (currentPage === "profile.html") profileLink.classList.add("active");
            profileLink.innerHTML = '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.5 2.8-5.8 7-5.8s7 2.3 7 5.8"/></svg><span>Mon profil</span>';
            nav.appendChild(profileLink);
        }

        // Staff who are also members reach their member area from the admin menu,
        // and members who are also staff reach the administration from the member menu.
        const memberIcon = '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 11L12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/></svg>';
        const adminIcon = '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1.6"/><rect x="13" y="3" width="8" height="8" rx="1.6"/><rect x="3" y="13" width="8" height="8" rx="1.6"/><rect x="13" y="13" width="8" height="8" rx="1.6"/></svg>';
        if (nav && adminSidebar && can(ctx, "useMemberArea") && !nav.querySelector('a[href="subscriber.html"]')) {
            const link = document.createElement("a");
            link.href = "subscriber.html";
            link.className = "nav-switch";
            link.innerHTML = `${memberIcon}<span>Mon espace membre</span>`;
            nav.appendChild(link);
        }
        const staffHome = homePageFor({ ...ctx, roles: (ctx.roles || []).filter(role => String(role).toUpperCase() !== "MEMBER") });
        if (nav && !adminSidebar && staffHome && !nav.querySelector(`a[href="${staffHome}"]`)) {
            const link = document.createElement("a");
            link.href = staffHome;
            link.className = "nav-switch";
            link.innerHTML = `${adminIcon}<span>Administration</span>`;
            nav.appendChild(link);
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
            if (navigator.vibrate) try { navigator.vibrate(8); } catch (_) {}
            sidebar.classList.add("open");
            backdrop.classList.add("visible");
            document.body.classList.add("nav-open");
            menuButton.setAttribute("aria-expanded", "true");
            menuButton.setAttribute("aria-label", "Fermer le menu");
            // Always open at the top (header visible); focusing must not scroll it.
            sidebar.scrollTop = 0;
            sidebar.querySelector("nav a:not(.hidden)")?.focus({ preventScroll: true });
        };

        menuButton.addEventListener("click", () => {
            sidebar.classList.contains("open") ? closeDrawer() : openDrawer();
        });
        backdrop.addEventListener("click", () => closeDrawer());

        // Phone drawer: profile card + close button at the top, quick bar
        // (theme + logout) at the bottom, swipe to open / close.
        if (!sidebar.querySelector(".drawer-profile")) {
            const name = ctx?.profile?.display_name || "Utilisateur";
            const profile = document.createElement("div");
            profile.className = "drawer-profile";
            profile.innerHTML = `<span class="drawer-avatar" aria-hidden="true">${escapeHtml(Array.from(name.trim())[0]?.toLocaleUpperCase() || "U")}</span>
                <div class="drawer-who"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(ctx ? PERMS.primaryRoleLabel(ctx) : "")}</small></div>
                <button type="button" class="drawer-close" aria-label="Fermer le menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
            sidebar.querySelector(".side-brand")?.insertAdjacentElement("afterend", profile);
            profile.querySelector(".drawer-close").addEventListener("click", () => closeDrawer());

            const quick = document.createElement("div");
            quick.className = "drawer-quick";
            quick.innerHTML = `<button type="button" class="drawer-theme"><span class="drawer-theme-icon" aria-hidden="true"></span><span>Thème</span></button>`;
            quick.querySelector(".drawer-theme").addEventListener("click", () => document.querySelector(".theme-toggle")?.click());
            const logout = sidebar.querySelector(".side-logout");
            if (logout) { logout.insertAdjacentElement("beforebegin", quick); quick.appendChild(logout); }
            else sidebar.appendChild(quick);
            enhanceDrawer(sidebar, ctx, profile, quick, closeDrawer);
        }

        // Swipe: from the left screen edge to open, to the left on the drawer to close.
        const mobile = () => window.matchMedia("(max-width: 900px)").matches;
        let startX = null, startY = 0, fromEdge = false;
        document.addEventListener("touchstart", event => {
            if (!mobile() || event.touches.length !== 1) return;
            const t = event.touches[0];
            const open = sidebar.classList.contains("open");
            fromEdge = false; // the phone menu is a bottom sheet now (opened from the tab bar)
            if (open || fromEdge) { startX = t.clientX; startY = t.clientY; } else startX = null;
        }, { passive: true });
        document.addEventListener("touchend", event => {
            if (startX === null) return;
            const t = event.changedTouches[0];
            const dx = t.clientX - startX, dy = Math.abs(t.clientY - startY);
            if (dy < 60) {
                if (fromEdge && dx > 60) openDrawer();
                else if (!fromEdge && sidebar.classList.contains("open") && dx < -60) closeDrawer(false);
            }
            startX = null;
        }, { passive: true });
        sidebar.querySelectorAll("nav a").forEach(link => link.addEventListener("click", () => closeDrawer(false)));
        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && sidebar.classList.contains("open")) closeDrawer();
        });
        window.matchMedia("(min-width: 901px)").addEventListener?.("change", event => {
            if (event.matches) closeDrawer(false);
        });
    }

    setupMobileTabbar(sidebar, menuButton);
    setupResponsiveTables();
    setupAccessibleDialogs();
}

/* ============================================================
   PHONE DRAWER v2 — season + role in the header, page search, live
   counters (upcoming meetings / events), shortcuts (install the app,
   Discord), staggered entrance.
============================================================ */
function enhanceDrawer(sidebar, ctx, profile, quick, closeDrawer) {
    const now = new Date();
    const y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    const handle = document.createElement("span");
    handle.className = "sheet-handle";
    handle.setAttribute("aria-hidden", "true");
    sidebar.insertAdjacentElement("afterbegin", handle);

    // Bottom sheet on phones: drag down from the top area to close.
    let dragY = null;
    sidebar.addEventListener("touchstart", event => {
        if (event.touches.length === 1 && sidebar.scrollTop <= 0 && event.touches[0].clientY - sidebar.getBoundingClientRect().top < 90) dragY = event.touches[0].clientY;
        else dragY = null;
    }, { passive: true });
    sidebar.addEventListener("touchmove", event => {
        if (dragY === null) return;
        const dy = Math.max(0, event.touches[0].clientY - dragY);
        sidebar.style.transition = "none";
        sidebar.style.setProperty("transform", `translateY(${dy}px)`, "important");
    }, { passive: true });
    sidebar.addEventListener("touchend", event => {
        if (dragY === null) return;
        const dy = event.changedTouches[0].clientY - dragY;
        sidebar.style.transition = "";
        sidebar.style.removeProperty("transform");
        dragY = null;
        if (dy > 90) closeDrawer(false);
    }, { passive: true });

    const meta = document.createElement("div");
    meta.className = "drawer-meta";
    meta.innerHTML = `<span>Saison ${y}-${y + 1}</span><span class="drawer-dot" aria-hidden="true"></span><span>UEC21 Members</span>`;
    profile.insertAdjacentElement("afterend", meta);

    const nav = sidebar.querySelector("nav");
    if (nav) {
        const search = document.createElement("label");
        search.className = "drawer-search";
        search.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg><input type="search" placeholder="Rechercher une page…" aria-label="Rechercher une page" autocomplete="off">';
        nav.insertAdjacentElement("beforebegin", search);
        const input = search.querySelector("input");
        const norm = v => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
        input.addEventListener("input", () => {
            const q = norm(input.value.trim());
            nav.querySelectorAll("a").forEach(link => { link.classList.toggle("drawer-filtered", Boolean(q) && !norm(link.textContent).includes(q)); });
        });
        input.addEventListener("keydown", event => {
            if (event.key !== "Enter") return;
            const first = nav.querySelector("a:not(.drawer-filtered):not(.hidden)");
            if (first) { event.preventDefault(); closeDrawer(false); location.href = first.getAttribute("href"); }
        });
        nav.querySelectorAll("a").forEach((link, i) => link.style.setProperty("--i", i));
    }

    const shortcuts = document.createElement("div");
    shortcuts.className = "drawer-shortcuts";
    const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    shortcuts.innerHTML = `
        ${standalone ? "" : '<button type="button" class="drawer-sc" data-sc="install"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg><span>Installer l’app</span></button>'}
        <a class="drawer-sc drawer-sc-discord" href="${UEC_DISCORD_URL}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.3 4.4A19.6 19.6 0 0015.4 3l-.6 1.3a18.2 18.2 0 00-5.5 0L8.7 3a19.5 19.5 0 00-4.9 1.4C.7 9 0 13.6.3 18.1a19.7 19.7 0 006 3l1.3-2a12.7 12.7 0 01-2-1l.5-.4a14 14 0 0012 0l.5.4c-.6.4-1.3.7-2 1l1.3 2a19.6 19.6 0 006-3c.4-5.2-.7-9.7-3.3-13.7zM8.7 15.3c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4zm6.6 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4z"/></svg><span>Discord UEC</span></a>`;
    shortcuts.querySelector('[data-sc="install"]')?.addEventListener("click", () => { closeDrawer(false); window.uecInstallApp?.(); });
    quick.insertAdjacentElement("beforebegin", shortcuts);
    const foot = document.createElement("small");
    foot.className = "drawer-foot";
    foot.textContent = "UEC21 · Ensemble, portons haut nos couleurs";
    quick.insertAdjacentElement("afterend", foot);

    // Live counters: upcoming meetings and events this account can see.
    (async () => {
        try {
            const since = new Date(Date.now() - 6 * 3600000).toISOString();
            const count = async table => {
                const { count: n, error } = await sb.from(table).select("id", { count: "exact", head: true }).gte("starts_at", since).neq("status", "CANCELLED");
                return error ? 0 : n || 0;
            };
            const [meetings, events] = await Promise.all([count("meetings"), count("club_events")]);
            const badge = (selector, n) => {
                if (!n) return;
                sidebar.querySelectorAll(selector).forEach(link => {
                    if (link.querySelector(".drawer-badge")) return;
                    const b = document.createElement("span");
                    b.className = "drawer-badge";
                    b.textContent = n > 9 ? "9+" : String(n);
                    b.setAttribute("aria-label", `${n} à venir`);
                    link.appendChild(b);
                });
            };
            badge('nav a[href*="reunions"], nav a[href="meetings.html"]', meetings);
            badge('nav a[href*="evenements"], nav a[href="events.html"]', events);
        } catch (_) { /* counters are optional */ }
    })();
}

/* ============================================================
   MOBILE: bottom tab bar + tables as cards
============================================================ */

// Phone navigation: the first visible sidebar links (already filtered by role)
// become a bottom tab bar, plus a "Menu" tab that opens the full drawer.
function setupMobileTabbar(sidebar, menuButton) {
    if (!sidebar || document.querySelector(".mobile-tabbar")) return;
    const links = [...sidebar.querySelectorAll("nav a")].filter(link => !link.classList.contains("hidden"));
    if (links.length < 2) return;

    const bar = document.createElement("nav");
    bar.className = "mobile-tabbar";
    bar.setAttribute("aria-label", "Navigation rapide");

    const max = links.length > 5 ? 4 : links.length;
    const active = links.findIndex(link => link.classList.contains("active"));
    // Keep the current page in the bar even when it is not among the first ones.
    const chosen = links.slice(0, max);
    if (active >= max) chosen[max - 1] = links[active];

    for (const link of chosen) {
        const tab = document.createElement("a");
        tab.href = link.getAttribute("href");
        tab.className = "tab-item" + (link.classList.contains("active") ? " active" : "");
        if (link.classList.contains("active")) tab.setAttribute("aria-current", "page");
        const icon = link.querySelector("svg")?.cloneNode(true);
        if (icon) { icon.setAttribute("aria-hidden", "true"); tab.appendChild(icon); }
        const label = document.createElement("span");
        label.textContent = (link.querySelector("span:not([aria-hidden])")?.textContent || link.textContent || "").trim();
        tab.appendChild(label);
        bar.appendChild(tab);
    }

    if (links.length > max && menuButton) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "tab-item";
        more.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg><span>Menu</span>';
        more.addEventListener("click", () => menuButton.click());
        bar.appendChild(more);
    }

    document.body.appendChild(bar);
    document.body.classList.add("has-tabbar");
}

// On phones every data table is shown as a list of cards: each cell gets the
// text of its column header as a label (data-label), read by the CSS.
function labelTableCells(table) {
    const headers = [...table.querySelectorAll("thead th")].map(th => th.textContent.trim());
    if (!headers.length) return;
    table.classList.add("responsive-table");
    for (const row of table.tBodies[0]?.rows || []) {
        [...row.cells].forEach((cell, index) => {
            if (cell.colSpan > 1) { cell.classList.add("cell-full"); return; }
            const label = headers[index] || "";
            if (label) cell.setAttribute("data-label", label);
            else cell.removeAttribute("data-label");
        });
    }
}

function setupResponsiveTables() {
    if (window.__ueTablesReady || !document.body) return;
    window.__ueTablesReady = true;
    const scan = () => document.querySelectorAll(".table-wrap table").forEach(labelTableCells);
    scan();
    // Table bodies are re-rendered by each page: label new rows as they appear.
    let queued = false;
    new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; scan(); });
    }).observe(document.body, { childList: true, subtree: true });
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


/* ============================================================
   PHONE ACTION SHEET — "•••" menus on compact cards
   actions: [{ label, run, danger?, strong? }]
============================================================ */
const MORE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';

function openActionSheet(title, subtitle, actions) {
    document.querySelector(".action-sheet")?.remove();
    const sheet = document.createElement("div");
    sheet.className = "action-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.innerHTML = `<div class="action-sheet-panel">
        <div class="action-sheet-title"><strong>${escapeHtml(title || "")}</strong>${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ""}</div>
        <div class="action-sheet-list"></div>
        <button type="button" class="btn secondary action-sheet-cancel">Annuler</button>
      </div>`;
    const close = () => { sheet.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = e => { if (e.key === "Escape") close(); };
    const list = sheet.querySelector(".action-sheet-list");
    for (const action of actions) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "action-sheet-item" + (action.danger ? " danger" : "") + (action.strong ? " strong" : "");
        b.textContent = action.label;
        b.addEventListener("click", () => { close(); action.run(); });
        list.appendChild(b);
    }
    sheet.addEventListener("click", e => { if (e.target === sheet) close(); });
    sheet.querySelector(".action-sheet-cancel").addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    document.body.appendChild(sheet);
    sheet.querySelector(".action-sheet-item")?.focus();
}
window.openActionSheet = openActionSheet;


/* ============================================================
   VIRTUAL MEMBER CARD — official design, recto / verso, tap to flip
   s: subscriber row; opts.photoUrl: signed photo URL (optional)
============================================================ */
function memberCardSeason(date = new Date()) {
    const y = date.getFullYear();
    const start = date.getMonth() >= 6 ? y : y - 1; // season starts in July
    return `${start}-${start + 1}`;
}

function renderVirtualMemberCard(s, opts = {}) {
    const name = `${s.prenom || ""} ${s.nom || ""}`.trim() || "Membre";
    const initial = escapeHtml((s.prenom || s.nom || "U").charAt(0).toUpperCase());
    const paid = Boolean(s.card_paid);
    const active = s.status === "ACTIVE";
    const photo = opts.photoUrl
        ? `<img src="${escapeHtml(opts.photoUrl)}" alt="" onerror="this.remove()">`
        : "";
    const rows = [
        ["N° abonnement", s.numero_abonnement || "—"],
        ["Faculté", facultyShort(s.faculties?.name || s.faculty_name) || "—"],
        ["Zone", s.zones?.name || "—"]
    ];
    return `
    <div class="vcard" tabindex="0" role="button" aria-label="Carte membre de ${escapeHtml(name)} — touchez pour retourner">
      <div class="vcard-inner">
        <div class="vcard-face vcard-front">
          <div class="vcard-front-bottom">
            <div class="vcard-holder"><strong>${escapeHtml(name)}</strong><span>N° ${escapeHtml(s.numero_abonnement || "—")}</span></div>
            <span class="vcard-pill ${paid ? "ok" : "ko"}">${paid ? "✓ Payée" : "Non payée"}</span>
          </div>
        </div>
        <div class="vcard-face vcard-back">
          <div class="vcard-tribune"></div>
          <div class="vcard-body">
            <div class="vcard-photo">${photo}<span>${initial}</span></div>
            <div class="vcard-info">
              <strong>${escapeHtml(name)}</strong>
              <span class="vcard-state"><i class="${active ? "ok" : "ko"}"></i>${active ? "Actif" : "Désactivé"} · ${paid ? "Carte payée" : "Carte non payée"}</span>
              <dl>${rows.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join("")}</dl>
            </div>
          </div>
          <p class="vcard-motto">Ensemble, portons haut nos couleurs</p>
        </div>
      </div>
    </div>
    <p class="vcard-hint">Touchez la carte pour la retourner</p>`;
}

// One delegated handler for every card on the page (click, Enter, Space).
document.addEventListener("click", event => {
    const card = event.target.closest(".vcard");
    if (card) card.classList.toggle("flipped");
});
document.addEventListener("keydown", event => {
    const card = event.target.closest?.(".vcard");
    if (card && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); card.classList.toggle("flipped"); }
});
