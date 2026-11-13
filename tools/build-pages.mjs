import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root=process.cwd();
const out=path.join(root,'dist');
const env=Object.fromEntries((fs.existsSync(path.join(root,'.env'))?fs.readFileSync(path.join(root,'.env'),'utf8'):'').split(/\r?\n/).filter(x=>x&& !x.trim().startsWith('#')).map(line=>{const i=line.indexOf('=');return i<0?['','']:[line.slice(0,i).trim(),line.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]}));
const publicConfig=fs.readFileSync(path.join(root,'public','supabase-config.js'),'utf8');
const url=process.env.SUPABASE_URL||env.SUPABASE_URL||publicConfig.match(/url\s*:\s*['"]([^'"]+)/)?.[1];
const key=process.env.SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_PUBLISHABLE_KEY||publicConfig.match(/publishableKey\s*:\s*['"]([^'"]+)/)?.[1];
if(!url||!key)throw new Error('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required to build the static site.');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
fs.cpSync(path.join(root,'public'),out,{recursive:true});
for(const [dir,file] of [['admin','admin.html'],['parent','parent.html'],['teacher','enseignant.html'],['change-password','change-password.html']]){const target=path.join(out,dir);fs.mkdirSync(target,{recursive:true});fs.copyFileSync(path.join(root,'public',file),path.join(target,'index.html'));}
fs.writeFileSync(path.join(out,'supabase-config.js'),`window.SMART_SCHOOL_SUPABASE=${JSON.stringify({url,publishableKey:key})};\n`);
fs.writeFileSync(path.join(out,'.nojekyll'),'');
const files=[];const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())walk(f);else files.push(f);}};walk(out);
for(const file of files){if(file.endsWith(path.join('vendor','supabase.js')))continue;const content=fs.readFileSync(file);if(/SUPABASE_SECRET_KEY|sb_secret_|DATABASE_URL/.test(content.toString('utf8')))throw new Error(`Secret-like configuration found in static output: ${path.relative(out,file)}`);}
for(const p of ['index.html','admin/index.html','parent/index.html','teacher/index.html','change-password/index.html'])if(!fs.existsSync(path.join(out,p)))throw new Error(`Missing static route: ${p}`);
console.log('Static site built: login, admin, parent, teacher, and password-change routes are present.');
