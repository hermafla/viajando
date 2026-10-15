export const bookingEnvironment=key=>/^(sand_|sandbox_)/.test(String(key||''))?'sandbox':/^prod_/.test(String(key||''))?'production':'unknown';
export const moneyNumber=v=>{if(v==null||v==='')return null;if(Array.isArray(v))return moneyNumber(v[0]);if(typeof v==='object')return moneyNumber(v.amount??v.value??v.total??v.price);const n=Number(v);return Number.isFinite(n)?n:null};
export const roundMoney=n=>Math.round((n+Number.EPSILON)*100)/100;
export function occupanciesFromQuery(query){
  const rooms=query.occupancies?JSON.parse(String(query.occupancies)):[{adults:Number(query.adults||2),children:Number(query.children||0),childAges:[]}];
  if(!Array.isArray(rooms)||!rooms.length||rooms.length>5)throw Error('Elegí entre 1 y 5 habitaciones.');
  return rooms.map(r=>{const adults=Number(r.adults),ages=r.childAges||(Array.isArray(r.children)?r.children:[]),count=Array.isArray(r.children)?r.children.length:Number(r.children??ages.length);if(!Number.isInteger(adults)||adults<1||adults>10||!Array.isArray(ages)||count!==ages.length||ages.length>6||ages.some(a=>!Number.isInteger(a)||a<0||a>17))throw Error('Revisá adultos y edades de los niños en cada habitación.');return {adults,...(ages.length?{children:ages}:{})}});
}
export function mapOffer(room,currency='USD'){
  const source=Array.isArray(room.rates)&&room.rates.length?room.rates:[room];
  const rates=source.map((r,i)=>({
    occupancyNumber:Number(r.occupancyNumber||i+1),adultCount:r.adultCount,childCount:Number(r.childCount||0),childrenAges:r.childrenAges||[],mappedRoomId:r.mappedRoomId||null,roomName:r.name||r.roomName||'Habitación',boardName:r.boardName||'',maxOccupancy:r.maxOccupancy||null,cancellationPolicies:r.cancellationPolicies||room.cancellationPolicies||{},
    initialPrice:moneyNumber(r.retailRate?.initialPrice??r.initialPrice),
    promotions:Array.isArray(r.retailRate?.promotions)?r.retailRate.promotions:Array.isArray(r.promotions)?r.promotions:[],
    perks:Array.isArray(r.perks)?r.perks:[]
  }));
  const values=source.map(r=>moneyNumber(r.retailRate?.total)),total=moneyNumber(room.offerRetailRate)??(values.every(v=>v!=null)?roundMoney(values.reduce((s,v)=>s+v,0)):null);
  if(total==null||total<=0||!room.offerId)return null;
  const initialValues=source.map(r=>moneyNumber(r.retailRate?.initialPrice??r.initialPrice));
  const offerInitialPrice=moneyNumber(room.offerInitialPrice)??(initialValues.every(v=>v!=null)?roundMoney(initialValues.reduce((s,v)=>s+v,0)):null);
  const promotions=[...new Map(source.flatMap(r=>Array.isArray(r.retailRate?.promotions)?r.retailRate.promotions:Array.isArray(r.promotions)?r.promotions:[]).concat(Array.isArray(room.promotions)?room.promotions:[]).filter(p=>p&&typeof p==='object').map(p=>[JSON.stringify([p.name,p.from,p.to,p.discount,p.discountType]),p])).values()];
  const perks=[...new Map(source.flatMap(r=>Array.isArray(r.perks)?r.perks:[]).concat(Array.isArray(room.perks)?room.perks:[]).filter(p=>p&&typeof p==='object').map(p=>[JSON.stringify([p.name,p.level,p.amount,p.currency]),p])).values()];
  const fees=source.flatMap(r=>Array.isArray(r.retailRate?.taxesAndFees)?r.retailRate.taxesAndFees:Array.isArray(r.taxesAndFees)?r.taxesAndFees:[]).map(f=>({name:f.description||f.name||f.type||'Concepto no detallado por el proveedor',amount:moneyNumber(f.amount??f.value??f.total)||0,included:f.included===true,currency:f.currency||currency})).filter(f=>f.amount>0);
  const dueAtProperty=roundMoney(fees.filter(f=>!f.included&&f.currency===currency).reduce((s,f)=>s+f.amount,0));
  const cancellationPolicies=rates.length===1?rates[0].cancellationPolicies:{refundableTag:rates.every(r=>r.cancellationPolicies.refundableTag==='RFN')?'RFN':'NRFN',rooms:rates.map(r=>r.cancellationPolicies)};
  return {offerId:room.offerId,retailRate:total,offerInitialPrice,currency,rates,rooms:rates.length,roomName:rates.map(r=>r.roomName).join(' + '),boardName:[...new Set(rates.map(r=>r.boardName))].join(' · '),mappedRoomId:rates[0].mappedRoomId,fees,dueAtProperty,estimatedTotal:roundMoney(total+dueAtProperty),includedFees:roundMoney(fees.filter(f=>f.included).reduce((s,f)=>s+f.amount,0)),refundableTag:cancellationPolicies.refundableTag||'',cancellationPolicies,suggestedSellingPrice:moneyNumber(room.suggestedSellingPrice),paymentTypes:source.flatMap(r=>r.paymentTypes||[]),commissionAmount:roundMoney(source.flatMap(r=>r.commission||[]).reduce((s,c)=>s+(moneyNumber(c)||0),0)),promotions,perks};
}
export function applyArgentineHotelTaxEstimate(offer,countryCode,guestNationality='AR'){
  if(!offer)return offer;
  const country=String(countryCode||'').toUpperCase(),nationality=String(guestNationality||'').toUpperCase();
  const result={...offer,countryCode:country};
  if(country!=='AR'||nationality!=='AR')return {...result,argentinaVatEstimate:0,argentinaVatDueAtProperty:0};
  const isCityTax=fee=>/(city\s*tax|city\s*fee|municipal\s*tax|impuesto\s+municipal|tasa\s+municipal)/i.test(String(fee.name||''));
  const fees=(Array.isArray(offer.fees)?offer.fees:[]).filter(f=>!isCityTax(f));
  const currency=String(offer.currency||'USD').toUpperCase();
  const dueAtProperty=roundMoney(fees.filter(f=>!f.included&&String(f.currency||currency).toUpperCase()===currency).reduce((s,f)=>s+(moneyNumber(f.amount)||0),0));
  const argentinaVatDueAtProperty=roundMoney(fees.filter(f=>!f.included&&String(f.currency||currency).toUpperCase()===currency&&/(\\bvat\\b|\\biva\\b|value\\s+added\\s+tax)/i.test(String(f.name||''))).reduce((s,f)=>s+(moneyNumber(f.amount)||0),0));
  const retailRate=moneyNumber(offer.retailRate)||0;
  return {...result,fees,dueAtProperty,estimatedTotal:roundMoney(retailRate+dueAtProperty),argentinaVatDueAtProperty,argentinaVatEstimate:roundMoney(retailRate*0.21)};
}
