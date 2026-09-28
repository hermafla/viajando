export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({error:'Método no permitido'});
  const key=process.env.NUITEE_API_KEY;
  if(!key) return res.status(503).json({error:'Falta NUITEE_API_KEY'});
  const placeId=String(req.query.placeId||'').trim();
  const checkin=String(req.query.checkin||''), checkout=String(req.query.checkout||'');
  const currency=String(req.query.currency||'USD').toUpperCase(), guestNationality=String(req.query.guestNationality||'AR').toUpperCase();
  const adults=Math.max(1,Number(req.query.adults||2));
  if(!placeId||!/^\d{4}-\d{2}-\d{2}$/.test(checkin)||!/^\d{4}-\d{2}-\d{2}$/.test(checkout)) return res.status(400).json({error:'Parámetros inválidos'});
  const headers={'X-API-Key':key,'Content-Type':'application/json','Accept':'application/json'};
  try{
    const p=await fetch('https://api.liteapi.travel/v3.0/data/places/'+encodeURIComponent(placeId),{headers});
    const pj=await p.json(); const loc=pj?.data?.location||pj?.location;
    const latitude=Number(loc?.latitude??loc?.lat), longitude=Number(loc?.longitude??loc?.lng);
    if(!p.ok||!Number.isFinite(latitude)||!Number.isFinite(longitude)) return res.status(502).json({error:'No se pudo resolver el lugar'});
    const q=new URLSearchParams({latitude:String(latitude),longitude:String(longitude),radius:'15000',limit:'500',language:'es'});
    const cr=await fetch('https://api.liteapi.travel/v3.0/data/hotels?'+q,{headers}); const cj=await cr.json();
    if(!cr.ok) return res.status(502).json({error:'No se pudo cargar catálogo',provider:cj});
    const hotels=Array.isArray(cj.data)?cj.data:(Array.isArray(cj.data?.hotels)?cj.data.hotels:[]);
    const ids=hotels.map(h=>h.id).filter(Boolean);
    const mr=await fetch('https://api.liteapi.travel/v3.0/hotels/min-rates',{method:'POST',headers,body:JSON.stringify({hotelIds:ids,occupancies:[{adults}],checkin,checkout,currency,guestNationality,timeout:10})});
    const mj=await mr.json(); if(!mr.ok) return res.status(502).json({error:'No se pudo consultar min-rates',provider:mj});
    const rates=Array.isArray(mj.data)?mj.data:[];
    const available=new Set(rates.map(x=>x.hotelId));
    const typeCounts=hotels.reduce((a,h)=>{const k=String(h.hotelTypeId??'unknown');a[k]=(a[k]||0)+1;return a;},{});
    const availableTypeCounts=hotels.filter(h=>available.has(h.id)).reduce((a,h)=>{const k=String(h.hotelTypeId??'unknown');a[k]=(a[k]||0)+1;return a;},{});
    return res.status(200).json({radiusKm:15,catalogCount:hotels.length,hotelIdsCount:ids.length,availableMinRatesCount:rates.length,typeCounts,availableTypeCounts});
  }catch(e){return res.status(502).json({error:e.message||'Error de diagnóstico'});}
}