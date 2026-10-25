let facultyChart, zoneChart, facData, zoneData;

function renderCharts(){
  if(!facData) return;
  const dark=document.documentElement.getAttribute("data-theme")==="dark";
  const ink=dark?"#f2f3f5":"#0f1115", grid=dark?"#23262d":"#eef0f3", muted=dark?"#9097a3":"#667085", surface=dark?"#13151a":"#ffffff";
  Chart.defaults.color=muted; Chart.defaults.font.family="Inter, system-ui, sans-serif"; Chart.defaults.font.size=12;
  const tooltip={backgroundColor:dark?"#f2f3f5":"#0f1115",titleColor:dark?"#0f1115":"#fff",bodyColor:dark?"#0f1115":"#fff",padding:10,cornerRadius:8,displayColors:false};
  const zonePalette=["#c8102e",dark?"#e4e7ec":"#0f1115","#f04462","#667085","#fda29b","#98a2b3","#7a0b1d",dark?"#475467":"#d0d5dd"];
  const fac=[...facData].sort((a,b)=>b[1]-a[1]);
  const zones=[...zoneData].sort((a,b)=>b[1]-a[1]);
  const max=window.innerWidth<640?16:28; // phones: short labels keep the bars readable
  const short=label=>label.length>max?label.slice(0,max-1)+"…":label;

  facultyChart?.destroy(); zoneChart?.destroy();

  // Horizontal bars: long faculty names stay readable, largest first.
  facultyChart=new Chart($("#facultyChart"),{type:"bar",data:{labels:fac.map(x=>short(x[0])),datasets:[{label:"Abonnés",data:fac.map(x=>x[1]),borderRadius:6,borderSkipped:false,backgroundColor:"#c8102e",hoverBackgroundColor:"#e51c3f",barThickness:"flex",maxBarThickness:22}]},options:{indexAxis:"y",responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{...tooltip,callbacks:{title:items=>fac[items[0].dataIndex][0]}}},scales:{x:{beginAtZero:true,ticks:{precision:0,color:muted},grid:{color:grid},border:{display:false}},y:{ticks:{color:ink},grid:{display:false},border:{display:false}}}}});
  zoneChart=new Chart($("#zoneChart"),{type:"doughnut",data:{labels:zones.map(x=>x[0]),datasets:[{data:zones.map(x=>x[1]),backgroundColor:zonePalette,borderColor:surface,borderWidth:3,hoverOffset:4}]},options:{responsive:true,maintainAspectRatio:false,cutout:"68%",plugins:{tooltip,legend:{position:"right",labels:{color:ink,usePointStyle:true,pointStyle:"circle",boxWidth:8,padding:14}}}}});
}

window.addEventListener("ue-theme-change", renderCharts);

