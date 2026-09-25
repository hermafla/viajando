export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({error:'Método no permitido'});
  const key=process.env.NUITEE_API_KEY;
  if(!key) return res.status(503).json({error:'Falta configurar NUITEE_API_KEY en Vercel para activar la prueba.'});
  const city=String(req.query.city||'Rio de Janeiro'), countryCode=String(req.query.countryCode||'BR').toUpperCase(), placeId=String(req.query.placeId||'').trim();
  const checkin=String(req.query.checkin||''), checkout=String(req.query.checkout||'');
  const adults=Math.max(1,Number(req.query.adults||2)), currency=String(req.query.currency||'USD').toUpperCase(), guestNationality=String(req.query.guestNationality||'AR').toUpperCase(); const testMargin=req.query.testMargin==null?null:Number(req.query.testMargin);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(checkin)||!/^\d{4}-\d{2}-\d{2}$/.test(checkout)) return res.status(400).json({error:'Fechas inválidas'});
  let occupancies=[{rooms:1,adults}];
  if(req.query.occupancies){try{const parsed=JSON.parse(String(req.query.occupancies));if(Array.isArray(parsed)&&parsed.length){occupancies=parsed.slice(0,5).map(o=>{const a=Math.max(1,Number(o.adults||1));const ages=Array.isArray(o.childAges)?o.childAges.map(x=>Math.max(0,Math.min(17,Number(x)||0))):[];return {adults:a,...(ages.length?{children:ages}: {})}})}}catch{}}
  const totalAdults=occupancies.reduce((s,o)=>s+o.adults,0),totalChildren=occupancies.reduce((s,o)=>s+(Array.isArray(o.children)?o.children.length:0),0);
  const headers={'X-API-Key':key,'Content-Type':'application/json','Accept':'application/json'};
  const num=v=>{if(v==null)return null;if(typeof v==='number')return v;if(typeof v==='string'&&!isNaN(Number(v)))return Number(v);if(typeof v==='object'){for(const k of ['amount','value','total']){const n=num(v[k]);if(n!=null)return n}}return null};
  try{
    const [catalogRes,ratesRes]=await Promise.all([
      fetch('https://api.liteapi.travel/v3.0/data/hotels?'+new URLSearchParams(placeId?{placeId,limit:'200',language:'es'}:{countryCode,cityName:city,limit:'200',language:'es'}),{headers}),
      fetch('https://api.liteapi.travel/v3.0/hotels/rates',{method:'POST',headers,body:JSON.stringify({...(placeId?{placeId}:{countryCode,cityName:city}),checkin,checkout,currency,guestNationality,occupancies,...(Number.isFinite(testMargin)&&[0,5,10,15].includes(testMargin)?{margin:testMargin}:{}),maxRatesPerHotel:8,timeout:10,limit:100,roomMapping:true})})
    ]);
    const catalog=await catalogRes.json(), rates=await ratesRes.json();
    if(!catalogRes.ok) throw new Error(catalog.message||'Error al consultar datos de hoteles');
    if(!ratesRes.ok) throw new Error(rates.message||'Error al consultar tarifas');
    const catalogHotels=Array.isArray(catalog.data)?catalog.data:(Array.isArray(catalog.data?.hotels)?catalog.data.hotels:[]);
    const rateHotels=Array.isArray(rates.data)?rates.data:(Array.isArray(rates.data?.hotels)?rates.data.hotels:[]);
    const byId=new Map(catalogHotels.map(h=>[h.id,h])), hotels=[];
    for(const item of rateHotels){
      const meta=byId.get(item.hotelId)||{}, offers=[];
      for(const room of (item.roomTypes||[])){
        const rateList=(room.rates&&room.rates.length?room.rates:[room]);
        for(const rate of rateList){
          const rr=rate.retailRate||room.retailRate||{}, rawTotal=Array.isArray(rr.total)?rr.total[0]:rr.total, amount=num(rawTotal); if(amount==null) continue;
          const feeSource=rr.taxesAndFees||rate.taxesAndFees||room.taxesAndFees||[];
          const fees=(Array.isArray(feeSource)?feeSource:[]).map(f=>({name:f.name||f.type||'Impuesto o cargo',amount:num(f.amount??f.value??f.total)||0,included:f.included===true,currency:f.currency||currency})).filter(f=>f.amount>0);
          const dueAtProperty=fees.filter(f=>!f.included).reduce((s,f)=>s+f.amount,0);
          const ssp=num(rate.suggestedSellingPrice??room.suggestedSellingPrice??item.suggestedSellingPrice??rr.suggestedSellingPrice);
          const commissionSource=rate.commission||room.commission||item.commission||[];
          const commissionItems=(Array.isArray(commissionSource)?commissionSource:[commissionSource]).filter(Boolean).map(x=>({amount:num(x.amount??x.value??x.total)||0,currency:x.currency||currency,type:x.type||x.name||''}));
          const commissionAmount=commissionItems.reduce((s,x)=>s+x.amount,0);
          const cancellationPolicies=rate.cancellationPolicies||room.cancellationPolicies||null; const refundableTag=(cancellationPolicies&&cancellationPolicies.refundableTag)||rate.refundableTag||room.refundableTag||''; const includedFees=fees.filter(f=>f.included).reduce((s,f)=>s+f.amount,0); offers.push({offerId:rate.offerId||room.offerId||'',retailRate:amount,currency,fees,includedFees,dueAtProperty,estimatedTotal:amount+dueAtProperty,roomName:rate.name||room.name||rate.roomName||room.roomName||'Habitación',boardName:rate.boardName||rate.boardType||room.boardName||'',mappedRoomId:rate.mappedRoomId||room.mappedRoomId||null,refundableTag,cancellationPolicies,suggestedSellingPrice:ssp,commissionAmount,commission:commissionItems});
        }
      }
      offers.sort((a,b)=>a.estimatedTotal-b.estimatedTotal);
      if(!offers.length)continue;
      const best=offers[0];
      hotels.push({hotelId:item.hotelId,name:meta.name||item.hotelId,photo:meta.main_photo||meta.thumbnail||'',address:meta.address||'',stars:meta.stars||0,rating:meta.rating||0,reviewCount:meta.reviewCount||0,...best,offers:offers.slice(0,8)});
    }
    hotels.sort((a,b)=>a.estimatedTotal-b.estimatedTotal);
    const commissionDiagnostic=hotels.slice(0,5).map(h=>({hotelId:h.hotelId,name:h.name,currency:h.currency,retailRate:h.retailRate,commissionAmount:h.commissionAmount,commission:h.commission}));
    return res.status(200).json({sandbox:true,testMargin:Number.isFinite(testMargin)?testMargin:null,hotels,commissionDiagnostic,search:{adults:totalAdults,children:totalChildren,rooms:occupancies.length,occupancies},debug:{catalogCount:catalogHotels.length,rateHotelCount:rateHotels.length,rateShape:Array.isArray(rates.data)?'array':(rates.data&&typeof rates.data==='object'?'object':'other')}});
  }catch(e){return res.status(502).json({error:e.message||'Error consultando Nuitee'});}
}