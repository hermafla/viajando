import crypto from 'node:crypto';

const COOKIE='__Host-valijeandoAdmin',TTL=2*60*60*1000,CODE_TTL=10*60*1000;
const emailOf=v=>String(v||'').trim().toLowerCase();
const secret=()=>process.env.ADMIN_CONSOLE_SECRET||process.env.MI_CUENTA_SECRET||process.env.SUPABASE_SECRET_KEY;
const allowed=email=>(process.env.VALIJEANDO_ADMIN_EMAILS||'hola@valijeando.com.ar').split(',').map(emailOf).includes(emailOf(email));
const headers=()=>({apikey:process.env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+process.env.SUPABASE_SECRET_KEY,'Content-Type':'application/json'});
const base=()=>process.env.SUPABASE_URL?.replace(/\/$/,'');
const digest=(value)=>crypto.createHmac('sha256',secret()).update('admin-console|'+value).digest('base64url');
export const adminCodeHash=(email,code)=>crypto.createHmac('sha256',secret()).update('admin-console-code|'+emailOf(email)+'|'+code).digest('hex');
export function adminSessionToken(email,now=Date.now()){
  const body=Buffer.from(JSON.stringify({purpose:'admin-console',email:emailOf(email),iat:now,exp:now+TTL,nonce:crypto.randomBytes(16).toString('hex')})).toString('base64url');
  return body+'.'+digest(body);
}
export function adminSession(req){
  if(!secret())return null;
  const raw=String(req.headers?.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if(!raw||raw.length>2000)return null;
  const parts=raw.split('.');if(parts.length!==2)return null;
  const [body,sig]=parts,a=Buffer.from(sig),b=Buffer.from(digest(body));
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
  try{const s=JSON.parse(Buffer.from(body,'base64url').toString());
    if(s.purpose!=='admin-console'||!allowed(s.email)||!Number.isFinite(s.exp)||!Number.isFinite(s.iat)||s.iat>Date.now()+1000||s.exp<=Date.now()||s.exp-s.iat>TTL)return null;
    return s;
  }catch{return null}
}
const cookie=(value,age=TTL/1000)=>`${COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${age}`;
const sameOrigin=req=>{
  try{const o=new URL(req.headers?.origin);return o.protocol==='https:'&&o.host===req.headers?.host}catch{return false}
};
async function database(path,options={}){
  const r=await fetch(base()+'/rest/v1/'+path,{...options,headers:{...headers(),...options.headers},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('No pudimos consultar los registros.');return r;
}
const response=(res,status,data)=>res.status(status).json(data);
const cleanText=(v,max=240)=>String(v??'').trim().slice(0,max);
const cleanAmount=v=>{if(v==null||v==='')return null;const s=String(v).trim();if(!/^\d{1,12}(?:\.\d{1,2})?$/.test(s))return undefined;return Number(s)};
const cleanCurrency=v=>{const s=String(v??'').trim().toUpperCase();return !s?null:/^[A-Z]{3}$/.test(s)?s:undefined};
const select='booking_id,confirmacion_hotel,email,nombre,apellido,telefono,hotel_nombre,hotel_id,checkin,checkout,noches,adultos,ninos,habitaciones,habitacion_nombre,regimen,reembolsable,politicas_cancelacion,total_usd,total_ars,moneda_base,pagado,estado,creado_en,actualizado_en,provider:proveedor,finance:datos_proveedor->valijeandoFinance,booking_environment:datos_proveedor->>valijeandoEnvironment,email_sent:datos_proveedor->valijeandoEmailSent,payment_method:datos_proveedor->>valijeandoPaymentMethod';
export async function handleAdmin(req,res){
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Cookie');res.setHeader('X-Content-Type-Options','nosniff');
  if(!base()||!process.env.SUPABASE_SECRET_KEY||!secret())return response(res,503,{error:'La consola todavía no está configurada.'});
  if(req.method==='POST'){
    if(!sameOrigin(req))return response(res,403,{error:'Ingresá desde la consola de Valijeando.'});
    const action=req.body?.action,email=emailOf(req.body?.email);
    if(action==='logout'){res.setHeader('Set-Cookie',cookie('',0));return response(res,200,{ok:true})}
    if(['save-financials','prepare-invoice'].includes(action)){
      if(!adminSession(req))return response(res,401,{error:'Ingresá a la consola privada.'});
      const bookingId=cleanText(req.body?.bookingId,100);
      if(!bookingId)return response(res,400,{error:'Falta identificar la reserva.'});
      try{
        const found=await (await database('reservas_hoteles?select=booking_id,datos_proveedor&booking_id=eq.'+encodeURIComponent(bookingId)+'&limit=1')).json();
        if(!found[0])return response(res,404,{error:'No encontramos esta reserva.'});
        const providerData=found[0].datos_proveedor&&typeof found[0].datos_proveedor==='object'&&!Array.isArray(found[0].datos_proveedor)?found[0].datos_proveedor:{};
        const current=providerData.valijeandoFinance&&typeof providerData.valijeandoFinance==='object'?providerData.valijeandoFinance:{};
        let next;
        if(action==='save-financials'){
          const supplierCost=cleanAmount(req.body?.supplierCost),commissionAmount=cleanAmount(req.body?.commissionAmount);
          const supplierCurrency=cleanCurrency(req.body?.supplierCurrency),commissionCurrency=cleanCurrency(req.body?.commissionCurrency);
          const status=String(req.body?.supplierPaymentStatus||'unknown');
          const paidAt=cleanText(req.body?.supplierPaidAt,10);
          if(supplierCost===undefined||commissionAmount===undefined||supplierCurrency===undefined||commissionCurrency===undefined)return response(res,400,{error:'Revisá los importes y las monedas.'});
          if(!['unknown','pending','paid','partial','refunded'].includes(status))return response(res,400,{error:'El estado de pago al proveedor no es válido.'});
          if(paidAt&&!/^\d{4}-\d{2}-\d{2}$/.test(paidAt))return response(res,400,{error:'La fecha de pago no es válida.'});
          next={...current,supplierBookingId:cleanText(req.body?.supplierBookingId,120),supplierCost,supplierCurrency,commissionAmount,commissionCurrency,supplierPaymentStatus:status,supplierPaidAt:paidAt||null,notes:cleanText(req.body?.notes,500),updatedAt:new Date().toISOString()};
        }else{
          const amount=cleanAmount(req.body?.invoiceAmount),currency=cleanCurrency(req.body?.invoiceCurrency);
          const recipientType=String(req.body?.recipientType||'undecided'),documentType=String(req.body?.documentType||'undecided');
          if(amount===undefined||currency===undefined)return response(res,400,{error:'Revisá el importe y la moneda del borrador.'});
          if(!['customer','supplier','undecided'].includes(recipientType)||!['undecided','A','B','C','E'].includes(documentType))return response(res,400,{error:'Revisá el destinatario o tipo de comprobante.'});
          next={...current,invoiceDraft:{recipientType,recipientName:cleanText(req.body?.recipientName,160),recipientTaxId:cleanText(req.body?.recipientTaxId,30),documentType,amount,currency,concept:cleanText(req.body?.concept,240),updatedAt:new Date().toISOString()}};
        }
        await database('reservas_hoteles?booking_id=eq.'+encodeURIComponent(bookingId),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({datos_proveedor:{...providerData,valijeandoFinance:next},actualizado_en:new Date().toISOString()})});
        return response(res,200,{ok:true,finance:next,sent:false});
      }catch{return response(res,503,{error:'No pudimos guardar el registro interno. Intentá nuevamente.'})}
    }
    if(!['request','verify'].includes(action))return response(res,400,{error:'Acción no válida.'});
    if(!allowed(email))return response(res,403,{error:'Este email no tiene acceso de administración.'});
    try{
      if(action==='request'){
        if(!process.env.RESEND_API_KEY)return response(res,503,{error:'El envío de códigos no está disponible.'});
        const last=await (await database('codigos_acceso?select=vence_en&email=eq.'+encodeURIComponent(email)+'&limit=1')).json();
        if(last[0]&&Date.parse(last[0].vence_en)-CODE_TTL>Date.now()-60000)return response(res,429,{error:'Esperá un minuto antes de pedir otro código.'});
        const code=String(crypto.randomInt(0,1000000)).padStart(6,'0')+String(crypto.randomInt(0,1000000)).padStart(6,'0');
        await database('codigos_acceso?on_conflict=email',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({email,codigo_hash:adminCodeHash(email,code),vence_en:new Date(Date.now()+CODE_TTL).toISOString(),usado:false})});
        const mail=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:'Valijeando <reservas@valijeando.com.ar>',to:[email],subject:'Código para la consola privada de Valijeando',html:`<div style="font-family:Arial;color:#17384b;max-width:560px;margin:auto"><h2>Consola privada de Valijeando</h2><p>Usá este código de 12 dígitos para ingresar:</p><p style="font-size:28px;font-weight:bold;letter-spacing:3px">${code}</p><p>Vence en 10 minutos y se usa una sola vez. No lo compartas.</p><p>Si no pediste acceso, ignorá este correo.</p></div>`}),signal:AbortSignal.timeout(15000)});
        if(!mail.ok)throw Error('No pudimos enviar el código.');return response(res,200,{ok:true,message:'Revisá tu correo. El código tiene 12 dígitos.'});
      }
      const code=String(req.body?.code||'').replace(/[\s-]/g,'');
      if(!/^\d{12}$/.test(code))return response(res,400,{error:'Ingresá los 12 dígitos del código.'});
      const rows=await (await database('codigos_acceso?select=id&email=eq.'+encodeURIComponent(email)+'&codigo_hash=eq.'+adminCodeHash(email,code)+'&usado=eq.false&vence_en=gt.'+encodeURIComponent(new Date().toISOString())+'&limit=1')).json();
      if(!rows[0])return response(res,401,{error:'El código es incorrecto o venció.'});
      const claimed=await (await database('codigos_acceso?id=eq.'+encodeURIComponent(rows[0].id)+'&usado=eq.false&vence_en=gt.'+encodeURIComponent(new Date().toISOString()),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({usado:true})})).json();
      if(claimed.length!==1)return response(res,401,{error:'El código ya fue usado o venció.'});
      res.setHeader('Set-Cookie',cookie(adminSessionToken(email)));return response(res,200,{ok:true,email});
    }catch{return response(res,503,{error:'No pudimos completar el acceso. Intentá nuevamente.'})}
  }
  if(req.method!=='GET')return response(res,405,{error:'Método no permitido.'});
  const session=adminSession(req);if(!session)return response(res,401,{error:'Ingresá a la consola privada.'});
  try{
    const query=req.query||{},params=new URLSearchParams({select,order:'creado_en.desc,booking_id.asc'});
    const page=Math.max(1,Math.min(100000,parseInt(query.page,10)||1)),size=25;
    params.set('limit',String(size));params.set('offset',String((page-1)*size));
    if(query.bookingId){params.set('booking_id','eq.'+String(query.bookingId).slice(0,100));params.set('offset','0');params.set('limit','1')}
    else{
      const search=String(query.q||'').slice(0,100).replace(/[^\p{L}\p{N}@ _+-]/gu,' ').trim();
      if(search)params.set('or','('+['email','nombre','apellido','hotel_nombre','booking_id'].map(k=>k+'.ilike.*'+search+'*').join(',')+')');
      if(['confirmada','cancelada','pendiente'].includes(query.status))params.set('estado','eq.'+query.status);
      if(['sandbox','production'].includes(query.environment))params.set('datos_proveedor->>valijeandoEnvironment','eq.'+query.environment);
      else if(query.environment==='unregistered')params.set('datos_proveedor->>valijeandoEnvironment','is.null');
      for(const [key,column,operator] of [['from','checkin','gte'],['to','checkin','lte']])if(/^\d{4}-\d{2}-\d{2}$/.test(query[key]||''))params.append(column,operator+'.'+query[key]);
    }
    const r=await database('reservas_hoteles?'+params,{headers:{Prefer:'count=exact'}}),rows=await r.json();
    const range=r.headers.get('content-range')||'',total=Number(range.split('/')[1]);
    let checkout=null;
    if(query.bookingId&&rows[0]){
      const p=new URLSearchParams({select:'state,environment,email_sent,saved,created_at,updated_at,expires_at',or:'(provider_result->>bookingId.eq.'+String(rows[0].booking_id).replace(/[^a-zA-Z0-9_-]/g,'')+',provider_result->>id.eq.'+String(rows[0].booking_id).replace(/[^a-zA-Z0-9_-]/g,'')+')',limit:'1'});
      checkout=(await (await database('hotel_checkouts?'+p)).json())[0]||null;
    }
    return response(res,200,{email:session.email,reservations:rows,page:query.bookingId?1:page,pageSize:size,total:Number.isFinite(total)?total:rows.length,checkout});
  }catch{return response(res,503,{error:'No pudimos cargar las reservas. Volvé a intentar.'})}
}
