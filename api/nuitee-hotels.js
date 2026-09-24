export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({error:'Método no permitido'});
  const key=process.env.NUITEE_API_KEY;
  if(!key) return res.status(503).json({error:'Falta configurar NUITEE_API_KEY en Vercel para activar la prueba.'});
  const city=String(req.query.city||'Rio de Janeiro'), countryCode=String(req.query.countryCode||'BR').toUpperCase();
  const checkin=String(req.query.checkin||''), checkout=String(req.query.checkout||'');
  const adults=Math.max(1,Number(req.query.adults||2)), currency=String(req.query.currency||'USD').toUpperCase(), guestNationality=String(req.query.guestNationality||'AR').toUpperCase();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(checkin)||!/^\d{4}-\d{2}-\d{2}$/.test(checkout)) return res.status(400).json({error:'Fechas inválidas'});
  const headers={'X-API-Key':key,'Content-Type':'application/json','Accept':'application/json'};
  const num=v=>{if(v==null)return null;if(typeof v==='number')return v;if(typeof v==='string'&&!isNaN(Number(v)))return Number(v);if(typeof v==='object'){for(const k of ['amount','value','total']){const n=num(v[k]);if(n!=null)return n}}return null};
  try{
    const [catalogRes,ratesRes]=await Promise.all([
      fetch('https://api.liteapi.travel/v3.0/data/hotels?'+new URLSearchParams({countryCode,cityName:city,limit:'200'}),{headers}),
      fetch('https://api.liteapi.travel/v3.0/hotels/rates',{method:'POST',headers,body:JSON.stringify({countryCode,cityName:city,checkin,checkout,currency,guestNationality,occupancies:[{rooms:1,adults}],maxRatesPerHotel:1,timeout:8,limit:20})})
    ]);
    const catalog=await catalogRes.json(), rates=await ratesRes.json();
    if(!catalogRes.ok) throw new Error(catalog.message||'Error al consultar datos de hoteles');
    if(!ratesRes.ok) throw new Error(rates.message||'Error al consultar tarifas');
    const byId=new Map((catalog.data||[]).map(h=>[h.id,h])), hotels=[];
    for(const item of (rates.data||[])){
      const meta=byId.get(item.hotelId)||{}, room=(item.roomTypes||[])[0]||{}, rate=(room.rates||[])[0]||room, rr=rate.retailRate||room.retailRate||{};
      const rawTotal=Array.isArray(rr.total)?rr.total[0]:rr.total, amount=num(rawTotal); if(amount==null) continue;
      const feeSource=rr.taxesAndFees||rate.taxesAndFees||room.taxesAndFees||[];
      const fees=(Array.isArray(feeSource)?feeSource:[]).map(f=>({name:f.name||f.type||'Impuesto o cargo',amount:num(f.amount??f.value??f.total)||0,included:f.included===true,currency:f.currency||currency})).filter(f=>f.amount>0);
      const dueAtProperty=fees.filter(f=>!f.included).reduce((s,f)=>s+f.amount,0);
      hotels.push({hotelId:item.hotelId,name:meta.name||item.hotelId,photo:meta.main_photo||meta.thumbnail||'',address:meta.address||'',stars:meta.stars||0,rating:meta.rating||0,reviewCount:meta.reviewCount||0,retailRate:amount,currency,fees,dueAtProperty,estimatedTotal:amount+dueAtProperty,refundableTag:rate.refundableTag||room.refundableTag||''});
    }
    return res.status(200).json({sandbox:true,hotels});
  }catch(e){return res.status(502).json({error:e.message||'Error consultando Nuitee'});}
}