(async function init(){
  const ctx=await requirePermission("viewDashboard"); if(!ctx)return; setupShell(ctx);
  const displayName=ctx.profile.display_name||"Admin";
  $("#adminName").textContent=displayName;
  if($("#adminGreetName"))$("#adminGreetName").textContent=displayName;
  renderGreeting();
  renderQuickActions(ctx);
  const {data: subs,error}=await sb.from("subscribers").select("id,nom,prenom,numero_abonnement,status,created_at,faculties(name),zones(name)").order("created_at",{ascending:false});
  if(error){
    for(const id of ["#total","#active","#inactive","#rate"])$(id).textContent="—";
    $("#recentRows").innerHTML=`<tr><td colspan="6" class="empty">Impossible de charger les données. Rechargez la page.</td></tr>`;
    return showAlert("#pageAlert","Erreur de chargement des statistiques.","error");
  }
  const total=subs.length, active=subs.filter(s=>s.status==="ACTIVE").length;
  renderInsight(total, active);
  $("#total").textContent=total;$("#active").textContent=active;$("#inactive").textContent=total-active;$("#rate").textContent=total?Math.round(active/total*100)+"%":"0%";
  const countBy=(key)=>Object.entries(subs.reduce((a,s)=>{let k=s[key]?.name||"Non défini";if(key==="faculties")k=facultyShort(k);a[k]=(a[k]||0)+1;return a},{}));
  facData=countBy("faculties"); zoneData=countBy("zones");
  renderCharts();
  $("#recentRows").innerHTML=subs.slice(0,8).map(s=>`<tr><td>${escapeHtml(s.nom)}</td><td>${escapeHtml(s.prenom)}</td><td>${escapeHtml(s.numero_abonnement)}</td><td>${escapeHtml(facultyShort(s.faculties?.name)||"—")}</td><td>${escapeHtml(s.zones?.name||"—")}</td><td>${statusBadge(s.status)}</td><td class="m-summary"><div class="m-head"><span class="m-avatar">${escapeHtml((s.prenom||s.nom||"?").charAt(0).toUpperCase())}</span><div class="m-id"><strong>${escapeHtml(`${s.prenom||""} ${s.nom||""}`.trim())}</strong><small>${escapeHtml([s.numero_abonnement?`N° ${s.numero_abonnement}`:"",facultyShort(s.faculties?.name)||"",s.zones?.name||""].filter(Boolean).join(" · ")||"—")}</small></div>${statusBadge(s.status)}</div></td></tr>`).join("")||`<tr><td colspan="6" class="empty">Aucun abonné</td></tr>`;
})();


// ---------- Phone dashboard helpers ----------
function renderGreeting(){
  const h=new Date().getHours();
  if($("#greetWord"))$("#greetWord").textContent=h>=18||h<5?"Bonsoir":"Bonjour";
  if($("#heroDate"))$("#heroDate").textContent=new Date().toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});
}

// Shortcuts to the most used screens, only those the role may open.
function renderQuickActions(ctx){
  const box=$("#quickActions"); if(!box) return;
  const icon=d=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const items=[
    can(ctx,"manageMembers")&&{href:"subscribers.html",label:"Ajouter un abonné",icon:icon('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c0-3.3 2.6-5.6 5.5-5.6s5.5 2.3 5.5 5.6"/><path d="M18 8v6M15 11h6"/>')},
    can(ctx,"viewMembers")&&{href:"subscribers.html",label:"Abonnés",icon:icon('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c0-3.3 2.6-5.6 5.5-5.6s5.5 2.3 5.5 5.6"/><circle cx="17" cy="8.5" r="2.4"/><path d="M15.8 14.7c2.5.3 4.3 2.3 4.3 5.3"/>')},
    can(ctx,"viewEvents")&&{href:"payments.html",label:"Cotisations",icon:icon('<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/>')},
    can(ctx,"viewMatches")&&{href:"admin-matchs.html",label:"Matchs",icon:icon('<circle cx="12" cy="12" r="8.5"/><path d="M12 8.2l3.4 2.5-1.3 4h-4.2l-1.3-4z"/>')},
    can(ctx,"viewUsers")&&{href:"admin-users.html",label:"Comptes",icon:icon('<path d="M12 3.5l7 2.6v5.4c0 4.6-2.9 7.8-7 9-4.1-1.2-7-4.4-7-9V6.1l7-2.6z"/><path d="M9 12.2l2 2 4-4.2"/>')},
    can(ctx,"useMemberArea")&&{href:"subscriber.html",label:"Mon espace",icon:icon('<path d="M3.5 11L12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>')}
  ].filter(Boolean).slice(0,6);
  box.innerHTML=items.map(i=>`<a class="qa-tile" href="${i.href}">${i.icon}<span>${escapeHtml(i.label)}</span></a>`).join("");
}

function renderInsight(total, active){
  const hero=$(".hero-card > div"); if(!hero||$("#heroInsight")) return;
  const p=document.createElement("p"); p.id="heroInsight"; p.className="hero-insight";
  const rate=total?Math.round(active/total*100):0;
  p.innerHTML=`<b>${active}</b> actifs sur <b>${total}</b> abonnés · <b>${rate}%</b>`;
  hero.appendChild(p);
}
