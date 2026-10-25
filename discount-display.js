(function(root){
  function details(offer){
    const currency=String(offer?.currency||'USD').toUpperCase();
    const original=Number(offer?.offerInitialPrice);
    const current=Number(offer?.retailRate);
    const hasPriceDiscount=Number.isFinite(original)&&original>0&&Number.isFinite(current)&&current>0&&original>current+0.009;
    const promotions=[...new Map((Array.isArray(offer?.promotions)?offer.promotions:[])
      .filter(p=>p&&typeof p==='object')
      .map(p=>[String(p.name||p.promotionCode||JSON.stringify(p)),p])).values()];
    const names=[...new Set(promotions.map(p=>String(p.name||'').trim()).filter(Boolean))];
    return {currency,original,current,hasPriceDiscount,percent:hasPriceDiscount?Math.round((original-current)/original*100):null,saved:hasPriceDiscount?Math.round((original-current+Number.EPSILON)*100)/100:0,promotions,names};
  }
  function markup(offer,money,esc){
    const d=details(offer);
    if(!d.hasPriceDiscount&&!d.promotions.length)return '';
    const label=d.hasPriceDiscount
      ?'<span class="provider-discount-badge">Descuento aplicado</span><span>Antes <s>'+esc(money(d.original,d.currency))+'</s> · ahora <strong>'+esc(money(d.current,d.currency))+'</strong> · ahorrás '+esc(money(d.saved,d.currency))+(d.percent>0?' ('+d.percent+'%)':'')+'</span>'
      :'<span class="provider-discount-badge">Promoción disponible</span>';
    const promotion=d.names.length?'<span class="provider-discount-name">'+esc(d.names.join(' · '))+'</span>':'';
    return '<div class="provider-discount">'+label+promotion+'</div>';
  }
  const api={details,markup};root.ValijeandoDiscount=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
