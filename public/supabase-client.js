'use strict';
(() => {
  const basePath='/smart-school/';
  window.smartSchoolPath=(path='')=>`${basePath}${String(path).replace(/^\/+/, '')}`;
  const config=window.SMART_SCHOOL_SUPABASE;
  if(!config?.url||!config?.publishableKey||!window.supabase?.createClient)throw new Error('Configuration Supabase indisponible.');
  window.smartSchoolSupabase=window.supabase.createClient(config.url,config.publishableKey,{
    auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:false}
  });
  window.smartSchoolLoginEmail=loginId=>`id-${Array.from(new TextEncoder().encode(String(loginId).trim()),b=>b.toString(16).padStart(2,'0')).join('')}@login.smart-school-2027.invalid`;
})();
