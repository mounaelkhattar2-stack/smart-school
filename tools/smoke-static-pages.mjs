import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root=path.resolve('dist');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  if(!pathname.startsWith('/smart-school/'))return res.writeHead(404).end();
  let file=path.resolve(root,pathname.slice('/smart-school/'.length)||'index.html');
  if(!file.startsWith(root+path.sep)&&file!==path.join(root,'index.html'))return res.writeHead(403).end();
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  if(!fs.existsSync(file))return res.writeHead(404).end();
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(4175,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1365,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.name));
  const rootResponse=await page.goto('http://127.0.0.1:4175/smart-school/');
  if(rootResponse?.status()!==200||!await page.locator('#login-form').count())throw Error('Login static page did not render.');
  console.log('PASS: login static page renders in Chromium.');
  for(const [route,title] of [['admin/','SMART SCHOOL — Administration'],['teacher/','SMART SCHOOL — Espace enseignant'],['parent/','SMART SCHOOL — Espace parent']]){
    const response=await page.evaluate(async route=>{const r=await fetch(`/smart-school/${route}`);return{status:r.status,type:r.headers.get('content-type'),body:await r.text()};},route);
    if(response.status!==200||!response.type?.includes('text/html'))throw Error(`Static route ${route} did not return HTML.`);
    if(!response.body.includes(`<title>${title}</title>`))throw Error(`Static route ${route} returned the wrong page.`);
    console.log(`PASS: direct static request for ${route} returned its dashboard HTML.`);
    await page.goto(`http://127.0.0.1:4175/smart-school/${route}`);
    await page.waitForFunction(()=>location.pathname==='/smart-school/'&&!!document.querySelector('#login-form'),null,{timeout:10000}).catch(()=>{});
    if(new URL(page.url()).pathname!=='/smart-school/'||!await page.locator('#login-form').count())throw Error(`Unauthenticated direct navigation to ${route} was not redirected to login.`);
    console.log(`PASS: unauthenticated direct navigation to ${route} returns to login.`);
  }
  await page.setViewportSize({width:390,height:844});await page.goto('http://127.0.0.1:4175/smart-school/');
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Login page overflows at mobile width.');
  if(errors.length)throw Error(`Browser page errors: ${errors.join(', ')}`);
  console.log('PASS: login layout fits a 390px viewport; no browser page errors.');
  console.log('INFO: dashboard authentication and role views were not exercised in this static-only smoke test.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
