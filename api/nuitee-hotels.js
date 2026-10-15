import { bookingEnvironment, occupanciesFromQuery, mapOffer, applyArgentineHotelTaxEstimate } from '../lib/nuitee.js';

const countryCodeFrom=value=>{if(value&&typeof value==='object')return countryCodeFrom(value.countryCode||value.code||value.isoCode||value.shortText||value.shortName||value.short_name||value.longText||value.long_name||value.name);const text=String(value||'').trim();if(/^AR$/i.test(text)||/argentina/i.test(text))return 'AR';return /^[A-Za-z]{2}$/.test(text)?text.toUpperCase():'';};
const listOf=value=>Array.isArray(value)?value.map(x=>typeof x==='string'?x:x?.name||x?.displayName||x?.label||'').filter(Boolean):typeof value==='string'?value.split(/[,;|]/).map(x=>x.trim()).filter(Boolean):[];
const textOf=value=>typeof value==='string'?value.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim():Array.isArray(value)?value.map(textOf).filter(Boolean).join('\n\n'):value&&typeof value==='object'?textOf(value.text||value.content||value.description||value.value||''):'';
const rowsOf=value=>Array.isArray(value)?value:value&&typeof value==='object'?Object.values(value).filter(x=>x&&typeof x==='object'):[];
const referenceMap=(value,idKeys,labelKeys)=>{
  const map=new Map();
  for(const row of rowsOf(value)){const id=idKeys.map(k=>row?.[k]).find(x=>x!=null),label=labelKeys.map(k=>row?.[k]).find(x=>x!=null);if(id!=null&&label!=null)map.set(String(id),String(label))}
  return map;
};
const namesFor=(value,map)=>{
  const values=Array.isArray(value)?value:value==null?[]:[value];
  return [...new Set(values.map(x=>{
    if(x&&typeof x==='object')return String(x.name||x.displayName||x.label||map.get(String(x.id||x.facilityId||x.hotelTypeId||x.chainId))||'');
    return map.get(String(x))||String(x);
  }).filter(Boolean))];
};
const imageUrls=value=>rowsOf(value).map(x=>typeof x==='string'?x:String(x?.url||x?.imageUrl||x?.imageURL||x?.main_photo||x?.image||x?.photo||'')).filter(Boolean);

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:'Método no permitido'});
  const key=process.env.NUITEE_API_KEY;
  if(!key)return res.status(503).json({error:'La búsqueda de hoteles no está disponible en este momento.'});
  const action=String(req.query.action||''),hotelIdForContent=String(req.query.hotelId||'').trim();
  if(action==='details'||action==='reviews'){
    if(!/^[A-Za-z0-9_-]{1,80}$/.test(hotelIdForContent))return res.status(400).json({error:'Falta un hotelId válido.'});
    res.setHeader('Cache-Control','public, s-maxage=86400, stale-while-revalidate=604800');
    try{
      const params=new URLSearchParams({hotelId:hotelIdForContent,language:'es'});
      const endpoint=action==='details'?'data/hotel':'data/reviews';
      if(action==='reviews'){params.set('limit','10');params.set('getSentiment','true');params.set('timeout','4')}
      const response=await fetch('https://api.liteapi.travel/v3.0/'+endpoint+'?'+params,{headers:{'X-API-Key':key,Accept:'application/json'},signal:AbortSignal.timeout(action==='details'?9000:9000)});
      const payload=await response.json();
      if(!response.ok){console.error('Nuitee hotel content',action,response.status);return res.status(502).json({error:action==='details'?'No se pudo cargar la descripción del alojamiento.':'No se pudo cargar el detalle de reseñas.'})}
      const data=payload.data||payload;
      if(action==='details'){
        const hotel=data.hotel||data;
        const rawFacilities=hotel.hotelFacilities||hotel.facilities||hotel.amenities||hotel.services||hotel.facilityIds||[];
        const facilities=namesFor(rawFacilities,new Map());
        const rawImages=hotel.hotelImages||hotel.images||hotel.photos||hotel.gallery||[];
        const images=Array.isArray(rawImages)?rawImages.map(x=>typeof x==='string'?x:String(x?.url||x?.imageUrl||x?.imageURL||x?.main_photo||x?.image||x?.photo||'')).filter(Boolean):[];
        return res.status(200).json({hotelId:hotelIdForContent,name:String(hotel.name||hotel.hotelName||''),description:textOf(hotel.normalizedDescription||hotel.markdownDescription||hotel.hotelDescription||hotel.description||hotel.hotel_description),address:String(hotel.address||hotel.formattedAddress||''),stars:Number(hotel.stars||hotel.starRating||0),rating:Number(hotel.rating||hotel.reviewRating||0),reviewCount:Number(hotel.reviewCount||hotel.reviewsCount||0),facilities,images,hotelType:String(hotel.hotelTypeName||hotel.hotelType||hotel.propertyType||''),chainName:String(hotel.chainName||hotel.chain?.name||hotel.brand||''),checkInInstructions:textOf(hotel.checkInInstructions||hotel.checkinInstructions||hotel.hotelImportantInformation||'')});
      }
      const sentiment=data.sentimentAnalysis||payload.sentimentAnalysis||{},categories=(Array.isArray(sentiment.categories)?sentiment.categories:[]).map(x=>({name:String(x.name||''),rating:Number(x.rating),description:String(x.description||'')})).filter(x=>x.name&&Number.isFinite(x.rating)),labels=list=>Array.isArray(list)?list.map(x=>typeof x==='string'?x:String(x?.name||x?.label||'')).filter(Boolean).slice(0,8):[];
      return res.status(200).json({hotelId:hotelIdForContent,available:categories.length>0||labels(sentiment.pros).length>0||labels(sentiment.cons).length>0,sentiment:categories.length||sentiment.pros||sentiment.cons?{categories,pros:labels(sentiment.pros),cons:labels(sentiment.cons)}:null});
    }catch(e){console.error('Nuitee hotel content request',action,e.name);return res.status(502).json({error:action==='details'?'No se pudo cargar la descripción del alojamiento.':'No se pudo cargar el detalle de calificaciones.'})}
  }
  const city=String(req.query.city||'Rio de Janeiro'),countryCode=String(req.query.countryCode||'BR').toUpperCase(),placeId=String(req.query.placeId||'').trim(),hotelId=String(req.query.hotelId||'').trim();
  const requestedSessionId=String(req.query.sessionId||'').trim(),sessionId=/^[A-Za-z0-9_-]{8,80}$/.test(requestedSessionId)?requestedSessionId:'';
  const checkin=String(req.query.checkin||''),checkout=String(req.query.checkout||''),currency=String(req.query.currency||'USD').toUpperCase(),guestNationality=String(req.query.guestNationality||'AR').toUpperCase(),requestedCountryCode=String(req.query.countryCode||'').toUpperCase();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(checkin)||!/^\d{4}-\d{2}-\d{2}$/.test(checkout)||checkout<=checkin)return res.status(400).json({error:'La salida debe ser posterior a la entrada.'});
  let occupancies;try{occupancies=occupanciesFromQuery(req.query)}catch{return res.status(400).json({error:'Revisá los huéspedes y las edades de los niños.'})}
  const effectiveMargin=10;
  const headers={'X-API-Key':key,'Content-Type':'application/json','Accept':'application/json'};
  const request=(url,options={},timeout=18000)=>fetch(url,{...options,headers,signal:AbortSignal.timeout(timeout)});
  try{
    let locationQuery=hotelId?{hotelIds:[hotelId]}:placeId?{placeId}:{countryCode,cityName:city};
    let destination=null;
    if(placeId&&!hotelId){
      try{
        const pr=await fetch('https://api.liteapi.travel/v3.0/data/places/'+encodeURIComponent(placeId)+'?language=es',{headers,signal:AbortSignal.timeout(4000)}),p=await pr.json(),details=p?.data||p,l=details?.location,latitude=Number(l?.latitude??l?.lat),longitude=Number(l?.longitude??l?.lng);
        if(pr.ok){
          const displayName=details.displayName?.text||details.displayName||details.name,formattedAddress=typeof details.formattedAddress==='string'?details.formattedAddress:'',addressComponents=details.addressComponents||details.address_components||[],countryPart=addressComponents.find(c=>Array.isArray(c.types)&&c.types.includes('country'));
          const placeCountryCode=countryCodeFrom(details.countryCode||details.country_code||countryPart?.shortText||countryPart?.shortName||countryPart?.short_name||countryPart?.longText||countryPart?.long_name)||countryCodeFrom(formattedAddress);
          destination={placeId,displayName:typeof displayName==='string'?displayName:'',formattedAddress,countryCode:placeCountryCode,...(Number.isFinite(latitude)&&Number.isFinite(longitude)?{latitude,longitude}:{})};
          if(Number.isFinite(latitude)&&Number.isFinite(longitude))locationQuery={latitude,longitude,radius:15000};
        }
      }catch{}
    }
    // Una consulta, hasta 1500 propiedades, sin tres páginas simultáneas por destino.
    const referencePromise=Promise.all([
      request('https://api.liteapi.travel/v3.0/data/facilities?language=es',{},3500).then(async r=>r.ok?(await r.json()).data||[]:[]).catch(()=>[]),
      request('https://api.liteapi.travel/v3.0/data/hotelTypes?language=es',{},3500).then(async r=>r.ok?(await r.json()).data||[]:[]).catch(()=>[]),
      request('https://api.liteapi.travel/v3.0/data/chains?language=es',{},3500).then(async r=>r.ok?(await r.json()).data||[]:[]).catch(()=>[])
    ]);
    const catalogPromise=hotelId?Promise.resolve([]):request('https://api.liteapi.travel/v3.0/data/hotels?'+new URLSearchParams({...locationQuery,limit:'1500',language:'es'}),{},6500).then(async response=>{if(!response.ok)return [];const payload=await response.json();return Array.isArray(payload.data)?payload.data:payload.data?.hotels||[]}).catch(()=>[]);
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
    const [staticHotels,referenceData]=await Promise.all([catalogPromise,referencePromise]);
    const [facilityRows,typeRows,chainRows]=referenceData;
    const facilityNames=referenceMap(facilityRows,['id','facilityId','facility_id'],['name','displayName','label']);
    const typeNames=referenceMap(typeRows,['id','hotelTypeId','typeId','hotel_type_id'],['name','hotelType','displayName','label']);
    const chainNames=referenceMap(chainRows,['id','chainId','chain_id'],['name','chain','displayName','label']);
    let catalogHotels=Array.isArray(rates.hotels)?rates.hotels:[];
    if(staticHotels.length)catalogHotels=staticHotels.concat(catalogHotels.filter(h=>!staticHotels.some(r=>(r.id||r.hotelId||r.hotel_id)===(h.id||h.hotelId||h.hotel_id))));
    const byId=new Map(catalogHotels.map(h=>[h.id||h.hotelId||h.hotel_id,h])),hotels=[];
    for(const item of rateHotels){
      const meta={...(item.hotel||{}),...(byId.get(item.hotelId)||{})},hotelCountryCode=countryCodeFrom(meta.countryCode||meta.country_code||meta.country||meta.address)||destination?.countryCode||requestedCountryCode;
      const offers=(item.roomTypes||[]).map(r=>applyArgentineHotelTaxEstimate(mapOffer(r,currency),hotelCountryCode,guestNationality)).filter(o=>{
        if(!o||o.rates.length!==occupancies.length)return false;
        const seen=new Set();
        return o.rates.every((r,i)=>{const n=r.occupancyNumber||i+1,wanted=occupancies[n-1];if(!wanted||seen.has(n))return false;seen.add(n);return Number(r.adultCount)===wanted.adults&&r.childCount===(wanted.children||[]).length&&JSON.stringify(r.childrenAges)===JSON.stringify(wanted.children||[])});
      }).sort((a,b)=>a.estimatedTotal-b.estimatedTotal);
      if(!offers.length)continue;
      const hotelLat=Number(meta.latitude??meta.location?.latitude),hotelLng=Number(meta.longitude??meta.location?.longitude),distanceKm=destination&&Number.isFinite(hotelLat)&&Number.isFinite(hotelLng)?(()=>{const rad=n=>n*Math.PI/180,dl=rad(hotelLat-destination.latitude),dn=rad(hotelLng-destination.longitude),a=Math.sin(dl/2)**2+Math.cos(rad(destination.latitude))*Math.cos(rad(hotelLat))*Math.sin(dn/2)**2;return 6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))})():null;
      const typeId=meta.hotelTypeId||meta.hotelTypeID||meta.typeId||meta.hotel_type_id||null,chainId=meta.chainId||meta.chainID||meta.chain_id||null;
      const hotelType=meta.hotelTypeName||meta.hotelType?.name||meta.hotelType||meta.propertyType||meta.type||typeNames.get(String(typeId||meta.hotelType||''))||'',chainName=meta.chainName||meta.chain?.name||meta.chain||meta.brand||chainNames.get(String(chainId||''))||'';
      const facilities=[...new Set([...listOf(meta.facilities||meta.hotelFacilities||meta.amenities||meta.facilityIds),...namesFor(meta.facilityIds||meta.facility_ids||[],facilityNames)])],roomAmenities=listOf(meta.roomAmenities||meta.room_amenities||meta.roomFacilityIds||meta.room_facility_ids),neighborhood=meta.neighborhood||meta.district||meta.suburb||meta.area||'';

      hotels.push({hotelId:item.hotelId,name:meta.name||meta.hotelName||item.hotelId,photo:meta.main_photo||meta.mainPhoto||meta.thumbnail||meta.image||'',address:meta.address||meta.formattedAddress||'',description:textOf(meta.description||meta.hotelDescription||meta.hotel_description),countryCode:hotelCountryCode,stars:meta.stars||meta.starRating||meta.star_rating||0,rating:meta.rating||meta.reviewRating||0,reviewCount:meta.reviewCount||meta.reviewsCount||0,hotelType:String(hotelType||''),hotelTypeId:typeId,chainName:String(chainName||''),chainId,facilities,roomAmenities,neighborhood:String(neighborhood||''),latitude:Number.isFinite(hotelLat)?hotelLat:null,longitude:Number.isFinite(hotelLng)?hotelLng:null,distanceKm,...offers[0],offers:offers.slice(0,8)});
    }
    hotels.sort((a,b)=>a.estimatedTotal-b.estimatedTotal);
    const bookingMode=bookingEnvironment(key);
    return res.status(200).json({sandbox:bookingMode==='sandbox',bookingEnvironment:bookingMode,effectiveMargin,destination,hotels,search:{adults:occupancies.reduce((s,o)=>s+o.adults,0),children:occupancies.reduce((s,o)=>s+(o.children||[]).length,0),rooms:occupancies.length,occupancies},debug:{catalogCount:catalogHotels.length,rateHotelCount:rateHotels.length}});
  }catch(e){console.error('Nuitee rates request',e.name);return res.status(502).json({error:'La consulta de hoteles demoró o no pudo completarse. Podés volver a intentar con las mismas fechas.',reason:'provider_error'})}
}
