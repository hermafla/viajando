import test from 'node:test';
import assert from 'node:assert/strict';
import Party from '../travel-party.js';
import Fare from '../flight-fare.js';
import {mapOffer,bookingEnvironment,occupanciesFromQuery} from '../lib/nuitee.js';
import hotels from '../api/nuitee-hotels.js';
import prebook from '../api/nuitee-prebook.js';
import book from '../api/nuitee-book.js';

const party=[{adults:2,children:1,childAges:[9]},{adults:2,children:0,childAges:[]}];
const rate=(n,amount,children=[])=>({occupancyNumber:n,adultCount:2,childCount:children.length,childrenAges:children,name:n===1?'TRIPLE WITH DOUBLE BED':'DOUBLE Standard',mappedRoomId:10+n,retailRate:{total:[{amount,currency:'USD'}],taxesAndFees:n===1?[{name:'City tax',amount:10,included:false,currency:'USD'}]:[]},cancellationPolicies:{refundableTag:n===1?'RFN':'NRFN'}});
const offer={offerId:'two-room-offer',rates:[rate(1,170.25,[9]),rate(2,140.5)],offerRetailRate:{amount:310.75,currency:'USD'}};
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
async function call(handler,req){const res={code:200,setHeader(){},status(n){this.code=n;return this},json(data){this.data=data;return this}};await handler(req,res);return res}
async function withFetch(mock,fn){const old=globalThis.fetch;globalThis.fetch=mock;try{return await fn()}finally{globalThis.fetch=old}}
function env(){process.env.NUITEE_API_KEY='sand_test_only';process.env.SUPABASE_URL='https://database.test';process.env.SUPABASE_SECRET_KEY='test-only';process.env.RESEND_API_KEY='test-only'}

