'use strict';
(function(){
  const stage=document.getElementById('stage'),enter=document.getElementById('fullScreenLesson'),exit=document.getElementById('exitFullScreenLesson');
  function expanded(){return document.fullscreenElement===stage||stage.classList.contains('lesson-fullscreen')}
  function sync(){const active=expanded();exit.hidden=!active;enter.setAttribute('aria-expanded',String(active));if(!active)enter.focus()}
  function fallback(){stage.classList.add('lesson-fullscreen');document.body.classList.add('lesson-expanded');sync()}
  enter.addEventListener('click',async()=>{
    if(expanded())return;
    if(stage.requestFullscreen){try{await stage.requestFullscreen();sync();return}catch{}}
    fallback();
  });
  async function close(){
    if(document.fullscreenElement===stage){try{await document.exitFullscreen()}catch{return}}
    stage.classList.remove('lesson-fullscreen');document.body.classList.remove('lesson-expanded');sync();
  }
  // The exit button must never place a pointer or start a highlight on the lesson.
  ['pointerdown','pointermove','pointerup','pointercancel'].forEach(type=>exit.addEventListener(type,event=>event.stopPropagation()));
  exit.addEventListener('click',event=>{event.stopPropagation();close()});
  document.addEventListener('fullscreenchange',sync);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&stage.classList.contains('lesson-fullscreen'))close()});
})();
