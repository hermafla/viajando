(function(root){
  const round=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;
  const estimate=(amount,countryCode)=>String(countryCode||'').toUpperCase()==='AR'&&Number.isFinite(Number(amount))&&Number(amount)>0?round(Number(amount)*0.21):0;
  const styles=()=>{
    if(document.getElementById('valijeando-hotel-tax-style'))return;
    const style=document.createElement('style');
    style.id='valijeando-hotel-tax-style';
    style.textContent='.iva-estimate{margin-top:10px;padding:10px 12px;border:1px solid #d7e7f4;border-radius:10px;background:#f2f8fd;color:#23415f;font-size:13px;line-height:1.45}.iva-estimate strong{color:#07558f}.iva-estimate small{display:block;color:#53677b;margin-top:3px}.iva-estimate .iva-total{margin-top:5px;font-weight:800;color:#07558f}';
    document.head.appendChild(style);
  };
  const line=(amount,total,money,vatAlreadyDue=0)=>{
    amount=Number(amount)||0;
    if(amount<=0)return '';
    styles();
    const remaining=Math.max(0,amount-(Number(vatAlreadyDue)||0));
    const providerNote=Number(vatAlreadyDue)>0?'<small>El proveedor ya informa '+money(vatAlreadyDue)+' de IVA para pagar en el alojamiento; se descuenta de este total de referencia.</small>':'';
    return '<div class="iva-estimate"><div><strong>IVA estimado (21%): '+money(amount)+'</strong> · posible pago en el hotel</div><small>Estimación preventiva sobre la tarifa. El alojamiento confirma si corresponde y el importe final.</small>'+providerNote+'<div class="iva-total">Total de referencia con IVA estimado: '+money((Number(total)||0)+remaining)+'</div></div>';
  };
  const rateLine=(offer,money)=>line(offer?.argentinaVatEstimate??estimate(offer?.retailRate,offer?.countryCode),offer?.estimatedTotal??offer?.retailRate,money,offer?.argentinaVatDueAtProperty);
  const decorateResults=(container,hotels,money)=>{
    const cards=container.querySelectorAll('.card');
    cards.forEach((card,index)=>{
      const hotel=hotels[index];
      if(!hotel)return;
      const amount=hotel.argentinaVatEstimate??estimate(hotel.retailRate,hotel.countryCode);
      const box=card.querySelector('.price');
      if(box&&amount>0)box.insertAdjacentHTML('beforeend',line(amount,hotel.estimatedTotal??hotel.retailRate,money,hotel.argentinaVatDueAtProperty));
    });
  };
  const checkoutLine=(amount,total,money,vatAlreadyDue)=>line(amount,total,money,vatAlreadyDue);
  root.ValijeandoHotelTax={estimate,line,rateLine,decorateResults,checkoutLine};
})(window);
