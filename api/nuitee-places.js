export default async function handler(req,res){
  res.setHeader('Cache-Control','public, s-maxage=300, stale-while-revalidate=600');
  if(req.method!=='GET') return res.status(405).json({error:'Método no permitido'});
  const key=process.env.NUITEE_API_KEY, q=String(req.query.q||'').trim();
  if(!key) return res.status(503).json({error:'Falta configurar NUITEE_API_KEY.'});
  if(q.length<2) return res.status(200).json({places:[]});
  try{
    const url='https://api.liteapi.travel/v3.0/data/places?'+new URLSearchParams({textQuery:q,type:'locality,airport',language:'es'});
    const r=await fetch(url,{headers:{'X-API-Key':key,'Accept':'application/json'}});
    const j=await r.json();
    if(!r.ok) return res.status(r.status).json({error:j.message||'No se pudieron buscar destinos'});
    const data=Array.isArray(j.data)?j.data:[];
    return res.status(200).json({places:data.slice(0,8).map(p=>({placeId:p.placeId||p.id||'',displayName:p.displayName||p.name||'',formattedAddress:p.formattedAddress||p.address||''})).filter(p=>p.placeId&&p.displayName)});
  }catch(e){return res.status(502).json({error:e.message||'No se pudieron buscar destinos'});}
}