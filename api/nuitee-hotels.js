export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({error:'Método no permitido'});
  const key=process.env.NUITEE_API_KEY;
  if(!key) return res.status(503).json({error:'Falta configurar NUITEE_API_KEY en Vercel para activar la prueba.'});
  const city=String(req.query.city||'Rio de Janeiro');
  const countryCode=String(req.query.countryCode||'BR').toUpperCase();
  const checkin=String(req.query.checkin||'');
  const checkout=String(req.query.checkout||'');
  const adults=Math.max(1,Number(req.query.adults||2));
  const currency=String(req.query.currency||'USD').toUpperCase();
  const guestNationality=String(req.query.guestNationality||'AR').toUpperCase();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(checkin)||!/^\d{4}-\d{2}-\d{2}$/.test(checkout)) return res.status(400).json({error:'Fechas inválidas'});
  const headers={'X-API-Key':key,'Content-Type':'application/json','Accept':'application/json'};
  try{
    const [catalogRes,ratesRes]=await Promise.all([
      fetch('https://api.liteapi.travel/v3.0/data/hotels?'+new URLSearchParams({countryCode,cityName:city,limit:'200'}),{headers}),
      fetch('https://api.liteapi.travel/v3.0/hotels/rates',{method:'POST',headers,body:JSON.stringify({countryCode,cityName:city,checkin,checkout,currency,guestNationality,occupancies:[{rooms:1,adults}],maxRatesPerHotel:1,timeout:8,limit:20})})
    ]);
    const catalog=await catalogRes.json(); const rates=await ratesRes.json();
    if(!catalogRes.ok) throw new Error(catalog.message||'Error al consultar datos de hoteles');
    if(!ratesRes.ok) throw new Error(rates.message||'Error al consultar tarifas');
    const byId=new Map((catalog.data||[]).map(h=>[h.id,h]));
    const hotels=[];
    for(const item of (rates.data||[])){
      const meta=byId.get(item.hotelId)||{};
      const room=(item.roomTypes||[])[0]||{};
      const rate=(room.rates||[])[0]||room;
      const rr=rate.retailRate||room.retailRate||{};
      const total=Array.isArray(rr.total)?rr.total[0]:rr.total;
      const amount=total&&typeof total==='object'?total.amount:total;
      if(amount==null) continue;
      hotels.push({hotelId:item.hotelId,name:meta.name||item.hotelId,photo:meta.main_photo||meta.thumbnail||'',address:meta.address||'',stars:meta.stars||0,rating:meta.rating||0,reviewCount:meta.reviewCount||0,retailRate:Number(amount),currency});
    }
    return res.status(200).json({sandbox:true,hotels});
  }catch(e){return res.status(502).json({error:e.message||'Error consultando Nuitee'});}
}