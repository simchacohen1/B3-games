'use strict';
// Makes the lesson fill the browser window (it never asks the browser for real full screen).
// The drawing toolbar (annotation-toolbar.js) floats over the lesson, so no tools have to move into it.
(function(){
  const stage=document.getElementById('stage'),enter=document.getElementById('fullScreenLesson'),exit=document.getElementById('exitFullScreenLesson');
  exit.dataset.stageUi='true';
  function expanded(){return document.fullscreenElement===stage||stage.classList.contains('lesson-fullscreen')}
  function sync(){const active=expanded();exit.hidden=!active;enter.setAttribute('aria-expanded',String(active))}
  function fallback(){stage.classList.add('lesson-fullscreen');document.body.classList.add('lesson-expanded');sync()}
  // Capturing a screen must not change the teacher's layout automatically.
  document.addEventListener('class-pointer-capture-ready',()=>sync());
  enter.addEventListener('click',async()=>{
    if(expanded())return;
    // Maximize only within the browser viewport; preserve tabs and address bar.
    fallback();
  });
  async function close(){
    stage.classList.remove('lesson-fullscreen');document.body.classList.remove('lesson-expanded');sync();enter.focus();
  }
  // The Restore button sits inside the lesson: it must never place a pointer or start a highlight.
  ['pointerdown','pointermove','pointerup','pointercancel','click'].forEach(type=>exit.addEventListener(type,event=>event.stopPropagation()));
  exit.addEventListener('click',event=>{event.stopPropagation();close()});
  document.addEventListener('fullscreenchange',sync);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&stage.classList.contains('lesson-fullscreen'))close()});
})();
