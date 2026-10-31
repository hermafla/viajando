const settingKey='nuitee_confirmation_email_enabled';
const base=()=>process.env.SUPABASE_URL?.replace(/\/$/,'');
const headers=()=>({apikey:process.env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+process.env.SUPABASE_SECRET_KEY,'Content-Type':'application/json'});

// Fail open: if settings storage is unavailable, keep the current Valijeando email enabled.
export async function nuiteeConfirmationEmailEnabled(){
  if(!base()||!process.env.SUPABASE_SECRET_KEY)return true;
  try{
    const r=await fetch(base()+'/rest/v1/valijeando_settings?select=setting_value&setting_key=eq.'+settingKey+'&limit=1',{headers:headers(),signal:AbortSignal.timeout(5000)});
    if(!r.ok)return true;
    const rows=await r.json();
    return rows?.[0]?.setting_value===false?false:true;
  }catch{return true}
}

export async function setNuiteeConfirmationEmailEnabled(enabled,updatedBy){
  if(!base()||!process.env.SUPABASE_SECRET_KEY)throw Error('La consola no está configurada.');
  const r=await fetch(base()+'/rest/v1/valijeando_settings?on_conflict=setting_key',{method:'POST',headers:{...headers(),Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({setting_key:settingKey,setting_value:Boolean(enabled),updated_by:String(updatedBy||'').slice(0,254),updated_at:new Date().toISOString()}),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('No pudimos guardar la configuración del correo.');
  return Boolean(enabled);
}
