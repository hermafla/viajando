import crypto from 'crypto';

const cleanEmail=v=>String(v||'').trim().toLowerCase();
const json=(res,status,body)=>res.status(status).json(body);
const sbHeaders=key=>({'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'});
const hash=(email,code,secret)=>crypto.createHmac('sha256',secret).update(email+'|'+code).digest('hex');

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return json(res,405,{error:'Método no permitido'});
  const email=cleanEmail(req.body?.email);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res,400,{error:'Ingresá un email válido.'});
  const supabaseUrl=process.env.SUPABASE_URL?.replace(/\/$/,'');
  const supabaseKey=process.env.SUPABASE_SECRET_KEY;
  const resendKey=process.env.RESEND_API_KEY;
  const secret=process.env.MI_CUENTA_SECRET||supabaseKey;
  if(!supabaseUrl||!supabaseKey||!resendKey||!secret) return json(res,503,{error:'El acceso a Mi cuenta todavía no está disponible.'});
  try{
    const lookup=await fetch(supabaseUrl+'/rest/v1/reservas_hoteles?select=id&email=eq.'+encodeURIComponent(email)+'&limit=1',{headers:sbHeaders(supabaseKey)});
    const rows=lookup.ok?await lookup.json():[];
    // Respuesta deliberadamente igual exista o no el email, para no revelar clientes.
    if(!Array.isArray(rows)||!rows.length) return json(res,200,{ok:true,message:'Si ese email tiene reservas en Valijeando, vas a recibir un código de acceso.'});
    const code=String(crypto.randomInt(0,1000000)).padStart(6,'0');
    const expires=new Date(Date.now()+10*60*1000).toISOString();
    const tokenHash=hash(email,code,secret);
    const up=await fetch(supabaseUrl+'/rest/v1/codigos_acceso',{method:'POST',headers:{...sbHeaders(supabaseKey),'Prefer':'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({email,codigo_hash:tokenHash,vence_en:expires,usado:false})});
    if(!up.ok){console.error('OTP Supabase',up.status,await up.text());return json(res,503,{error:'No pudimos generar el código. Intentá nuevamente en unos minutos.'});}
    const er=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':'Bearer '+resendKey,'Content-Type':'application/json'},body:JSON.stringify({
      from:'Valijeando <reservas@valijeando.com.ar>',to:[email],subject:'Tu código para ingresar a Valijeando',
      html:'<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#172033"><h2>Ingresá a Mi cuenta</h2><p>Usá este código para ver tus reservas en Valijeando:</p><div style="font-size:34px;font-weight:800;letter-spacing:8px;background:#f2f6ff;border-radius:14px;padding:18px;text-align:center">'+code+'</div><p>El código vence en 10 minutos y puede usarse una sola vez.</p><p style="color:#667085;font-size:13px">Si no solicitaste este acceso, podés ignorar este correo.</p></div>'
    })});
    if(!er.ok){console.error('OTP Resend',er.status,await er.text());return json(res,503,{error:'No pudimos enviar el código. Intentá nuevamente.'});}
    return json(res,200,{ok:true,message:'Si ese email tiene reservas en Valijeando, vas a recibir un código de acceso.'});
  }catch(e){console.error('OTP request',e);return json(res,503,{error:'No pudimos generar el acceso en este momento.'});}
}
