/* ============================================================
   ANNONCES — news from the bureau. Every account reads them; ADMIN /
   SUPERADMIN publish, edit, pin and delete (row-level security of
   migration 20261028120000). The last visit is remembered on this device
   so new announcements are flagged.
============================================================ */
let annAll = [];
let annManager = false;
let annPhotoUrl = null; // current photo of the announcement being edited
const ANN_SEEN = "uec-announcements-seen";

(async () => {
  const ctx = await requirePermission("useCommunity");
  if (!ctx) return;
  setupShell(ctx);
  annManager = can(ctx, "manageMeetings");
  document.getElementById("annCompose").classList.toggle("hidden", !annManager);
  document.getElementById("annForm").addEventListener("submit", save);
  document.getElementById("annCancel").addEventListener("click", resetForm);
  document.getElementById("annList").addEventListener("click", onClick);
  document.getElementById("annPhoto").addEventListener("change", e => {
    const file = e.target.files?.[0];
    if (file) showPhoto(URL.createObjectURL(file));
  });
  document.getElementById("annPhotoRemove").addEventListener("click", () => { annPhotoUrl = null; document.getElementById("annPhoto").value = ""; showPhoto(null); });
  await load();
})();

function lastSeen() { try { return Number(localStorage.getItem(ANN_SEEN) || 0); } catch (_) { return 0; } }

async function load() {
  const box = document.getElementById("annList");
  const { data, error } = await sb.from("announcements").select("id,title,body,image_url,pinned,created_at,updated_at").order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(100);
  if (error) { box.innerHTML = '<div class="empty">Les annonces ne sont pas encore disponibles (migration 20261028120000 à appliquer).</div>'; return; }
  annAll = data || [];
  const seen = lastSeen();
  const ago = d => {
    const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
    if (m < 1) return "à l’instant";
    if (m < 60) return `il y a ${m} min`;
    if (m < 1440) return `il y a ${Math.round(m / 60)} h`;
    if (m < 10080) return `il y a ${Math.round(m / 1440)} j`;
    return new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  };
  const text = a => escapeHtml(a.body).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener nofollow">${u}</a>`);
  box.innerHTML = annAll.length ? annAll.map((a, i) => {
    const isNew = new Date(a.created_at).getTime() > seen;
    const featured = i === 0;
    const long = a.body.length > 260;
    return `<article class="ann-card${featured ? " featured" : ""}${a.pinned ? " pinned" : ""}${a.image_url ? " has-img" : ""}">
      ${a.image_url ? `<div class="ann-media"><img src="${escapeHtml(a.image_url)}" alt="" loading="lazy"></div>` : ""}
      <div class="ann-content">
        <div class="ann-top">
          <span class="ann-author"><img src="assets/uec-logo-96.webp" alt="" width="28" height="28"><span><b>Bureau UEC</b><time datetime="${a.created_at}" title="${new Date(a.created_at).toLocaleString("fr-FR")}">${ago(a.created_at)}</time></span></span>
          <span class="ann-tags">${a.pinned ? '<span class="ann-tag pin">📌 Épinglée</span>' : ""}${isNew ? '<span class="ann-tag new">Nouveau</span>' : ""}</span>
        </div>
        <h3>${escapeHtml(a.title)}</h3>
        <p class="${long ? "clamp" : ""}">${text(a)}</p>
        ${long ? '<button type="button" class="ann-more" data-more>Lire la suite</button>' : ""}
        ${annManager ? `<div class="ann-actions"><button type="button" class="btn secondary" data-edit="${a.id}">Modifier</button><button type="button" class="btn secondary" data-pin="${a.id}">${a.pinned ? "Désépingler" : "Épingler"}</button><button type="button" class="btn secondary danger" data-del="${a.id}">Supprimer</button></div>` : ""}
      </div>
    </article>`;
  }).join("") : '<div class="ann-empty"><span aria-hidden="true">📣</span><b>Aucune annonce pour le moment</b><small>Les nouvelles du bureau apparaîtront ici.</small></div>';
  try { localStorage.setItem(ANN_SEEN, String(Date.now())); } catch (_) {}
}

function showPhoto(src) {
  const box = document.getElementById("annPhotoPreview");
  box.classList.toggle("hidden", !src);
  if (src) box.querySelector("img").src = src;
}

function resetForm() {
  annPhotoUrl = null;
  showPhoto(null);
  document.getElementById("annId").value = "";
  document.getElementById("annForm").reset();
  document.getElementById("annFormTitle").textContent = "Nouvelle annonce";
  document.getElementById("annCancel").classList.add("hidden");
}

async function save(event) {
  event.preventDefault();
  const id = document.getElementById("annId").value;
  let imageUrl = annPhotoUrl;
  const file = document.getElementById("annPhoto").files?.[0];
  if (file) {
    try { imageUrl = await uploadCommunityImage(file, "announcements"); }
    catch (e) { return showAlert("#pageAlert", e.message, "error"); }
  }
  const row = { image_url: imageUrl, title: document.getElementById("annTitle").value.trim(), body: document.getElementById("annBody").value.trim(), pinned: document.getElementById("annPinned").checked, updated_at: new Date().toISOString() };
  const q = id ? sb.from("announcements").update(row).eq("id", id).select("id") : sb.from("announcements").insert(row).select("id");
  const failure = writeError(await q);
  if (failure) return showAlert("#pageAlert", failure, "error");
  showAlert("#pageAlert", id ? "Annonce modifiée." : "Annonce publiée. Les membres la voient dans leur espace.", "success");
  resetForm();
  load();
}

async function onClick(event) {
  const more = event.target.closest("[data-more]");
  if (more) {
    const p = more.previousElementSibling;
    p.classList.toggle("clamp");
    more.textContent = p.classList.contains("clamp") ? "Lire la suite" : "Réduire";
    return;
  }
  const edit = event.target.closest("[data-edit]");
  const pin = event.target.closest("[data-pin]");
  const del = event.target.closest("[data-del]");
  const a = annAll.find(x => x.id === (edit || pin || del)?.dataset[edit ? "edit" : pin ? "pin" : "del"]);
  if (!a) return;
  if (edit) {
    document.getElementById("annId").value = a.id;
    document.getElementById("annTitle").value = a.title;
    document.getElementById("annBody").value = a.body;
    document.getElementById("annPinned").checked = a.pinned;
    annPhotoUrl = a.image_url || null;
    document.getElementById("annPhoto").value = "";
    showPhoto(annPhotoUrl);
    document.getElementById("annFormTitle").textContent = "Modifier l’annonce";
    document.getElementById("annCancel").classList.remove("hidden");
    document.getElementById("annCompose").scrollIntoView({ behavior: "smooth" });
  } else if (pin) {
    const failure = writeError(await sb.from("announcements").update({ pinned: !a.pinned }).eq("id", a.id).select("id"));
    if (failure) return showAlert("#pageAlert", failure, "error");
    load();
  } else if (await confirmDialog(`Supprimer « ${a.title} » ?`, { confirmText: "Supprimer" })) {
    const failure = writeError(await sb.from("announcements").delete().eq("id", a.id).select("id"));
    if (failure) return showAlert("#pageAlert", failure, "error");
    load();
  }
}
