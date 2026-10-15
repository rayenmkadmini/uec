// Staff profile (SUPERADMIN / ADMIN / TREASURER), backed by public.profiles.
// Staff accounts have no row in public.subscribers, so the member page cannot
// be used for them. Only SUPERADMIN may edit; the database enforces the same rule.
let profileCtx = null;
let profileRow = null;
let canEditProfile = false;
let profileSaving = false;

const editableFields = ["pDisplayName", "pNom", "pPrenom", "pPhone", "pAvatarFile"];

function setEditing(editing) {
    editableFields.forEach(id => { $("#" + id).disabled = !editing; });
    $("#profileSaveRow").classList.toggle("hidden", !editing);
    $("#editProfileBtn").classList.toggle("hidden", editing || !canEditProfile);
}

async function renderProfile() {
    const name = profileRow.display_name || [profileRow.prenom, profileRow.nom].filter(Boolean).join(" ") || "Utilisateur";
    $("#profileHeading").textContent = name;
    $("#profileRole").textContent = UE_PERMISSIONS.primaryRoleLabel(profileCtx);

    $("#pDisplayName").value = profileRow.display_name || "";
    $("#pEmail").value = profileRow.email || profileCtx.user.email || "";
    $("#pNom").value = profileRow.nom || "";
    $("#pPrenom").value = profileRow.prenom || "";
    $("#pPhone").value = profileRow.phone || "";
    $("#pRoles").value = normalizeRoleNames(profileCtx.roles).join(" · ") || "—";
    $("#pAvatarFile").value = "";

    const avatar = $("#profileAvatar");
    const photoUrl = await getSubscriberPhotoUrl(profileRow.avatar_url);
    avatar.textContent = "";
    if (photoUrl) {
        const img = document.createElement("img");
        img.src = photoUrl;
        img.alt = "";
        img.onerror = () => { img.remove(); avatar.textContent = Array.from(name)[0]?.toUpperCase() || "U"; };
        avatar.appendChild(img);
    } else {
        avatar.textContent = Array.from(name)[0]?.toUpperCase() || "U";
    }
}

async function loadProfile() {
    const { data, error } = await sb
        .from("profiles")
        .select("id,email,display_name,nom,prenom,phone,avatar_url")
        .eq("id", profileCtx.user.id)
        .maybeSingle();

    if (error || !data) {
        $("#profileHeading").textContent = "Profil indisponible";
        showAlert("#pageAlert", error?.message || "Votre profil est introuvable. Contactez un super administrateur.", "error");
        return false;
    }

    profileRow = data;
    await renderProfile();
    return true;
}

async function uploadAvatar(file) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        throw new Error("Format photo invalide. Utilisez JPG, PNG ou WebP.");
    }
    if (file.size > 5 * 1024 * 1024) {
        throw new Error("La photo dépasse la limite de 5 Mo.");
    }
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `profiles/${profileCtx.user.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from("subscriber-photos").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type
    });
    if (error) throw new Error(`Erreur upload photo : ${error.message}`);
    return path;
}

async function saveProfile(event) {
    event.preventDefault();
    if (!canEditProfile || profileSaving) return;

    const displayName = $("#pDisplayName").value.trim();
    if (!displayName) return showAlert("#pageAlert", "Le nom affiché est obligatoire.", "error");

    const button = $("#saveProfileBtn");
    profileSaving = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = "Enregistrement…";

    try {
        let avatarUrl = profileRow.avatar_url || null;
        const file = $("#pAvatarFile").files?.[0];
        if (file) avatarUrl = await uploadAvatar(file);

        const result = await sb
            .from("profiles")
            .update({
                display_name: displayName,
                nom: $("#pNom").value.trim() || null,
                prenom: $("#pPrenom").value.trim() || null,
                phone: $("#pPhone").value.trim() || null,
                avatar_url: avatarUrl
            })
            .eq("id", profileCtx.user.id)
            .select("id,email,display_name,nom,prenom,phone,avatar_url");

        const failure = writeError(result);
        if (failure) throw new Error(failure);

        profileRow = result.data[0];
        profileCtx.profile.display_name = profileRow.display_name;
        setEditing(false);
        await renderProfile();
        const topName = $(".top-user-meta span:not(.role-summary)");
        if (topName) topName.textContent = profileRow.display_name;
        showAlert("#pageAlert", "Profil mis à jour.");
    } catch (error) {
        showAlert("#pageAlert", error?.message || "La mise à jour du profil a échoué.", "error");
    } finally {
        profileSaving = false;
        button.disabled = false;
        button.removeAttribute("aria-busy");
        button.textContent = "Enregistrer";
    }
}

(async function init() {
    profileCtx = await requirePermission("viewStaffProfile");
    if (!profileCtx) return;
    canEditProfile = can(profileCtx, "editStaffProfile");
    setupShell(profileCtx);

    $("#avatarField").classList.toggle("hidden", !canEditProfile);
    $("#readOnlyNotice").classList.toggle("hidden", canEditProfile);

    if (!(await loadProfile())) return;
    setEditing(false);

    $("#editProfileBtn").onclick = () => setEditing(true);
    $("#cancelProfileBtn").onclick = async () => { setEditing(false); await renderProfile(); };
    $("#staffProfileForm").addEventListener("submit", saveProfile);
})();
