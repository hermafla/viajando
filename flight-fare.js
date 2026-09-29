(function(root){
  function parsePrice(text,defaultCurrency='USD'){
    const clean=String(text||'').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'').replace(/\u00a0/g,' ').trim();
    const m=clean.match(/^(USD|US\$|ARS|EUR|\$|€)\s*([0-9]+(?:[ .][0-9]{3})*(?:,[0-9]{1,2})?)$/i);
    if(!m)return null;
    const value=Number(m[2].replace(/[ .]/g,'').replace(',','.'));
    const symbol=m[1].toUpperCase(),currency=symbol==='€'?'EUR':symbol==='US$'?'USD':symbol==='$'?defaultCurrency:symbol;
    return Number.isFinite(value)&&value>0?{value,currency}:null;
  }
  function selectedOffer(anchor){
    if(!anchor)return null;
    let redirect;try{redirect=new URL(anchor.href);if(redirect.protocol!=='https:'||redirect.hostname!=='tpscr.com'||redirect.pathname!=='/wl/redirect')return null}catch{return null}
    // Este contenedor pertenece a una sola oferta del proveedor pulsado.
    const card=anchor.closest('[class*="ProposaCard-module__wrapper"]');
    if(!card||card.querySelectorAll('a[href*="tpscr.com/wl/redirect"]').length!==1)return null;
    const price=card.querySelector('[class*="ProposaCard-module__price"]');
    if(!price)return null;
    const fare=parsePrice(price.textContent);
    return fare?{...fare,provider:redirect.searchParams.get('gate_name')||'Proveedor',redirect_url:redirect.href}:null;
  }
  const api={parsePrice,selectedOffer};root.ValijeandoFare=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
