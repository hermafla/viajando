import { bookingEnvironment, occupanciesFromQuery, mapOffer } from '../lib/nuitee.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:'Método no permitido'});
  const key=process.env.NUITEE_API_KEY;
  if(!key)return res.status(503).json({error:'La búsqueda de hoteles no está disponible en este momento.'});
  const city=String(req.query.city||'Rio de Janeiro'),countryCode=String(req.query.countryCode||'BR').toUpperCase(),placeId=String(req.query.placeId||'').trim(),hotelId=String(req.query.hotelId||'').trim();
  const checkin=String(req.query.checkin||''),checkout=String(req.query.checkout||''),currency=String(req.query.currency||'USD').toUpperCase(),guestNationality=String(req.query.guestNationality||'AR').toUpperCase();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(checkin)||!/^\d{4}-\d{2}-\d{2}$/.test(checkout)||checkout<=checkin)return res.status(400).json({error:'La salida debe ser posterior a la entrada.'});
  let occupancies;try{occupancies=occupanciesFromQuery(req.query)}catch{return res.status(400).json({error:'Revisá los huéspedes y las edades de los niños.'})}
  const testMargin=Number(req.query.testMargin),effectiveMargin=req.query.testMargin!=null&&[0,5,10,15].includes(testMargin)?testMargin:10;
  const headers={'X-API-Key':key,'Content-Type':'application/json','Accept':'application/json'};
  const request=(url,options={})=>fetch(url,{...options,headers,signal:AbortSignal.timeout(18000)});
  try{
    let locationQuery=hotelId?{hotelIds:[hotelId]}:placeId?{placeId}:{countryCode,cityName:city};
    if(placeId&&!hotelId){
      try{const pr=await fetch('https://api.liteapi.travel/v3.0/data/places/'+encodeURIComponent(placeId),{headers,signal:AbortSignal.timeout(4000)}),p=await pr.json(),l=p?.data?.location||p?.location,latitude=Number(l?.latitude??l?.lat),longitude=Number(l?.longitude??l?.lng);if(pr.ok&&Number.isFinite(latitude)&&Number.isFinite(longitude))locationQuery={latitude,longitude,radius:15000}}catch{}
    }
    // Una consulta, hasta 1500 propiedades, sin tres páginas simultáneas por destino.
    const rr=await request('https://api.liteapi.travel/v3.0/hotels/rates',{method:'POST',body:JSON.stringify({...locationQuery,checkin,checkout,currency,guestNationality,occupancies,margin:effectiveMargin,maxRatesPerHotel:8,timeout:10,limit:1500,roomMapping:true,includeHotelData:true})});
    const rates=await rr.json();
    if(!rr.ok||rates.error){console.error('Nuitee rates',rr.status,JSON.stringify(rates.error||rates.message||'Consulta rechazada'));return res.status(502).json({error:'No pudimos consultar la disponibilidad. Intentá nuevamente con las mismas fechas.',reason:'provider_error',stage:'rates'})}
    const rateHotels=Array.isArray(rates.data)?rates.data:rates.data?.hotels||[];
    let catalogHotels=Array.isArray(rates.hotels)?rates.hotels:[];
    // Los datos descriptivos son opcionales: su falla no elimina tarifas válidas.
    if(!catalogHotels.length&&rateHotels.length&&!hotelId){
      try{const cr=await request('https://api.liteapi.travel/v3.0/data/hotels?'+new URLSearchParams({...locationQuery,limit:'1500',language:'es'})),c=await cr.json();if(cr.ok)catalogHotels=Array.isArray(c.data)?c.data:c.data?.hotels||[]}catch{}
    }
    const byId=new Map(catalogHotels.map(h=>[h.id||h.hotelId,h])),hotels=[];
    for(const item of rateHotels){
      const meta=byId.get(item.hotelId)||item.hotel||item;
      const offers=(item.roomTypes||[]).map(r=>mapOffer(r,currency)).filter(o=>{
        if(!o||o.rates.length!==occupancies.length)return false;
        const seen=new Set();
        return o.rates.every((r,i)=>{const n=r.occupancyNumber||i+1,wanted=occupancies[n-1];if(!wanted||seen.has(n))return false;seen.add(n);return Number(r.adultCount)===wanted.adults&&r.childCount===(wanted.children||[]).length&&JSON.stringify(r.childrenAges)===JSON.stringify(wanted.children||[])});
      }).sort((a,b)=>a.estimatedTotal-b.estimatedTotal);
      if(!offers.length)continue;
      hotels.push({hotelId:item.hotelId,name:meta.name||meta.hotelName||item.hotelId,photo:meta.main_photo||meta.thumbnail||'',address:meta.address||'',stars:meta.stars||meta.starRating||0,rating:meta.rating||0,reviewCount:meta.reviewCount||0,...offers[0],offers:offers.slice(0,8)});
    }
    hotels.sort((a,b)=>a.estimatedTotal-b.estimatedTotal);
    const bookingMode=bookingEnvironment(key);
    return res.status(200).json({sandbox:bookingMode==='sandbox',bookingEnvironment:bookingMode,effectiveMargin,hotels,search:{adults:occupancies.reduce((s,o)=>s+o.adults,0),children:occupancies.reduce((s,o)=>s+(o.children||[]).length,0),rooms:occupancies.length,occupancies},debug:{catalogCount:catalogHotels.length,rateHotelCount:rateHotels.length}});
  }catch(e){console.error('Nuitee rates request',e.name);return res.status(502).json({error:'La consulta de hoteles demoró o no pudo completarse. Podés volver a intentar con las mismas fechas.',reason:'provider_error'})}
}
