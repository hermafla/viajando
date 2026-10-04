import crypto from 'crypto';

const cleanEmail=v=>String(v||'').trim().toLowerCase();
const sbHeaders=key=>({'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'});
const hash=(email,code,secret)=>crypto.createHmac('sha256',secret).update(email+'|'+code).digest('hex');
const b64url=v=>Buffer.from(v).toString('base64url');
const sign=(payload,secret)=>{
  const body=b64url(JSON.stringify(payload));
  const sig=crypto.createHmac('sha256',secret).update(body).digest('base64url');
  return body+'.'+sig;
};

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).json({error:'Método no permitido'});
  const email=cleanEmail(req.body?.email),code=String(req.body?.code||'').replace(/\D/g,'');
  if(!email||code.length!==6) return res.status(400).json({error:'Ingresá el código de 6 dígitos.'});
  const url=process.env.SUPABASE_URL?.replace(/\/$/,'');
  const key=process.env.SUPABASE_SECRET_KEY;
  const secret=process.env.MI_CUENTA_SECRET||key;
  if(!url||!key||!secret) return res.status(503).json({error:'El acceso a Mi cuenta todavía no está disponible.'});
  try{
    const h=hash(email,code,secret);
    const q=url+'/rest/v1/codigos_acceso?select=id,vence_en,usado&email=eq.'+encodeURIComponent(email)+'&codigo_hash=eq.'+encodeURIComponent(h)+'&usado=eq.false&order=vence_en.desc&limit=1';
    const rr=await fetch(q,{headers:sbHeaders(key)}); const rows=rr.ok?await rr.json():[];
    const row=Array.isArray(rows)?rows[0]:null;
    if(!row||!Number.isFinite(Date.parse(row.vence_en))||Date.parse(row.vence_en)<Date.now()) return res.status(401).json({error:'El código es incorrecto o venció.'});
    const used=await fetch(url+'/rest/v1/codigos_acceso?id=eq.'+encodeURIComponent(row.id)+'&usado=eq.false&vence_en=gt.'+encodeURIComponent(new Date().toISOString()),{method:'PATCH',headers:{...sbHeaders(key),'Prefer':'return=representation'},body:JSON.stringify({usado:true})});
    if(!used.ok)return res.status(503).json({error:'No pudimos validar el código. Intentá nuevamente.'});
    const consumed=await used.json();
    if(!Array.isArray(consumed)||consumed.length!==1)return res.status(401).json({error:'El código ya fue usado o venció.'});
    const token=sign({email,exp:Date.now()+24*60*60*1000},secret);
    return res.status(200).json({ok:true,token});
  }catch(e){console.error('OTP verify',e);return res.status(503).json({error:'No pudimos validar el código.'});}
}
