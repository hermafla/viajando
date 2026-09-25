export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).json({error:'Método no permitido'});
  const key=process.env.NUITEE_API_KEY;
  if(!key) return res.status(503).json({error:'Falta configurar NUITEE_API_KEY.'});
  const offerId=String(req.body?.offerId||'');
  if(!offerId) return res.status(400).json({error:'Esta tarifa no tiene offerId. Volvé a buscar.'});
  const num=v=>{if(v==null)return null;if(typeof v==='number')return v;if(typeof v==='string'&&!isNaN(Number(v)))return Number(v);if(typeof v==='object'){for(const k of ['amount','value','total','price']){const n=num(v[k]);if(n!=null)return n}}return null};
  try{
    const r=await fetch('https://book.liteapi.travel/v3.0/rates/prebook?timeout=30',{method:'POST',headers:{'X-API-Key':key,'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({offerId,usePaymentSdk:false})});
    const j=await r.json();
    if(!r.ok) return res.status(r.status).json({error:(typeof j.message==='string'?j.message:(typeof j.error==='string'?j.error:(j.error?.message||j.message?.message)))||'La tarifa cambió o ya no está disponible. Volvé a buscar.'});
    const d=j.data||j;
    const rr=d.retailRate||d.rate?.retailRate||d.room?.retailRate||d.roomType?.retailRate||{};
    const rawTotal=Array.isArray(rr.total)?rr.total[0]:rr.total;
    const price=num(rawTotal)??num(d.price)??num(d.total);
    const currency=(rawTotal&&rawTotal.currency)||d.currency||'USD';
    const fs=rr.taxesAndFees||d.taxesAndFees||d.rate?.taxesAndFees||[];
    const fees=(Array.isArray(fs)?fs:[]).map(f=>({name:f.name||f.type||'Impuesto o cargo',amount:num(f.amount??f.value??f.total)||0,included:f.included===true,currency:f.currency||currency})).filter(f=>f.amount>0);
    const dueAtProperty=fees.filter(f=>!f.included).reduce((s,f)=>s+f.amount,0);
    return res.status(200).json({sandbox:true,prebookId:d.prebookId||'',price,currency,fees,dueAtProperty,estimatedTotal:price!=null?price+dueAtProperty:null,refundableTag:d.cancellationPolicies?.refundableTag||d.refundableTag||'',cancellationPolicies:d.cancellationPolicies||[]});
  }catch(e){return res.status(502).json({error:(typeof e?.message==='string'?e.message:'No se pudo reconfirmar la tarifa')});}
}