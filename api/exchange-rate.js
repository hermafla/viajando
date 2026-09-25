export default async function handler(req,res){
if(req.method!=='GET')return res.status(405).json({error:'Método no permitido'});
try{
const r=await fetch('https://dolarapi.com/v1/ambito/dolares/bna');
const d=await r.json();
const compra=Number(d&&d.compra),venta=Number(d&&d.venta);
if(!r.ok||!venta)throw new Error('Cotización no disponible');
res.setHeader('Cache-Control','s-maxage=900, stale-while-revalidate=3600');
return res.status(200).json({base:'USD',quote:'ARS',rate:venta,compra,venta,updatedAt:d.fechaActualizacion||null,source:'DolarAPI',reference:'Dólar BNA vendedor según Ámbito Financiero'});
}catch(e){return res.status(502).json({error:'No se pudo obtener la cotización BNA'});}
}