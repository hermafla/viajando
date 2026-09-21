export default async function handler(req,res){
  try{
    const q=String(req.query.q||"").trim();
    if(q.length<2)return res.status(200).json([]);
    const [cr,rr]=await Promise.all([
      fetch("https://api.travelpayouts.com/aviasales_resources/v3/cities.json?locale=es"),
      fetch("https://api.travelpayouts.com/aviasales_resources/v3/countries.json?locale=es")
    ]);
    if(!cr.ok||!rr.ok)throw new Error("No se pudo consultar destinos");
    const cities=await cr.json(),countries=await rr.json();
    const cmap=Object.fromEntries(countries.map(x=>[x.code,x.name]));
    const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
    const nq=norm(q);
    const out=cities.filter(x=>norm(x.name).includes(nq)||norm(x.code).includes(nq))
      .sort((a,b)=>{const aa=norm(a.name).startsWith(nq)?0:1,bb=norm(b.name).startsWith(nq)?0:1;return aa-bb||String(a.name).localeCompare(String(b.name),"es")})
      .slice(0,8).map(x=>({name:x.name,country:cmap[x.country_code]||x.country_code||"",countryCode:x.country_code||"",iata:x.code||""}));
    res.setHeader("Cache-Control","s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json(out);
  }catch(e){return res.status(500).json({error:"No pudimos cargar destinos"});}
}