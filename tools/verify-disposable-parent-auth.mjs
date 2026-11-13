import fs from 'node:fs';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const env=Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(x=>x.trim()&&!x.trim().startsWith('#')).map(line=>{const i=line.indexOf('=');return i<0?['','']:[line.slice(0,i).trim(),line.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]}));
for(const key of ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','DATABASE_URL','SUPABASE_DB_CA_CERT'])if(!env[key])throw Error(`Missing required test setting: ${key}`);
const projectRef=new URL(env.SUPABASE_URL).hostname.split('.')[0];
if(projectRef!=='dnkaxkxncgnrgijrmstx')throw Error('Configured Supabase project does not match the SMART SCHOOL project.');
const suffix=crypto.randomUUID();
const loginId=`ZTEST-${suffix.slice(0,12)}`;
const authEmail=`id-${[...new TextEncoder().encode(loginId)].map(b=>b.toString(16).padStart(2,'0')).join('')}@login.smart-school-2027.invalid`;
const password=`T-${crypto.randomUUID()}-pA9!`;
const studentId=`ZTEST-${suffix}`;
const authAdmin=createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const authClient=createClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const db=new pg.Client({connectionString:env.DATABASE_URL,ssl:{ca:fs.readFileSync(env.SUPABASE_DB_CA_CERT,'utf8'),rejectUnauthorized:true},connectionTimeoutMillis:15000});
let authId=null,studentCreated=false,profileCreated=false;
const report=(ok,label)=>{if(!ok)throw Error(`FAILED: ${label}`);console.log(`PASS: ${label}`)};
try{
 await db.connect();
 const {data:created,error:createError}=await authAdmin.auth.admin.createUser({email:authEmail,password,email_confirm:true,app_metadata:{account_code:loginId,role:'PARENT',status:'ACTIVE'}});
 if(createError)throw Error('Could not create disposable Supabase Auth parent.');
 authId=created.user.id;
 const cls=await db.query('select class_id from public.classes order by class_id limit 1');
 if(!cls.rows.length)throw Error('No existing class available for disposable authentication test.');
 await db.query('begin');
 await db.query(`insert into public.students(student_id,massar_id,full_name,class_id,class_number,status,provenance) values($1,$2,$3,$4,999,'TEST','DISPOSABLE_TEST')`,[studentId,`Z${suffix.replaceAll('-','').slice(0,10)}`,`Test Parent ${suffix.slice(0,8)}`,cls.rows[0].class_id]);
 studentCreated=true;
 await db.query(`insert into public.profiles(id,account_code,legacy_user_id,full_name,role,status,student_id) values($1,$2,$3,$4,'PARENT','ACTIVE',$5)`,[authId,loginId,`TEST-${suffix}`,`Test Parent ${suffix.slice(0,8)}`,studentId]);
 profileCreated=true;
 await db.query('commit');
 const {data:login,error:loginError}=await authClient.auth.signInWithPassword({email:authEmail,password});
 report(!loginError&&login.user?.id===authId,'disposable parent can authenticate with the configured Supabase flow');
 const {data:profile,error:profileError}=await authClient.from('profiles').select('role,status,student_id').single();
 report(!profileError&&profile?.role==='PARENT'&&profile.status==='ACTIVE'&&profile.student_id===studentId,'disposable parent Auth UUID resolves to the trusted linked profile');
 const {data:own,error:ownError}=await authClient.from('students').select('student_id').eq('student_id',studentId);
 report(!ownError&&own.length===1,'disposable parent RLS grants access to exactly the linked student');
 const {data:other,error:otherError}=await authClient.from('students').select('student_id').neq('student_id',studentId).limit(1);
 report(!otherError&&other.length===0,'disposable parent RLS denies access to other students');
}finally{
 await authClient.auth.signOut({scope:'local'}).catch(()=>{});
 if(db._connected){
  await db.query('begin').catch(()=>{});
  if(profileCreated)await db.query('delete from public.profiles where id=$1',[authId]).catch(()=>{});
  if(studentCreated)await db.query('delete from public.students where student_id=$1',[studentId]).catch(()=>{});
  await db.query('commit').catch(()=>{});
  await db.end().catch(()=>{});
 }
 if(authId)await authAdmin.auth.admin.deleteUser(authId).then(({error})=>{if(error)console.error('Cleanup warning: disposable Auth user deletion failed.');}).catch(()=>console.error('Cleanup warning: disposable Auth user deletion failed.'));
 await authAdmin.auth.signOut({scope:'local'}).catch(()=>{});
}
