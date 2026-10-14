import test from 'node:test';
import assert from 'node:assert/strict';
import {RATEHAWK_SANDBOX_URL,validateSandboxSearch,summarizeSandboxHotels} from '../lib/ratehawk-sandbox.js';
import handler from '../api/ratehawk-sandbox-search.js';

const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
async function call(fn,req){const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(data){this.data=data;return this}};await fn(req,res);return res}

test('sandbox search only accepts known sandbox hotel IDs and valid future dates',()=>{
 const search=validateSandboxSearch({hid:10004834,checkin:'2026-11-01',checkout:'2026-11-04',residency:'AR'},new Date('2026-10-14T00:00:00Z'));
 assert.equal(search.currency,'USD');assert.equal(search.residency,'ar');assert.equal(search.guests[0].adults,2);assert.deepEqual(search.hids,[10004834]);assert.equal(RATEHAWK_SANDBOX_URL,'https://api-sandbox.ratehawk.com/api/b2b/v3/search/serp/hotels/');
 assert.throws(()=>validateSandboxSearch({hid:42,checkin:'2026-11-01',checkout:'2026-11-02'},new Date('2026-10-14T00:00:00Z')));
 assert.throws(()=>validateSandboxSearch({hid:10004834,checkin:'2026-10-01',checkout:'2026-10-02'},new Date('2026-10-14T00:00:00Z')));
});

test('provider response is reduced to safe display fields and capped at five rates',()=>{
 const rates=Array.from({length:7},(_,i)=>({book_hash:'secret-rate-hash',meal:'breakfast',payment_options:{payment_types:[{show_amount:String(200+i),show_currency_code:'USD'}]},tax_data:{taxes:[{name:'city_tax',amount:'3',currency_code:'USD',included_by_supplier:false}]}}));
 const [hotel]=summarizeSandboxHotels({data:{hotels:[{id:'hotel-id',hid:10004834,name:'Demo Hotel',rates}]}});
 assert.equal(hotel.rates.length,5);assert.equal(hotel.rates[0].price,200);assert.equal(hotel.rates[0].taxes[0].included,false);assert.equal(JSON.stringify(hotel).includes('secret-rate-hash'),false);
});

test('API is fail-closed unless Vercel Preview is explicitly configured for Sandbox',async()=>{
 const names=['RATEHAWK_ENV','RATEHAWK_SANDBOX_KEY_ID','RATEHAWK_SANDBOX_API_KEY'];const old=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 try{delete process.env.RATEHAWK_ENV;process.env.RATEHAWK_SANDBOX_KEY_ID='id';process.env.RATEHAWK_SANDBOX_API_KEY='key';const r=await call(handler,{method:'POST',body:{}});assert.equal(r.code,503);assert.match(r.data.error,/Sandbox/)}finally{for(const k of names){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k]}}
});

test('API calls only the sandbox host with Basic auth and returns a safe summary',async()=>{
 const names=['RATEHAWK_ENV','RATEHAWK_SANDBOX_KEY_ID','RATEHAWK_SANDBOX_API_KEY'];const old=Object.fromEntries(names.map(k=>[k,process.env[k]]));const previousFetch=globalThis.fetch;
 try{process.env.RATEHAWK_ENV='sandbox';process.env.RATEHAWK_SANDBOX_KEY_ID='sandbox-id';process.env.RATEHAWK_SANDBOX_API_KEY='sandbox-key';globalThis.fetch=async(url,opts)=>{assert.equal(url,RATEHAWK_SANDBOX_URL);assert.equal(opts.headers.Authorization,`Basic ${Buffer.from('sandbox-id:sandbox-key').toString('base64')}`);assert.deepEqual(JSON.parse(opts.body).hids,[10004834]);return response({data:{hotels:[{hid:10004834,name:'Demo',rates:[{book_hash:'private',meal:'breakfast',payment_options:{payment_types:[{show_amount:'245.00',show_currency_code:'USD'}]}}]}]}})};const r=await call(handler,{method:'POST',body:{hid:10004834,checkin:'2026-11-01',checkout:'2026-11-04',residency:'AR'}});assert.equal(r.code,200);assert.equal(r.data.environment,'sandbox');assert.equal(r.data.search.hotelId,10004834);assert.equal(r.data.hotels[0].rates[0].price,245);assert.equal(JSON.stringify(r.data).includes('private'),false)}finally{globalThis.fetch=previousFetch;for(const k of names){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k]}}
});
