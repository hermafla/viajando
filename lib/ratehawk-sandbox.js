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
        refundable:rate.cancellation_penalties?.free_cancellation_before||null,
        taxes:taxes.slice(0,8).map(t=>({name:String(t.name||'Impuesto'),amount:Number(t.amount)||null,currency:String(t.currency_code||''),included:t.included_by_supplier===true}))
      };
    })
  }));
}
