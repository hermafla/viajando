import crypto from 'crypto';
import { bookingEnvironment, occupanciesFromQuery } from '../lib/nuitee.js';
import { loadCheckout, checkoutDatabase, liveBookingEnabled } from '../lib/hotel-checkout.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).json({error:'Método no permitido'});
  const key=process.env.NUITEE_API_KEY;
  if(!key) return res.status(503).json({error:'Falta configurar NUITEE_API_KEY.'});
  let sdkCheckout=null;
  if(req.body?.checkoutToken){
    try{
      sdkCheckout=await loadCheckout(req.body.checkoutToken);
      if(!sdkCheckout.holder||!sdkCheckout.guests?.length)return res.status(409).json({error:'Completá tus datos antes de pagar.'});
      if(['booking','uncertain'].includes(sdkCheckout.state)){
        const lookup=await fetch('https://book.liteapi.travel/v3.0/bookings?clientReference='+encodeURIComponent(sdkCheckout.client_reference),{headers:{'X-API-Key':key,Accept:'application/json'}});
        const found=lookup.ok?await lookup.json():null;
        const bookings=Array.isArray(found?.data)?found.data:Array.isArray(found?.data?.bookings)?found.data.bookings:Array.isArray(found?.bookings)?found.bookings:[];
        const confirmed=bookings.find(b=>(b.bookingId||b.id)&&['confirmed','ok'].includes(String(b.status||'').toLowerCase()));
        if(!confirmed)return res.status(409).json({error:'Estamos verificando la confirmación. Conservá tus datos y consultá Mi cuenta antes de volver a reservar.',reason:'booking_uncertain'});
        await checkoutDatabase('?id=eq.'+encodeURIComponent(sdkCheckout.id),{method:'PATCH',body:{state:'confirmed',provider_result:confirmed},representation:false});
        sdkCheckout={...sdkCheckout,state:'confirmed',provider_result:confirmed};
      }
      if(sdkCheckout.state==='rejected')return res.status(409).json({error:'Esta tarifa no pudo confirmarse. Realizá una búsqueda nueva.',reason:'provider_rejected'});
      req.body={prebookId:sdkCheckout.prebook_id,...sdkCheckout.holder,reservation:sdkCheckout.reservation,roomGuests:sdkCheckout.guests.slice(1)};
    }catch{return res.status(503).json({error:'No pudimos verificar el pago preparado. Conservá tus datos antes de volver a reservar.',reason:'booking_uncertain'})}
  }
  let {prebookId,firstName,lastName,email,phone,reservation,roomGuests}=req.body||{};
  if(!prebookId||!firstName||!lastName||!email) return res.status(400).json({error:'Completá nombre, apellido y email.'});
  const clean=s=>String(s||'').trim();
  const mode=bookingEnvironment(key);
  if(mode!=='sandbox'&&!(mode==='production'&&sdkCheckout&&liveBookingEnabled()))return res.status(503).json({error:'Las reservas no están habilitadas en este entorno. Podés seguir consultando alojamientos.'});
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(email)))return res.status(400).json({error:'Ingresá un email válido.'});
  let rooms;try{rooms=occupanciesFromQuery({occupancies:JSON.stringify(reservation?.occupancies),adults:reservation?.adults})}catch{return res.status(400).json({error:'Revisá la distribución de habitaciones.'})}
  const guests=rooms.map((r,i)=>({occupancyNumber:i+1,firstName:clean(i===0?firstName:roomGuests?.[i-1]?.firstName),lastName:clean(i===0?lastName:roomGuests?.[i-1]?.lastName),email:clean(email)}));
  if(guests.some(g=>!g.firstName||!g.lastName))return res.status(400).json({error:'Indicá un huésped adulto por habitación.'});
  const clientReference='VAL-'+crypto.createHash('sha256').update(clean(prebookId)).digest('hex').slice(0,32);
  const supabaseUrl=process.env.SUPABASE_URL,supabaseKey=process.env.SUPABASE_SECRET_KEY;
  const sbHeaders={'apikey':supabaseKey,'Authorization':'Bearer '+supabaseKey,'Content-Type':'application/json'};
  if(!supabaseUrl||!supabaseKey||!reservation)return res.status(503).json({error:'No pudimos preparar el registro de la reserva. Intentá más tarde.'});
  let existingRow=null;
  // Verificar el registro antes de Book evita volver a reservar al repetir la solicitud.
  try{
    const prior=await fetch(supabaseUrl.replace(/\/$/,'')+'/rest/v1/reservas_hoteles?select=booking_id,confirmacion_hotel,estado,datos_proveedor,email,nombre,apellido,telefono&datos_proveedor->>valijeandoClientReference=eq.'+encodeURIComponent(clientReference)+'&limit=1',{headers:sbHeaders});
    if(!prior.ok)return res.status(503).json({error:'No pudimos preparar el registro de la reserva. Intentá más tarde.'});
    const rows=await prior.json();existingRow=rows?.[0]||null;
    if(existingRow?.estado==='cancelada')return res.status(409).json({error:'Esta reserva ya fue cancelada. Realizá una búsqueda nueva.',reason:'provider_rejected'});
    if(existingRow&&existingRow.datos_proveedor?.valijeandoEmailSent!==false)return res.status(200).json({sandbox:mode==='sandbox',bookingEnvironment:mode,bookingId:existingRow.booking_id,hotelConfirmationCode:existingRow.confirmacion_hotel,status:existingRow.estado,saved:true,emailSent:existingRow.datos_proveedor?.valijeandoEmailSent===true||!!sdkCheckout?.email_sent,emailStatus:'already_confirmed',alreadyConfirmed:true});
    if(existingRow?.email){email=existingRow.email;firstName=existingRow.nombre||firstName;lastName=existingRow.apellido||lastName;phone=existingRow.telefono||phone;}
  }catch{return res.status(503).json({error:'No pudimos preparar el registro de la reserva. Intentá más tarde.'})}

  const num=v=>{if(v==null||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null};
  const payload={
    prebookId:clean(prebookId),
    clientReference,
    holder:{firstName:clean(firstName),lastName:clean(lastName),email:clean(email),...(phone?{phone:clean(phone)}:{})},
    guests,
    payment:sdkCheckout?{method:'TRANSACTION_ID',transactionId:sdkCheckout.transaction_id}:{method:'ACC_CREDIT_CARD'}
  };
  try{
    let d=existingRow?{...existingRow.datos_proveedor,bookingId:existingRow.booking_id,hotelConfirmationCode:existingRow.confirmacion_hotel,status:'confirmed'}:(sdkCheckout?.state==='confirmed'?sdkCheckout.provider_result:null);
    if(!d){
      if(sdkCheckout){
        const claim=await checkoutDatabase('?id=eq.'+encodeURIComponent(sdkCheckout.id)+'&state=eq.ready',{method:'PATCH',body:{state:'booking',updated_at:new Date().toISOString()}});
        if(claim?.length!==1)return res.status(409).json({error:'La reserva ya está en proceso. Revisá la confirmación.',reason:'booking_uncertain'});
      }
      const r=await fetch('https://book.liteapi.travel/v3.0/rates/book?timeout=30',{method:'POST',headers:{'X-API-Key':key,'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload)});
      const j=await r.json().catch(()=>({}));
      if(!r.ok||j.error){
        const code=String(j.code??j.error?.code??''),uncertain=r.status>=500||['4005','4016'].includes(code);
        if(sdkCheckout)await checkoutDatabase('?id=eq.'+encodeURIComponent(sdkCheckout.id),{method:'PATCH',body:{state:uncertain?'uncertain':'rejected'},representation:false}).catch(()=>{});
        return res.status(uncertain?502:(r.ok?409:r.status)).json({error:uncertain?'No pudimos verificar la confirmación. Consultá Mi cuenta antes de repetir la reserva.':'El proveedor no confirmó esta tarifa. Realizá una búsqueda nueva.',reason:uncertain?'booking_uncertain':'provider_rejected'});
      }
      d=j.data||j;
      if(sdkCheckout){
        const confirmed=(d.bookingId||d.id)&&['confirmed','ok'].includes(String(d.status||'').toLowerCase());
        await checkoutDatabase('?id=eq.'+encodeURIComponent(sdkCheckout.id),{method:'PATCH',body:{state:confirmed?'confirmed':'uncertain',provider_result:d},representation:false});
      }
    }
    const bookingId=d.bookingId||d.id||'';
    const hotelConfirmationCode=d.hotelConfirmationCode||d.confirmationCode||'';
    const status=String(d.status||'').toLowerCase();
    if(!bookingId||!['confirmed','ok'].includes(status))return res.status(502).json({error:'El proveedor no confirmó la reserva. Consultá Mi cuenta antes de volver a intentar.',reason:'booking_uncertain'});
    const dbStatus=String(status).toLowerCase()==='cancelled'?'cancelada':'confirmada';

    let saved=!!existingRow,saveError='';
    if(!existingRow&&supabaseUrl&&supabaseKey&&reservation){
      const checkin=clean(reservation.checkin),checkout=clean(reservation.checkout);
      const nights=(checkin&&checkout)?Math.max(0,Math.round((new Date(checkout+'T00:00:00Z')-new Date(checkin+'T00:00:00Z'))/86400000)):0;
      const refundable=String(reservation.refundableTag||reservation.cancellationPolicies?.refundableTag||'').toUpperCase()==='RFN';
      const totalUsd=num(reservation.estimatedTotal??reservation.price);
      const bna=num(reservation.bnaRate);
      const row={
        email:clean(email).toLowerCase(),
        nombre:clean(firstName),
        apellido:clean(lastName),
        telefono:clean(phone)||null,
        booking_id:clean(bookingId),
        confirmacion_hotel:clean(hotelConfirmationCode)||null,
        proveedor:'Nuitee',
        hotel_id:clean(reservation.hotelId)||null,
        hotel_nombre:clean(reservation.hotelName)||null,
        checkin:checkin||null,
        checkout:checkout||null,
        noches:nights||null,
        adultos:rooms.reduce((n,r)=>n+r.adults,0),
        ninos:rooms.reduce((n,r)=>n+(r.children||[]).length,0),
        habitaciones:rooms.length,
        habitacion_nombre:clean(reservation.roomName)||null,
        regimen:clean(reservation.boardName)||null,
        reembolsable:refundable,
        politicas_cancelacion:reservation.cancellationPolicies||{},
        moneda_base:'USD',
        total_usd:totalUsd,
        total_ars:(totalUsd!=null&&bna!=null)?Number((totalUsd*bna).toFixed(2)):null,
        cotizacion_bna:bna,
        cotizacion_fecha:bna?new Date().toISOString():null,
        pagado:false,
        cargos_alojamiento_usd:num(reservation.dueAtProperty)||0,
        estado:dbStatus,
        datos_proveedor:{...d,valijeandoClientReference:clientReference,valijeandoOccupancies:rooms,valijeandoEnvironment:mode,valijeandoPaymentMethod:payload.payment.method,valijeandoEmailSent:false}
      };
      try{
        const sr=await fetch(supabaseUrl.replace(/\/$/,'')+'/rest/v1/reservas_hoteles',{
          method:'POST',
          headers:{...sbHeaders,'Prefer':'return=minimal'},
          body:JSON.stringify(row)
        });
        if(sr.ok) saved=true;
        else if(sr.status===409){
          const duplicate=await fetch(supabaseUrl.replace(/\/$/,'')+'/rest/v1/reservas_hoteles?select=booking_id&booking_id=eq.'+encodeURIComponent(bookingId)+'&email=eq.'+encodeURIComponent(clean(email).toLowerCase())+'&limit=1',{headers:sbHeaders});
          const duplicateRows=duplicate.ok?await duplicate.json():[];
          saved=Array.isArray(duplicateRows)&&duplicateRows.length===1&&duplicateRows[0].booking_id===bookingId;
          if(!saved)saveError='No pudimos verificar el registro existente';
        }
        else {saveError='Supabase '+sr.status+': '+await sr.text(); console.error('Supabase reserva INSERT',sr.status,saveError);}
      }catch(se){saveError=se?.message||'No se pudo guardar en Supabase';}
    }else if(!supabaseUrl||!supabaseKey){
      saveError='Falta configurar Supabase en el servidor';
    }

    // El correo es posterior a la confirmación de Nuitee: si falla, la reserva sigue confirmada y NO se reintenta el Book.
    let emailSent=false,emailError='';
    const resendKey=process.env.RESEND_API_KEY;
    if(resendKey){
      try{
        const htmlEscape=v=>clean(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
        const hotelName=htmlEscape(reservation?.hotelName)||'tu alojamiento';
        const checkin=htmlEscape(reservation?.checkin),checkout=htmlEscape(reservation?.checkout);
        const totalUsd=num(reservation?.estimatedTotal??reservation?.price);
        const subject=(mode==='sandbox'?'[PRUEBA] ':'')+'Reserva confirmada - '+clean(reservation?.hotelName||'Alojamiento')+' | Valijeando';
        const html='<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#172033">'
          +'<h2 style="margin-bottom:8px">'+(mode==='sandbox'?'Reserva de prueba confirmada':'¡Tu reserva está confirmada!')+'</h2>'
          +(mode==='sandbox'?'<p><strong>Esta es una prueba sin cobro. No tiene validez para alojarte en el hotel.</strong></p>':'')
          +'<p>Hola '+htmlEscape(firstName)+', recibimos la confirmación de tu reserva en <strong>'+hotelName+'</strong>.</p>'
          +'<div style="background:#f6f8fb;padding:16px;border-radius:12px;margin:18px 0">'
          +(bookingId?'<p><strong>Código de reserva:</strong> '+htmlEscape(bookingId)+'</p>':'')
          +(hotelConfirmationCode?'<p><strong>Confirmación del hotel:</strong> '+htmlEscape(hotelConfirmationCode)+'</p>':'')
          +(checkin?'<p><strong>Entrada:</strong> '+checkin+'</p>':'')
          +(checkout?'<p><strong>Salida:</strong> '+checkout+'</p>':'')
          +(reservation?.roomName?'<p><strong>Habitación:</strong> '+htmlEscape(reservation.roomName)+'</p>':'')
          +(totalUsd!=null?'<p><strong>Importe base:</strong> USD '+totalUsd.toFixed(2)+'</p>':'')
          +'</div><p>Guardá este correo junto con tu código de reserva.</p>'
          +'<p style="color:#657085;font-size:13px">Valijeando · valijeando.com.ar</p></div>';
        const er=await fetch('https://api.resend.com/emails',{
          method:'POST',
          headers:{'Authorization':'Bearer '+resendKey,'Content-Type':'application/json','Idempotency-Key':'valijeando-confirmation-'+clientReference},
          body:JSON.stringify({from:'Valijeando <reservas@valijeando.com.ar>',reply_to:'hola@valijeando.com.ar',to:[clean(email).toLowerCase()],subject,html})
        });
        if(er.ok) emailSent=true;
        else {emailError='Resend '+er.status+': '+await er.text();console.error('Resend confirmación',er.status,emailError);}
      }catch(ee){emailError=ee?.message||'No se pudo enviar el correo';console.error('Resend confirmación',emailError);}
    }else emailError='Falta configurar RESEND_API_KEY';

    if(saved&&emailSent)await fetch(supabaseUrl.replace(/\/$/,'')+'/rest/v1/reservas_hoteles?booking_id=eq.'+encodeURIComponent(bookingId),{method:'PATCH',headers:{...sbHeaders,'Prefer':'return=minimal'},body:JSON.stringify({datos_proveedor:{...d,valijeandoClientReference:clientReference,valijeandoOccupancies:rooms,valijeandoEnvironment:mode,valijeandoPaymentMethod:payload.payment.method,valijeandoEmailSent:true}})}).catch(()=>{});
    if(sdkCheckout)await checkoutDatabase('?id=eq.'+encodeURIComponent(sdkCheckout.id),{method:'PATCH',body:{saved,email_sent:emailSent},representation:false}).catch(()=>{});
    return res.status(200).json({sandbox:mode==='sandbox',bookingEnvironment:mode,bookingId,hotelConfirmationCode,status,saved,saveError:saved?'':'La reserva se confirmó, pero no pudimos guardarla en Mi cuenta. Conservá el código.',emailSent,emailError:emailSent?'':'No pudimos enviar el correo de confirmación. Conservá el código.'});
  }catch(e){return res.status(502).json({error:'No pudimos verificar la confirmación. Consultá Mi cuenta antes de repetir la reserva.',reason:'booking_uncertain'});}
}
