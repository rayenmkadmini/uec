import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set(["http://localhost:5500","http://127.0.0.1:5500","http://localhost:3000","http://127.0.0.1:3000","https://login.ueclubistes.tn","https://ueclubistes.tn","https://www.ueclubistes.tn"]);
function cors(req: Request) { const origin=req.headers.get("Origin")||""; return { ...(allowedOrigins.has(origin)?{"Access-Control-Allow-Origin":origin,"Vary":"Origin"}:{}), "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods":"POST, OPTIONS", "Content-Type":"application/json"}; }
function json(req:Request, body:unknown, status=200){return new Response(JSON.stringify(body),{status,headers:cors(req)});}
function secret(){ const k=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if(k)return k; const raw=Deno.env.get("SUPABASE_SECRET_KEYS"); if(!raw)throw new Error("Supabase server key missing"); const v=Object.values(JSON.parse(raw)).find(x=>typeof x==='string'&&x.length>20); if(!v)throw new Error("Supabase server key missing"); return v as string; }
function adminClient(){return createClient(Deno.env.get("SUPABASE_URL")!,secret(),{auth:{autoRefreshToken:false,persistSession:false}});}
async function requireSuper(req:Request){const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();if(!token)throw new Error("Unauthorized");const db=adminClient();const {data:{user},error}=await db.auth.getUser(token);if(error||!user)throw new Error("Unauthorized");const {data:p}=await db.from("profiles").select("role,is_active").eq("id",user.id).single();if(p?.role!=="SUPERADMIN"||p?.is_active===false)throw new Error("Forbidden");return {db,user};}
function norm(v:string){return String(v||"").trim();}
function slugLogin(nom:string,prenom:string){return `${nom}${prenom}`.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]/g,"");}
async function refId(db:any, table:"faculties"|"zones", value:string){const name=norm(value);if(!name)return null;let {data}=await db.from(table).select("id,name").ilike("name",name).limit(1).maybeSingle();if(data)return data.id;const ins=await db.from(table).insert({name}).select("id").single();if(ins.error) throw new Error(`${table}: ${ins.error.message}`);return ins.data.id;}
async function uniqueLogin(db:any, base:string, ignoreId?:string){let candidate=base||"MEMBRE";let i=1;while(true){let q=db.from("subscribers").select("id").eq("login_name",candidate).limit(1);if(ignoreId)q=q.neq("id",ignoreId);const {data}=await q.maybeSingle();if(!data)return candidate;i++;candidate=`${base}${i}`;}}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(req)});
  if(req.method!=="POST")return json(req,{error:"Method not allowed"},405);
  try{
    const {db,user}=await requireSuper(req);
    const body=await req.json(); const rows=Array.isArray(body.rows)?body.rows:[];
    if(!rows.length)return json(req,{error:"Aucune ligne à importer."},400);
    if(rows.length>500)return json(req,{error:"Maximum 500 lignes par import."},400);
    let created=0,updated=0; const errors:any[]=[];
    for(let i=0;i<rows.length;i++){
      const r=rows[i]||{}; const nom=norm(r.nom),prenom=norm(r.prenom),cin=norm(r.cin),numero=norm(r.numero_abonnement),email=norm(r.email),phone=norm(r.phone),adresse=norm(r.adresse);
      const gender=norm(r.gender).toUpperCase().startsWith("F")?"FEMALE":norm(r.gender).toUpperCase().startsWith("M")?"MALE":"";
      if(!nom||!prenom||!cin||!numero||!gender){errors.push({line:i+2,error:"Nom, prénom, numéro d'abonnement, CIN et sexe sont obligatoires."});continue;}
      try{
        let existing:any=null;
        for(const key of [["cin",cin],["numero_abonnement",numero]]){const {data}=await db.from("subscribers").select("id,user_id,login_name").eq(key[0],key[1]).maybeSingle();if(data){existing=data;break;}}
        if(!existing){const base=slugLogin(nom,prenom);const login=await uniqueLogin(db,base);const authEmail=`${login.toLowerCase()}@login.ueclubiste.local`;const cu=await db.auth.admin.createUser({email:authEmail,password:cin,email_confirm:true,user_metadata:{display_name:`${prenom} ${nom}`,role:"SUBSCRIBER",gender}});if(cu.error||!cu.data.user)throw new Error(cu.error?.message||"Création du compte impossible");
          const faculty_id=await refId(db,"faculties",norm(r.faculty)); const zone_id=await refId(db,"zones",norm(r.zone));
          const ins=await db.from("subscribers").insert({user_id:cu.data.user.id,nom,prenom,login_name:login,numero_abonnement:numero,cin,gender,phone:phone||null,email:email||null,adresse:adresse||null,faculty_id,zone_id,status:"ACTIVE"}).select("id").single();
          if(ins.error){await db.auth.admin.deleteUser(cu.data.user.id);throw new Error(ins.error.message);} await db.from("profiles").update({role:"SUBSCRIBER",display_name:`${prenom} ${nom}`,must_change_password:true,is_active:true}).eq("id",cu.data.user.id); created++;
        } else {
          const faculty_id=await refId(db,"faculties",norm(r.faculty)); const zone_id=await refId(db,"zones",norm(r.zone));
          const up=await db.from("subscribers").update({nom,prenom,numero_abonnement:numero,cin,gender,phone:phone||null,email:email||null,adresse:adresse||null,faculty_id,zone_id,status:"ACTIVE"}).eq("id",existing.id);if(up.error)throw new Error(up.error.message);if(existing.user_id)await db.from("profiles").update({display_name:`${prenom} ${nom}`}).eq("id",existing.user_id);updated++;
        }
      }catch(e){errors.push({line:i+2,error:e instanceof Error?e.message:String(e)});}
    }
    await db.from("security_audit_logs").insert({actor_id:user.id,action:"IMPORT_SUBSCRIBERS",success:errors.length===0,metadata:{rows:rows.length,created,updated,errors:errors.length}});
    return json(req,{ok:true,created,updated,errors});
  }catch(e){return json(req,{error:e instanceof Error?e.message:String(e)},String(e).includes("Unauthorized")?401:403);}
});
