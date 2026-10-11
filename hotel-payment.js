(function(){
  'use strict';
  if(!data||data.paymentMethod!=='TRANSACTION_ID')return;
  const container=document.createElement('section');
  container.id='hotelPayment';container.hidden=true;container.innerHTML='<h2 class="formTitle">Pago de tu alojamiento</h2><p>El pago se procesa en dólares (USD). Los cargos a pagar en el alojamiento se abonan por separado.</p><div id="hotelPaymentForm"></div>';
  form.after(container);
  const returnKey='valijeandoPaymentReturn:'+data.prebookId;
  let paymentMounted=false,finalizing=false;
  function saveContact(){
    return {checkoutToken:data.checkoutToken,firstName:document.getElementById('firstName').value,lastName:document.getElementById('lastName').value,email:document.getElementById('email').value,phone:document.getElementById('phone').value,roomGuests:rooms.slice(1).map((r,i)=>({firstName:document.getElementById('roomFirst'+i).value,lastName:document.getElementById('roomLast'+i).value}))};
  }
  function loadPaymentSdk(){
    if(window.LiteAPIPayment)return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='https://payment-wrapper.liteapi.travel/dist/liteAPIPayment.js?v=a1';
      script.onload=()=>window.LiteAPIPayment?resolve():reject(Error('No pudimos cargar el formulario de pago.'));
      script.onerror=()=>reject(Error('No pudimos cargar el formulario de pago. Intentá nuevamente.'));
      document.head.append(script);
    });
  }
  async function finalize(){
    if(finalizing||confirmed)return;
    finalizing=true;submit.disabled=true;form.hidden=true;container.hidden=true;
    result.innerHTML='<p>Verificando el pago y la confirmación de tu reserva…</p>';
    try{
      const response=await fetch('/api/nuitee-book',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({checkoutToken:data.checkoutToken})});
      const answer=await response.json();
      if(!response.ok||!answer.bookingId){const error=Error(answer.error||'No pudimos verificar la confirmación.');error.uncertain=answer.reason==='booking_uncertain'||response.status>=500;throw error}
      showConfirmation(answer);
      sessionStorage.removeItem(returnKey);
      // La clave del formulario de pago ya no es necesaria después de confirmar.
      const completed={...data};delete completed.paymentSecret;sessionStorage.setItem('valijeandoCheckout',JSON.stringify(completed));
      history.replaceState(null,'',location.pathname);
    }catch(error){
      const uncertain=error.uncertain!==false;
      result.innerHTML='<div class="err">'+esc(error.message)+(uncertain?'<p>No vuelvas a pagar mientras se verifica la reserva.</p><button class="btn" id="checkHotelConfirmation" type="button">Verificar confirmación</button>':'<p>No se confirmó el alojamiento. Volvé a realizar una búsqueda y revisá el estado del pago con Valijeando.</p>')+'</div>';
      document.getElementById('checkHotelConfirmation')?.addEventListener('click',finalize);
    }finally{finalizing=false}
  }
  form.onsubmit=async event=>{
    event.preventDefault();if(!modeReady||busy||confirmed||paymentMounted)return;
    busy=true;submit.disabled=true;submit.textContent='Preparando el pago…';result.innerHTML='';
    try{
      const response=await fetch('/api/nuitee-prebook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...saveContact(),action:'prepare_payment'})});
      const answer=await response.json();if(!response.ok||!answer.ready)throw Error(answer.error||'No pudimos preparar el pago.');
      await loadPaymentSdk();
      sessionStorage.setItem(returnKey,JSON.stringify({checkoutToken:data.checkoutToken}));
      const returnUrl=new URL('/reserva-hotel.html',location.origin);returnUrl.searchParams.set('pago','confirmado');
      container.hidden=false;form.hidden=true;
      const portal=new window.LiteAPIPayment({publicKey:data.paymentPublicKey,appearance:{theme:'flat'},options:{business:{name:'Valijeando'}},targetElement:'#hotelPaymentForm',secretKey:data.paymentSecret,returnUrl:returnUrl.href});
      await portal.handlePayment();
      paymentMounted=true;
      const paymentRoot=document.getElementById('hotelPaymentForm');
      const localizePayButton=()=>{
        paymentRoot.querySelectorAll('.lp-submit-button').forEach(button=>{
          const label=button.textContent.trim();
          if(label.toLowerCase().startsWith('pay'))button.textContent='Pagar'+label.slice(3);
        });
      };
      const paymentButtonStyle=document.createElement('style');
      paymentButtonStyle.textContent='#hotelPaymentForm .lp-submit-button{width:100%;min-height:48px;background:#f58220;color:#fff;border:0;border-radius:10px;font:700 16px Arial,sans-serif;cursor:pointer}#hotelPaymentForm .lp-submit-button:disabled{opacity:.6;cursor:wait}';
      document.head.append(paymentButtonStyle);
      const paymentButtonObserver=new MutationObserver(localizePayButton);
      paymentButtonObserver.observe(paymentRoot,{childList:true,subtree:true,characterData:true});
      localizePayButton();
    }catch(error){container.hidden=true;form.hidden=false;result.innerHTML='<div class="err">'+esc(error.message)+'</div>';submit.disabled=false;submit.textContent='Ir al pago'}
    finally{busy=false}
  };
  window.valijeandoBookingMode.then(answer=>{
    if(confirmed)return;
    if(!modeReady)return;
    submit.textContent='Ir al pago';
    if(new URLSearchParams(location.search).get('pago')==='confirmado'){
      let pending;try{pending=JSON.parse(sessionStorage.getItem(returnKey)||'null')}catch{}
      if(pending?.checkoutToken===data.checkoutToken)finalize();
      else{submit.disabled=true;result.innerHTML='<div class="err">No encontramos los datos de este pago. Contactá a <a href="mailto:hola@valijeando.com.ar">hola@valijeando.com.ar</a> antes de volver a pagar.</div>'}
    }
  }).catch(()=>{});
})();