test('flight passengers distinguish adults, children and infants by age',()=>{
 assert.equal(Party.flightSearch('COR','RIO','2026-10-15','2026-10-20',[party[0]]),'COR1510RIO2010210');
 assert.deepEqual(Party.flightCounts(Party.normalize([{adults:2,children:4,childAges:[0,1,9,12]}])),{adults:3,children:1,infants:2});
 assert.throws(()=>Party.flightCounts([{adults:1,children:2,childAges:[0,1]}]));
 assert.throws(()=>Party.flightCounts([{adults:10,children:0,childAges:[]}]));
});
test('party round trip preserves children, ages and separate rooms',()=>{
 const p=Party.apply(new URLSearchParams(),party);assert.deepEqual(Party.fromParams(p),party);
 assert.equal(p.get('viajeros'),'5');assert.equal(Party.summary(party),'4 adultos · 1 niño · 2 habitaciones');
 assert.throws(()=>Party.normalize([{adults:2,children:1,childAges:[]}]));
 assert.deepEqual(occupanciesFromQuery({occupancies:JSON.stringify(party)}),[{adults:2,children:[9]},{adults:2}]);
});
test('multi-room offer keeps one offerId and sums all rooms plus property fees',()=>{
 const mapped=mapOffer(offer);assert.equal(mapped.retailRate,310.75);assert.equal(mapped.estimatedTotal,320.75);assert.equal(mapped.offerId,'two-room-offer');assert.equal(mapped.rates.length,2);
 assert.ok(Party.matchesOffer(mapped,party));assert.equal(Party.matchesOffer(mapped,[party[0]]),false);
 assert.equal(Party.matchesOffer({...mapped,rates:[mapped.rates[0],mapped.rates[0]]},party),false);
 assert.equal(mapped.cancellationPolicies.rooms.length,2);
});
test('price parser keeps only displayed amount, never a stale provider quote',()=>{
 assert.deepEqual(Fare.parsePrice('$ \u202a1 341\u202c'),{currency:'USD',value:1341});
 assert.deepEqual(Fare.parsePrice('USD 1.350,02'),{currency:'USD',value:1350.02});
 assert.equal(Fare.parsePrice('USD 1.350,021'),null);
 assert.equal(Fare.parsePrice('$ 1 341 BudgetAir $ 1 407 Trip.com'),null);
});
test('booking mode is determined by server key, never a static banner',()=>{
 assert.equal(bookingEnvironment('sand_test'),'sandbox');assert.equal(bookingEnvironment('sandbox_test'),'sandbox');assert.equal(bookingEnvironment('prod_test'),'production');assert.equal(bookingEnvironment('unknown'),'unknown');
});
test('hotels uses one rates request and retains availability if catalog fails',async()=>{
 env();let ratesCalls=0;
 await withFetch(async(url,options)=>{
  if(url.includes('/hotels/rates')){ratesCalls++;const payload=JSON.parse(options.body);assert.deepEqual(payload.occupancies,[{adults:2,children:[9]},{adults:2}]);assert.equal(payload.limit,1500);assert.equal(payload.offset,undefined);return response({data:[{hotelId:'hotel-test',roomTypes:[offer]}]})}
  if(url.includes('/data/hotels'))return response({error:'catalog unavailable'},503);
  throw Error('Unexpected request');
 },async()=>{const r=await call(hotels,{method:'GET',query:{city:'Santiago',checkin:'2026-10-15',checkout:'2026-10-20',occupancies:JSON.stringify(party)}});assert.equal(r.code,200);assert.equal(r.data.hotels.length,1);assert.equal(r.data.hotels[0].estimatedTotal,320.75);assert.equal(r.data.search.rooms,2);assert.equal(ratesCalls,1)});
});
test('provider failure is a technical error and invalid ages never reach provider',async()=>{
 env();await withFetch(async()=>response({error:'timeout'},503),async()=>{const r=await call(hotels,{method:'GET',query:{checkin:'2026-10-15',checkout:'2026-10-20'}});assert.equal(r.code,502);assert.equal(r.data.reason,'provider_error')});
 await withFetch(async()=>{throw Error('Must not call provider')},async()=>{const r=await call(hotels,{method:'GET',query:{checkin:'2026-10-15',checkout:'2026-10-20',occupancies:'not json'}});assert.equal(r.code,400)});
});
test('prebook returns full offer price and rejects a missing verified price',async()=>{
 env();await withFetch(async()=>response({data:{prebookId:'prebook-test',roomTypes:[offer]}}),async()=>{const r=await call(prebook,{method:'POST',body:{offerId:offer.offerId}});assert.equal(r.code,200);assert.equal(r.data.price,310.75);assert.equal(r.data.estimatedTotal,320.75);assert.equal(r.data.rates.length,2)});
 await withFetch(async()=>response({data:{prebookId:'prebook-test'}}),async()=>{const r=await call(prebook,{method:'POST',body:{offerId:offer.offerId}});assert.equal(r.code,502)});
});
const bookingBody={prebookId:'prebook-test',firstName:'Huesped',lastName:'Prueba',email:'huesped@example.test',roomGuests:[{firstName:'Segundo',lastName:'Huesped'}],reservation:{occupancies:party,adults:4,children:1,rooms:2,hotelName:'Hotel prueba',price:310.75,estimatedTotal:320.75,checkin:'2026-10-15',checkout:'2026-10-20'}};
test('booking sends one named adult per room and reports failed email separately',async()=>{
 env();let bookCalls=0;
 await withFetch(async(url,options)=>{
  if(url.includes('/rates/book')){bookCalls++;const p=JSON.parse(options.body);assert.equal(p.guests.length,2);assert.equal(p.guests[1].firstName,'Segundo');return response({data:{bookingId:'booking-test',status:'CONFIRMED'}})}
  if(url.startsWith('https://database.test')){assert.equal(options.headers.Authorization,'Bearer test-only');if(options.method==='POST'){const row=JSON.parse(options.body);assert.equal(row.adultos,4);assert.equal(row.ninos,1);assert.equal(row.habitaciones,2);return response({})}return response([])}
  if(url.includes('resend.com'))return response({error:'email unavailable'},503);
  throw Error('Unexpected request');
 },async()=>{const r=await call(book,{method:'POST',body:bookingBody});assert.equal(r.code,200);assert.equal(r.data.saved,true);assert.equal(r.data.emailSent,false);assert.equal(r.data.bookingId,'booking-test');assert.equal(bookCalls,1)});
});
test('a known booking is returned without creating another provider booking',async()=>{
 env();let calls=0;await withFetch(async(url)=>{calls++;assert.ok(url.startsWith('https://database.test'));return response([{booking_id:'booking-test',estado:'confirmada'}])},async()=>{const r=await call(book,{method:'POST',body:bookingBody});assert.equal(r.code,200);assert.equal(r.data.alreadyConfirmed,true);assert.equal(calls,1)});
});
test('database failure before confirmation stops Book; production cannot use sandbox payment',async()=>{
 env();await withFetch(async(url)=>{assert.ok(url.startsWith('https://database.test'));return response({},503)},async()=>{assert.equal((await call(book,{method:'POST',body:bookingBody})).code,503)});
 process.env.NUITEE_API_KEY='prod_test';await withFetch(async()=>{throw Error('Must not send booking')},async()=>{assert.equal((await call(book,{method:'POST',body:bookingBody})).code,503)});
});
