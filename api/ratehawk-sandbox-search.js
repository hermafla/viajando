import { RATEHAWK_SANDBOX_URL, summarizeSandboxHotels, validateSandboxSearch } from '../lib/ratehawk-sandbox.js';

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Método no permitido.'});
  if(process.env.RATEHAWK_ENV!=='sandbox')return res.status(503).json({error:'La conexión de RateHawk está apagada. Solo se admite el entorno Sandbox.'});
  const keyId=String(process.env.RATEHAWK_SANDBOX_KEY_ID||'').trim();
  const apiKey=String(process.env.RATEHAWK_SANDBOX_API_KEY||'').trim();
  if(!keyId||!apiKey)return res.status(503).json({error:'Faltan las credenciales Sandbox de RateHawk en el entorno Preview.'});
  let body=req.body;
  if(typeof body==='string'){try{body=JSON.parse(body)}catch{return res.status(400).json({error:'Solicitud inválida.'})}}
  let search;
  try{search=validateSandboxSearch(body)}catch(e){return res.status(400).json({error:e.message})}
  try{
    const auth=Buffer.from(`${keyId}:${apiKey}`).toString('base64');
    const response=await fetch(RATEHAWK_SANDBOX_URL,{method:'POST',headers:{Authorization:`Basic ${auth}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(search),signal:AbortSignal.timeout(20000)});
    const data=await response.json().catch(()=>null);
    if(!response.ok){console.error('RateHawk Sandbox search',response.status);return res.status(502).json({error:'RateHawk Sandbox rechazó la búsqueda. Revisá las credenciales y los datos de prueba.',providerStatus:response.status})}
    return res.status(200).json({environment:'sandbox',search:{checkin:search.checkin,checkout:search.checkout,residency:search.residency,currency:search.currency,hotelId:search.hids[0]},hotels:summarizeSandboxHotels(data)});
  }catch(e){console.error('RateHawk Sandbox request',e.name);return res.status(502).json({error:'No pudimos completar la consulta de prueba a RateHawk. Intentá de nuevo.'})}
}
