import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutToken,verifyCheckoutToken,clientReferenceFor } from '../lib/hotel-checkout.js';
import prebook from '../api/nuitee-prebook.js';
const prepare=(req,res)=>prebook({...req,body:{...req.body,action:'prepare_payment'}},res);
import book from '../api/nuitee-book.js';

const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
async function call(handler,body,method='POST'){const res={code:200,setHeader(){},status(n){this.code=n;return this},json(data){this.data=data;return this}};await handler({method,body,headers:{}},res);return res}
async function mockFetch(fn,run){const old=globalThis.fetch;globalThis.fetch=fn;try{return await run()}finally{globalThis.fetch=old;delete process.env.NUITEE_LIVE_BOOKING_ENABLED;delete process.env.NUITEE_SANDBOX_PAYMENT_SDK_ENABLED}}
function env(mode='sandbox'){process.env.NUITEE_API_KEY=mode==='production'?'prod_test':'sand_test';process.env.SUPABASE_URL='https://database.test';process.env.SUPABASE_SECRET_KEY='test-only';process.env.RESEND_API_KEY='test-only';delete process.env.NUITEE_LIVE_BOOKING_ENABLED;delete process.env.NUITEE_SANDBOX_PAYMENT_SDK_ENABLED}
const context={hotelId:'hotel-test',hotelName:'Hotel de prueba',checkin:'2027-01-10',checkout:'2027-01-11',occupancies:[{adults:2}],roomName:'Doble'};
const verified={...context,price:100,estimatedTotal:110,dueAtProperty:10,currency:'USD'};
function checkout(state='ready',environment='sandbox'){return {id:'checkout-test',environment,prebook_id:'prebook-test',transaction_id:'transaction-test',client_reference:clientReferenceFor('prebook-test'),reservation:verified,state,holder:{firstName:'Huésped',lastName:'Prueba',email:'test@example.test'},guests:[{occupancyNumber:1,firstName:'Huésped',lastName:'Prueba',email:'test@example.test'}]}}
test('signed checkout rejects edits, a changed environment, and disabled production',()=>{
  env();const token=checkoutToken('checkout-test','sandbox');assert.equal(verifyCheckoutToken(token).id,'checkout-test');assert.throws(()=>verifyCheckoutToken(token+'x'));
  env('production');assert.throws(()=>verifyCheckoutToken(token));assert.throws(()=>verifyCheckoutToken(checkoutToken('checkout-test','production')));
  process.env.NUITEE_LIVE_BOOKING_ENABLED='true';assert.equal(verifyCheckoutToken(checkoutToken('checkout-test','production')).environment,'production');delete process.env.NUITEE_LIVE_BOOKING_ENABLED;
});
test('a production key does not activate sales by itself',async()=>{
  env('production');await mockFetch(()=>{throw Error('Must not call provider')},async()=>{assert.equal((await call(prebook,{offerId:'offer',reservation:context})).code,503);assert.equal((await call(prebook,{},'GET')).data.bookingEnabled,false)});
});
test('missing checkout storage stops SDK prebook before opening a payment',async()=>{
  env();let providerCalls=0;await mockFetch(async url=>{if(url.includes('/rates/'))providerCalls++;return response({},404)},async()=>{assert.equal((await call(prebook,{offerId:'offer',usePaymentSdk:true,reservation:context})).code,503);assert.equal(providerCalls,0)});
});
test('sandbox SDK switch advertises the real payment flow and cannot be disabled by the browser',async()=>{
  env();process.env.NUITEE_SANDBOX_PAYMENT_SDK_ENABLED='true';let providerCalls=0;
  await mockFetch(async(url,options)=>{
    if(url.includes('hotel_checkouts')||url.includes('reservas_hoteles'))return response([]);
    assert.ok(url.includes('/rates/prebook'));providerCalls++;assert.equal(JSON.parse(options.body).usePaymentSdk,true);
    return response({data:{prebookId:'prebook-test',transactionId:'transaction-test',secretKey:'payment-secret',price:100,currency:'USD'}});
  },async()=>{const mode=await call(prebook,{},'GET');assert.equal(mode.data.bookingEnabled,true);assert.equal(mode.data.paymentMethod,'TRANSACTION_ID');assert.equal(mode.data.bookingEnvironment,'sandbox');const r=await call(prebook,{offerId:'offer',usePaymentSdk:false,reservation:context});assert.equal(r.code,200);assert.equal(r.data.paymentPublicKey,'sandbox');assert.equal(providerCalls,1)});
});
test('sandbox SDK switch disables checkout when storage is unavailable before any provider call',async()=>{
  env();process.env.NUITEE_SANDBOX_PAYMENT_SDK_ENABLED='true';let providerCalls=0;
  await mockFetch(async url=>{if(url.includes('/rates/'))providerCalls++;return response({},404)},async()=>{const mode=await call(prebook,{},'GET');assert.equal(mode.data.bookingEnabled,false);assert.equal(mode.data.paymentMethod,'TRANSACTION_ID');assert.equal((await call(prebook,{offerId:'offer',reservation:context})).code,503);assert.equal(providerCalls,0)});
});
test('SDK prebook persists a verified price and the transaction pair before returning its secret',async()=>{
  env();let saved;
  await mockFetch(async(url,options)=>{
    if(url.includes('hotel_checkouts')){if(options.method==='POST'){saved=JSON.parse(options.body);return response([saved])}return response([])}
    assert.ok(url.includes('/rates/prebook'));assert.equal(JSON.parse(options.body).usePaymentSdk,true);return response({data:{prebookId:'prebook-test',transactionId:'transaction-test',secretKey:'payment-secret',price:100,currency:'USD'}});
  },async()=>{const r=await call(prebook,{offerId:'offer',usePaymentSdk:true,reservation:{...context,price:1}});assert.equal(r.code,200);assert.equal(r.data.paymentPublicKey,'sandbox');assert.equal(r.data.paymentSecret,'payment-secret');assert.equal(saved.prebook_id,'prebook-test');assert.equal(saved.transaction_id,'transaction-test');assert.equal(saved.reservation.price,100);assert.equal(saved.reservation.estimatedTotal,100);assert.ok(!JSON.stringify(saved).includes('payment-secret'));assert.equal(verifyCheckoutToken(r.data.checkoutToken).id,saved.id)});
});
test('missing transaction information never exposes a payment form',async()=>{
  env();await mockFetch(async url=>url.includes('hotel_checkouts')?response([]):response({data:{prebookId:'prebook-test',price:100}}),async()=>{const r=await call(prebook,{offerId:'offer',usePaymentSdk:true,reservation:context});assert.equal(r.code,503);assert.equal(r.data.paymentSecret,undefined)});
});
test('guest details must be saved before allowing payment',async()=>{
  env();const row=checkout('prepared');let saved;
  await mockFetch(async(url,options)=>{assert.ok(url.includes('hotel_checkouts'));if(options.method==='PATCH'){saved=JSON.parse(options.body);return response([{...row,...saved}])}return response([row])},async()=>{const token=checkoutToken(row.id,'sandbox');assert.equal((await call(prepare,{checkoutToken:token,firstName:'Uno',lastName:'Dos',email:'incorrecto'})).code,400);const r=await call(prepare,{checkoutToken:token,firstName:'Uno',lastName:'Dos',email:'TEST@example.test'});assert.equal(r.data.ready,true);assert.equal(saved.holder.email,'test@example.test');assert.equal(saved.guests.length,1);assert.equal(saved.state,'ready')});
});
test('production book uses only the stored transaction and price, never account credit or browser amounts',async()=>{
  env('production');process.env.NUITEE_LIVE_BOOKING_ENABLED='true';let row=checkout('ready','production'),bookCalls=0;
  await mockFetch(async(url,options)=>{
    if(url.includes('hotel_checkouts')){if(options.method==='PATCH'){row={...row,...JSON.parse(options.body)};return response([row])}return response([row])}
    if(url.includes('reservas_hoteles')){if(options.method==='POST'){const saved=JSON.parse(options.body);assert.equal(saved.total_usd,110);assert.equal(saved.datos_proveedor.valijeandoEnvironment,'production')}return response([])}
    if(url.includes('/rates/book')){bookCalls++;const payload=JSON.parse(options.body);assert.deepEqual(payload.payment,{method:'TRANSACTION_ID',transactionId:'transaction-test'});return response({data:{bookingId:'booking-test',status:'CONFIRMED'}})}
    if(url.includes('resend.com')){assert.ok(!JSON.parse(options.body).subject.includes('[PRUEBA]'));return response({id:'email-test'})}
    throw Error('Unexpected request');
  },async()=>{const r=await call(book,{checkoutToken:checkoutToken(row.id,'production'),prebookId:'forged',transactionId:'forged',reservation:{price:1}});assert.equal(r.code,200);assert.equal(r.data.sandbox,false);assert.equal(r.data.saved,true);assert.equal(r.data.emailSent,true);assert.equal(bookCalls,1);assert.equal(row.state,'confirmed')});
});
test('an already claimed checkout never submits another provider booking',async()=>{
  env();const row=checkout('booking');let bookCalls=0;
  await mockFetch(async(url)=>{if(url.includes('hotel_checkouts'))return response([row]);if(url.includes('/rates/book'))bookCalls++;if(url.includes('/bookings?'))return response({data:[]});throw Error('Unexpected request')},async()=>{const r=await call(book,{checkoutToken:checkoutToken(row.id,'sandbox')});assert.equal(r.data.reason,'booking_uncertain');assert.equal(bookCalls,0)});
});
test('a network error after claiming payment leaves a recoverable booking, never enables another charge',async()=>{
  env();let row=checkout();let bookCalls=0;
  await mockFetch(async(url,options)=>{if(url.includes('hotel_checkouts')){if(options.method==='PATCH'){row={...row,...JSON.parse(options.body)};return response([row])}return response([row])}if(url.includes('reservas_hoteles'))return response([]);if(url.includes('/rates/book')){bookCalls++;throw Error('network interrupted')}if(url.includes('/bookings?'))return response({data:[]});throw Error('Unexpected')},async()=>{const token=checkoutToken(row.id,'sandbox');assert.equal((await call(book,{checkoutToken:token})).data.reason,'booking_uncertain');assert.equal((await call(book,{checkoutToken:token})).data.reason,'booking_uncertain');assert.equal(bookCalls,1);assert.equal(row.state,'booking')});
});
test('a stored confirmation recovers a failed reservation insert without another Book',async()=>{
  env();let row={...checkout('confirmed'),provider_result:{bookingId:'booking-test',status:'CONFIRMED'}},bookCalls=0;
  await mockFetch(async(url,options)=>{if(url.includes('hotel_checkouts')){if(options.method==='PATCH'){row={...row,...JSON.parse(options.body)};return response([row])}return response([row])}if(url.includes('/rates/book'))bookCalls++;if(url.includes('reservas_hoteles'))return response([]);if(url.includes('resend.com'))return response({id:'mail'});throw Error('Unexpected')},async()=>{const r=await call(book,{checkoutToken:checkoutToken(row.id,'sandbox')});assert.equal(r.code,200);assert.equal(r.data.saved,true);assert.equal(bookCalls,0)});
});
test('confirmation email retry uses its original reservation and labels sandbox messages',async()=>{
  env();let bookCalls=0,insertCalls=0,mailCalls=0;
  await mockFetch(async(url,options)=>{if(url.includes('/rates/book'))bookCalls++;if(url.includes('reservas_hoteles')){if(options.method==='POST')insertCalls++;return response([{booking_id:'booking-test',estado:'confirmada',datos_proveedor:{valijeandoEmailSent:false}}])}if(url.includes('resend.com')){mailCalls++;const mail=JSON.parse(options.body);assert.ok(mail.subject.startsWith('[PRUEBA]'));assert.ok(mail.html.includes('No tiene validez'));assert.equal(mail.reply_to,'hola@valijeando.com.ar');assert.ok(options.headers['Idempotency-Key']);return response({id:'mail'})}throw Error('Unexpected')},async()=>{const r=await call(book,{prebookId:'prebook-test',firstName:'Uno',lastName:'Dos',email:'test@example.test',reservation:verified});assert.equal(r.code,200);assert.equal(r.data.saved,true);assert.equal(r.data.emailSent,true);assert.equal(bookCalls,0);assert.equal(insertCalls,0);assert.equal(mailCalls,1)});
});
test('a concurrent reservation insert is verified by booking ID and owner before reporting saved',async()=>{
  env();let row={...checkout('confirmed'),provider_result:{bookingId:'booking-test',status:'CONFIRMED'}};
  await mockFetch(async(url,options)=>{
    if(url.includes('hotel_checkouts'))return response([row]);
    if(url.includes('reservas_hoteles')){if(options.method==='POST')return response({code:'23505'},409);if(url.includes('booking_id=eq.')){assert.ok(url.includes('email=eq.test%40example.test'));return response([{booking_id:'booking-test'}])}return response([])}
    if(url.includes('resend.com'))return response({id:'mail'});
    throw Error('Unexpected');
  },async()=>{assert.equal((await call(book,{checkoutToken:checkoutToken(row.id,'sandbox')})).data.saved,true)});
});
