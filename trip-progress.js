(function(){
  const header=document.querySelector('header'),steps=document.querySelector('.pasos');
  if(!header||!steps)return;
  const update=()=>{
    document.documentElement.style.setProperty('--trip-header-height',header.getBoundingClientRect().height+'px');
    document.documentElement.style.setProperty('--trip-progress-height',steps.getBoundingClientRect().height+'px');
  };
  update();
  if(typeof ResizeObserver==='function'){
    const observer=new ResizeObserver(update);
    observer.observe(header);observer.observe(steps);
  }else window.addEventListener('resize',update);
})();
