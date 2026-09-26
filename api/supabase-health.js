export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'Método no permitido'});
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SECRET_KEY;
  if(!url||!key) return res.status(503).json({ok:false,error:'Falta configurar Supabase en el servidor'});
  const bookingId='VAL-HEALTH-'+Date.now();
  const row={
    email:'healthcheck@valijeando.invalid',
    nombre:'Valijeando',
    apellido:'Healthcheck',
    booking_id:bookingId,
    proveedor:'Valijeando',
    hotel_nombre:'Prueba técnica',
    checkin:'2026-10-01',
    checkout:'2026-10-02',
    noches:1,
    adultos:1,
    ninos:0,
    habitaciones:1,
    moneda_base:'USD',
    total_usd:1,
    pagado:false,
    cargos_alojamiento_usd:0,
    estado:'healthcheck',
    datos_proveedor:{healthcheck:true}
  };
  try{
    const base=url.replace(/\/$/,'')+'/rest/v1/reservas_hoteles';
    const headers={'apikey':key,'Content-Type':'application/json','Prefer':'return=representation'};
    const ins=await fetch(base,{method:'POST',headers,body:JSON.stringify(row)});
    const body=await ins.text();
    if(!ins.ok){
      console.error('Supabase healthcheck INSERT',ins.status,body);
      return res.status(502).json({ok:false,stage:'insert',status:ins.status,error:body});
    }
    let inserted=[]; try{inserted=JSON.parse(body)}catch{}
    const id=inserted?.[0]?.id;
    if(id){
      const del=await fetch(base+'?id=eq.'+encodeURIComponent(id),{method:'DELETE',headers:{'apikey':key,'Prefer':'return=minimal'}});
      if(!del.ok){
        const de=await del.text();
        console.error('Supabase healthcheck DELETE',del.status,de);
        return res.status(200).json({ok:true,inserted:true,cleanup:false,id,error:de});
      }
    }
    return res.status(200).json({ok:true,inserted:true,cleanup:true});
  }catch(e){
    console.error('Supabase healthcheck exception',e?.message||e);
    return res.status(502).json({ok:false,error:e?.message||'Error probando Supabase'});
  }
}