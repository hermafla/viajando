(function(root){
  function details(offer){
    const currency=String(offer?.currency||'USD').toUpperCase();
    const current=Number(offer?.retailRate);
    const initialPrice=Number(offer?.offerInitialPrice);
    const suggestedSellingPrice=Number(offer?.suggestedSellingPrice);
    const hasInitialDiscount=Number.isFinite(initialPrice)&&initialPrice>0&&Number.isFinite(current)&&current>0&&initialPrice>current+0.009;
    const hasSuggestedPriceDiscount=!hasInitialDiscount&&Number.isFinite(suggestedSellingPrice)&&suggestedSellingPrice>0&&Number.isFinite(current)&&current>0&&suggestedSellingPrice>current+0.009;
    const original=hasInitialDiscount?initialPrice:hasSuggestedPriceDiscount?suggestedSellingPrice:null;
    const hasPriceDiscount=original!=null;
    const promotions=[...new Map((Array.isArray(offer?.promotions)?offer.promotions:[])
      .filter(p=>p&&typeof p==='object')
      .map(p=>[String(p.name||p.promotionCode||JSON.stringify(p)),p])).values()];
    const names=[...new Set(promotions.map(p=>String(p.name||'').trim()).filter(Boolean))];
    return {currency,original,current,hasPriceDiscount,referenceLabel:hasSuggestedPriceDiscount?'Precio de referencia Nuitee':'Antes',percent:hasPriceDiscount?Math.round((original-current)/original*100):null,saved:hasPriceDiscount?Math.round((original-current+Number.EPSILON)*100)/100:0,promotions,names};
  }
  function markup(offer,money,esc){
    const d=details(offer);
    if(!d.hasPriceDiscount&&!d.promotions.length)return '';
    const label=d.hasPriceDiscount
      ?'<span class="provider-discount-badge">'+(d.referenceLabel==='Antes'?'Descuento aplicado':d.percent+'% menos')+'</span><span>'+esc(d.referenceLabel)+' <s>'+esc(money(d.original,d.currency))+'</s> · precio Valijeando <strong>'+esc(money(d.current,d.currency))+'</strong> · diferencia '+esc(money(d.saved,d.currency))+(d.percent>0?' ('+d.percent+'%)':'')+'</span>'
      :'<span class="provider-discount-badge">Promoción disponible</span>';
    const promotion=d.names.length?'<span class="provider-discount-name">'+esc(d.names.join(' · '))+'</span>':'';
    return '<div class="provider-discount">'+label+promotion+'</div>';
  }
  const api={details,markup};root.ValijeandoDiscount=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
