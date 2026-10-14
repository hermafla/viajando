export const RATEHAWK_SANDBOX_URL='https://api-sandbox.ratehawk.com/api/b2b/v3/search/serp/hotels/';
export const RATEHAWK_SANDBOX_HIDS=Object.freeze([10004834,8819557,9744270,10050577,10076665,10004873,9015534]);

export function validateSandboxSearch(body,now=new Date()){
  const checkin=String(body?.checkin||'');
  const checkout=String(body?.checkout||'');
  const hid=Number(body?.hid);
  const residency=String(body?.residency||'AR').toLowerCase();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(checkin)||!/^\d{4}-\d{2}-\d{2}$/.test(checkout))throw new Error('Ingresá fechas válidas.');
  const inDate=new Date(`${checkin}T00:00:00Z`),outDate=new Date(`${checkout}T00:00:00Z`),today=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
  if(Number.isNaN(inDate.valueOf())||Number.isNaN(outDate.valueOf())||inDate.toISOString().slice(0,10)!==checkin||outDate.toISOString().slice(0,10)!==checkout)throw new Error('Ingresá fechas válidas.');
  if(inDate<today||outDate<=inDate)throw new Error('La salida debe ser posterior a la entrada y las fechas deben ser futuras.');
  if(inDate>new Date(today.valueOf()+730*86400000)||outDate>new Date(inDate.valueOf()+30*86400000))throw new Error('El Sandbox permite hasta 730 días de anticipación y estadías de hasta 30 días.');
  if(!RATEHAWK_SANDBOX_HIDS.includes(hid))throw new Error('Elegí uno de los hoteles de prueba habilitados.');
  if(!/^[a-z]{2}$/.test(residency))throw new Error('La residencia debe ser un código de país de dos letras.');
  return {checkin,checkout,hids:[hid],residency,language:'en',currency:'USD',guests:[{adults:2,children:[]}]};
}

export function summarizeSandboxHotels(payload){
  const hotels=Array.isArray(payload?.data?.hotels)?payload.data.hotels:[];
  return hotels.map(h=>({
    hid:Number(h.hid)||null,
    name:String(h.name||h.id||`Hotel ${h.hid||''}`).slice(0,180),
    rates:(Array.isArray(h.rates)?h.rates:[]).slice(0,5).map(rate=>{
      const types=Array.isArray(rate.payment_options?.payment_types)?rate.payment_options.payment_types:[];
      const payment=types[0]||{};
      const taxes=Array.isArray(rate.tax_data?.taxes)?rate.tax_data.taxes:[];
      return {
        price:Number(payment.show_amount)||Number(payment.amount)||null,
        currency:String(payment.show_currency_code||payment.currency_code||'USD'),
        meal:String(rate.meal_data?.value||rate.meal||'Sin comidas'),
        refundable:payment.cancellation_penalties?.free_cancellation_before||null,
        taxes:taxes.slice(0,8).map(t=>({name:String(t.name||'Impuesto'),amount:Number(t.amount)||null,currency:String(t.currency_code||''),included:t.included_by_supplier===true}))
      };
    })
  }));
}

export async function ratehawkSandboxHandler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Método no permitido.'});
  if(process.env.RATEHAWK_ENV!=='sandbox')return res.status(503).json({error:'RateHawk Sandbox todavía no está habilitado en este Preview. Se necesitan las credenciales Sandbox y activar el entorno de prueba.'});
  const keyId=String(process.env.RATEHAWK_SANDBOX_KEY_ID||'').trim();
  const apiKey=String(process.env.RATEHAWK_SANDBOX_API_KEY||'').trim();
  if(!keyId||!apiKey)return res.status(503).json({error:'Faltan las credenciales Sandbox de RateHawk en el entorno Preview.'});
  let body=req.body;
  if(typeof body==='string'){try{body=JSON.parse(body)}catch{return res.status(400).json({error:'Solicitud inválida.'})}}
  let search;
  try{search=validateSandboxSearch(body)}catch(e){return res.status(400).json({error:e.message})}
  try{
    const auth=Buffer.from(`${keyId}:${apiKey}`).toString('base64');
    const response=await fetch(RATEHAWK_SANDBOX_URL,{method:'POST',headers:{Authorization:`Basic ${auth}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(search),signal:AbortSignal.timeout(20000)});
    const data=await response.json().catch(()=>null);
    if(!response.ok){console.error('RateHawk Sandbox search',response.status);return res.status(502).json({error:'RateHawk Sandbox rechazó la búsqueda. Revisá las credenciales y los datos de prueba.',providerStatus:response.status})}
    return res.status(200).json({environment:'sandbox',search:{checkin:search.checkin,checkout:search.checkout,residency:search.residency,currency:search.currency,hotelId:search.hids[0]},hotels:summarizeSandboxHotels(data)});
  }catch(e){console.error('RateHawk Sandbox request',e.name);return res.status(502).json({error:'No pudimos completar la consulta de prueba a RateHawk. Intentá de nuevo.'})}
}
