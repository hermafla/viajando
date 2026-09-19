export default async function handler(req,res){
 if(req.method!=="POST")return res.status(405).json({ok:false,error:"Método no permitido"});
 const token=process.env.TRAVELPAYOUTS_TOKEN,trs=Number(process.env.TRAVELPAYOUTS_PROJECT_ID),marker=Number(process.env.TRAVELPAYOUTS_PARTNER_ID);
 if(!token||!trs||!marker)return res.status(500).json({ok:false,error:"Falta configurar Travelpayouts en Vercel"});
 const url=String(req.body?.url||""),sub_id=String(req.body?.sub_id||"viajando_vuelos");
 if(!/^https:\/\/(www\.)?aviasales\.com\//i.test(url))return res.status(400).json({ok:false,error:"URL no permitida"});
 try{const r=await fetch("https://api.travelpayouts.com/links/v1/create",{method:"POST",headers:{"Content-Type":"application/json","X-Access-Token":token},body:JSON.stringify({trs,marker,shorten:true,links:[{url,sub_id}]})});const data=await r.json(),item=data?.result?.links?.[0];if(!r.ok||!item||item.code!=="success"||!item.partner_url)return res.status(r.status||502).json({ok:false,error:"No se pudo generar el enlace afiliado"});return res.status(200).json({ok:true,partner_url:item.partner_url})}catch(e){return res.status(500).json({ok:false,error:"No se pudo conectar con Travelpayouts"})}
}