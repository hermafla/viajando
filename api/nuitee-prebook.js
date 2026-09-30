import { bookingEnvironment, mapOffer, moneyNumber } from '../lib/nuitee.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method==='GET')return res.status(200).json({bookingEnvironment:bookingEnvironment(process.env.NUITEE_API_KEY)});
  if(req.method!=='POST') return res.status(405).json({error:'Método no permitido'});
  const key=process.env.NUITEE_API_KEY;
  if(!key) return res.status(503).json({error:'Falta configurar NUITEE_API_KEY.'});
  const offerId=String(req.body?.offerId||'');
  if(!offerId) return res.status(400).json({error:'Esta tarifa no tiene offerId. Volvé a buscar.'});
  const num=v=>{if(v==null)return null;if(typeof v==='number')return v;if(typeof v==='string'&&!isNaN(Number(v)))return Number(v);if(typeof v==='object'){for(const k of ['amount','value','total','price']){const n=num(v[k]);if(n!=null)return n}}return null};
  try{
    const r=await fetch('https://book.liteapi.travel/v3.0/rates/prebook?timeout=30',{method:'POST',headers:{'X-API-Key':key,'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({offerId,usePaymentSdk:false})});
    const j=await r.json();
    if(!r.ok||j.error){const code=String(j.code??j.error?.code??j.data?.code??''),msg=(typeof j.message==='string'?j.message:(typeof j.error==='string'?j.error:(j.error?.message||j.message?.message)))||'';let reason='technical',error='No pudimos reconfirmar esta tarifa. Volvé a intentarlo.';if(code==='2001'||/no availability found/i.test(msg)){reason='refresh_offer';error='La tarifa seleccionada ya no puede confirmarse con ese precio o disponibilidad. Actualizá la búsqueda para obtener una oferta vigente.'}else if(code==='4016'||/timeout/i.test(msg)){reason='timeout';error='La reconfirmación demoró más de lo esperado. Intentá nuevamente.'}else if(code==='4002'||/offerId|offer id|invalid.*offer|required request field/i.test(msg)){reason='expired_offer';error='La oferta seleccionada venció. Actualizá la búsqueda para obtener una tarifa vigente.'}return res.status(r.ok?(reason==='technical'?502:409):r.status).json({error,reason,providerCode:code||null});}
    const d=j.data||j;
    const offer=(d.roomTypes||[]).find(o=>o.offerId===offerId)||(d.roomTypes||[])[0];
    const mapped=offer?mapOffer({...offer,offerId:offer.offerId||offerId},'USD'):null;
    const rr=d.retailRate||d.rate?.retailRate||d.room?.retailRate||d.roomType?.retailRate||{};
    const rawTotal=Array.isArray(rr.total)?rr.total[0]:rr.total;
    const price=mapped?.retailRate??moneyNumber(d.offerRetailRate)??num(rawTotal)??num(d.price)??num(d.total);
    if(!d.prebookId||price==null||price<=0)return res.status(502).json({error:'No pudimos verificar el precio total de esta tarifa. Actualizá la búsqueda.'});
    const currency=(rawTotal&&rawTotal.currency)||d.currency||'USD';
    const fs=rr.taxesAndFees||d.taxesAndFees||d.rate?.taxesAndFees||[];
    const fees=(Array.isArray(fs)?fs:[]).map(f=>({name:f.name||f.type||'Impuesto o cargo',amount:num(f.amount??f.value??f.total)||0,included:f.included===true,currency:f.currency||currency})).filter(f=>f.amount>0);
    const dueAtProperty=fees.filter(f=>!f.included).reduce((s,f)=>s+f.amount,0);
    const mode=bookingEnvironment(key);
    return res.status(200).json({sandbox:mode==='sandbox',bookingEnvironment:mode,prebookId:d.prebookId||'',price,currency,fees:mapped?.fees||fees,dueAtProperty:mapped?.dueAtProperty??dueAtProperty,estimatedTotal:mapped?.estimatedTotal??(price+dueAtProperty),rates:mapped?.rates||[],refundableTag:mapped?.refundableTag||d.cancellationPolicies?.refundableTag||d.refundableTag||'',cancellationPolicies:mapped?.cancellationPolicies||d.cancellationPolicies||{}});
  }catch(e){return res.status(502).json({error:(typeof e?.message==='string'?e.message:'No se pudo reconfirmar la tarifa')});}
}
