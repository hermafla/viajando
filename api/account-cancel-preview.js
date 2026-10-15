import crypto from 'crypto';

const json=(res,status,body)=>res.status(status).json(body);
const sbHeaders=key=>({'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'});

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return json(res,405,{error:'Método no permitido'});
  const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  const [body,sig]=token.split('.');
  const supabaseUrl=process.env.SUPABASE_URL?.replace(/\/$/,'');
  const supabaseKey=process.env.SUPABASE_SECRET_KEY;
  const secret=process.env.MI_CUENTA_SECRET||supabaseKey;
  const nuiteeKey=process.env.NUITEE_API_KEY;
  if(!body||!sig||!supabaseUrl||!supabaseKey||!secret||!nuiteeKey)return json(res,401,{error:'Volvé a ingresar a Mi cuenta.'});
  const expected=crypto.createHmac('sha256',secret).update(body).digest('base64url');
  const a=Buffer.from(sig),b=Buffer.from(expected);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return json(res,401,{error:'La sesión no es válida.'});
  let session=null;try{session=JSON.parse(Buffer.from(body,'base64url').toString('utf8'))}catch{}
  if(!session?.email||Number(session.exp)<Date.now())return json(res,401,{error:'La sesión venció. Volvé a ingresar.'});
  const bookingId=String(req.body?.bookingId||'').trim();
  if(!bookingId)return json(res,400,{error:'Falta identificar la reserva.'});
  try{
    const own=await fetch(supabaseUrl+'/rest/v1/reservas_hoteles?select=booking_id,estado,email,politicas_cancelacion,reembolsable&booking_id=eq.'+encodeURIComponent(bookingId)+'&email=eq.'+encodeURIComponent(session.email)+'&limit=1',{headers:sbHeaders(supabaseKey)});
    if(!own.ok)return json(res,503,{error:'No pudimos verificar la reserva. Intentá nuevamente.'});
    const rows=await own.json(),reservation=Array.isArray(rows)?rows[0]:null;
    if(!reservation)return json(res,404,{error:'No encontramos esta reserva en tu cuenta.'});
    if(String(reservation.estado||'').toLowerCase()==='cancelada')return json(res,409,{error:'Esta reserva ya está cancelada.'});
    const provider=await fetch('https://book.liteapi.travel/v3.0/bookings/'+encodeURIComponent(bookingId)+'?timeout=6',{headers:{'X-API-Key':nuiteeKey,'Accept':'application/json'},signal:AbortSignal.timeout(8000)});
    const raw=await provider.text();let parsed={};try{parsed=raw?JSON.parse(raw):{}}catch{}
    if(!provider.ok||!raw)return json(res,502,{error:'Nuitee no pudo consultar ahora las condiciones de cancelación. No confirmes la cancelación todavía.'});
    const booking=parsed?.data||parsed;
    const policies=booking.cancellationPolicies||booking.bookedRooms?.[0]?.cancellationPolicies||reservation.politicas_cancelacion||{};
    return json(res,200,{
      ok:true,
      bookingId,
      bookingStatus:booking.status||null,
      currency:booking.currency||null,
      refundableTag:booking.tag||policies.refundableTag||(reservation.reembolsable===true?'RFN':reservation.reembolsable===false?'NRFN':null),
      lastFreeCancellationDate:booking.lastFreeCancellationDate||null,
      cancellationPolicies:policies,
      hotelRemarks:policies.hotelRemarks||[],
      policySource:booking.cancellationPolicies?'nuitee':'saved'
    });
  }catch(e){
    console.error('Cancellation preview',e.name);
    return json(res,502,{error:'No pudimos consultar las condiciones de cancelación. Intentá nuevamente antes de confirmar.'});
  }
}
