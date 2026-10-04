import crypto from 'node:crypto';
import { bookingEnvironment, occupanciesFromQuery } from './nuitee.js';

export const clean = value => String(value ?? '').trim();
export const liveBookingEnabled = () => process.env.NUITEE_LIVE_BOOKING_ENABLED === 'true';
const signingSecret = () => process.env.HOTEL_CHECKOUT_SECRET || process.env.SUPABASE_SECRET_KEY;
export const clientReferenceFor = prebookId => 'VAL-' + crypto.createHash('sha256').update(clean(prebookId)).digest('hex').slice(0,32);
export function checkoutToken(id, environment) {
  const secret=signingSecret();
  if(!secret) throw Error('Checkout no configurado');
  const body=Buffer.from(JSON.stringify({id,environment,exp:Date.now()+2*60*60*1000})).toString('base64url');
  return body+'.'+crypto.createHmac('sha256',secret).update('hotel-checkout|'+body).digest('base64url');
}
export function verifyCheckoutToken(token) {
  const secret=signingSecret(), parts=String(token||'').split('.');
  if(!secret||parts.length!==2) throw Error('Checkout inválido');
  const [body,signature]=parts;
  const expected=crypto.createHmac('sha256',secret).update('hotel-checkout|'+body).digest('base64url');
  const a=Buffer.from(signature),b=Buffer.from(expected);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b)) throw Error('Checkout inválido');
  const data=JSON.parse(Buffer.from(body,'base64url').toString());
  if(!data.id||!Number.isFinite(data.exp)||data.exp<Date.now()||data.environment!==bookingEnvironment(process.env.NUITEE_API_KEY)) throw Error('Checkout vencido o de otro entorno');
  if(data.environment==='production'&&!liveBookingEnabled()) throw Error('Reservas reales no habilitadas');
  return data;
}
export async function checkoutDatabase(query='', {method='GET',body,representation=true}={}) {
  const url=process.env.SUPABASE_URL?.replace(/\/$/,''),key=process.env.SUPABASE_SECRET_KEY;
  if(!url||!key) throw Error('Falta configurar el registro de pagos');
  const response=await fetch(url+'/rest/v1/hotel_checkouts'+query,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:representation?'return=representation':'return=minimal'},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok) throw Error('No pudimos registrar el estado del pago');
  return representation?response.json():null;
}
export async function loadCheckout(token) {
  const auth=verifyCheckoutToken(token);
  const rows=await checkoutDatabase('?id=eq.'+encodeURIComponent(auth.id)+'&limit=1');
  const row=rows?.[0];
  if(!row||row.environment!==auth.environment) throw Error('No encontramos el pago preparado');
  return row;
}
export async function productionStorageReady(){
  if(!process.env.RESEND_API_KEY)throw Error('Falta configurar el correo');
  await checkoutDatabase('?select=id&limit=0');
  const url=process.env.SUPABASE_URL?.replace(/\/$/,''),key=process.env.SUPABASE_SECRET_KEY;
  const response=await fetch(url+'/rest/v1/reservas_hoteles?select=id&limit=0',{headers:{apikey:key,Authorization:'Bearer '+key}});
  if(!response.ok)throw Error('Falta el registro de reservas');
}
export function reservationContext(value) {
  if(!value||typeof value!=='object') throw Error('Faltan los datos del alojamiento');
  const checkin=clean(value.checkin),checkout=clean(value.checkout);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(checkin)||!/^\d{4}-\d{2}-\d{2}$/.test(checkout)||!(Date.parse(checkout)>Date.parse(checkin))||!clean(value.hotelId)) throw Error('Revisá el alojamiento y las fechas');
  const occupancies=occupanciesFromQuery({occupancies:JSON.stringify(value.occupancies),adults:value.adults});
  return {hotelId:clean(value.hotelId).slice(0,100),hotelName:clean(value.hotelName).slice(0,300),roomName:clean(value.roomName).slice(0,500),boardName:clean(value.boardName).slice(0,300),checkin,checkout,occupancies,adults:occupancies.reduce((n,r)=>n+r.adults,0),children:occupancies.reduce((n,r)=>n+(r.children||[]).length,0),rooms:occupancies.length};
}
export async function createCheckout(prebook, reservation) {
  const environment=bookingEnvironment(process.env.NUITEE_API_KEY),id=crypto.randomUUID();
  if(!prebook.transactionId||!prebook.secretKey) throw Error('El proveedor no preparó el pago');
  await checkoutDatabase('',{method:'POST',body:{id,environment,prebook_id:prebook.prebookId,transaction_id:prebook.transactionId,client_reference:clientReferenceFor(prebook.prebookId),reservation,state:'prepared',expires_at:new Date(Date.now()+2*60*60*1000).toISOString()}});
  return {checkoutToken:checkoutToken(id,environment),paymentMethod:'TRANSACTION_ID',paymentPublicKey:environment==='production'?'live':'sandbox',paymentSecret:prebook.secretKey};
}
