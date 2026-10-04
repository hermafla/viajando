import crypto from 'crypto';
import {handleAdmin} from '../lib/admin-console.js';

const cleanEmail=v=>String(v||'').trim().toLowerCase();
const json=(res,status,body)=>res.status(status).json(body);
const sbHeaders=key=>({'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'});
const hash=(email,code,secret)=>crypto.createHmac('sha256',secret).update(email+'|'+code).digest('hex');

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.query?.console==='1'||req.body?.purpose==='admin-console')return handleAdmin(req,res);
  if(req.method==='GET'){
    const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    const [body,sig]=token.split('.');
    const supabaseUrl=process.env.SUPABASE_URL?.replace(/\/$/,'');
    const supabaseKey=process.env.SUPABASE_SECRET_KEY;
    const secret=process.env.MI_CUENTA_SECRET||supabaseKey;
    if(!body||!sig||!supabaseUrl||!supabaseKey||!secret) return json(res,401,{error:'Volvé a ingresar a Mi cuenta.'});
    const expected=crypto.createHmac('sha256',secret).update(body).digest('base64url');
    const a=Buffer.from(sig),b=Buffer.from(expected);
    if(a.length!==b.length||!crypto.timingSafeEqual(a,b)) return json(res,401,{error:'La sesión no es válida.'});
    let session=null; try{session=JSON.parse(Buffer.from(body,'base64url').toString('utf8'))}catch{}
    if(!session?.email||Number(session.exp)<Date.now()) return json(res,401,{error:'La sesión venció. Volvé a ingresar.'});
    try{
      const select='booking_id,confirmacion_hotel,hotel_id,hotel_nombre,checkin,checkout,noches,adultos,ninos,habitaciones,habitacion_nombre,regimen,reembolsable,politicas_cancelacion,moneda_base,total_usd,total_ars,cotizacion_bna,pagado,estado,creado_en,booking_environment:datos_proveedor->>valijeandoEnvironment';
      const rr=await fetch(supabaseUrl+'/rest/v1/reservas_hoteles?select='+encodeURIComponent(select)+'&email=eq.'+encodeURIComponent(session.email)+'&order=creado_en.desc',{headers:sbHeaders(supabaseKey)});
      if(!rr.ok) return json(res,503,{error:'No pudimos cargar tus reservas.'});
      const rows=await rr.json();
      return json(res,200,{email:session.email,reservations:rows.map(row=>({...row,isTest:row.booking_environment==='sandbox'}))});
    }catch(e){return json(res,503,{error:'No pudimos cargar tus reservas.'});}
  }
  if(req.method==='PUT'){
    const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    const [body,sig]=token.split('.');
    const supabaseUrl=process.env.SUPABASE_URL?.replace(/\/$/,'');
    const supabaseKey=process.env.SUPABASE_SECRET_KEY;
    const secret=process.env.MI_CUENTA_SECRET||supabaseKey;
    const nuiteeKey=process.env.NUITEE_API_KEY;
    if(!body||!sig||!supabaseUrl||!supabaseKey||!secret||!nuiteeKey) return json(res,401,{error:'Volvé a ingresar a Mi cuenta.'});
    const expected=crypto.createHmac('sha256',secret).update(body).digest('base64url');
    const a=Buffer.from(sig),b=Buffer.from(expected);
    if(a.length!==b.length||!crypto.timingSafeEqual(a,b)) return json(res,401,{error:'La sesión no es válida.'});
    let session=null; try{session=JSON.parse(Buffer.from(body,'base64url').toString('utf8'))}catch{}
    if(!session?.email||Number(session.exp)<Date.now()) return json(res,401,{error:'La sesión venció. Volvé a ingresar.'});
    const bookingId=String(req.body?.bookingId||'').trim();
    if(!bookingId) return json(res,400,{error:'Falta identificar la reserva.'});
    try{
      const own=await fetch(supabaseUrl+'/rest/v1/reservas_hoteles?select=booking_id,estado,email,nombre,hotel_nombre,checkin,checkout,habitacion_nombre,total_usd,total_ars&booking_id=eq.'+encodeURIComponent(bookingId)+'&email=eq.'+encodeURIComponent(session.email)+'&limit=1',{headers:sbHeaders(supabaseKey)});
      const rows=own.ok?await own.json():[];
      if(!Array.isArray(rows)||!rows.length) return json(res,404,{error:'No encontramos esta reserva en tu cuenta.'});
      if(String(rows[0].estado||'').toLowerCase()==='cancelada') return json(res,200,{ok:true,status:'CANCELLED',alreadyCancelled:true});
      const nr=await fetch('https://book.liteapi.travel/v3.0/bookings/'+encodeURIComponent(bookingId),{method:'PUT',headers:{'X-API-Key':nuiteeKey,'Accept':'application/json'}});
      const textBody=await nr.text(); let nj={}; try{nj=textBody?JSON.parse(textBody):{}}catch{}
      if(!nr.ok && nr.status!==204){console.error('Nuitee cancel',nr.status,textBody);return json(res,502,{error:'No pudimos cancelar la reserva con el proveedor. No se modificó tu reserva.'});}
      const data=nj?.data||nj||{}; const status=String(data.status||'CANCELLED').toUpperCase();
      if(!status.startsWith('CANCELLED')) return json(res,502,{error:'El proveedor no confirmó la cancelación. No se modificó tu reserva.'});
      const up=await fetch(supabaseUrl+'/rest/v1/reservas_hoteles?booking_id=eq.'+encodeURIComponent(bookingId)+'&email=eq.'+encodeURIComponent(session.email),{method:'PATCH',headers:{...sbHeaders(supabaseKey),'Prefer':'return=minimal'},body:JSON.stringify({estado:'cancelada',actualizado_en:new Date().toISOString()})});
      let syncWarning=false;if(!up.ok){syncWarning=true;console.error('Supabase cancel sync',up.status,await up.text());}
      let emailSent=false,emailError='';
      const resendKey=process.env.RESEND_API_KEY,booking=rows[0];
      if(resendKey){
        try{
          const fee=data.cancellation_fee??null,refund=data.refund_amount??null,currency=data.currency||'USD';
          const money=v=>v==null?'No informado':currency+' '+Number(v).toFixed(2);
          const er=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':'Bearer '+resendKey,'Content-Type':'application/json'},body:JSON.stringify({
            from:'Valijeando <reservas@valijeando.com.ar>',to:[booking.email],subject:'Reserva cancelada - '+(booking.hotel_nombre||'Alojamiento')+' | Valijeando',
            html:'<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033"><h2 style="color:#b42318">Tu reserva fue cancelada</h2><p>Hola '+String(booking.nombre||'').replace(/[<>&]/g,'')+',</p><p>La cancelación fue confirmada por el proveedor.</p><div style="background:#f6f8fb;border-radius:14px;padding:18px"><strong>'+(booking.hotel_nombre||'Alojamiento')+'</strong><p>Código de reserva: <b>'+bookingId+'</b><br>Entrada: '+(booking.checkin||'—')+'<br>Salida: '+(booking.checkout||'—')+'<br>Habitación: '+(booking.habitacion_nombre||'—')+'</p><p><b>Cargo por cancelación: '+money(fee)+'</b><br><b>Reintegro: '+money(refund)+'</b></p></div><p style="color:#667085;font-size:13px">Guardá este correo como constancia de la cancelación.</p><p>Valijeando</p></div>'
          })});
          if(!er.ok)throw Error(await er.text()); emailSent=true;
        }catch(e){emailError='La reserva se canceló, pero no pudimos enviar el email de constancia.';console.error('Cancel email',e);}
      }else emailError='La reserva se canceló, pero el servicio de email no está configurado.';
      return json(res,200,{ok:true,status,cancellationFee:data.cancellation_fee??null,refundAmount:data.refund_amount??null,currency:data.currency||null,syncWarning,emailSent,emailError});
    }catch(e){console.error('Cancel booking',e);return json(res,503,{error:'No pudimos completar la cancelación en este momento.'});}
  }
  if(req.method!=='POST') return json(res,405,{error:'Método no permitido'});
  const email=cleanEmail(req.body?.email);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res,400,{error:'Ingresá un email válido.'});
  const supabaseUrl=process.env.SUPABASE_URL?.replace(/\/$/,'');
  const supabaseKey=process.env.SUPABASE_SECRET_KEY;
  const resendKey=process.env.RESEND_API_KEY;
  const secret=process.env.MI_CUENTA_SECRET||supabaseKey;
  if(!supabaseUrl||!supabaseKey||!resendKey||!secret) return json(res,503,{error:'El acceso a Mi cuenta todavía no está disponible.'});
  try{
    const lookup=await fetch(supabaseUrl+'/rest/v1/reservas_hoteles?select=id&email=eq.'+encodeURIComponent(email)+'&limit=1',{headers:sbHeaders(supabaseKey)});
    const rows=lookup.ok?await lookup.json():[];
    // Respuesta deliberadamente igual exista o no el email, para no revelar clientes.
    if(!Array.isArray(rows)||!rows.length) return json(res,200,{ok:true,message:'Si ese email tiene reservas en Valijeando, vas a recibir un código de acceso.'});
    const code=String(crypto.randomInt(0,1000000)).padStart(6,'0');
    const expires=new Date(Date.now()+10*60*1000).toISOString();
    const tokenHash=hash(email,code,secret);
    const up=await fetch(supabaseUrl+'/rest/v1/codigos_acceso?on_conflict=email',{method:'POST',headers:{...sbHeaders(supabaseKey),'Prefer':'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({email,codigo_hash:tokenHash,vence_en:expires,usado:false})});
    if(!up.ok){console.error('OTP Supabase',up.status,await up.text());return json(res,503,{error:'No pudimos generar el código. Intentá nuevamente en unos minutos.'});}
    const er=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':'Bearer '+resendKey,'Content-Type':'application/json'},body:JSON.stringify({
      from:'Valijeando <reservas@valijeando.com.ar>',to:[email],subject:'Tu código para ingresar a Valijeando',
      html:'<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#172033"><h2>Ingresá a Mi cuenta</h2><p>Usá este código para ver tus reservas en Valijeando:</p><div style="font-size:34px;font-weight:800;letter-spacing:8px;background:#f2f6ff;border-radius:14px;padding:18px;text-align:center">'+code+'</div><p>El código vence en 10 minutos y puede usarse una sola vez.</p><p style="color:#667085;font-size:13px">Si no solicitaste este acceso, podés ignorar este correo.</p></div>'
    })});
    if(!er.ok){console.error('OTP Resend',er.status,await er.text());return json(res,503,{error:'No pudimos enviar el código. Intentá nuevamente.'});}
    return json(res,200,{ok:true,message:'Si ese email tiene reservas en Valijeando, vas a recibir un código de acceso.'});
  }catch(e){console.error('OTP request',e);return json(res,503,{error:'No pudimos generar el acceso en este momento.'});}
}
