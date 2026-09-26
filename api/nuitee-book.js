export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).json({error:'Método no permitido'});
  const key=process.env.NUITEE_API_KEY;
  if(!key) return res.status(503).json({error:'Falta configurar NUITEE_API_KEY.'});
  const {prebookId,firstName,lastName,email,phone,reservation}=req.body||{};
  if(!prebookId||!firstName||!lastName||!email) return res.status(400).json({error:'Completá nombre, apellido y email.'});
  const clean=s=>String(s||'').trim();
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
  const payload={
    prebookId:clean(prebookId),
    clientReference:'VAL-SBX-'+Date.now(),
    holder:{firstName:clean(firstName),lastName:clean(lastName),email:clean(email),...(phone?{phone:clean(phone)}:{})},
    guests:[{occupancyNumber:1,firstName:clean(firstName),lastName:clean(lastName),email:clean(email)}],
    payment:{method:'ACC_CREDIT_CARD'}
  };
  try{
    const r=await fetch('https://book.liteapi.travel/v3.0/rates/book?timeout=30',{method:'POST',headers:{'X-API-Key':key,'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload)});
    const j=await r.json().catch(()=>({}));
    if(!r.ok) return res.status(r.status).json({error:(typeof j.message==='string'?j.message:(typeof j.error==='string'?j.error:(j.error?.message||j.message?.message)))||'No se pudo confirmar la reserva SANDBOX.',details:j});
    const d=j.data||j;
    const bookingId=d.bookingId||d.id||'';
    const hotelConfirmationCode=d.hotelConfirmationCode||d.confirmationCode||'';
    const status=d.status||'confirmed';

    let saved=false,saveError='';
    const supabaseUrl=process.env.SUPABASE_URL;
    const supabaseKey=process.env.SUPABASE_SECRET_KEY;
    if(supabaseUrl&&supabaseKey&&reservation){
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
        adultos:num(reservation.adults)||1,
        ninos:num(reservation.children)||0,
        habitaciones:num(reservation.rooms)||1,
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
        estado:clean(status)||'confirmed',
        datos_proveedor:d
      };
      try{
        const sr=await fetch(supabaseUrl.replace(/\/$/,'')+'/rest/v1/reservas_hoteles',{
          method:'POST',
          headers:{'apikey':supabaseKey,'Content-Type':'application/json','Prefer':'return=minimal'},
          body:JSON.stringify(row)
        });
        if(sr.ok) saved=true;
        else saveError='Supabase '+sr.status+': '+await sr.text();
      }catch(se){saveError=se?.message||'No se pudo guardar en Supabase';}
    }else if(!supabaseUrl||!supabaseKey){
      saveError='Falta configurar Supabase en el servidor';
    }

    return res.status(200).json({sandbox:true,bookingId,hotelConfirmationCode,status,booking:d,saved,saveError});
  }catch(e){return res.status(502).json({error:e?.message||'No se pudo conectar con Nuitee para confirmar la reserva.'});}
}