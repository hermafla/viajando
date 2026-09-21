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
  const url=new URL("https://api.travelpayouts.com/v2/prices/latest");
  url.searchParams.set("origin",origin);url.searchParams.set("destination",destination);
  url.searchParams.set("currency",currency);url.searchParams.set("period_type","year");
  url.searchParams.set("one_way",fechaVuelta?"false":"true");url.searchParams.set("sorting","price");
  url.searchParams.set("trip_class","0");url.searchParams.set("limit","100");url.searchParams.set("page","1");
  url.searchParams.set("show_to_affiliates","true");
  try{
    const response=await fetch(url,{headers:{"X-Access-Token":token,"Accept-Encoding":"gzip, deflate"}});
    const raw=await response.json();
    if(!response.ok)return res.status(response.status).json({ok:false,error:"Aviasales devolvió un error",details:raw});
    const all=Array.isArray(raw.data)?raw.data:[];
    const exact=all.filter(x=>(!fechaIda||x.depart_date===fechaIda)&&(!fechaVuelta||x.return_date===fechaVuelta));
    const month=fechaIda?fechaIda.slice(0,7):"";
    const nearby=exact.length?[]:all.filter(x=>(!month||String(x.depart_date||"").startsWith(month))).slice(0,8);
    const normalize=x=>({price:Number(x.value??x.price),currency:(raw.currency||currency).toUpperCase(),airline:x.airline||null,departure_at:x.departure_at||x.depart_date||null,return_at:x.return_at||x.return_date||null,transfers:x.number_of_changes??x.transfers??null,found_at:x.found_at||null,gate:x.gate||null,exact_dates:exact.includes(x)});
    return res.status(200).json({ok:true,source:"Travelpayouts / Aviasales Data API",cached:true,origin,destination,requested:{fechaIda,fechaVuelta},offers:exact.map(normalize),nearby:nearby.map(normalize),note:"Precios encontrados previamente por usuarios; no son disponibilidad en tiempo real."});
  }catch(e){return res.status(500).json({ok:false,error:"No se pudo consultar Aviasales"});}
}