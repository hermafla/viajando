import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function element(id){return {id,value:'',disabled:false,hidden:false,textContent:'',innerHTML:'',classList:{add(){},remove(){}},listeners:{},addEventListener(type,handler){this.listeners[type]=handler},after(){},insertBefore(){},append(){},focus(){}}}
const checkout={prebookId:'prebook-ui',hotelId:'hotel-ui',hotelName:'Hotel de prueba',roomName:'Doble',checkin:'2027-01-10',checkout:'2027-01-11',occupancies:[{adults:2,children:0,childAges:[]}],price:100,estimatedTotal:110,dueAtProperty:10,bookingEnvironment:'production',paymentMethod:'TRANSACTION_ID',checkoutToken:'signed-token',paymentSecret:'sensitive-secret',paymentPublicKey:'live'};
const page=readFileSync(new URL('../reserva-hotel.html',import.meta.url),'utf8');
const inline=Array.from(page.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)).map(m=>m[1]).filter(s=>s.trim()).join('\n');
const tick=()=>new Promise(r=>setImmediate(r));
async function render({data=checkout,store,query='',mode={bookingEnvironment:'production',bookingEnabled:true},answer={bookingId:'booking-ui',status:'confirmed',saved:true,emailSent:true},bookStatus=200,prepareStatus=200}={}){
  const values=store||new Map([['valijeandoCheckout',JSON.stringify(data)]]),elements=new Map(),calls=[],portals=[];
  const document={getElementById(id){if(!elements.has(id))elements.set(id,element(id));return elements.get(id)},createElement(){return element('new')},head:{append(){}},querySelectorAll(){return []}};
  const sandbox={document,URL,URLSearchParams,Date,console,location:{origin:'https://www.valijeando.com.ar',pathname:'/reserva-hotel.html',search:query},history:{replaceState(){}},sessionStorage:{getItem:key=>values.get(key)||null,setItem:(key,v)=>values.set(key,v),removeItem:key=>values.delete(key)},fetch:async(url,options)=>{calls.push({url,body:options?.body?JSON.parse(options.body):null});if(url==='/api/nuitee-prebook')return {ok:true,json:async()=>mode};if(url==='/api/hotel-checkout')return {ok:prepareStatus===200,status:prepareStatus,json:async()=>prepareStatus===200?{ready:true}:{error:'No pudimos preparar el pago.'}};if(url==='/api/nuitee-book')return {ok:bookStatus===200,status:bookStatus,json:async()=>answer};throw Error('Unexpected request '+url)},LiteAPIPayment:class{constructor(config){portals.push(config)}async handlePayment(){} }};
  sandbox.window=sandbox;
  for(const id of ['firstName','lastName','email','phone'])sandbox[id]=document.getElementById(id);
  sandbox.firstName.value='Huésped';sandbox.lastName.value='Prueba';sandbox.email.value='test@example.test';
  const context=vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL('../travel-party.js',import.meta.url),'utf8'),context);
  vm.runInContext(inline,context);
  vm.runInContext(readFileSync(new URL('../hotel-payment.js',import.meta.url),'utf8'),context);
  await tick();await tick();
  return {context,calls,portals,elements,values,submit:async()=>{await document.getElementById('form').onsubmit({preventDefault(){}});await tick()}};
}
test('production checkout saves guests before mounting the real payment form and does not call Book early',async()=>{
  const ui=await render();await ui.submit();assert.equal(ui.portals.length,1);assert.equal(ui.portals[0].publicKey,'live');assert.equal(ui.portals[0].secretKey,'sensitive-secret');assert.equal(ui.portals[0].returnUrl,'https://www.valijeando.com.ar/reserva-hotel.html?pago=confirmado');assert.ok(!ui.portals[0].returnUrl.includes('secret'));assert.equal(ui.calls.filter(c=>c.url==='/api/hotel-checkout').length,1);assert.equal(ui.calls.filter(c=>c.url==='/api/nuitee-book').length,0);assert.equal(ui.elements.get('form').hidden,true);
  await ui.submit();assert.equal(ui.portals.length,1);
});
test('payment return confirms only with the saved token and discards the payment secret after confirmation',async()=>{
  const first=await render();await first.submit();const returned=await render({store:first.values,query:'?pago=confirmado'});assert.deepEqual(returned.calls.filter(c=>c.url==='/api/nuitee-book').map(c=>c.body),[{checkoutToken:'signed-token'}]);assert.equal(returned.portals.length,0);assert.ok(returned.elements.get('result').innerHTML.includes('booking-ui'));assert.ok(!JSON.parse(returned.values.get('valijeandoCheckout')).paymentSecret);
});
test('a forged return URL without a saved payment never confirms a booking',async()=>{
  const ui=await render({query:'?pago=confirmado'});assert.equal(ui.calls.filter(c=>c.url==='/api/nuitee-book').length,0);assert.ok(ui.elements.get('result').innerHTML.includes('No encontramos los datos'));
});
test('failed guest persistence never mounts a payment portal',async()=>{
  const ui=await render({prepareStatus:503});await ui.submit();assert.equal(ui.portals.length,0);assert.equal(ui.calls.filter(c=>c.url==='/api/nuitee-book').length,0);assert.equal(ui.elements.get('form').hidden,false);
});
test('uncertain payment return offers status verification without opening payment again',async()=>{
  const first=await render();await first.submit();const ui=await render({store:first.values,query:'?pago=confirmado',bookStatus:409,answer:{error:'Confirmación incierta',reason:'booking_uncertain'}});assert.equal(ui.portals.length,0);assert.ok(ui.elements.get('result').innerHTML.includes('No vuelvas a pagar'));assert.ok(ui.elements.get('result').innerHTML.includes('Verificar confirmación'));
});
test('a mismatched environment keeps the payment button disabled',async()=>{
  const ui=await render({mode:{bookingEnvironment:'sandbox',bookingEnabled:true}});await ui.submit();assert.equal(ui.elements.get('submit').disabled,true);assert.equal(ui.portals.length,0);
});
