/* Use the actual containing block rather than assuming fixed == viewport. */
(function(){
  'use strict';
  let queued=false;
  function clamp(menu){
    if(menu.hidden||!menu.getClientRects().length)return;
    const r=menu.getBoundingClientRect(),gap=8;
    const x=Math.max(gap,Math.min(innerWidth-r.width-gap,r.left));
    const y=Math.max(gap,Math.min(innerHeight-r.height-gap,r.top));
    // Move by the difference in viewport coordinates. This also works inside
    // a transformed toolbar, where position:fixed uses a local containing block.
    if(Math.abs(x-r.left)>.5||Math.abs(y-r.top)>.5){
      const css=getComputedStyle(menu),left=parseFloat(css.left),top=parseFloat(css.top);
      menu.style.right='auto';menu.style.bottom='auto';
      menu.style.left=(Number.isFinite(left)?left:menu.offsetLeft)+x-r.left+'px';
      menu.style.top=(Number.isFinite(top)?top:menu.offsetTop)+y-r.top+'px';
    }
  }
  function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;document.querySelectorAll('.tb-menu:not([hidden])').forEach(clamp)})}
  new MutationObserver(schedule).observe(document.body,{subtree:true,attributes:true,attributeFilter:['hidden','class','style'],childList:true});
  window.addEventListener('resize',schedule);document.addEventListener('fullscreenchange',schedule);
  window.ClassPointerMenuViewport={clamp};
})();
