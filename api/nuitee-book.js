export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).json({error:'Método no permitido'});
  const key=process.env.NUITEE_API_KEY;
  if(!key) return res.status(503).json({error:'Falta configurar NUITEE_API_KEY.'});
  const {prebookId,firstName,lastName,email,phone}=req.body||{};
  if(!prebookId||!firstName||!lastName||!email) return res.status(400).json({error:'Completá nombre, apellido y email.'});
  const clean=s=>String(s||'').trim();
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
    return res.status(200).json({sandbox:true,bookingId:d.bookingId||d.id||'',hotelConfirmationCode:d.hotelConfirmationCode||d.confirmationCode||'',status:d.status||'confirmed',booking:d});
  }catch(e){return res.status(502).json({error:e?.message||'No se pudo conectar con Nuitee para confirmar la reserva.'});}
}