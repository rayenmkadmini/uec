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
  const {data: subs,error}=await sb.from("subscribers").select("id,nom,prenom,numero_abonnement,status,created_at,faculties(name),zones(name)").order("created_at",{ascending:false});
  if(error){
    for(const id of ["#total","#active","#inactive","#rate"])$(id).textContent="—";
    $("#recentRows").innerHTML=`<tr><td colspan="6" class="empty">Impossible de charger les données. Rechargez la page.</td></tr>`;
    return showAlert("#pageAlert","Erreur de chargement des statistiques.","error");
  }
  const total=subs.length, active=subs.filter(s=>s.status==="ACTIVE").length;
  $("#total").textContent=total;$("#active").textContent=active;$("#inactive").textContent=total-active;$("#rate").textContent=total?Math.round(active/total*100)+"%":"0%";
  const countBy=(key)=>Object.entries(subs.reduce((a,s)=>{let k=s[key]?.name||"Non défini";if(key==="faculties")k=facultyShort(k);a[k]=(a[k]||0)+1;return a},{}));
  facData=countBy("faculties"); zoneData=countBy("zones");
  renderCharts();
  $("#recentRows").innerHTML=subs.slice(0,8).map(s=>`<tr><td>${escapeHtml(s.nom)}</td><td>${escapeHtml(s.prenom)}</td><td>${escapeHtml(s.numero_abonnement)}</td><td>${escapeHtml(facultyShort(s.faculties?.name)||"—")}</td><td>${escapeHtml(s.zones?.name||"—")}</td><td>${statusBadge(s.status)}</td></tr>`).join("")||`<tr><td colspan="6" class="empty">Aucun abonné</td></tr>`;
})();
