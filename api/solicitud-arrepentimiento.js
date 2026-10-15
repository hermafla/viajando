import crypto from 'node:crypto';

const clean=(v,max=160)=>String(v??'').trim().slice(0,max);
const respond=(res,status,body)=>res.status(status).json(body);
const base=()=>process.env.SUPABASE_URL?.replace(/\\/$/,'');
const headers=()=>({apikey:process.env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+process.env.SUPABASE_SECRET_KEY,'Content-Type':'application/json'});
const sameOrigin=req=>{
  try{const origin=new URL(req.headers?.origin);return origin.protocol==='https:'&&origin.host===req.headers?.host}catch{return false}
};
async function db(path,options={}){
  const r=await fetch(base()+'/rest/v1/'+path,{...options,headers:{...headers(),...options.headers},signal:AbortSignal.timeout(12000)});
  const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{}
  return {ok:r.ok,status:r.status,data};
}
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateText=value=>value?new Date(String(value).slice(0,10)+'T12:00:00Z').toLocaleDateString('es-AR',{timeZone:'UTC'}):'No informada';
async function sendEmail(to,subject,html,idempotencyKey){
  if(!process.env.RESEND_API_KEY)return false;
  try{
    const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify({from:'Valijeando <reservas@valijeando.com.ar>',reply_to:'hola@valijeando.com.ar',to:[to],subject,html}),signal:AbortSignal.timeout(12000)});
    if(!r.ok)console.error('Arrepentimiento email status',r.status);
    return r.ok;
  }catch(e){console.error('Arrepentimiento email error',e?.name||'network');return false}
}
async function findOpenRequest(bookingId,email){
  const p=new URLSearchParams({select:'codigo,correo_cliente_enviado,correo_valijeando_enviado',booking_id:'eq.'+bookingId,email:'eq.'+email,estado:'in.(recibida,en_gestion)',limit:'1'});
  const r=await db('solicitudes_arrepentimiento?'+p);
  if(!r.ok)throw Error('database');
  return r.data?.[0]||null;
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return respond(res,405,{error:'Método no permitido.'});
  if(!sameOrigin(req))return respond(res,403,{error:'Ingresá desde el sitio de Valijeando.'});
  if(!base()||!process.env.SUPABASE_SECRET_KEY)return respond(res,503,{error:'El registro de solicitudes no está disponible en este momento.'});

  const body=req.body||{};
  if(clean(body.website,120))return respond(res,200,{ok:true,message:'Solicitud recibida.'});
  const email=clean(body.email,254).toLowerCase();
  const bookingId=clean(body.bookingId,120);
  if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email))return respond(res,400,{error:'Ingresá un email válido.'});
  if(!/^[A-Za-z0-9._-]{3,120}$/.test(bookingId))return respond(res,400,{error:'Revisá el código de reserva.'});

  try{
    const p=new URLSearchParams({select:'booking_id,email,nombre,hotel_nombre,checkin,checkout,estado,entorno:datos_proveedor->>valijeandoEnvironment',booking_id:'eq.'+bookingId,email:'eq.'+email,estado:'eq.confirmada','datos_proveedor->>valijeandoEnvironment':'eq.production',limit:'1'});
    const lookup=await db('reservas_hoteles?'+p);
    if(!lookup.ok)return respond(res,503,{error:'No pudimos validar la solicitud. Intentá nuevamente.'});
    const booking=lookup.data?.[0];
    if(!booking)return respond(res,400,{error:'No pudimos validar esos datos. Revisá el email y el código de reserva.'});

    const existing=await findOpenRequest(bookingId,email);
    if(existing)return respond(res,200,{ok:true,code:existing.codigo,alreadyReceived:true,emailSent:existing.correo_cliente_enviado===true});

    const since=new Date(Date.now()-60*60*1000).toISOString();
    const limitQuery=new URLSearchParams({select:'id',email:'eq.'+email,creado_en:'gte.'+since,limit:'6'});
    const recent=await db('solicitudes_arrepentimiento?'+limitQuery);
    if(!recent.ok)return respond(res,503,{error:'No pudimos validar la solicitud. Intentá nuevamente.'});
    if((recent.data||[]).length>=5)return respond(res,429,{error:'Ya registramos varios intentos para este email. Si necesitás ayuda, escribinos a hola@valijeando.com.ar.'});

    const code='AR-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'-'+crypto.randomBytes(3).toString('hex').toUpperCase();
    const saved=await db('solicitudes_arrepentimiento',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({codigo:code,booking_id:bookingId,email,hotel_nombre:booking.hotel_nombre||null,checkin:booking.checkin||null,checkout:booking.checkout||null})});
    if(saved.status===409){
      const duplicate=await findOpenRequest(bookingId,email);
      if(duplicate)return respond(res,200,{ok:true,code:duplicate.codigo,alreadyReceived:true,emailSent:duplicate.correo_cliente_enviado===true});
    }
    if(!saved.ok)return respond(res,503,{error:'No pudimos registrar la solicitud. Intentá nuevamente o escribinos a hola@valijeando.com.ar.'});

    const htmlCustomer='<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033"><h2>Recibimos tu solicitud</h2><p>Registramos tu solicitud de arrepentimiento para la reserva de <strong>'+escapeHtml(booking.hotel_nombre||'alojamiento')+'</strong>.</p><p style="background:#f2f6ff;border-radius:12px;padding:16px"><strong>Número de trámite:</strong> '+escapeHtml(code)+'</p><p>Conservá este número como constancia. Te enviaremos novedades al correo informado.</p><p style="color:#667085;font-size:13px">Valijeando · hola@valijeando.com.ar</p></div>';
    const htmlAdmin='<div style="font-family:Arial,sans-serif;max-width:650px;margin:auto;color:#172033"><h2>Nueva solicitud de arrepentimiento</h2><p><strong>Número:</strong> '+escapeHtml(code)+'</p><p><strong>Reserva:</strong> '+escapeHtml(bookingId)+'<br><strong>Email:</strong> '+escapeHtml(email)+'<br><strong>Hotel:</strong> '+escapeHtml(booking.hotel_nombre||'—')+'<br><strong>Entrada:</strong> '+escapeHtml(dateText(booking.checkin))+'<br><strong>Salida:</strong> '+escapeHtml(dateText(booking.checkout))+'</p><p>La solicitud quedó registrada en la consola privada. Revisar y gestionar dentro del plazo correspondiente.</p></div>';
    const [customerSent,adminSent]=await Promise.all([
      sendEmail(email,'Constancia de solicitud '+code,htmlCustomer,'arrepentimiento-customer-'+code),
      sendEmail('hola@valijeando.com.ar','Nueva solicitud de arrepentimiento '+code,htmlAdmin,'arrepentimiento-admin-'+code)
    ]);
    await db('solicitudes_arrepentimiento?codigo=eq.'+encodeURIComponent(code),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({correo_cliente_enviado:customerSent,correo_valijeando_enviado:adminSent,actualizado_en:new Date().toISOString()})});
    return respond(res,200,{ok:true,code,emailSent:customerSent,message:customerSent?'Te enviamos una constancia por email. Conservá el número de trámite.':'Tu solicitud quedó registrada. Conservá el número de trámite que aparece en pantalla.'});
  }catch(e){console.error('Arrepentimiento request failed',e?.name||'error');return respond(res,503,{error:'No pudimos registrar la solicitud en este momento. Intentá nuevamente.'})}
}
