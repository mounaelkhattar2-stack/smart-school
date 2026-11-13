import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import bcrypt from 'npm:bcryptjs@3.0.2';
const url=Deno.env.get('SUPABASE_URL')||'';
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
if(!url||!serviceKey)throw new Error('Required Edge Function secrets are missing.');
const cors={'Access-Control-Allow-Origin':'https://mounaelkhattar2-stack.github.io','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const generic={message:'Votre demande a été transmise. La Direction doit la vérifier avant toute création de compte.'};
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply(405,{error:'Méthode non autorisée.'});
 let input;try{input=await req.json();}catch{return reply(400,{error:'Formulaire invalide.'});}
 const parentName=String(input.parent_name||'').trim(),childName=String(input.child_name||'').trim(),classId=String(input.class_id||'').trim().toUpperCase(),massar=String(input.massar_id||'').trim().toUpperCase(),classNumber=Number(input.class_number),email=String(input.email||'').trim().toLowerCase(),phone=String(input.phone||'').trim(),confirmation=String(input.password_confirmation||'');let password=String(input.password||'');
 if(input.confirmed!==true||parentName.length<3||parentName.length>120||childName.length<3||childName.length>120||!/^[A-Z0-9-]{5,24}$/i.test(massar)||!/^[A-Z0-9_-]{2,20}$/.test(classId)||!Number.isInteger(classNumber)||classNumber<1||classNumber>60||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>160||phone.length<6||phone.length>30||password.length<10||password.length>200||password!==confirmation)return reply(400,{error:'Vérifiez les champs et la confirmation du mot de passe.'});
 const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const passwordHash=await bcrypt.hash(password,12),requestId=`INS-${crypto.randomUUID()}`,accountId=`PAR-${crypto.randomUUID()}`;
  const {data,error}=await admin.rpc('service_submit_parent_registration',{p_request_id:requestId,p_parent_id:accountId,p_parent_name:parentName,p_child_name:childName,p_class_id:classId,p_class_number:classNumber,p_massar_id:massar,p_email:email,p_phone:phone,p_password_hash:passwordHash});
  if(error){if(error.code==='P0002'||error.code==='23505'||error.code==='22023')return reply(202,generic);return reply(500,{error:'La demande n’a pas pu être enregistrée. Réessayez plus tard.'});}
  return reply(202,{...generic,account_id:accountId});
 }finally{password='';input.password='';input.password_confirmation='';await admin.auth.signOut({scope:'local'}).catch(()=>{});}
});
