(function(){
  const header=document.querySelector('header[data-valijeando-header]');
  if(!header)return;
  header.innerHTML=`<div class="vh-inner">
    <a class="vh-brand" href="/" aria-label="Valijeando, inicio"><span class="vh-logo-frame"><img src="/valijeando-logo-original.png" alt="" width="58" height="58"></span><span class="vh-brand-copy"><span class="vh-wordmark">Valije<span>ando</span></span><span class="vh-tagline">BUSCÁ · COMPARÁ · VIAJÁ</span></span></a>
    <nav class="vh-links" id="vh-navigation" aria-label="Navegación principal">
      <a class="vh-link" href="/hoteles.html" data-section="hoteles">Hoteles</a>
      <a class="vh-link" href="https://vuelos.valijeando.com.ar/" data-section="vuelos">Vuelos</a>
      <a class="vh-link" href="/servicios.html#traslados" data-section="traslados">Traslados</a>
      <a class="vh-link" href="/servicios.html#actividades" data-section="actividades">Actividades</a>
      <a class="vh-link" href="/servicios.html#asistencia" data-section="asistencia">Asistencia al viajero</a>
      <a class="vh-link" href="/servicios.html#autos" data-section="autos">Alquiler de autos</a>
      <details class="vh-more"><summary>Más</summary><div class="vh-more-panel"><a href="/servicios.html#esim" data-section="esim">eSIM e internet</a><a href="/#buscar">Viaje completo</a><a href="/guias.html">Guías para viajar</a><a href="/consejos.html">Consejos</a><a href="/#destinos">Destinos</a><a href="/#porque">¿Por qué Valijeando?</a></div></details>
    </nav>
    <a class="vh-account" href="/mi-cuenta.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="7" r="4"></circle><path d="M3.5 22v-2a8.5 8.5 0 0 1 17 0v2"></path></svg>Mi cuenta</a>
    <button class="vh-menu-button" type="button" aria-label="Abrir menú" aria-controls="vh-navigation" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"></path></svg></button>
  </div>`;
  const nav=header.querySelector('.vh-links'),button=header.querySelector('.vh-menu-button'),more=header.querySelector('.vh-more');
  const closeMenu=()=>{nav.classList.remove('is-open');button.setAttribute('aria-expanded','false');button.setAttribute('aria-label','Abrir menú');more.open=false};
  button.addEventListener('click',()=>{const open=nav.classList.toggle('is-open');button.setAttribute('aria-expanded',String(open));button.setAttribute('aria-label',open?'Cerrar menú':'Abrir menú')});
  header.addEventListener('click',e=>{if(e.target.closest('a'))closeMenu()});
  document.addEventListener('click',e=>{if(!header.contains(e.target))closeMenu()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&(nav.classList.contains('is-open')||more.open)){closeMenu();button.offsetParent!==null?button.focus():more.querySelector('summary').focus()}});
  const media=window.matchMedia('(min-width:1021px)');media.addEventListener('change',closeMenu);
  const setActive=()=>{
    header.querySelectorAll('[aria-current]').forEach(a=>a.removeAttribute('aria-current'));
    const page=location.pathname.split('/').pop(),hotelPages=['hoteles.html','hotel.html','reserva-hotel.html'],section=hotelPages.includes(page)?'hoteles':page==='vuelos.html'?'vuelos':page==='servicios.html'?location.hash.slice(1):'';
    const active=Array.from(header.querySelectorAll('[data-section]')).find(a=>a.dataset.section===section);if(active)active.setAttribute('aria-current','page');
    if(page==='mi-cuenta.html'||page==='reserva.html')header.querySelector('.vh-account').setAttribute('aria-current','page');
  };
  setActive();window.addEventListener('hashchange',setActive);
})();
