import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from '@playwright/test';

const sharedPassword=process.env.SMART_SCHOOL_BROWSER_TEST_PASSWORD;
const passwords={DIRECTION:process.env.SMART_SCHOOL_DIRECTION_TEST_PASSWORD||sharedPassword,TEACHER:process.env.SMART_SCHOOL_TEACHER_TEST_PASSWORD||sharedPassword,PARENT:process.env.SMART_SCHOOL_PARENT_TEST_PASSWORD||sharedPassword};
if(Object.values(passwords).some(value=>!value))throw Error('Set per-role SMART_SCHOOL_*_TEST_PASSWORD values (or SMART_SCHOOL_BROWSER_TEST_PASSWORD when shared); values are never printed.');
const root=path.resolve('dist');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://127.0.0.1').pathname;
 if(!pathname.startsWith('/smart-school/')){res.writeHead(404).end();return;}
 let file=path.resolve(root,pathname.slice('/smart-school/'.length)||'index.html');
 if(!file.startsWith(root+path.sep)&&file!==path.join(root,'index.html')){res.writeHead(403).end();return;}
 if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
 if(!fs.existsSync(file)){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(4173,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
const errors=[];const results=[];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const onRolePath=(page,route)=>new URL(page.url()).pathname.replace(/\/?$/,'/').includes(route);
async function loginRole(id,route,role){
 const page=await browser.newPage({viewport:{width:1365,height:900}});page.on('pageerror',e=>errors.push(`${id}: ${e.name}`));const profileResponses=[];page.on('response',r=>{if(r.url().includes('/rest/v1/profiles'))profileResponses.push(r.status());});
 let loginRequests=0;page.on('request',req=>{if(req.method()==='POST'&&req.url().includes('/auth/v1/token?grant_type=password'))loginRequests++;});
 await page.goto('http://127.0.0.1:4173/smart-school/');await page.locator('#login-id').fill(id);await page.locator('#login-password').fill(passwords[role]);await page.getByRole('button',{name:/Se connecter/}).click();
 await page.waitForFunction(expected=>location.pathname.includes(expected)||!!document.querySelector('#login-message')?.textContent,route,{timeout:25000}).catch(()=>{});
 if(!onRolePath(page,route)){results.push({role,login:'FAILED',detail:'Compte non authentifié avec le mot de passe de test.'});await page.close();return;}
 if(loginRequests!==1)errors.push(`${id}: ${loginRequests} password login requests`);
 await page.reload();
 const dashboardSelector=role==='DIRECTION'?'#admin-content .content-wrap':role==='PARENT'?'.parent-child-heading':'#teacher-content .parent-child-heading';
 await Promise.race([page.locator(dashboardSelector).waitFor({state:'attached',timeout:15000}),page.locator('#login-form').waitFor({state:'visible',timeout:15000})]).catch(()=>{});
 const refreshDiagnostic=await page.evaluate(()=>{const key=Object.keys(localStorage).find(x=>x.startsWith('sb-')&&x.endsWith('-auth-token'));let session=null;try{session=key?JSON.parse(localStorage.getItem(key)||'{}'):null;}catch{}return{storedSession:!!session?.access_token&&!!session?.refresh_token,loginFormVisible:!!document.querySelector('#login-form'),directionVisible:!!document.querySelector('#admin-app:not([hidden])')};});
 if(!onRolePath(page,route))errors.push(`${id}: session did not survive refresh (${new URL(page.url()).pathname})`);
 if(role==='DIRECTION'){
  const views=['dashboard','students','teachers','parents','classes','absences','timetable','requests','notifications','accounts','settings'];
  const headings={dashboard:'Tableau de bord',students:'Élèves',teachers:'Enseignants',parents:'Parents',classes:'Classes',absences:'Absences',timetable:'Emploi du temps',requests:"Demandes d'inscription",notifications:'Notifications',accounts:'Comptes',settings:'Paramètres'};
  for(const view of views){await page.locator(`[data-view="${view}"]`).click();await wait(350);const title=view==='dashboard'?await page.locator('#top-page-title').innerText().catch(()=> ''):await page.locator('#admin-content .page-heading h1').innerText().catch(()=> '');if(!title.includes(headings[view]))errors.push(`Direction ${view}: expected page title not visible (got ${title||'empty'})`);}
  await page.setViewportSize({width:390,height:844});
  const width=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);results.push({role,login:'PASSED',views:views.length,mobileNoHorizontalOverflow:width,refreshPath:new URL(page.url()).pathname,...refreshDiagnostic,profileResponses});await page.setViewportSize({width:1365,height:900});
  const logout=page.waitForFunction(()=>location.pathname==='/smart-school/'&&!!document.querySelector('#login-form'),null,{timeout:10000});await page.locator('#admin-logout').click();await logout.catch(()=>errors.push(`${id}: logout did not return to login (${new URL(page.url()).pathname})`));
 }else if(role==='PARENT'){
  const child=await page.locator('.parent-child-heading h1').innerText().catch(()=>'' );
  await page.getByRole('button',{name:/Semaine précédente/}).click();await wait(150);await page.getByRole('button',{name:/Semaine suivante/}).click();await wait(150);
  await page.getByRole('button',{name:/Absences de l'année/}).click();await wait(200);const absence=await page.locator('#parent-content').innerText();const unsubmittedAbsences=await page.locator('#parent-content .drawer-table tbody tr').evaluateAll(rows=>rows.filter(row=>row.cells[5]?.innerText.includes('Non justifiée')).length);const explanationForm=await page.locator('#explanation-form').count(),attachmentInput=await page.locator('#explanation-form input[type=file]').count();if(unsubmittedAbsences>0&&explanationForm!==1)errors.push(`${id}: explanation form missing despite ${unsubmittedAbsences} unjustified absence(s)`);if(unsubmittedAbsences===0&&explanationForm!==0)errors.push(`${id}: explanation form shown when there are no unsubmitted absences`);if(explanationForm===1&&attachmentInput!==1)errors.push(`${id}: attachment input missing from the available explanation form`);
  await page.setViewportSize({width:390,height:844});const width=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);await page.setViewportSize({width:1365,height:900});
  results.push({role,login:'PASSED',linkedChildVisible:!!child,absenceTabVisible:absence.includes('Absences'),unsubmittedAbsences,explanationFormState:unsubmittedAbsences?'available':'not applicable: no unsubmitted absences',attachmentInputState:explanationForm===1?'available':'not applicable',mobileNoHorizontalOverflow:width});
  await page.getByRole('button',{name:'Paramètres'}).click();const logout=page.waitForFunction(()=>location.pathname==='/smart-school/'&&!!document.querySelector('#login-form'),null,{timeout:10000});await page.locator('[data-logout]').click();await logout.catch(()=>errors.push(`${id}: logout did not return to login (${new URL(page.url()).pathname})`));
 }else{
  let rosterLoaded=false,attendancePanelState='not visited';for(const tab of ['Emploi du temps','Appels et présences','Historique','Paramètres']){await page.getByRole('button',{name:tab}).click();await wait(200);if(tab==='Appels et présences'){if(await page.locator('[data-open-roster]').count()){await page.locator('[data-open-roster]').click();await page.locator('#teacher-roster tr[data-student-row]').first().waitFor({timeout:10000}).catch(()=>{});rosterLoaded=await page.locator('#teacher-roster tr[data-student-row]').count()>0;attendancePanelState=rosterLoaded?'active lesson: roster loaded':'active lesson: roster missing';if(!rosterLoaded)errors.push(`${id}: active lesson roster did not load`);}else{const empty=await page.locator('#teacher-panel .live-lesson-empty').innerText().catch(()=> '');attendancePanelState=empty.includes('Aucun cours en cours')?'no active lesson: expected empty state':'no active lesson button and no expected empty state';if(!empty.includes('Aucun cours en cours'))errors.push(`${id}: teacher attendance panel did not explain that no lesson is active`);}}}
  await page.setViewportSize({width:390,height:844});const width=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);await page.setViewportSize({width:1365,height:900});
  results.push({role,login:'PASSED',tabs:4,activeLessonRosterLoaded:rosterLoaded,attendancePanelState,mobileNoHorizontalOverflow:width});const logout=page.waitForFunction(()=>location.pathname==='/smart-school/'&&!!document.querySelector('#login-form'),null,{timeout:10000});await page.locator('[data-logout]').click();await logout.catch(()=>errors.push(`${id}: logout did not return to login (${new URL(page.url()).pathname})`));
 }
 await page.close();
}
try{
 for(const [id,route,role] of [['DIR-001','/admin/','DIRECTION'],['ENS-ARA-A','/teacher/','TEACHER'],['F26099088','/parent/','PARENT']])await loginRole(id,route,role);
 const wrong=await browser.newPage();let count=0;wrong.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/auth/v1/token?grant_type=password'))count++;});await wrong.goto('http://127.0.0.1:4173/smart-school/');await wrong.locator('#login-id').fill(`NONEXISTENT-${crypto.randomUUID()}`);await wrong.locator('#login-password').fill(passwords.DIRECTION);await wrong.getByRole('button',{name:/Se connecter/}).click();await wrong.locator('#login-message').waitFor({state:'visible',timeout:12000}).catch(()=>{});if(count!==1)errors.push(`Wrong password flow made ${count} login requests`);if(!new URL(wrong.url()).pathname.endsWith('/smart-school/'))errors.push('Wrong login navigated away from login page');results.push({role:'incorrect credentials',requestCount:count,staysOnLogin:new URL(wrong.url()).pathname.endsWith('/smart-school/')});await wrong.close();
 console.log(JSON.stringify({results,pageErrors:errors}));if(errors.length||results.some(x=>x.login==='FAILED'))process.exitCode=1;
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
