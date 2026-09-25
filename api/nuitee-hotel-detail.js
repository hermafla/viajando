export default async function handler(req,res){
 res.setHeader('Cache-Control','public, s-maxage=3600, stale-while-revalidate=86400');
 if(req.method!=='GET')return res.status(405).json({error:'Método no permitido'});
 const key=process.env.NUITEE_API_KEY,hotelId=String(req.query.hotelId||'');
 if(!key)return res.status(503).json({error:'Falta configurar NUITEE_API_KEY.'});
 if(!hotelId)return res.status(400).json({error:'Falta hotelId'});
 try{
  const r=await fetch('https://api.liteapi.travel/v3.0/data/hotel?'+new URLSearchParams({hotelId}),{headers:{'X-API-Key':key,Accept:'application/json'}});
  const j=await r.json();if(!r.ok){const msg=typeof j?.message==='string'?j.message:(typeof j?.error==='string'?j.error:j?.error?.message);throw new Error(msg||'No se pudo cargar el hotel');}
  const d=j.data||j;
  const images=(d.hotelImages||[]).map(x=>({url:x.url||x.thumbnail||'',caption:x.caption||''})).filter(x=>x.url);
  const facilities=(d.hotelFacilities||[]).map(x=>typeof x==='string'?x:(x.name||x.facilityName||'')).filter(Boolean);
  const rooms=(d.rooms||[]).map(x=>({id:x.id,roomName:x.roomName||x.name||'',description:x.description||'',maxOccupancy:x.maxOccupancy||null,bedTypes:x.bedTypes||[],amenities:(x.roomAmenities||[]).map(a=>typeof a==='string'?a:(a.name||'')).filter(Boolean),photos:(x.photos||[]).map(p=>p.url||p).filter(Boolean)}));
  res.status(200).json({sandbox:true,hotel:{id:d.id||hotelId,name:d.name||'',description:d.hotelDescription||'',importantInformation:d.hotelImportantInformation||'',address:d.address||'',city:d.city||'',stars:d.starRating||d.stars||0,images,facilities,rooms,checkinCheckoutTimes:d.checkinCheckoutTimes||{},policies:d.policies||[]}});
 }catch(e){res.status(502).json({error:e.message||'No se pudo cargar el hotel'});}
}