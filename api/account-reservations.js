import crypto from 'crypto';
const sbHeaders=key=>({'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'});
const decode=s=>{try{return JSON.parse(Buffer.from(s,'base64url').toString('utf8'))}catch{return null}};
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({error:'Método no permitido'});
  const key=process.env.SUPABASE_SECRET_KEY,url=process.env.SUPABASE_URL?.replace(/\/$/,'');
  const secret=process.env.MI_CUENTA_SECRET||key;
  const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  const [body,sig]=token.split('.');
  if(!body||!sig||!secret) return res.status(401).json({error:'Volvé a ingresar a Mi cuenta.'});
  const expected=crypto.createHmac('sha256',secret).update(body).digest('base64url');
  const a=Buffer.from(sig),b=Buffer.from(expected);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b)) return res.status(401).json({error:'La sesión no es válida.'});
  const session=decode(body);
  if(!session?.email||Number(session.exp)<Date.now()) return res.status(401).json({error:'La sesión venció. Volvé a ingresar.'});
  try{
    const select='booking_id,confirmacion_hotel,hotel_nombre,checkin,checkout,noches,adultos,ninos,habitaciones,habitacion_nombre,regimen,reembolsable,moneda_base,total_usd,total_ars,cotizacion_bna,pagado,estado,creado_en';
    const r=await fetch(url+'/rest/v1/reservas_hoteles?select='+encodeURIComponent(select)+'&email=eq.'+encodeURIComponent(session.email)+'&order=creado_en.desc',{headers:sbHeaders(key)});
    if(!r.ok){console.error('Mis reservas',r.status,await r.text());return res.status(503).json({error:'No pudimos cargar tus reservas.'});}
    return res.status(200).json({email:session.email,reservations:await r.json()});
  }catch(e){return res.status(503).json({error:'No pudimos cargar tus reservas.'});}
}
