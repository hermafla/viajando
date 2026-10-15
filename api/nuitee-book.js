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
      const bna=num(reservation.bnaRate),cardRate=num(reservation.cardRate),arsRate=reservation.displayCurrency==='ARS'&&cardRate!=null?cardRate:bna;
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
        total_ars:(totalUsd!=null&&arsRate!=null)?Number((totalUsd*arsRate).toFixed(2)):null,
        cotizacion_bna:bna,
        cotizacion_fecha:bna?new Date().toISOString():null,
        pagado:false,
        cargos_alojamiento_usd:num(reservation.dueAtProperty)||0,
        estado:dbStatus,
        datos_proveedor:{...d,valijeandoArsCardRate:cardRate,valijeandoClientReference:clientReference,valijeandoOccupancies:rooms,valijeandoEnvironment:mode,valijeandoPaymentMethod:payload.payment.method,valijeandoEmailSent:false}
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
        const policyTag=String(reservation?.refundableTag||reservation?.cancellationPolicies?.refundableTag||'').toUpperCase();
        const cancellationText=policyTag==='NRFN'
          ?'Esta tarifa figura como no reembolsable. Revisá las condiciones guardadas en Mi cuenta antes de solicitar una cancelación.'
          :policyTag==='RFN'
            ?'Esta tarifa figura como reembolsable. La fecha límite y los cargos aplicables se consultan desde Mi cuenta antes de confirmar una cancelación.'
            :'Consultá las condiciones vigentes de cancelación desde Mi cuenta antes de confirmar una solicitud.';
        const accountUrl='https://www.valijeando.com.ar/mi-cuenta.html';
        const html='<div style="margin:0;padding:24px 12px;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#172033">'
          +'<div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden">'
          +'<div style="padding:23px 28px;background:#fff;border-bottom:1px solid #edf1f6"><div style="font-size:24px;font-weight:800;color:#1769d2">Valijeando</div><div style="font-size:12px;color:#667085;margin-top:4px">Tu viaje, más fácil</div></div>'
          +'<div style="padding:28px"><div style="display:inline-block;padding:6px 10px;border-radius:999px;background:#eaf7ef;color:#168344;font-size:12px;font-weight:700">RESERVA CONFIRMADA</div>'
          +'<h1 style="font-size:25px;line-height:1.25;margin:16px 0 8px;color:#172033">'+(mode==='sandbox'?'Reserva de prueba confirmada':'¡Tu alojamiento está confirmado!')+'</h1>'
          +(mode==='sandbox'?'<p style="padding:12px 14px;background:#fff7e5;border:1px solid #f3d18b;border-radius:10px;color:#7a4b00"><strong>Prueba sin cobro:</strong> no tiene validez para alojarte en el hotel.</p>':'')
          +'<p style="font-size:15px;line-height:1.6;margin:0 0 20px">Hola '+htmlEscape(firstName)+'. El proveedor confirmó tu reserva en <strong>'+hotelName+'</strong>.</p>'
          +'<div style="padding:18px;background:#f6f8fb;border-radius:13px">'
          +(bookingId?'<p style="margin:0 0 12px"><span style="color:#667085">Código de reserva</span><br><strong style="font-size:17px">'+htmlEscape(bookingId)+'</strong></p>':'')
          +(hotelConfirmationCode?'<p style="margin:0 0 12px"><span style="color:#667085">Confirmación del hotel</span><br><strong>'+htmlEscape(hotelConfirmationCode)+'</strong></p>':'')
          +'<table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.6">'
          +(checkin?'<tr><td style="padding:7px 0;color:#667085">Entrada</td><td style="padding:7px 0;text-align:right;font-weight:700">'+checkin+'</td></tr>':'')
          +(checkout?'<tr><td style="padding:7px 0;color:#667085">Salida</td><td style="padding:7px 0;text-align:right;font-weight:700">'+checkout+'</td></tr>':'')
          +(reservation?.roomName?'<tr><td style="padding:7px 0;color:#667085">Habitación</td><td style="padding:7px 0;text-align:right;font-weight:700">'+htmlEscape(reservation.roomName)+'</td></tr>':'')
          +(reservation?.boardName?'<tr><td style="padding:7px 0;color:#667085">Régimen</td><td style="padding:7px 0;text-align:right;font-weight:700">'+htmlEscape(reservation.boardName)+'</td></tr>':'')
          +(totalUsd!=null?'<tr><td style="padding:7px 0;color:#667085">Precio de la tarifa</td><td style="padding:7px 0;text-align:right;font-weight:700">USD '+totalUsd.toFixed(2)+'</td></tr>':'')
          +'</table></div>'
          +'<div style="margin-top:18px;padding:16px;border:1px solid #dce8f8;border-radius:12px"><strong style="color:#175ca8">Cancelación</strong><p style="font-size:14px;line-height:1.55;margin:7px 0 0">'+htmlEscape(cancellationText)+'</p></div>'
          +'<div style="text-align:center;margin:24px 0 18px"><a href="'+accountUrl+'" style="display:inline-block;background:#1769d2;color:#fff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:999px">Ver mi reserva</a></div>'
          +'<p style="font-size:13px;line-height:1.55;color:#667085">Guardá este correo junto con el código de reserva. Para ayuda, escribinos a <a href="mailto:hola@valijeando.com.ar" style="color:#1769d2">hola@valijeando.com.ar</a>.</p>'
          +'</div><div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #edf1f6;color:#667085;font-size:12px">Valijeando · <a href="https://www.valijeando.com.ar" style="color:#1769d2">valijeando.com.ar</a></div></div></div>';
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
