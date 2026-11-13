import fs from 'node:fs';
import { parse } from 'csv-parse/sync';
import { createClient } from '@supabase/supabase-js';
const env=Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(x=>x.trim()&&!x.trim().startsWith('#')).map(line=>{const i=line.indexOf('=');return i<0?['','']:[line.slice(0,i).trim(),line.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]}));
if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY)throw Error('Required verification configuration is missing.');
const rows=parse(fs.readFileSync('private_input/COMPTES_INITIAUX_CONFIDENTIELS.csv','utf8'),{columns:true,bom:true,skip_empty_lines:true});
const account=rows.find(x=>x.identifiant==='F26099088');if(!account)throw Error('Existing parent account ID is absent from the approved account file.');
const expected=`id-${[...new TextEncoder().encode(account.identifiant.trim())].map(b=>b.toString(16).padStart(2,'0')).join('')}@login.smart-school-2027.invalid`;
const admin=createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const say=(ok,label)=>{if(!ok)throw Error(`FAIL: ${label}`);console.log(`PASS: ${label}`);};
try{
 let authUser=null;for(let page=1;page<=10;page++){const {data,error}=await admin.auth.admin.listUsers({page,perPage:1000});if(error)throw Error('Could not inspect Auth account mapping.');authUser=data.users.find(u=>u.email?.toLowerCase()===expected.toLowerCase())||null;if(authUser||data.users.length<1000)break;}
 say(!!authUser,'existing parent ID maps to one Auth user using the login page synthetic-email encoding');
 const {data:profile,error}=await admin.from('profiles').select('id,account_code,role,status,student_id').eq('account_code',account.identifiant).maybeSingle();
 if(error)throw Error('Could not inspect parent profile mapping.');
 say(!!profile&&profile.id===authUser.id&&profile.role==='PARENT'&&!!profile.student_id,'Auth UUID is linked to the correct trusted parent profile and child');
 say(profile?.status==='ACTIVE','existing parent profile status is active');
 const testPassword=process.env.SMART_SCHOOL_PARENT_TEST_PASSWORD;
 if(testPassword){const login=createClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const result=await login.auth.signInWithPassword({email:expected,password:testPassword});say(!result.error&&result.data.user?.id===authUser.id,'existing parent authenticates with the supplied temporary test password');await login.auth.signOut({scope:'local'}).catch(()=>{});}
 console.log('INFO: Supabase does not expose the imported Auth password hash; no account password was changed.');
}finally{await admin.auth.signOut({scope:'local'}).catch(()=>{});}
