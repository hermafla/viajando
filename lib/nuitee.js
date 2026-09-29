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
  const rates=source.map((r,i)=>({occupancyNumber:Number(r.occupancyNumber||i+1),adultCount:r.adultCount,childCount:Number(r.childCount||0),childrenAges:r.childrenAges||[],mappedRoomId:r.mappedRoomId||null,roomName:r.name||r.roomName||'Habitación',boardName:r.boardName||'',maxOccupancy:r.maxOccupancy||null,cancellationPolicies:r.cancellationPolicies||room.cancellationPolicies||{}}));
  const values=source.map(r=>moneyNumber(r.retailRate?.total)),total=moneyNumber(room.offerRetailRate)??(values.every(v=>v!=null)?roundMoney(values.reduce((s,v)=>s+v,0)):null);
  if(total==null||total<=0||!room.offerId)return null;
  const fees=source.flatMap(r=>Array.isArray(r.retailRate?.taxesAndFees)?r.retailRate.taxesAndFees:Array.isArray(r.taxesAndFees)?r.taxesAndFees:[]).map(f=>({name:f.name||f.type||'Impuesto o cargo',amount:moneyNumber(f.amount??f.value??f.total)||0,included:f.included===true,currency:f.currency||currency})).filter(f=>f.amount>0);
  const dueAtProperty=roundMoney(fees.filter(f=>!f.included&&f.currency===currency).reduce((s,f)=>s+f.amount,0));
  const cancellationPolicies=rates.length===1?rates[0].cancellationPolicies:{refundableTag:rates.every(r=>r.cancellationPolicies.refundableTag==='RFN')?'RFN':'NRFN',rooms:rates.map(r=>r.cancellationPolicies)};
  return {offerId:room.offerId,retailRate:total,currency,rates,rooms:rates.length,roomName:rates.map(r=>r.roomName).join(' + '),boardName:[...new Set(rates.map(r=>r.boardName))].join(' · '),mappedRoomId:rates[0].mappedRoomId,fees,dueAtProperty,estimatedTotal:roundMoney(total+dueAtProperty),includedFees:roundMoney(fees.filter(f=>f.included).reduce((s,f)=>s+f.amount,0)),refundableTag:cancellationPolicies.refundableTag||'',cancellationPolicies,suggestedSellingPrice:moneyNumber(room.suggestedSellingPrice),paymentTypes:source.flatMap(r=>r.paymentTypes||[]),commissionAmount:roundMoney(source.flatMap(r=>r.commission||[]).reduce((s,c)=>s+(moneyNumber(c)||0),0))};
}
