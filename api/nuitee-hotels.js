import { bookingEnvironment, occupanciesFromQuery, mapOffer, applyArgentineHotelTaxEstimate } from '../lib/nuitee.js';

const countryCodeFrom=value=>{if(value&&typeof value==='object')return countryCodeFrom(value.countryCode||value.code||value.isoCode||value.shortText||value.shortName||value.short_name||value.longText||value.long_name||value.name);const text=String(value||'').trim();if(/^AR$/i.test(text)||/argentina/i.test(text))return 'AR';return /^[A-Za-z]{2}$/.test(text)?text.toUpperCase():'';};

async function searchNuiteeFlights(req,res) {
  if (process.env.VERCEL_ENV === 'production') {
    return res.status(404).json({ok:false,error:'Búsqueda de vuelos de prueba no disponible.'});
  }
  const apiKey=process.env.NUITEE_FLIGHTS_SANDBOX_API_KEY||(process.env.VERCEL_ENV==='preview'?process.env.NUITEE_API_KEY:'');
  if(!apiKey)return res.status(503).json({ok:false,error:'Falta configurar NUITEE_FLIGHTS_SANDBOX_API_KEY en Vercel Preview.'});
  const body=req.body||{},legs=Array.isArray(body.legs)?body.legs:[];
  const adults=Number(body.adults),children=Number(body.children||0),infants=Number(body.infants||0),currency=String(body.currency||'USD').toUpperCase();
  if(!legs.length||legs.length>6||legs.some(leg=>! /^[A-Z]{3}$/.test(String(leg.origin||''))||! /^[A-Z]{3}$/.test(String(leg.destination||''))||! /^\d{4}-\d{2}-\d{2}$/.test(String(leg.date||'')))||!Number.isInteger(adults)||adults<1||adults>9||!Number.isInteger(children)||children<0||!Number.isInteger(infants)||infants<0||! /^[A-Z]{3}$/.test(currency)){
    return res.status(400).json({ok:false,error:'Revisá aeropuertos, fechas y cantidad de pasajeros.'});
  }
  const requestBody={legs:legs.map((leg,index)=>({origin:String(leg.origin).toUpperCase(),destination:String(leg.destination).toUpperCase(),date:String(leg.date),direction:index===0?'OUTBOUND':'INBOUND'})),adults,children,infants,currency,country:'AR'};
  if(Array.isArray(body.childrenAges)&&body.childrenAges.length===children)requestBody.childrenAges=body.childrenAges.map(Number);
  if(Array.isArray(body.infantAges)&&body.infantAges.length===infants)requestBody.infantAges=body.infantAges.map(Number);
  try{
    const response=await fetch('https://api.liteapi.travel/v3.0/flights/rates',{method:'POST',headers:{'X-API-Key':apiKey,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(requestBody),signal:AbortSignal.timeout(18000)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      const message=response.status===401?'Nuitee no aceptó la clave de Sandbox.':response.status===403||response.status===503?'Nuitee todavía no habilitó Flights para esta cuenta.':'Nuitee no pudo completar la búsqueda de vuelos.';
      return res.status(response.status>=500?502:response.status).json({ok:false,error:message,providerStatus:response.status});
    }
    return res.status(200).json({ok:true,sandbox:true,data});
  }catch(error){console.error('Nuitee Flights sandbox search failed:',error?.message||error);return res.status(502).json({ok:false,error:'No pudimos conectar con Nuitee para buscar vuelos.'})}
}

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method==='POST'&&String(req.query.action||'')==='flights')return searchNuiteeFlights(req,res);
  if(req.method!=='GET')return res.status(405).json({error:'Método no permitido'});
  const key=process.env.NUITEE_API_KEY;
  if(!key)return res.status(503).json({error:'La búsqueda de hoteles no está disponible en este momento.'});
  const city=String(req.query.city||'Rio de Janeiro'),countryCode=String(req.query.countryCode||'BR').toUpperCase(),placeId=String(req.query.placeId||'').trim(),hotelId=String(req.query.hotelId||'').trim();
  const requestedSessionId=String(req.query.sessionId||'').trim(),sessionId=/^[A-Za-z0-9_-]{8,80}$/.test(requestedSessionId)?requestedSessionId:'';
  const checkin=String(req.query.checkin||''),checkout=String(req.query.checkout||''),currency=String(req.query.currency||'USD').toUpperCase(),guestNationality=String(req.query.guestNationality||'AR').toUpperCase(),requestedCountryCode=String(req.query.countryCode||'').toUpperCase();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(checkin)||!/^\d{4}-\d{2}-\d{2}$/.test(checkout)||checkout<=checkin)return res.status(400).json({error:'La salida debe ser posterior a la entrada.'});
  let occupancies;try{occupancies=occupanciesFromQuery(req.query)}catch{return res.status(400).json({error:'Revisá los huéspedes y las edades de los niños.'})}
  const effectiveMargin=10;
  const headers={'X-API-Key':key,'Content-Type':'application/json','Accept':'application/json'};
  const request=(url,options={})=>fetch(url,{...options,headers,signal:AbortSignal.timeout(18000)});
  try{
    let locationQuery=hotelId?{hotelIds:[hotelId]}:placeId?{placeId}:{countryCode,cityName:city};
    let destination=null;
    if(placeId&&!hotelId){
      try{
        const pr=await fetch('https://api.liteapi.travel/v3.0/data/places/'+encodeURIComponent(placeId)+'?language=es',{headers,signal:AbortSignal.timeout(4000)}),p=await pr.json(),details=p?.data||p,l=details?.location,latitude=Number(l?.latitude??l?.lat),longitude=Number(l?.longitude??l?.lng);
        if(pr.ok){
          const displayName=details.displayName?.text||details.displayName||details.name,formattedAddress=typeof details.formattedAddress==='string'?details.formattedAddress:'',addressComponents=details.addressComponents||details.address_components||[],countryPart=addressComponents.find(c=>Array.isArray(c.types)&&c.types.includes('country'));
          const placeCountryCode=countryCodeFrom(details.countryCode||details.country_code||countryPart?.shortText||countryPart?.shortName||countryPart?.short_name||countryPart?.longText||countryPart?.long_name)||countryCodeFrom(formattedAddress);
          destination={placeId,displayName:typeof displayName==='string'?displayName:'',formattedAddress,countryCode:placeCountryCode};
          if(Number.isFinite(latitude)&&Number.isFinite(longitude))locationQuery={latitude,longitude,radius:15000};
        }
      }catch{}
    }
    // Una consulta, hasta 1500 propiedades, sin tres páginas simultáneas por destino.
    const rateRequest={method:'POST',body:JSON.stringify({...locationQuery,...(sessionId?{sessionId}:{}),checkin,checkout,currency,guestNationality,occupancies,margin:effectiveMargin,maxRatesPerHotel:hotelId?20:8,timeout:10,limit:1500,roomMapping:true,includeHotelData:true})};
    let rr=await request('https://api.liteapi.travel/v3.0/hotels/rates',rateRequest),rates=await rr.json();
    let providerCode=Number(rates.error?.code??rates.code)||null;
    // Reintentamos una sola vez las fallas temporales explícitas, nunca una reserva.
    if([4011,4291].includes(providerCode)){
      await new Promise(resolve=>setTimeout(resolve,400));
      rr=await request('https://api.liteapi.travel/v3.0/hotels/rates',rateRequest);rates=await rr.json();
      providerCode=Number(rates.error?.code??rates.code)||null;
    }
    // LiteAPI puede devolver HTTP 200 con código 2001: es falta de disponibilidad.
    if(providerCode===2001)rates={data:[],hotels:[]};
    else if(!rr.ok||rates.error){console.error('Nuitee rates',rr.status,providerCode);return res.status(502).json({error:'No pudimos consultar la disponibilidad. Intentá nuevamente con las mismas fechas.',reason:'provider_error',stage:'rates',providerCode})}
    const rateHotels=Array.isArray(rates.data)?rates.data:rates.data?.hotels||[];
    let catalogHotels=Array.isArray(rates.hotels)?rates.hotels:[];
    // Los datos descriptivos son opcionales: su falla no elimina tarifas válidas.
    if(!catalogHotels.length&&rateHotels.length&&!hotelId){
      try{const cr=await request('https://api.liteapi.travel/v3.0/data/hotels?'+new URLSearchParams({...locationQuery,limit:'1500',language:'es'})),c=await cr.json();if(cr.ok)catalogHotels=Array.isArray(c.data)?c.data:c.data?.hotels||[]}catch{}
    }
    const byId=new Map(catalogHotels.map(h=>[h.id||h.hotelId,h])),hotels=[];
    for(const item of rateHotels){
      const meta=byId.get(item.hotelId)||item.hotel||item;
      const hotelCountryCode=countryCodeFrom(meta.countryCode||meta.country_code||meta.country||meta.address)||destination?.countryCode||requestedCountryCode;
      const offers=(item.roomTypes||[]).map(r=>applyArgentineHotelTaxEstimate(mapOffer(r,currency),hotelCountryCode,guestNationality)).filter(o=>{
        if(!o||o.rates.length!==occupancies.length)return false;
        const seen=new Set();
        return o.rates.every((r,i)=>{const n=r.occupancyNumber||i+1,wanted=occupancies[n-1];if(!wanted||seen.has(n))return false;seen.add(n);return Number(r.adultCount)===wanted.adults&&r.childCount===(wanted.children||[]).length&&JSON.stringify(r.childrenAges)===JSON.stringify(wanted.children||[])});
      }).sort((a,b)=>a.estimatedTotal-b.estimatedTotal);
      if(!offers.length)continue;
      hotels.push({hotelId:item.hotelId,name:meta.name||meta.hotelName||item.hotelId,photo:meta.main_photo||meta.thumbnail||'',address:meta.address||'',countryCode:hotelCountryCode,stars:meta.stars||meta.starRating||0,rating:meta.rating||0,reviewCount:meta.reviewCount||0,...offers[0],offers:offers.slice(0,8)});
    }
    hotels.sort((a,b)=>a.estimatedTotal-b.estimatedTotal);
    const bookingMode=bookingEnvironment(key);
    return res.status(200).json({sandbox:bookingMode==='sandbox',bookingEnvironment:bookingMode,effectiveMargin,destination,hotels,search:{adults:occupancies.reduce((s,o)=>s+o.adults,0),children:occupancies.reduce((s,o)=>s+(o.children||[]).length,0),rooms:occupancies.length,occupancies},debug:{catalogCount:catalogHotels.length,rateHotelCount:rateHotels.length}});
  }catch(e){console.error('Nuitee rates request',e.name);return res.status(502).json({error:'La consulta de hoteles demoró o no pudo completarse. Podés volver a intentar con las mismas fechas.',reason:'provider_error'})}
}
