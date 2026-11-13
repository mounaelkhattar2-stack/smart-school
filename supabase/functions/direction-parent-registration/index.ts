import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const url=Deno.env.get('SUPABASE_URL')||'';
const anonKey=Deno.env.get('SUPABASE_ANON_KEY')||'';
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
if(!url||!anonKey||!serviceKey)throw new Error('Required Edge Function secrets are missing.');
const cors={
  'Access-Control-Allow-Origin':'https://mounaelkhattar2-stack.github.io',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Vary':'Origin'
};
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const loginEmail=id=>`id-${Array.from(new TextEncoder().encode(id.trim()),b=>b.toString(16).padStart(2,'0')).join('')}@login.smart-school-2027.invalid`;

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return reply(405,{error:'Méthode non autorisée.'});
  const authorization=req.headers.get('Authorization');
  if(!authorization?.startsWith('Bearer '))return reply(401,{error:'Session requise.'});
  let body;
  try{body=await req.json();}catch{return reply(400,{error:'Requête invalide.'});}
  const requestId=String(body.request_id||'').trim();
  const decision=String(body.decision||'');
  const reason=String(body.reason||'').trim();
  if(!/^INS-[0-9a-f-]{20,50}$/i.test(requestId)||!['APPROUVEE','REFUSEE'].includes(decision))return reply(400,{error:'Demande ou décision invalide.'});
  if(decision==='REFUSEE'&&(reason.length<3||reason.length>500))return reply(400,{error:'Un motif de refus est obligatoire.'});

  const caller=createClient(url,anonKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:userError}=await caller.auth.getUser();
  if(userError||!user)return reply(401,{error:'Session invalide.'});
  const {data:profile,error:profileError}=await caller.from('profiles').select('id,role,status').eq('id',user.id).maybeSingle();
  if(profileError||profile?.role!=='DIRECTION'||profile.status!=='ACTIVE')return reply(403,{error:'Action réservée à la Direction.'});

  const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  if(decision==='REFUSEE'){
    const {error}=await caller.rpc('direction_reject_parent_registration',{p_request_id:requestId,p_reason:reason});
    return error?reply(error.code==='40001'?409:400,{error:'La demande n’a pas pu être refusée.'}):reply(200,{ok:true});
  }

  const {data:request,error:requestError}=await admin.from('parent_registration_requests').select('request_id,parent_id,parent_name,child_name,class_id,class_number,massar_id,email,status').eq('request_id',requestId).maybeSingle();
  if(requestError||!request)return reply(404,{error:'Demande introuvable.'});
  if(request.status!=='EN_ATTENTE')return reply(409,{error:'Cette demande a déjà été traitée.'});
  const {data:parent,error:parentError}=await admin.from('parents').select('parent_id,login_id,full_name,student_id,registration_status').eq('parent_id',request.parent_id).maybeSingle();
  if(parentError||!parent||parent.registration_status!=='EN_ATTENTE')return reply(409,{error:'Le profil parent n’est plus en attente.'});
  const {data:student,error:studentError}=await admin.from('students').select('student_id,full_name,massar_id,class_id,class_number').eq('student_id',parent.student_id).maybeSingle();
  if(studentError||!student||student.massar_id!==request.massar_id||student.class_id!==request.class_id||student.class_number!==request.class_number||student.full_name.trim().toLocaleLowerCase('fr')!==request.child_name.trim().toLocaleLowerCase('fr'))return reply(409,{error:'Le lien avec l’élève ne correspond pas aux dossiers scolaires.'});
  const loginId=String(parent.login_id||parent.parent_id);
  const {data:hash,error:hashError}=await admin.rpc('service_pending_parent_password_hash',{p_request_id:requestId});
  if(hashError||typeof hash!=='string'||!/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(hash))return reply(409,{error:'Le mot de passe initial n’est pas disponible pour cette demande.'});
  const syntheticEmail=loginEmail(loginId);
  const {data:existingProfile,error:existingProfileError}=await admin.from('profiles').select('id').eq('account_code',loginId).maybeSingle();
  if(existingProfileError)return reply(500,{error:'Impossible de vérifier le compte existant.'});
  if(existingProfile)return reply(409,{error:'Un compte utilise déjà cet identifiant.'});

  let authUserId=null;
  let createdNow=false;
  for(let page=1;page<=10;page++){
    const {data,error}=await admin.auth.admin.listUsers({page,perPage:1000});
    if(error)return reply(500,{error:'Impossible de vérifier les comptes Auth.'});
    const found=data.users.find(u=>u.email?.toLowerCase()===syntheticEmail.toLowerCase());
    if(found){
      if(found.app_metadata?.account_code!==loginId||found.app_metadata?.role!=='PARENT')return reply(409,{error:'Un compte Auth déjà existant utilise cet identifiant.'});
      authUserId=found.id;break;
    }
    if(data.users.length<1000)break;
  }
  if(!authUserId){
    const {data,error}=await admin.auth.admin.createUser({email:syntheticEmail,password_hash:hash,email_confirm:true,app_metadata:{account_code:loginId,role:'PARENT',status:'ACTIVE'}});
    if(error||!data.user)return reply(409,{error:'Le compte parent Auth n’a pas pu être créé.'});
    authUserId=data.user.id;createdNow=true;
  }
  const {data:finalized,error:finalizeError}=await admin.rpc('service_finalize_parent_registration',{p_request_id:requestId,p_auth_user_id:authUserId,p_direction_user_id:user.id});
  if(finalizeError){
    if(createdNow)await admin.auth.admin.deleteUser(authUserId).catch(()=>({error:true}));
    return reply(finalizeError.code==='40001'?409:409,{error:'Le compte Auth a été préparé, mais la validation atomique a échoué. Réessayez ou contactez le support.'});
  }
  return reply(200,{ok:true,login_id:finalized});
});
