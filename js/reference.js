const tableName=location.pathname.toLowerCase().includes("zones")?"zones":"faculties";
let allRefs=[];
(async()=>{const ctx=await requirePermission("viewReferences");if(!ctx)return;window.canManageReferences=can(ctx,"manageSettings");setupShell(ctx);$("#addRef")?.classList.toggle("hidden",!window.canManageReferences);await loadRefs();$("#refSearch")?.addEventListener("input",renderRefs);})();
function stripAccents(s){return String(s).normalize("NFD").replace(/[̀-ͯ]/g,"");}
async function loadRefs(){const grid=$("#refGrid");if(grid)grid.innerHTML='<div class="loading-state">Chargement…</div>';const {data,error}=await sb.from(tableName).select("id,name,created_at").order("name");if(error){if(grid)grid.innerHTML='<div class="empty">Impossible de charger les données. Réessayez.</div>';return showAlert("#pageAlert",error.message,"error");}allRefs=data||[];renderRefs();}
function renderRefs(){
  const q=stripAccents(($("#refSearch")?.value||"").trim().toLowerCase());
  const list=q?allRefs.filter(x=>stripAccents(x.name).toLowerCase().includes(q)):allRefs;
  // No data inside inline JavaScript: the browser decodes HTML entities in onclick=""
  // before running it, so an escaped quote in a name would still break out. Buttons
  // carry the id only; the delegated listener below looks the record up.
  $("#refGrid").innerHTML=list.map(x=>`<article class="ref-card"><div><span class="ref-dot" aria-hidden="true"></span><strong>${escapeHtml(x.name)}</strong></div><div class="actions">${window.canManageReferences ? `<button type="button" class="icon-btn" aria-label="Modifier ${escapeHtml(x.name)}" title="Modifier" data-ref-action="edit" data-ref-id="${escapeHtml(x.id)}">${ICONS.edit}</button><button type="button" class="icon-btn danger" aria-label="Supprimer ${escapeHtml(x.name)}" title="Supprimer" data-ref-action="delete" data-ref-id="${escapeHtml(x.id)}">${ICONS.trash}</button>` : ""}</div></article>`).join("")||`<div class="empty">Aucune donnée trouvée.</div>`;
}
$("#refGrid")?.addEventListener("click",e=>{const button=e.target.closest("[data-ref-action]");if(!button)return;const id=button.dataset.refId;if(button.dataset.refAction==="edit"){const ref=allRefs.find(x=>String(x.id)===id);if(ref)editRef(ref.id,ref.name);}else window.deleteRef(id);});
function editRef(id,name){ if(!window.canManageReferences)return;$("#refModal").classList.remove("hidden");$("#refTitle").textContent="Modifier";$("#refId").value=id;$("#refName").value=name;}
$("#addRef").onclick=()=>{if(!window.canManageReferences)return;$("#refModal").classList.remove("hidden");$("#refTitle").textContent="Ajouter";$("#refId").value="";$("#refName").value=""};
$("#closeRef").onclick=()=>$("#refModal").classList.add("hidden");
$("#refForm").onsubmit=async e=>{e.preventDefault();if(!window.canManageReferences)return;const id=$("#refId").value,name=$("#refName").value.trim();if(!name)return showAlert(null,"Le nom est obligatoire.","error");const q=id?sb.from(tableName).update({name}).eq("id",id).select("id"):sb.from(tableName).insert({name}).select("id");const failure=writeError(await q);if(failure)return showAlert(null,failure,"error");$("#refModal").classList.add("hidden");loadRefs();showAlert(null,id?"Élément modifié.":"Élément ajouté.");};
window.editRef=editRef;window.deleteRef=async id=>{if(!window.canManageReferences)return;if(!(await confirmDialog("Supprimer cet élément ?",{confirmText:"Supprimer"})))return;const failure=writeError(await sb.from(tableName).delete().eq("id",id).select("id"));if(failure)showAlert(null,failure,"error");else{loadRefs();showAlert(null,"Élément supprimé.");}};
