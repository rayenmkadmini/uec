/* ============================================================
   DISCUSSION — live chat between members (Supabase Realtime).
   Rooms: # général (every active account) and # bureau (ADMIN /
   SUPERADMIN). The database sets the author name, limits the rate and
   decides who can read or withdraw a message (migration 20261028120000).
============================================================ */
let chatCtx = null;
let chatChannel = "GENERAL";
let chatMessages = [];
let chatSub = null;
let chatPresence = null;
let chatIsManager = false;

(async () => {
  chatCtx = await requirePermission("useCommunity");
  if (!chatCtx) return;
  setupShell(chatCtx);
  chatIsManager = can(chatCtx, "manageMeetings");
  const bureauTab = document.querySelector('[data-channel="BUREAU"]');
  if (bureauTab) bureauTab.hidden = !chatIsManager;
  document.getElementById("chatTabs").addEventListener("click", event => {
    const tab = event.target.closest("[data-channel]");
    if (!tab || tab.dataset.channel === chatChannel) return;
    document.querySelectorAll(".chat-tab").forEach(t => { const on = t === tab; t.classList.toggle("active", on); t.setAttribute("aria-selected", String(on)); });
    chatChannel = tab.dataset.channel;
    openChannel();
  });
  const input = document.getElementById("chatInput");
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 140)}px`; });
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !window.matchMedia("(max-width: 900px)").matches) { event.preventDefault(); document.getElementById("chatForm").requestSubmit(); }
  });
  document.getElementById("chatForm").addEventListener("submit", send);
  document.getElementById("chatList").addEventListener("click", onListClick);
  document.getElementById("chatList").addEventListener("scroll", () => { if (nearBottom()) document.getElementById("chatNewer").classList.add("hidden"); });
  document.getElementById("chatNewer").addEventListener("click", () => scrollBottom(true));
  openChannel();
  joinPresence();
})();

const list = () => document.getElementById("chatList");
const nearBottom = () => { const l = list(); return l.scrollHeight - l.scrollTop - l.clientHeight < 80; };
function scrollBottom(smooth = false) { const l = list(); l.scrollTo({ top: l.scrollHeight, behavior: smooth ? "smooth" : "auto" }); document.getElementById("chatNewer").classList.add("hidden"); }

async function openChannel() {
  list().innerHTML = '<div class="loading-state">Chargement des messages…</div>';
  if (chatSub) { sb.removeChannel(chatSub); chatSub = null; }
  const { data, error } = await sb.from("chat_messages")
    .select("id,channel,user_id,author_name,body,created_at,deleted_at")
    .eq("channel", chatChannel).order("created_at", { ascending: false }).limit(80);
  if (error) {
    list().innerHTML = '<div class="empty">La discussion n’est pas encore disponible (migration 20261028120000 à appliquer).</div>';
    return;
  }
  chatMessages = (data || []).reverse();
  render();
  scrollBottom();
  chatSub = sb.channel(`chat-${chatChannel}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages", filter: `channel=eq.${chatChannel}` }, payload => {
      const row = payload.new;
      if (!row?.id) return;
      const i = chatMessages.findIndex(m => m.id === row.id);
      const stick = nearBottom() || row.user_id === chatCtx.user.id;
      if (i >= 0) chatMessages[i] = row; else chatMessages.push(row);
      render();
      if (stick) scrollBottom(true); else if (i < 0) document.getElementById("chatNewer").classList.remove("hidden");
    })
    .subscribe();
}

function joinPresence() {
  chatPresence = sb.channel("chat-presence", { config: { presence: { key: chatCtx.user.id } } });
  chatPresence.on("presence", { event: "sync" }, () => {
    const n = Object.keys(chatPresence.presenceState()).length;
    document.getElementById("chatOnline").innerHTML = `<i></i> ${n} en ligne`;
  }).subscribe(status => { if (status === "SUBSCRIBED") chatPresence.track({ at: Date.now() }); });
}

const day = d => new Date(d).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const hm = d => new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const initial = name => escapeHtml((name || "M").trim().charAt(0).toUpperCase());
// Links become clickable; everything else stays escaped text.
const linkify = text => escapeHtml(text).replace(/https?:\/\/[^\s<]+/g, url => `<a href="${url}" target="_blank" rel="noopener nofollow">${url}</a>`);

function render() {
  if (!chatMessages.length) {
    list().innerHTML = '<div class="chat-empty"><b>Aucun message pour l’instant</b><span>Lancez la discussion : dites bonjour au groupe 👋</span></div>';
    return;
  }
  let html = "", lastDay = "", lastUser = "", lastTime = 0;
  for (const m of chatMessages) {
    const d = day(m.created_at);
    if (d !== lastDay) { html += `<div class="chat-day"><span>${d}</span></div>`; lastDay = d; lastUser = ""; }
    const mine = m.user_id === chatCtx.user.id;
    const t = new Date(m.created_at).getTime();
    const grouped = lastUser === m.user_id && t - lastTime < 5 * 60000;
    lastUser = m.user_id; lastTime = t;
    const canDelete = !m.deleted_at && (mine || chatIsManager);
    html += `<div class="chat-msg${mine ? " mine" : ""}${grouped ? " grouped" : ""}${m.deleted_at ? " deleted" : ""}" data-id="${m.id}">
      ${mine ? "" : `<span class="chat-ava" aria-hidden="true">${grouped ? "" : initial(m.author_name)}</span>`}
      <div class="chat-bubble">
        ${grouped || mine ? "" : `<b class="chat-author">${escapeHtml(m.author_name || "Membre")}</b>`}
        <p>${m.deleted_at ? "<em>Message retiré</em>" : linkify(m.body)}</p>
        <span class="chat-time">${hm(m.created_at)}${canDelete ? ` · <button type="button" class="chat-del" data-del="${m.id}">retirer</button>` : ""}</span>
      </div>
    </div>`;
  }
  list().innerHTML = html;
}

async function send(event) {
  event.preventDefault();
  const input = document.getElementById("chatInput");
  const body = input.value.trim();
  if (!body) return;
  input.value = "";
  input.style.height = "auto";
  const { error } = await sb.from("chat_messages").insert({ channel: chatChannel, body });
  if (error) { input.value = body; return showAlert("#pageAlert", error.message, "error"); }
  input.focus();
}

async function onListClick(event) {
  const del = event.target.closest("[data-del]");
  if (!del) return;
  if (!(await confirmDialog("Retirer ce message ?", { confirmText: "Retirer" }))) return;
  const { error } = await sb.rpc("delete_chat_message", { p_id: Number(del.dataset.del) });
  if (error) showAlert("#pageAlert", error.message, "error");
}
