'use strict';
/* Screen sharing permission is a teacher switch; classroom connection stays automatic.
   Every capture still requires a student's own browser permission click. */
(function(){
 function init(){
  const button=document.getElementById('cpShareEnabled');
  const roomControl=document.getElementById('endClass');
  if(!button||!roomControl)return;
  function refresh(){
   const ready=!roomControl.disabled&&!!window.ClassPointerSharing;
   button.disabled=!ready;
   const enabled=ready&&window.ClassPointerSharing.enabled();
   button.setAttribute('aria-pressed',String(enabled));
   button.textContent=enabled?'Disable student sharing':'Enable student sharing';
   button.classList.toggle('cp-sharing-on',enabled);
  }
  const observer=new MutationObserver(refresh);
  observer.observe(roomControl,{attributes:true,attributeFilter:['disabled']});
  const studentBoards=document.getElementById('studentBoards');
  if(studentBoards)observer.observe(studentBoards,{attributes:true,attributeFilter:['aria-pressed']});
  document.addEventListener('classpointer:sharing-state',refresh);
  button.addEventListener('click',()=>{
   if(button.disabled||!window.ClassPointerSharing)return;
   const next=!window.ClassPointerSharing.enabled();
   button.disabled=true;
   try{if(next)window.ClassPointerSharing.enable();else window.ClassPointerSharing.disable()}
   finally{refresh()}
  });
  refresh();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();