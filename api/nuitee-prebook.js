import { bookingEnvironment, mapOffer, moneyNumber } from '../lib/nuitee.js';
import { liveBookingEnabled, createCheckout, reservationContext, checkoutDatabase, productionStorageReady } from '../lib/hotel-checkout.js';
import prepareHotelPayment from '../lib/prepare-hotel-payment.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  const mode=bookingEnvironment(process.env.NUITEE_API_KEY);
  if(req.method==='POST'&&req.body?.action==='prepare_payment')return prepareHotelPayment(req,res);
  if(req.method==='GET'){
    let paymentReady=false;
    if(mode==='production'&&liveBookingEnabled())try{await productionStorageReady();paymentReady=true}catch{}
    return res.status(200).json({bookingEnvironment:mode,bookingEnabled:mode==='sandbox'||paymentReady,paymentMethod:mode==='production'?'TRANSACTION_ID':'sandbox'});
  }
  if(req.method!=='POST') return res.status(405).json({error:'Método no permitido'});
  const key=process.env.NUITEE_API_KEY;
  if(!key) return res.status(503).json({error:'Falta configurar NUITEE_API_KEY.'});
  if(mode==='unknown'||(mode==='production'&&!liveBookingEnabled()))return res.status(503).json({error:'Las reservas no están habilitadas en este momento. Podés seguir consultando alojamientos.'});
  const usePaymentSdk=mode==='production'||req.body?.usePaymentSdk===true;
  let context;
  if(usePaymentSdk){
    try{context=reservationContext(req.body?.reservation)}catch{return res.status(400).json({error:'Revisá los datos del hotel, las fechas y los huéspedes.'})}
    try{if(mode==='production')await productionStorageReady();else await checkoutDatabase('?select=id&limit=0')}catch{return res.status(503).json({error:'No pudimos preparar el registro del pago. Intentá más tarde.'})}
  }
  const offerId=String(req.body?.offerId||'');
  if(!offerId) return res.status(400).json({error:'Esta tarifa no tiene offerId. Volvé a buscar.'});
  const num=v=>{if(v==null)return null;if(typeof v==='number')return v;if(typeof v==='string'&&!isNaN(Number(v)))return Number(v);if(typeof v==='object'){for(const k of ['amount','value','total','price']){const n=num(v[k]);if(n!=null)return n}}return null};
  try{
    const r=await fetch('https://book.liteapi.travel/v3.0/rates/prebook?timeout=30',{method:'POST',headers:{'X-API-Key':key,'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({offerId,usePaymentSdk})});
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
    const verified={sandbox:mode==='sandbox',bookingEnvironment:mode,prebookId:d.prebookId||'',price,currency,fees:mapped?.fees||fees,dueAtProperty:mapped?.dueAtProperty??dueAtProperty,estimatedTotal:mapped?.estimatedTotal??(price+dueAtProperty),rates:mapped?.rates||[],refundableTag:mapped?.refundableTag||d.cancellationPolicies?.refundableTag||d.refundableTag||'',cancellationPolicies:mapped?.cancellationPolicies||d.cancellationPolicies||{}};
    if(usePaymentSdk){
      if(currency!=='USD')return res.status(502).json({error:'No pudimos verificar la moneda del pago. Volvé a buscar.'});
      try{Object.assign(verified,await createCheckout(d,{...context,...verified}))}catch{return res.status(503).json({error:'No pudimos guardar el pago preparado. No se realizó ningún cobro.'})}
    }
    return res.status(200).json(verified);
  }catch(e){return res.status(502).json({error:(typeof e?.message==='string'?e.message:'No se pudo reconfirmar la tarifa')});}
}
