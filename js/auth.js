document.addEventListener("DOMContentLoaded", async () => {
  const form = document.querySelector("#loginForm");
  if (!window.sb) {
    // supabase-js did not load (CDN blocked or offline): say so instead of a dead button.
    const err = document.querySelector("#loginError");
    if (err) {
      err.textContent = "Le service de connexion n’a pas pu être chargé. Vérifiez votre réseau puis rechargez la page.";
      err.classList.remove("hidden");
    }
    form?.querySelector("button[type=submit]")?.setAttribute("disabled", "");
    return;
  }

  // Already signed in (page refresh / back button): go straight to the role's home.
  // A failure here must never prevent the form below from working.
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session?.user) {
      const ctx = await getCurrentContext();
      const home = ctx && homePageFor(ctx);
      if (ctx && home) {
        location.href = ctx.profile.must_change_password ? "change-password.html" : home;
        return;
      }
      await sb.auth.signOut();
    }
  } catch (error) {
    console.error("Session check failed:", error);
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const err = document.querySelector("#loginError");
    const button = form.querySelector("button[type=submit]");
    err.classList.add("hidden");
    err.textContent = "";

    const login = document.querySelector("#login").value.trim();
    const password = document.querySelector("#password").value;
    if (!login || !password) return;

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    const original = button.innerHTML;
    button.innerHTML = "Connexion…";

    // Admins can use their normal email. Subscribers may use their login_name
    // (for example FOULENFOULENI), which is mapped to the internal Auth email.
    const authEmail = login.includes("@") ? login.toLowerCase() : syntheticEmail(login);
    let signInResult;
    try {
      signInResult = await sb.auth.signInWithPassword({ email: authEmail, password });
    } catch (_) {
      err.textContent = "Connexion impossible pour le moment. Vérifiez votre réseau puis réessayez.";
      err.classList.remove("hidden");
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.innerHTML = original;
      return;
    }

    const { data, error } = signInResult;

    if (error) {
      const errorText = String(error.message || "").toLowerCase();
      err.textContent = /too many requests|rate limit/.test(errorText)
        ? "Trop de tentatives. Patientez quelques minutes puis réessayez."
        : "Identifiants incorrects ou compte indisponible. Vérifiez vos informations puis réessayez.";
      err.classList.remove("hidden");
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.innerHTML = original;
      return;
    }

    const { data: profile, error: profileError } = await sb.from("profiles")
      .select("must_change_password,display_name,is_active")
      .eq("id", data.user.id).single();

    if (profileError || !profile) {
      await sb.auth.signOut();
      err.textContent = "Profil utilisateur introuvable.";
      err.classList.remove("hidden");
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.innerHTML = original;
      return;
    }

    if (profile.is_active === false) {
      await sb.auth.signOut();
      err.textContent = "Ce compte est désactivé. Contactez l’administration.";
      err.classList.remove("hidden");
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.innerHTML = original;
      return;
    }

    const ctx = { user: data.user, profile, roles: await fetchUserRolesForUser(data.user.id) };
    const home = homePageFor(ctx);

    if (home === "subscriber.html") {
      const { data: subscriber } = await sb.from("subscribers")
        .select("status").eq("user_id", data.user.id).maybeSingle();

      if (subscriber && subscriber.status !== "ACTIVE") {
        await sb.auth.signOut();
        err.textContent = "Votre abonnement est désactivé. Contactez l’administration.";
        err.classList.remove("hidden");
        button.disabled = false;
        button.removeAttribute("aria-busy");
        button.innerHTML = original;
        return;
      }
    }

    if (home) {
      location.href = profile.must_change_password ? "change-password.html" : home;
      return;
    }

    await sb.auth.signOut();
    err.textContent = "Rôle utilisateur non autorisé.";
    err.classList.remove("hidden");
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.innerHTML = original;
  });
});
