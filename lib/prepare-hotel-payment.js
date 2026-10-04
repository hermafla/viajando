import { loadCheckout, checkoutDatabase, clean } from './hotel-checkout.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Método no permitido'});
  try{
    const row=await loadCheckout(req.body?.checkoutToken);
    if(!['prepared','ready'].includes(row.state))return res.status(409).json({error:'Este pago ya fue enviado. Revisá la confirmación de tu reserva.',reason:'booking_uncertain'});
    const firstName=clean(req.body.firstName).slice(0,100),lastName=clean(req.body.lastName).slice(0,100),email=clean(req.body.email).toLowerCase(),phone=clean(req.body.phone).slice(0,50);
    if(!firstName||!lastName||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'Completá nombre, apellido y un email válido.'});
    const guests=row.reservation.occupancies.map((room,i)=>({occupancyNumber:i+1,firstName:i?clean(req.body.roomGuests?.[i-1]?.firstName).slice(0,100):firstName,lastName:i?clean(req.body.roomGuests?.[i-1]?.lastName).slice(0,100):lastName,email}));
    if(guests.some(g=>!g.firstName||!g.lastName))return res.status(400).json({error:'Indicá un huésped adulto por habitación.'});
    const changed=await checkoutDatabase('?id=eq.'+encodeURIComponent(row.id)+'&state=in.(prepared,ready)',{method:'PATCH',body:{holder:{firstName,lastName,email,...(phone?{phone}:{})},guests,state:'ready',updated_at:new Date().toISOString()}});
    if(changed?.length!==1)return res.status(409).json({error:'La reserva ya está en proceso.',reason:'booking_uncertain'});
    return res.status(200).json({ready:true});
  }catch{return res.status(503).json({error:'No pudimos preparar el pago. Volvé al hotel y elegí nuevamente tu habitación.'})}
}
