(function(root){
  'use strict';
  const integer=(v,min,max,label)=>{const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)throw Error('Revisá '+label+'.');return n};
  function normalize(input,fallbackAdults=2){
    if(typeof input==='string')input=input?JSON.parse(input):null;
    if(!input)input=[{adults:fallbackAdults,children:0,childAges:[]}];
    if(!Array.isArray(input)||!input.length||input.length>5)throw Error('Elegí entre 1 y 5 habitaciones.');
    return input.map(r=>{const ages=r.childAges||r.ages||(Array.isArray(r.children)?r.children:[]),children=Array.isArray(r.children)?r.children.length:Number(r.children??ages.length);integer(children,0,6,'la cantidad de niños');if(!Array.isArray(ages)||ages.length!==children)throw Error('Indicá la edad de cada niño.');return {adults:integer(r.adults,1,10,'la cantidad de adultos'),children,childAges:ages.map(a=>integer(a,0,17,'las edades de los niños'))}});
  }
  const fromParams=p=>normalize(p.get('occupancies'),Number(p.get('adults')||p.get('viajeros')||2));
  const totals=rooms=>rooms.reduce((t,r)=>({adults:t.adults+r.adults,children:t.children+r.children,rooms:t.rooms+1}),{adults:0,children:0,rooms:0});
  function apply(p,rooms){const t=totals(rooms);for(const k of ['adults','children','rooms'])p.set(k,String(t[k]));p.set('viajeros',String(t.adults+t.children));p.set('occupancies',JSON.stringify(rooms));return p}
  function summary(rooms){const t=totals(rooms);return t.adults+(t.adults===1?' adulto':' adultos')+(t.children?' · '+t.children+(t.children===1?' niño':' niños'):'')+' · '+t.rooms+(t.rooms===1?' habitación':' habitaciones')}
  function flightCounts(rooms){const t=totals(rooms),counts={adults:t.adults,children:0,infants:0};rooms.flatMap(r=>r.childAges).forEach(a=>counts[a<2?'infants':a<12?'children':'adults']++);if(counts.adults+counts.children+counts.infants>9||counts.infants>counts.adults)throw Error('El buscador de vuelos admite hasta 9 pasajeros y un bebé por adulto. Revisá los viajeros.');return counts}
  function flightSearch(origin,destination,ida,vuelta,rooms){const t=flightCounts(rooms);if(!/^[A-Z]{3}$/.test(origin)||!/^[A-Z]{3}$/.test(destination)||!/^\d{4}-\d{2}-\d{2}$/.test(ida)||!/^\d{4}-\d{2}-\d{2}$/.test(vuelta)||vuelta<=ida)throw Error('Revisá aeropuertos y fechas.');const fmt=x=>x.slice(8,10)+x.slice(5,7);return origin+fmt(ida)+destination+fmt(vuelta)+t.adults+(t.children||t.infants?String(t.children)+t.infants:'')}
  function matchesOffer(o,rooms){if(!Array.isArray(o.rates)||o.rates.length!==rooms.length)return false;const seen=new Set();return o.rates.every((r,i)=>{const number=Number(r.occupancyNumber||i+1),wanted=rooms[number-1];if(!wanted||seen.has(number))return false;seen.add(number);return Number(r.adultCount)===wanted.adults&&Number(r.childCount||0)===wanted.children&&JSON.stringify(r.childrenAges||[])===JSON.stringify(wanted.childAges)})}
  function internalUrl(value,pathname){try{const u=new URL(value,root.location.origin);return u.origin===root.location.origin&&u.pathname===pathname?u.pathname+u.search:''}catch{return ''}}
  const api={normalize,fromParams,totals,apply,summary,flightCounts,flightSearch,matchesOffer,internalUrl};
  root.ValijeandoParty=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
