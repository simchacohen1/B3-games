'use strict';
// Teacher page plumbing for the drawing toolbar (annotation-toolbar.js + classroom-annotate.js).
// The old dock above the lesson is gone. What stays here:
//  - the page gets the class "teacher-view" while the teacher panel shows (the teacher layout depends on it);
//  - the share-view buttons that viewport.js creates while a screen is shared (choose area, zoom, move) are kept
//    in the hidden #tbViewSlot. The toolbar's Lesson menu clicks them by id.
(function(){
  if(window.ClassPointerBlocked)return;
  if(new URL(location.href).searchParams.get('room'))return;
  const teacherPanel=document.getElementById('teacherPanel'),slot=document.getElementById('tbViewSlot');
  if(!teacherPanel)return;
  function sync(){document.body.classList.toggle('teacher-view',!teacherPanel.hidden)}
  new MutationObserver(sync).observe(teacherPanel,{attributes:true,attributeFilter:['hidden']});
  sync();
  if(!slot)return;
  function adoptViewControls(){for(const view of document.querySelectorAll('.share-view-controls'))if(view.parentNode!==slot)slot.appendChild(view)}
  new MutationObserver(adoptViewControls).observe(document.body,{childList:true,subtree:true});
  adoptViewControls();
})();

