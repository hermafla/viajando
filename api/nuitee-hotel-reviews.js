export default async function handler(req,res){
  res.setHeader('Cache-Control','public, s-maxage=86400, stale-while-revalidate=604800');
  if(req.method!=='GET')return res.status(405).json({error:'Método no permitido'});
  const key=process.env.NUITEE_API_KEY,hotelId=String(req.query.hotelId||'').trim();
  if(!key)return res.status(503).json({error:'La consulta de reseñas no está disponible.'});
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(hotelId))return res.status(400).json({error:'Falta un hotelId válido.'});
  try{
    const params=new URLSearchParams({hotelId,limit:'10',getSentiment:'true',language:'es',timeout:'4'});
    const r=await fetch('https://api.liteapi.travel/v3.0/data/reviews?'+params,{headers:{'X-API-Key':key,Accept:'application/json'},signal:AbortSignal.timeout(9000)});
    const j=await r.json();
    if(!r.ok){console.error('Nuitee hotel reviews',r.status);return res.status(502).json({error:'No se pudo cargar el detalle de reseñas.'});}
    const d=j.data||j,s=d.sentimentAnalysis||j.sentimentAnalysis||{};
    const categories=(Array.isArray(s.categories)?s.categories:[]).map(x=>({name:String(x.name||''),rating:Number(x.rating),description:String(x.description||'')})).filter(x=>x.name&&Number.isFinite(x.rating));
    const labels=a=>(Array.isArray(a)?a:[]).map(x=>typeof x==='string'?x:String(x?.name||x?.label||'')).filter(Boolean).slice(0,8);
    res.status(200).json({hotelId,available:categories.length>0||labels(s.pros).length>0||labels(s.cons).length>0,sentiment:categories.length||s.pros||s.cons?{categories,pros:labels(s.pros),cons:labels(s.cons)}:null});
  }catch(e){console.error('Nuitee hotel reviews request',e.name);res.status(502).json({error:'No se pudo cargar el detalle de reseñas.'});}
}
