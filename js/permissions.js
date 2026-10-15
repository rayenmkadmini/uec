/* ============================================================
   UE CLUBISTE — CENTRALIZED ROLE / PERMISSION MODEL
   Single source of truth for the UI. The database enforces the same rules
   (see supabase/migrations/*_role_permissions_repair.sql); this file only
   decides what to show. Roles come from public.user_roles, never from the
   browser.
============================================================ */
(function (root) {
    const ROLES = ["SUPERADMIN", "ADMIN", "TREASURER", "MEMBER"];

    // Legacy values seen in older schemas. Anything else is ignored (no privilege).
    const LEGACY_ROLE_ALIASES = {
        SUBSCRIBER: "MEMBER",
        SUPERVISOR: "ADMIN"
    };

    const PERMISSIONS = {
        viewDashboard: ["SUPERADMIN", "ADMIN"],
        viewMembers: ["SUPERADMIN", "ADMIN", "TREASURER"],
        // Member details (phone, email, gender, zone, photo). TREASURER only gets
        // identification + payment fields via list_payment_members().
        viewMemberDetails: ["SUPERADMIN", "ADMIN"],
        // Protected identity (CIN, address, date of birth): the database withholds
        // these columns from every API role and serves them only through
        // get_member_private_fields() to SUPERADMIN (or the member themself).
        viewMemberIdentity: ["SUPERADMIN"],
        manageMembers: ["SUPERADMIN"],
        manageCardPayments: ["SUPERADMIN", "TREASURER"],
        viewEvents: ["SUPERADMIN", "ADMIN", "TREASURER"],
        manageEvents: ["SUPERADMIN"],
        manageCollections: ["SUPERADMIN"],
        manageEventPaymentStatuses: ["SUPERADMIN", "TREASURER"],
        viewFinancialReports: ["SUPERADMIN", "ADMIN", "TREASURER"],
        viewMatches: ["SUPERADMIN", "ADMIN"],
        manageMatches: ["SUPERADMIN"],
        manageClubLogos: ["SUPERADMIN"],
        manageStadiumSeats: ["SUPERADMIN"],
        viewUsers: ["SUPERADMIN", "ADMIN"],
        manageUsers: ["SUPERADMIN"],
        viewReferences: ["SUPERADMIN", "ADMIN"],
        manageSettings: ["SUPERADMIN"],
        viewStaffProfile: ["SUPERADMIN", "ADMIN", "TREASURER"],
        editStaffProfile: ["SUPERADMIN"],
        useMemberArea: ["MEMBER"],
        editOwnProfile: ["MEMBER"],
        chooseOwnSeat: ["MEMBER"]
    };

    // Which permission a page requires. Pages not listed are public (login).
    const PAGE_PERMISSIONS = {
        "dashboard.html": "viewDashboard",
        "subscribers.html": "viewMembers",
        "payments.html": "viewEvents",
        "admin-matchs.html": "viewMatches",
        "admin-users.html": "viewUsers",
        "faculties.html": "viewReferences",
        "zones.html": "viewReferences",
        "profile.html": "viewStaffProfile",
        "subscriber.html": "useMemberArea",
        "matchs.html": "chooseOwnSeat"
    };

    function normalizeRoles(roles) {
        const list = Array.isArray(roles) ? roles : roles ? [roles] : [];
        const normalized = list
            .map(role => String(role ?? "").trim().toUpperCase())
            .map(role => LEGACY_ROLE_ALIASES[role] || role)
            .filter(role => ROLES.includes(role));
        return [...new Set(normalized)];
    }

    function rolesOf(subject) {
        return normalizeRoles(Array.isArray(subject) ? subject : subject?.roles);
    }

    function can(subject, permission) {
        const allowed = PERMISSIONS[permission];
        if (!allowed) return false;
        return rolesOf(subject).some(role => allowed.includes(role));
    }

    function pageName(pathname) {
        const last = String(pathname || "").split(/[\\/]/).pop() || "";
        return last.split(/[?#]/)[0].toLowerCase() || "index.html";
    }

    function canAccessPage(subject, pathname) {
        const permission = PAGE_PERMISSIONS[pageName(pathname)];
        return !permission || can(subject, permission);
    }

    // Landing page after login, by highest-privilege role held.
    function homePage(subject) {
        if (can(subject, "viewDashboard")) return "dashboard.html";
        if (can(subject, "manageEventPaymentStatuses")) return "payments.html";
        if (can(subject, "useMemberArea")) return "subscriber.html";
        return null;
    }

    // True when the user can see administrative data but change none of it.
    function isReadOnlyStaff(subject) {
        const roles = rolesOf(subject);
        return roles.includes("ADMIN") && !roles.includes("SUPERADMIN") && !roles.includes("TREASURER");
    }

    function primaryRoleLabel(subject) {
        const roles = rolesOf(subject);
        if (roles.includes("SUPERADMIN")) return "Super administrateur";
        if (roles.includes("ADMIN")) return "Superviseur (lecture seule)";
        if (roles.includes("TREASURER")) return "Trésorier";
        if (roles.includes("MEMBER")) return "Membre";
        return "Aucun rôle";
    }

    const api = {
        ROLES,
        PERMISSIONS,
        PAGE_PERMISSIONS,
        normalizeRoles,
        can,
        pageName,
        canAccessPage,
        homePage,
        isReadOnlyStaff,
        primaryRoleLabel
    };

    if (typeof module !== "undefined" && module.exports) module.exports = api;
    root.UE_PERMISSIONS = api;
})(typeof window !== "undefined" ? window : globalThis);
