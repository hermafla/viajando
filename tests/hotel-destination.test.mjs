import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import hotels from '../api/nuitee-hotels.js';

const html=readFileSync(new URL('../hoteles.html',import.meta.url),'utf8');
const helpers=html.slice(html.indexOf('const normalizeDestination='),html.indexOf("if(incoming.get('city'))city.value="));
const initialize=html.match(/\n\(async\(\)=>\{[\s\S]*?\}\)\(\);/)[0];
const brazil={placeId:'brazil',displayName:'Río de Janeiro',formattedAddress:'Estado de Río de Janeiro, Brasil'};
const colombia={placeId:'colombia',displayName:'RIO DE JANEIRO',formattedAddress:'Mistrato, Risaralda, Colombia'};
const {chooseDestination}=vm.runInNewContext(helpers+';({chooseDestination})',{Intl});

test('accent differences do not displace the first relevant Rio result',()=>{
 for(const name of ['Rio de Janeiro','RIO DE JANEIRO','Río de Janeiro'])assert.equal(chooseDestination([brazil,colombia],name).placeId,'brazil');
});
test('a known country excludes identically named places in other countries',()=>{
 assert.equal(chooseDestination([colombia,brazil],'Rio de Janeiro','BR').placeId,'brazil');
 assert.equal(chooseDestination([brazil,colombia],'Rio de Janeiro','CO').placeId,'colombia');
 assert.equal(chooseDestination([colombia],'Rio de Janeiro','BR'),undefined);
});
test('automatic hotel navigation resolves Brazil and displays its address',async()=>{
 let query='',submitted=false;
 const context={Intl,URLSearchParams,displayCurrency:'USD',incoming:new URLSearchParams('city=Rio+de+Janeiro&countryCode=BR'),city:{value:'Rio de Janeiro'},placeId:{value:''},checkin:{value:'2027-01-10'},checkout:{value:'2027-01-25'},status:{textContent:''},form:{requestSubmit(){submitted=true}},fetch:async url=>{query=url;return {json:async()=>({places:[colombia,brazil]})}}};
 await vm.runInNewContext(helpers+initialize,context);
 assert.match(decodeURIComponent(query),/Rio de Janeiro, Brasil/);
 assert.equal(context.placeId.value,'brazil');
 assert.equal(context.city.value,'Río de Janeiro · Estado de Río de Janeiro, Brasil');
 assert.equal(submitted,true);
 assert.equal(context.checkin.value,'2027-01-10');assert.equal(context.checkout.value,'2027-01-25');
});
test('an explicitly chosen place remains selected without another lookup',async()=>{
 let submitted=false;
 const context={Intl,URLSearchParams,displayCurrency:'USD',incoming:new URLSearchParams('city=RIO+DE+JANEIRO'),city:{value:'RIO DE JANEIRO'},placeId:{value:'colombia'},checkin:{value:'2027-01-10'},checkout:{value:'2027-01-25'},status:{textContent:''},form:{requestSubmit(){submitted=true}},fetch:async()=>{throw Error('Explicit selection must not be replaced')}};
 await vm.runInNewContext(helpers+initialize,context);
 assert.equal(context.placeId.value,'colombia');assert.equal(submitted,true);
});
test('even an empty rates result identifies the exact place and country',async()=>{
 const oldFetch=globalThis.fetch,oldKey=process.env.NUITEE_API_KEY;process.env.NUITEE_API_KEY='sand_test_only';
 try{
  globalThis.fetch=async(url,options)=>{
   if(url.includes('/data/places/'))return new Response(JSON.stringify({data:{displayName:{text:colombia.displayName},formattedAddress:colombia.formattedAddress,location:{latitude:5.29,longitude:-75.88}}}));
   assert.ok(url.includes('/hotels/rates'));const q=JSON.parse(options.body);assert.equal(q.latitude,5.29);assert.deepEqual(q.occupancies,[{adults:2,children:[9]}]);
   return new Response(JSON.stringify({error:{code:2001,message:'No availability found'}}));
  };
  const res={code:200,setHeader(){},status(n){this.code=n;return this},json(data){this.data=data;return this}};
  await hotels({method:'GET',query:{placeId:'colombia',checkin:'2027-01-10',checkout:'2027-01-25',occupancies:'[{"adults":2,"children":1,"childAges":[9]}]'}},res);
  assert.equal(res.code,200);assert.deepEqual(res.data.hotels,[]);assert.equal(res.data.destination.formattedAddress,colombia.formattedAddress);assert.equal(res.data.destination.displayName,colombia.displayName);
 }finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.NUITEE_API_KEY;else process.env.NUITEE_API_KEY=oldKey}
});
