'use strict';
const tabs=[...document.querySelectorAll('.tab-button')];
const indicator=document.querySelector('.tab-indicator');
function showTab(name){const registering=name==='register';tabs.forEach((tab,index)=>{const active=index===(registering?1:0);tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));});indicator.style.transform=registering?'translateX(116px)':'translateX(0)';indicator.style.width=registering?'129px':'76px';document.querySelector('#login-panel').hidden=registering;document.querySelector('#register-panel').hidden=!registering;}
tabs[0].addEventListener('click',()=>showTab('login'));tabs[1].addEventListener('click',()=>showTab('register'));
tabs.forEach((tab,index)=>tab.addEventListener('keydown',event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();tabs[index===0?1:0].click();}}));
document.querySelectorAll('[data-toggle-password]').forEach(button=>button.addEventListener('click',()=>{const input=document.getElementById(button.dataset.togglePassword),visible=input.type==='password';input.type=visible?'text':'password';button.textContent=visible?'Masquer':'Afficher';button.setAttribute('aria-label',visible?'Masquer le mot de passe':'Afficher le mot de passe');}));
function setMessage(id,text,success=false){const node=document.getElementById(id);node.textContent=text;node.classList.toggle('success',success);}
async function api(url,options={}){const response=await fetch(url,{credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});let data={};try{data=await response.json();}catch{}if(!response.ok)throw new Error(data.error||'Le serveur n’a pas pu traiter la demande.');return data;}
function go(role){const destination={DIRECTION:'/admin',PARENT:'/parent',TEACHER:'/teacher'}[role];if(!destination)throw new Error('Le rôle de ce compte n’est pas reconnu.');location.replace(destination);}
const loginForm=document.querySelector('#login-form');
if(!loginForm.dataset.loginHandlerBound){
  loginForm.dataset.loginHandlerBound='true';
  loginForm.addEventListener('submit',async event=>{
    event.preventDefault();
    if(loginForm.dataset.loginInProgress==='true')return;
    loginForm.dataset.loginInProgress='true';
    const submitButton=loginForm.querySelector('[type="submit"]');
    submitButton.disabled=true;
    submitButton.setAttribute('aria-busy','true');
    setMessage('login-message','');
    const form=new FormData(loginForm);
    try{
      const result=await api('/api/login',{method:'POST',body:JSON.stringify({login_id:form.get('login_id'),password:form.get('password')})});
      go(result.user.role);
    }catch(error){
      setMessage('login-message',error.message||'Identifiant ou mot de passe incorrect.');
      loginForm.dataset.loginInProgress='false';
      submitButton.disabled=false;
      submitButton.removeAttribute('aria-busy');
    }
  });
}
document.querySelector('#register-form').addEventListener('submit',async event=>{event.preventDefault();setMessage('register-message','');const form=new FormData(event.currentTarget);if(form.get('password')!==form.get('password_confirmation'))return setMessage('register-message','Les deux mots de passe ne correspondent pas.');if(String(form.get('password')).length<10)return setMessage('register-message','Choisissez un mot de passe d’au moins 10 caractères.');try{const body=Object.fromEntries(form.entries());body.confirmed=form.get('confirmed')==='on';const result=await api('/api/register/parent',{method:'POST',body:JSON.stringify(body)});setMessage('register-message',result.message||'Votre demande a été prise en compte.',true);event.currentTarget.reset();}catch(error){setMessage('register-message',error.message);}});
(async()=>{try{const session=await api('/api/me');if(session.authenticated)go(session.user.role);}catch(error){setMessage('login-message',error.message);}})();
