'use strict';
// One compact teacher toolbar right above the lesson. In full screen it floats inside the lesson.
// It drives the original hidden controls (same ids), so classroom.js, highlighting.js and viewport.js are unchanged.
(function(){
  const studentView=!!new URL(location.href).searchParams.get('room');
  const source=id=>document.getElementById(id);
  if(studentView){
    const copy=source('teacherDock').cloneNode(true);copy.id='studentDock';copy.setAttribute('aria-label','My lesson tools');
    copy.querySelector('.tb-toggle').closest('.tb-group').remove();
    copy.querySelector('[data-mode="eraser"]')?.remove();
    copy.querySelector('#tbViewWrap').remove();copy.querySelector('#tbStudentsBtn').closest('.tb-menu-wrap').remove();
    const clear=copy.querySelector('#tbClearMenu');clear.replaceChildren();
    const clearButton=document.createElement('button');clearButton.type='button';clearButton.textContent='My drawings';clearButton.addEventListener('click',()=>source('clearStudentHighlights').click());clear.appendChild(clearButton);
    copy.querySelector('#undoTeacherHighlight').addEventListener('click',()=>source('undoStudentHighlight').click());
    for(const el of copy.querySelectorAll('[id]'))el.id='student-'+el.id;
    for(const el of copy.querySelectorAll('[data-menu]'))el.dataset.menu='student-'+el.dataset.menu;
    source('teacherDock').after(copy);
  }
  const $=id=>source(studentView&&id.startsWith('tb')?'student-'+id:id);
  const dock=$(studentView?'studentDock':'teacherDock'),stage=$('stage'),teacherPanel=$(studentView?'studentPanel':'teacherPanel');
  if(!dock||!stage||!teacherPanel)return;
  const toolSel=$(studentView?'studentTool':'teacherTool'),colorSel=$(studentView?'studentColor':'teacherColor'),sizeSel=$(studentView?'studentSize':'teacherSize');
  const home=document.createComment('teacher-dock-home');dock.parentNode.insertBefore(home,dock);
  const icons={target:'◎',arrow:'➤',star:'★',heart:'♥',paw:'🐾',sparkle:'✦'};
  let lastShape=window.ClassPointerCore.highlightTools.includes(toolSel.value)?'target':toolSel.value;

  function setSource(select,value){if(select.disabled||Array.from(select.options).find(o=>o.value===value)?.disabled||select.value===value)return;select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}))}

  // Color swatches are built from the real color list.
  const swatches=dock.querySelector('.tb-swatches');
  for(const option of colorSel.options){
    const b=document.createElement('button');b.type='button';b.dataset.color=option.value;b.title=option.textContent;b.setAttribute('aria-label',option.textContent);b.style.setProperty('--c',option.value||'#ffffff');if(!option.value)b.textContent='↺';
    swatches.appendChild(b);
  }

  // Menus: one open at a time, close on outside click or Escape.
  function closeMenus(except){
    dock.querySelectorAll('.tb-menu').forEach(menu=>{if(menu!==except){menu.hidden=true;dock.querySelector(`[data-menu="${menu.id}"]`)?.setAttribute('aria-expanded','false')}});
  }
  dock.querySelectorAll('[data-menu]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation();const menu=$(button.dataset.menu);const open=menu.hidden;closeMenus(menu);menu.hidden=!open;button.setAttribute('aria-expanded',String(open));
  }));
  document.addEventListener('click',event=>{if(!event.target.closest('.tb-menu-wrap'))closeMenus()});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenus()});
  // Clear actions close their menu after running; roster/access/view menus stay open for several changes.
  $('tbClearMenu').addEventListener('click',event=>{if(event.target.closest('button'))setTimeout(()=>closeMenus(),0)});

  dock.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b||!dock.contains(b))return;
    if(b.dataset.mode==='point')setSource(toolSel,lastShape);
    else if(['highlight','box','pen','eraser'].includes(b.dataset.mode))setSource(toolSel,b.dataset.mode);
    else if(b.dataset.shape){lastShape=b.dataset.shape;setSource(toolSel,lastShape);closeMenus()}
    else if(b.hasAttribute('data-color'))setSource(colorSel,b.dataset.color);
    else if(b.dataset.size){setSource(sizeSel,b.dataset.size);if(!window.ClassPointerCore.highlightTools.includes(toolSel.value))setSource(toolSel,'highlight')}
    else return;
    sync();
  });
  if(!studentView)$('tbStopShare').addEventListener('click',()=>{$('stopScreen').click();closeMenus()});
  $('tbFullscreen').addEventListener('click',()=>{if(isExpanded()){$('exitFullScreenLesson').click()}else $('fullScreenLesson').click()});
  $('tbCollapse').addEventListener('click',event=>{event.stopPropagation();dock.classList.toggle('collapsed');closeMenus();sync()});

  // Share sources remain available in the floating dock, even in expanded teaching mode.
  if(!studentView){
    const shareWrap=document.createElement('div');shareWrap.className='tb-menu-wrap';
    shareWrap.innerHTML='<button type="button" class="tb-btn" data-menu="tbShareMenu" aria-haspopup="true" aria-expanded="false">🖥 Share ▾</button><div class="tb-menu tb-menu-right" id="tbShareMenu" hidden><strong>Share with your class</strong></div>';
    const menu=shareWrap.querySelector('#tbShareMenu');
    [['shareScreen','Live tab, window or screen'],['openBrowserTab','Capture a tab, window or screen'],['openPdf','PDF'],['openWebpage','Web page'],['openWhiteboard','Whiteboard'],['stopScreen','Stop sharing']].forEach(([id,label])=>{
      const button=document.createElement('button');button.type='button';button.textContent=label;
      button.addEventListener('click',()=>{const original=source(id);if(original&&!original.disabled)original.click();menu.hidden=true});
      menu.appendChild(button);
      const original=source(id);if(original)new MutationObserver(()=>{button.disabled=original.disabled}).observe(original,{attributes:true,attributeFilter:['disabled']});
      button.disabled=!original||original.disabled;
    });
    shareWrap.querySelector('[data-menu]').addEventListener('click',event=>{event.stopPropagation();const opening=menu.hidden;closeMenus(menu);menu.hidden=!opening});
    dock.querySelector('#tbStudentsBtn').closest('.tb-menu-wrap').before(shareWrap);
    const panel=source('tbStudentsMenu'),handle=document.createElement('div');
    handle.className='tb-roster-handle';handle.textContent='⠿ Drag student permissions';handle.title='Drag to move this panel';
    panel.prepend(handle);
    let drag=null;
    handle.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;
      event.preventDefault();event.stopPropagation();
      const box=panel.getBoundingClientRect();
      panel.style.position='fixed';panel.style.left=box.left+'px';panel.style.top=box.top+'px';panel.style.right='auto';
      drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:box.left,top:box.top};
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove',event=>{
      if(!drag||drag.id!==event.pointerId)return;
      panel.style.left=Math.max(0,Math.min(innerWidth-panel.offsetWidth,drag.left+event.clientX-drag.x))+'px';
      panel.style.top=Math.max(0,Math.min(innerHeight-panel.offsetHeight,drag.top+event.clientY-drag.y))+'px';
    });
    ['pointerup','pointercancel','lostpointercapture'].forEach(type=>handle.addEventListener(type,()=>{drag=null}));
    window.addEventListener('resize',()=>{
      if(panel.style.left){panel.style.left=Math.max(0,Math.min(innerWidth-panel.offsetWidth,parseFloat(panel.style.left)||0))+'px';
      panel.style.top=Math.max(0,Math.min(innerHeight-panel.offsetHeight,parseFloat(panel.style.top)||0))+'px'}
    });
  }

  // Quick keys while the mouse is anywhere on the page (ignored while typing).
  document.addEventListener('keydown',event=>{
    if(dock.hidden||event.ctrlKey||event.metaKey||event.altKey||event.target.closest?.('input,select,textarea'))return;
    const k=event.key.toLowerCase();
    if(k==='p')setSource(toolSel,lastShape);else if(k==='h')setSource(toolSel,'highlight');else if(k==='b')setSource(toolSel,'box');else if(k==='d')setSource(toolSel,'pen');else if(k==='e'&&!studentView)setSource(toolSel,'eraser');else if(k==='u'){$(studentView?'undoStudentHighlight':'undoTeacherHighlight').click()}else return;
    sync();
  });

  // The share-view controls (area/zoom/move) are created by viewport.js while sharing; keep them in the View menu.
  function adoptViewControls(){
    if(studentView)return;
    const slot=$('tbViewSlot');
    for(const view of document.querySelectorAll('.share-view-controls'))if(view.parentNode!==slot)slot.appendChild(view);
    $('tbViewWrap').hidden=!$('tbViewSlot').querySelector('.share-view-controls')&&$('stopScreen').disabled;
  }
  new MutationObserver(adoptViewControls).observe(document.body,{childList:true,subtree:true});

  // Drag handle remains visible even when the dock is collapsed.
  const moveHandle=document.createElement('button');
  moveHandle.type='button';moveHandle.className='tb-move-handle';moveHandle.textContent='⠿ Move';
  moveHandle.title='Drag to reposition the teaching toolbar';
  moveHandle.setAttribute('aria-label','Drag to move the toolbar');
  moveHandle.style.cssText='order:-1;flex:0 0 auto;cursor:grab;touch-action:none;padding:6px 9px;border-radius:7px';
  dock.prepend(moveHandle);
  let moving=null;
  moveHandle.addEventListener('pointerdown',event=>{
    if(event.button!==0||!isExpanded())return;
    event.preventDefault();event.stopPropagation();
    const rect=dock.getBoundingClientRect(),bounds=stage.getBoundingClientRect();
    moving={id:event.pointerId,dx:event.clientX-rect.left,dy:event.clientY-rect.top};
    dock.style.right='auto';dock.style.bottom='auto';
    dock.style.left=(rect.left-bounds.left)+'px';dock.style.top=(rect.top-bounds.top)+'px';
    moveHandle.setPointerCapture(event.pointerId);moveHandle.style.cursor='grabbing';
  });
  moveHandle.addEventListener('pointermove',event=>{
    if(!moving||event.pointerId!==moving.id)return;
    const bounds=stage.getBoundingClientRect();
    dock.style.left=Math.max(0,Math.min(stage.clientWidth-dock.offsetWidth,event.clientX-bounds.left-moving.dx))+'px';
    dock.style.top=Math.max(0,Math.min(stage.clientHeight-dock.offsetHeight,event.clientY-bounds.top-moving.dy))+'px';
  });
  const stopMoving=()=>{moving=null;moveHandle.style.cursor='grab'};
  ['pointerup','pointercancel','lostpointercapture'].forEach(type=>moveHandle.addEventListener(type,stopMoving));
  moveHandle.addEventListener('click',event=>event.stopPropagation());
  new ResizeObserver(()=>{if(!isExpanded()||!dock.style.left)return;dock.style.left=Math.max(0,Math.min(stage.clientWidth-dock.offsetWidth,parseFloat(dock.style.left)||0))+'px';dock.style.top=Math.max(0,Math.min(stage.clientHeight-dock.offsetHeight,parseFloat(dock.style.top)||0))+'px'}).observe(stage);

  // Inside the lesson the toolbar must never place a pointer or start a drawing.
  ['pointerdown','pointermove','pointerup','pointercancel','click'].forEach(type=>dock.addEventListener(type,event=>{if(stage.contains(dock))event.stopPropagation()}));
  dock.addEventListener('pointerenter',()=>{if(stage.contains(dock))stage.dispatchEvent(new PointerEvent('pointerleave'))});

  function isExpanded(){return document.fullscreenElement===stage||stage.classList.contains('lesson-fullscreen')}
  function place(){
    const inside=isExpanded();
    if(inside&&dock.parentNode!==stage)stage.appendChild(dock);
    else if(!inside&&dock.parentNode===stage){home.parentNode.insertBefore(dock,home.nextSibling);dock.classList.remove('collapsed')}
    dock.classList.toggle('floating',inside);
    $('tbFullscreen').textContent=inside?'⤢ Exit fullscreen':'⛶ Fullscreen';$('tbFullscreen').title=inside?'Exit fullscreen lesson':'Expand lesson to fullscreen';
  }

  function sync(){
    const teacher=!teacherPanel.hidden;
    dock.hidden=!teacher;document.body.classList.toggle(studentView?'student-dock-view':'teacher-view',teacher);
    if(!teacher)return;
    place();
    const tool=toolSel.value,highlight=window.ClassPointerCore.highlightTools.includes(tool),erasing=tool==='eraser';
    if(!highlight)lastShape=tool;
    $('tbPointIcon').textContent=icons[lastShape]||'◎';
    dock.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===((highlight||erasing)?tool:'point'))));
    dock.querySelectorAll('[data-shape]').forEach(b=>b.classList.toggle('active',b.dataset.shape===lastShape));
    dock.querySelectorAll('[data-color]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.color===colorSel.value)));
    dock.querySelectorAll('[data-size]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.size===sizeSel.value)));
    dock.querySelector('.tb-sizes').classList.toggle('dim',!highlight);
    dock.querySelectorAll('[data-mode],[data-menu$="tbShapeMenu"],[data-shape]').forEach(b=>b.disabled=toolSel.disabled||!!Array.from(toolSel.options).find(o=>o.value===b.dataset.mode)?.disabled);
    dock.querySelectorAll('[data-color]').forEach(b=>b.disabled=colorSel.disabled);
    dock.querySelectorAll('[data-size]').forEach(b=>b.disabled=sizeSel.disabled);
    if(studentView)return;
    $('tbStopShare').disabled=$('stopScreen').disabled;
    adoptViewControls();
    const roster=$('roster');
    const waiting=Array.from(roster.querySelectorAll('button')).filter(b=>b.textContent.startsWith('Admit ')).length;
    const total=roster.querySelectorAll('.roster-row').length;
    $('tbStudentsText').textContent=waiting?` ${waiting} waiting`:` Students${total?` (${total-waiting})`:''}`;
    $('tbStudentsBtn').classList.toggle('alert',waiting>0);
  }
  [toolSel,colorSel,sizeSel].forEach(select=>select.addEventListener('change',sync));
  document.addEventListener('fullscreenchange',sync);
  new MutationObserver(sync).observe(stage,{attributes:true,attributeFilter:['class']});
  new MutationObserver(sync).observe(teacherPanel,{attributes:true,attributeFilter:['hidden']});
  // Light polling keeps disabled states and the roster badge current without touching classroom.js.
  setInterval(()=>{if(!dock.hidden)sync()},300);
  sync();
})();
