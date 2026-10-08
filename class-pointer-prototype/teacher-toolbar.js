'use strict';
// One compact teacher toolbar right above the lesson. In full screen it floats inside the lesson.
// It drives the original hidden controls (same ids), so classroom.js, highlighting.js and viewport.js are unchanged.
(function(){
  const $=id=>document.getElementById(id);
  const dock=$('teacherDock'),stage=$('stage'),teacherPanel=$('teacherPanel');
  if(!dock||!stage||!teacherPanel)return;
  const toolSel=$('teacherTool'),colorSel=$('teacherColor'),sizeSel=$('teacherSize');
  const home=document.createComment('teacher-dock-home');dock.parentNode.insertBefore(home,dock);
  const icons={target:'◎',arrow:'➤',star:'★',heart:'♥',paw:'🐾',sparkle:'✦'};
  let lastShape=toolSel.value==='highlight'?'target':toolSel.value;

  function setSource(select,value){if(select.value===value)return;select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}))}

  // Color swatches are built from the real color list.
  const swatches=dock.querySelector('.tb-swatches');
  for(const option of colorSel.options){
    const b=document.createElement('button');b.type='button';b.dataset.color=option.value;b.title=option.textContent;b.setAttribute('aria-label',option.textContent);b.style.setProperty('--c',option.value);
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
    else if(b.dataset.mode==='highlight')setSource(toolSel,'highlight');
    else if(b.dataset.shape){lastShape=b.dataset.shape;setSource(toolSel,lastShape);closeMenus()}
    else if(b.dataset.color)setSource(colorSel,b.dataset.color);
    else if(b.dataset.size){setSource(sizeSel,b.dataset.size);if(toolSel.value!=='highlight')setSource(toolSel,'highlight')}
    else return;
    sync();
  });
  $('tbStopShare').addEventListener('click',()=>{$('stopScreen').click();closeMenus()});
  $('tbFullscreen').addEventListener('click',()=>{if(isExpanded()){$('exitFullScreenLesson').click()}else $('fullScreenLesson').click()});
  $('tbCollapse').addEventListener('click',event=>{event.stopPropagation();dock.classList.toggle('collapsed');closeMenus();sync()});

  // Quick keys while the mouse is anywhere on the page (ignored while typing).
  document.addEventListener('keydown',event=>{
    if(dock.hidden||event.ctrlKey||event.metaKey||event.altKey||event.target.closest?.('input,select,textarea'))return;
    const k=event.key.toLowerCase();
    if(k==='p')setSource(toolSel,lastShape);else if(k==='h')setSource(toolSel,'highlight');else if(k==='u'){$('undoTeacherHighlight').click()}else return;
    sync();
  });

  // The share-view controls (area/zoom/move) are created by viewport.js while sharing; keep them in the View menu.
  function adoptViewControls(){
    const slot=$('tbViewSlot');
    for(const view of document.querySelectorAll('.share-view-controls'))if(view.parentNode!==slot)slot.appendChild(view);
    $('tbViewWrap').hidden=!$('tbViewSlot').querySelector('.share-view-controls')&&$('stopScreen').disabled;
  }
  new MutationObserver(adoptViewControls).observe(document.body,{childList:true,subtree:true});

  // Inside the lesson the toolbar must never place a pointer or start a drawing.
  ['pointerdown','pointermove','pointerup','pointercancel','click'].forEach(type=>dock.addEventListener(type,event=>{if(stage.contains(dock))event.stopPropagation()}));
  dock.addEventListener('pointerenter',()=>{if(stage.contains(dock))stage.dispatchEvent(new PointerEvent('pointerleave'))});

  function isExpanded(){return document.fullscreenElement===stage||stage.classList.contains('lesson-fullscreen')}
  function place(){
    const inside=isExpanded();
    if(inside&&dock.parentNode!==stage)stage.appendChild(dock);
    else if(!inside&&dock.parentNode===stage){home.parentNode.insertBefore(dock,home.nextSibling);dock.classList.remove('collapsed')}
    dock.classList.toggle('floating',inside);
    $('tbFullscreen').textContent=inside?'✕':'⛶';$('tbFullscreen').title=inside?'Exit full screen':'Full screen';
  }

  function sync(){
    const teacher=!teacherPanel.hidden;
    dock.hidden=!teacher;document.body.classList.toggle('teacher-view',teacher);
    if(!teacher)return;
    place();
    const tool=toolSel.value,highlight=tool==='highlight';
    if(!highlight)lastShape=tool;
    $('tbPointIcon').textContent=icons[lastShape]||'◎';
    dock.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===(highlight?'highlight':'point'))));
    dock.querySelectorAll('[data-shape]').forEach(b=>b.classList.toggle('active',b.dataset.shape===lastShape));
    dock.querySelectorAll('[data-color]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.color===colorSel.value)));
    dock.querySelectorAll('[data-size]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.size===sizeSel.value)));
    dock.querySelector('.tb-sizes').classList.toggle('dim',!highlight);
    dock.querySelectorAll('[data-mode],[data-menu="tbShapeMenu"],[data-shape]').forEach(b=>b.disabled=toolSel.disabled);
    dock.querySelectorAll('[data-color]').forEach(b=>b.disabled=colorSel.disabled);
    dock.querySelectorAll('[data-size]').forEach(b=>b.disabled=sizeSel.disabled);
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
