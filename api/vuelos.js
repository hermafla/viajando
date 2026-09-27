export default async function handler(req, res) {
  res.setHeader("Cache-Control","s-maxage=300, stale-while-revalidate=600");
  const token=process.env.TRAVELPAYOUTS_TOKEN;
  if(!token)return res.status(500).json({ok:false,error:"Falta TRAVELPAYOUTS_TOKEN en Vercel"});
  const origin=String(req.query.origin||req.query.origen||"").toUpperCase();
  const destination=String(req.query.destination||req.query.destino||"").toUpperCase();
  const fechaIda=String(req.query.fechaIda||req.query.depart_date||"");
  const fechaVuelta=String(req.query.fechaVuelta||req.query.return_date||"");
  const currency=String(req.query.currency||"usd").toLowerCase();
  if(!origin||!destination)return res.status(400).json({ok:false,error:"Faltan origen o destino IATA"});
  const url=new URL("https://api.travelpayouts.com/aviasales/v3/prices_for_dates");
  url.searchParams.set("origin",origin);
  url.searchParams.set("destination",destination);
  url.searchParams.set("currency",currency);
  url.searchParams.set("sorting","price");
  url.searchParams.set("direct","false");
  url.searchParams.set("unique","false");
  url.searchParams.set("limit","30");
  url.searchParams.set("page","1");
  url.searchParams.set("one_way",fechaVuelta?"false":"true");
  if(fechaIda)url.searchParams.set("departure_at",fechaIda);
  if(fechaVuelta)url.searchParams.set("return_at",fechaVuelta);
  try{
    const response=await fetch(url,{headers:{"X-Access-Token":token,"Accept-Encoding":"gzip, deflate"}});
    const raw=await response.json();
    if(!response.ok)return res.status(response.status).json({ok:false,error:"Aviasales devolvió un error",details:raw});
    const all=Array.isArray(raw.data)?raw.data:[];
    const normalize=x=>({price:Number(x.price),currency:(raw.currency||currency).toUpperCase(),airline:x.airline||null,departure_at:x.departure_at||null,return_at:x.return_at||null,transfers:x.transfers??null,return_transfers:x.return_transfers??null,found_at:x.found_at||null,origin_airport:x.origin_airport||origin,destination_airport:x.destination_airport||destination,link:x.link||null,exact_dates:(!fechaIda||String(x.departure_at||"").slice(0,10)===fechaIda)&&(!fechaVuelta||String(x.return_at||"").slice(0,10)===fechaVuelta)});
    const offers=all.map(normalize).filter(x=>x.exact_dates&&Number.isFinite(x.price)).sort((a,b)=>a.price-b.price);
    return res.status(200).json({ok:true,source:"Travelpayouts / Aviasales Data API",cached:true,origin,destination,requested:{fechaIda,fechaVuelta},offers,note:"Precios encontrados por usuarios de Aviasales en las últimas 48 horas; no garantizan disponibilidad hasta abrir la búsqueda."});
  }catch(e){return res.status(500).json({ok:false,error:"No se pudo consultar Aviasales"});}
}