import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const url=Deno.env.get('SUPABASE_URL')||'';
const anonKey=Deno.env.get('SUPABASE_ANON_KEY')||'';
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
if(!url||!anonKey||!serviceKey)throw new Error('Required Edge Function secrets are missing.');
const cors={'Access-Control-Allow-Origin':'https://mounaelkhattar2-stack.github.io','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const loginEmail=id=>`id-${Array.from(new TextEncoder().encode(id.trim()),b=>b.toString(16).padStart(2,'0')).join('')}@login.smart-school-2027.invalid`;
const temporaryPassword=()=>`${crypto.randomUUID()}-Aa7!`;

Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply(405,{error:'Méthode non autorisée.'});
 const authorization=req.headers.get('Authorization');if(!authorization?.startsWith('Bearer '))return reply(401,{error:'Session requise.'});
 let body;try{body=await req.json();}catch{return reply(400,{error:'Requête invalide.'});}
 const caller=createClient(url,anonKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error:userError}=await caller.auth.getUser();if(userError||!user)return reply(401,{error:'Session invalide.'});
 const {data:actor,error:actorError}=await caller.from('profiles').select('role,status').eq('id',user.id).single();
 const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  if(body.action==='complete_password_reset'){
   const pass=String(body.new_password||'');if(pass.length<12||pass.length>200)return reply(400,{error:'Le nouveau mot de passe doit contenir au moins 12 caractères.'});
   const {data:p,error}=await caller.from('profiles').select('role,status').eq('id',user.id).single();
   if(error||!p||!['PARENT','TEACHER'].includes(p.role)||p.status!=='RESET_REQUIRED')return reply(403,{error:'Aucun changement de mot de passe n’est en attente.'});
   const {error:updateError}=await admin.auth.admin.updateUserById(user.id,{password:pass});if(updateError)return reply(400,{error:'Le nouveau mot de passe n’a pas pu être enregistré.'});
   const {error:profileError}=await admin.rpc('service_complete_password_reset',{p_user_id:user.id,p_direction_user_id:null});
   if(profileError)return reply(503,{error:'Mot de passe enregistré; la finalisation doit être réessayée. Reconnectez-vous avec ce nouveau mot de passe.'});
   return reply(200,{ok:true});
  }
  if(actorError||actor?.role!=='DIRECTION'||actor.status!=='ACTIVE')return reply(403,{error:'Action réservée à la Direction.'});
  if(body.action==='create_teacher_account'){
   const teacherId=String(body.teacher_id||'').trim();if(!/^[A-Za-z0-9_-]{2,40}$/.test(teacherId))return reply(400,{error:'Fiche enseignant invalide.'});
   const {data:teacher,error:teacherError}=await caller.from('teachers').select('teacher_id,login_id,full_name,status').eq('teacher_id',teacherId).maybeSingle();
   if(teacherError||!teacher||teacher.status!=='Actif')return reply(404,{error:'Enseignant actif introuvable.'});
   const {data:existing,error:profileError}=await caller.from('profiles').select('id').eq('teacher_id',teacherId).maybeSingle();if(profileError)return reply(500,{error:'Vérification du compte impossible.'});if(existing)return reply(409,{error:'Un compte est déjà lié à cet enseignant.'});
   const loginId=String(teacher.login_id||'').trim();if(loginId.length<3)return reply(409,{error:'Identifiant enseignant invalide.'});
   const email=loginEmail(loginId);let userId=null;const pass=temporaryPassword();
   for(let page=1;page<=10;page++){
    const {data,error}=await admin.auth.admin.listUsers({page,perPage:1000});if(error)return reply(500,{error:'Vérification des comptes Auth impossible.'});
    const found=data.users.find(x=>x.email?.toLowerCase()===email.toLowerCase());
    if(found)return reply(409,{error:'Cet identifiant Auth existe déjà sans liaison vérifiée. Une récupération manuelle est requise.'});
    if(data.users.length<1000)break;
   }
   {const {data,error}=await admin.auth.admin.createUser({email,password:pass,email_confirm:true,app_metadata:{account_code:loginId,role:'TEACHER',status:'RESET_REQUIRED'}});if(error||!data.user)return reply(409,{error:'Le compte enseignant n’a pas pu être créé.'});userId=data.user.id;}
   const {data:account,error:linkError}=await admin.rpc('service_create_teacher_profile',{p_teacher_id:teacherId,p_auth_user_id:userId,p_direction_user_id:user.id});
   if(linkError){await admin.auth.admin.deleteUser(userId);return reply(409,{error:'Le compte ne peut pas être lié à cette fiche enseignant.'});}
   return reply(200,{ok:true,account_id:account,temporary_password:pass,must_change_password:true});
  }
  if(body.action==='reset_password'){
   const accountId=String(body.user_id||'');if(!/^[0-9a-f-]{36}$/i.test(accountId))return reply(400,{error:'Compte invalide.'});
   const {data:target,error}=await caller.from('profiles').select('id,role,status').eq('id',accountId).single();
   if(error||!target||!['PARENT','TEACHER'].includes(target.role)||target.status!=='ACTIVE')return reply(404,{error:'Seul un compte actif Parent ou Enseignant peut être réinitialisé.'});
   const {error:markError}=await admin.rpc('service_require_password_reset',{p_user_id:accountId,p_direction_user_id:user.id});if(markError)return reply(409,{error:'Le compte n’a pas pu être préparé.'});
   const pass=temporaryPassword(),{error:updateError}=await admin.auth.admin.updateUserById(accountId,{password:pass});
   if(updateError){await admin.rpc('service_complete_password_reset',{p_user_id:accountId,p_direction_user_id:user.id});return reply(500,{error:'La réinitialisation a échoué; le statut du compte a été restauré.'});}
   return reply(200,{ok:true,temporary_password:pass,must_change_password:true});
  }
  return reply(400,{error:'Opération non prise en charge.'});
 }finally{await admin.auth.signOut({scope:'local'}).catch(()=>{});await caller.auth.signOut({scope:'local'}).catch(()=>{});}
});
