export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({error:'Método no permitido'});
  const key=process.env.NUITEE_API_KEY;
  if(!key) return res.status(503).json({error:'Falta configurar NUITEE_API_KEY en Vercel para activar la prueba.'});
  const city=String(req.query.city||'Rio de Janeiro'), countryCode=String(req.query.countryCode||'BR').toUpperCase(), placeId=String(req.query.placeId||'').trim();
  const checkin=String(req.query.checkin||''), checkout=String(req.query.checkout||'');
  const adults=Math.max(1,Number(req.query.adults||2)), currency=String(req.query.currency||'USD').toUpperCase(), guestNationality=String(req.query.guestNationality||'AR').toUpperCase(); const testMargin=req.query.testMargin==null?null:Number(req.query.testMargin), effectiveMargin=(Number.isFinite(testMargin)&&[0,5,10,15].includes(testMargin))?testMargin:10;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(checkin)||!/^\d{4}-\d{2}-\d{2}$/.test(checkout)) return res.status(400).json({error:'Fechas inválidas'});
  let occupancies=[{rooms:1,adults}];
  if(req.query.occupancies){try{const parsed=JSON.parse(String(req.query.occupancies));if(Array.isArray(parsed)&&parsed.length){occupancies=parsed.slice(0,5).map(o=>{const a=Math.max(1,Number(o.adults||1));const ages=Array.isArray(o.childAges)?o.childAges.map(x=>Math.max(0,Math.min(17,Number(x)||0))):[];return {adults:a,...(ages.length?{children:ages}: {})}})}}catch{}}
  const totalAdults=occupancies.reduce((s,o)=>s+o.adults,0),totalChildren=occupancies.reduce((s,o)=>s+(Array.isArray(o.children)?o.children.length:0),0);
  const headers={'X-API-Key':key,'Content-Type':'application/json','Accept':'application/json'};
  const num=v=>{if(v==null)return null;if(typeof v==='number')return v;if(typeof v==='string'&&!isNaN(Number(v)))return Number(v);if(typeof v==='object'){for(const k of ['amount','value','total']){const n=num(v[k]);if(n!=null)return n}}return null};
  try{
    // Para ciudades seleccionadas con Google Place ID, LiteAPI limita el catálogo a ~1 km.
    // Obtenemos el centro del lugar y ampliamos la búsqueda a 15 km. Si no podemos
    // resolver las coordenadas, conservamos el comportamiento anterior con placeId.
    let locationQuery=placeId?{placeId}:{countryCode,cityName:city};
    if(placeId){
      try{
        const placeRes=await fetch('https://api.liteapi.travel/v3.0/data/places/'+encodeURIComponent(placeId),{headers});
        const place=await placeRes.json();
        const location=place?.data?.location||place?.location;
        const latitude=Number(location?.latitude??location?.lat);
        const longitude=Number(location?.longitude??location?.lng);
        if(placeRes.ok&&Number.isFinite(latitude)&&Number.isFinite(longitude)){
          locationQuery={latitude,longitude,radius:15000};
        }
      }catch{}
    }
    // Consultamos hasta 1000 propiedades. LiteAPI documenta un máximo de 5000 y
    // offset/limit para paginar. Esta prueba permite saber si el primer bloque de
    // 500 estaba ocultando alojamientos con tarifa, sin crear otra función Vercel.
    const [catalogRes,ratesRes,ratesRes2,ratesRes3]=await Promise.all([
      fetch('https://api.liteapi.travel/v3.0/data/hotels?'+new URLSearchParams({...locationQuery,limit:'1500',language:'es'}),{headers}),
      fetch('https://api.liteapi.travel/v3.0/hotels/rates',{method:'POST',headers,body:JSON.stringify({...locationQuery,checkin,checkout,currency,guestNationality,occupancies,margin:effectiveMargin,maxRatesPerHotel:8,timeout:10,limit:500,offset:0,roomMapping:true})}),
      fetch('https://api.liteapi.travel/v3.0/hotels/rates',{method:'POST',headers,body:JSON.stringify({...locationQuery,checkin,checkout,currency,guestNationality,occupancies,margin:effectiveMargin,maxRatesPerHotel:8,timeout:10,limit:500,offset:500,roomMapping:true})}),
      fetch('https://api.liteapi.travel/v3.0/hotels/rates',{method:'POST',headers,body:JSON.stringify({...locationQuery,checkin,checkout,currency,guestNationality,occupancies,margin:effectiveMargin,maxRatesPerHotel:8,timeout:10,limit:500,offset:1000,roomMapping:true})})
    ]);
    const catalog=await catalogRes.json(), rates=await ratesRes.json(), rates2=await ratesRes2.json(), rates3=await ratesRes3.json();
    if(!catalogRes.ok||!ratesRes.ok||!ratesRes2.ok||!ratesRes3.ok){
      const failed=!catalogRes.ok?['catalog',catalogRes,catalog]:(!ratesRes.ok?['rates-0-499',ratesRes,rates]:(!ratesRes2.ok?['rates-500-999',ratesRes2,rates2]:['rates-1000-1499',ratesRes3,rates3]));
      const diagnostic={error:'La consulta de hoteles no pudo completarse',stage:failed[0],catalogStatus:catalogRes.status,ratesStatus:ratesRes.status,rates2Status:ratesRes2.status,rates3Status:ratesRes3.status,providerMessage:failed[2].message||failed[2].error||failed[2]};
      console.error('Nuitee hotels diagnostic',JSON.stringify(diagnostic));
      return res.status(502).json(diagnostic);
    }
    const catalogHotels=Array.isArray(catalog.data)?catalog.data:(Array.isArray(catalog.data?.hotels)?catalog.data.hotels:[]);
    const typeCounts=catalogHotels.reduce((acc,h)=>{const id=String(h.hotelTypeId??'unknown');acc[id]=(acc[id]||0)+1;return acc;},{});
    const rateHotels1=Array.isArray(rates.data)?rates.data:(Array.isArray(rates.data?.hotels)?rates.data.hotels:[]);
    const rateHotels2=Array.isArray(rates2.data)?rates2.data:(Array.isArray(rates2.data?.hotels)?rates2.data.hotels:[]);
    const rateHotels3=Array.isArray(rates3.data)?rates3.data:(Array.isArray(rates3.data?.hotels)?rates3.data.hotels:[]);
    const rateHotels=[...new Map([...rateHotels1,...rateHotels2,...rateHotels3].map(h=>[h.hotelId,h])).values()];
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
          const commissionSource=rate.commission||room.commission||item.commission||[]; const paymentTypes=rate.paymentTypes||room.paymentTypes||item.paymentTypes||[]; const providerCommissionRaw=rate.providerCommission??room.providerCommission??item.providerCommission??null; const providerCommissionAmount=num(providerCommissionRaw);
          const commissionItems=(Array.isArray(commissionSource)?commissionSource:[commissionSource]).filter(Boolean).map(x=>({amount:num(x.amount??x.value??x.total)||0,currency:x.currency||currency,type:x.type||x.name||''}));
          const commissionAmount=commissionItems.reduce((s,x)=>s+x.amount,0);
          const cancellationPolicies=rate.cancellationPolicies||room.cancellationPolicies||null; const refundableTag=(cancellationPolicies&&cancellationPolicies.refundableTag)||rate.refundableTag||room.refundableTag||''; const includedFees=fees.filter(f=>f.included).reduce((s,f)=>s+f.amount,0); offers.push({offerId:rate.offerId||room.offerId||'',retailRate:amount,currency,fees,includedFees,dueAtProperty,estimatedTotal:amount+dueAtProperty,roomName:rate.name||room.name||rate.roomName||room.roomName||'Habitación',boardName:rate.boardName||rate.boardType||room.boardName||'',mappedRoomId:rate.mappedRoomId||room.mappedRoomId||null,refundableTag,cancellationPolicies,suggestedSellingPrice:ssp,commissionAmount,commission:commissionItems,paymentTypes:Array.isArray(paymentTypes)?paymentTypes:[paymentTypes].filter(Boolean),providerCommission:providerCommissionRaw,providerCommissionAmount});
        }
      }
      offers.sort((a,b)=>a.estimatedTotal-b.estimatedTotal);
      if(!offers.length)continue;
      const best=offers[0];
      hotels.push({hotelId:item.hotelId,name:meta.name||item.hotelId,photo:meta.main_photo||meta.thumbnail||'',address:meta.address||'',stars:meta.stars||0,rating:meta.rating||0,reviewCount:meta.reviewCount||0,...best,offers:offers.slice(0,8)});
    }
    hotels.sort((a,b)=>a.estimatedTotal-b.estimatedTotal);
    const commissionDiagnostic=hotels.slice(0,20).map(h=>({hotelId:h.hotelId,name:h.name,currency:h.currency,retailRate:h.retailRate,commissionAmount:h.commissionAmount,commission:h.commission,paymentTypes:h.paymentTypes,providerCommission:h.providerCommission,providerCommissionAmount:h.providerCommissionAmount,propertyPay:h.paymentTypes.some(x=>String(x).toUpperCase()==='PROPERTY_PAY')}));
    return res.status(200).json({sandbox:true,testMargin:Number.isFinite(testMargin)?testMargin:null,effectiveMargin,hotels,commissionDiagnostic,search:{adults:totalAdults,children:totalChildren,rooms:occupancies.length,occupancies},debug:{catalogCount:catalogHotels.length,rateHotelCount:rateHotels.length,ratePage1Count:rateHotels1.length,ratePage2Count:rateHotels2.length,ratePage3Count:rateHotels3.length,typeCounts,rateHotelIds:rateHotels.map(h=>h.hotelId).filter(Boolean),rateShape:Array.isArray(rates.data)?'array':(rates.data&&typeof rates.data==='object'?'object':'other')}});
  }catch(e){return res.status(502).json({error:e.message||'Error consultando Nuitee'});}
}