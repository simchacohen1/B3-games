'use strict';
(function(){
  const stage=document.getElementById('stage'),enter=document.getElementById('fullScreenLesson'),exit=document.getElementById('exitFullScreenLesson'),teacherPanel=document.getElementById('teacherPanel');
  const studentView=!!new URL(location.href).searchParams.get('room');
  const legacyStudentView=studentView&&!document.getElementById('studentDock');
  // Teachers use the docked toolbar from teacher-toolbar.js, which follows the lesson into full screen.
  const teacherDock=!!document.getElementById(studentView?'studentDock':'teacherDock');
  let syncTimer=null;
  const toolbar=document.createElement('div');toolbar.id='fullscreenTeacherToolbar';toolbar.className='fullscreen-teacher-toolbar';toolbar.dataset.stageUi='true';toolbar.hidden=true;
  const top=document.createElement('div');top.className='fullscreen-toolbar-top';
  const title=document.createElement('strong');title.textContent=legacyStudentView?'My tools · drag to move':'Teaching controls';
  const collapse=document.createElement('button');collapse.type='button';collapse.className='fullscreen-toolbar-collapse';collapse.textContent='Hide controls';collapse.setAttribute('aria-expanded','true');
  top.append(title,collapse);
  const body=document.createElement('div');body.className='fullscreen-toolbar-body';toolbar.append(top,body);
  // Teacher: the real student roster moves into the full-screen toolbar so admit / pointer / writing / remove all work without leaving full screen.
  const rosterEl=document.getElementById('roster');
  const rosterHome=document.createComment('roster-home');
  const rosterPanel=document.createElement('div');rosterPanel.className='fullscreen-roster-panel';rosterPanel.hidden=true;
  const rosterToggle=document.createElement('button');rosterToggle.type='button';rosterToggle.className='fullscreen-roster-toggle';rosterToggle.textContent='Students';rosterToggle.setAttribute('aria-expanded','false');
  if(!legacyStudentView&&!teacherDock&&rosterEl){
    rosterEl.parentNode.insertBefore(rosterHome,rosterEl);
    const panelTitle=document.createElement('strong');panelTitle.textContent='Students · admit, pointer, writing';
    rosterPanel.append(panelTitle);toolbar.append(rosterPanel);
    top.insertBefore(rosterToggle,collapse);
    rosterToggle.addEventListener('click',event=>{event.stopPropagation();setRosterOpen(rosterPanel.hidden)});
  }
  function setRosterOpen(open){rosterPanel.hidden=!open||toolbar.classList.contains('collapsed');rosterToggle.setAttribute('aria-expanded',String(open));rosterToggle.classList.toggle('active',open)}
  function placeRoster(inFullscreen){
    if(legacyStudentView||teacherDock||!rosterEl)return;
    if(inFullscreen){if(rosterEl.parentNode!==rosterPanel)rosterPanel.appendChild(rosterEl)}
    else if(rosterHome.parentNode&&rosterEl.parentNode!==rosterHome.parentNode){rosterHome.parentNode.insertBefore(rosterEl,rosterHome.nextSibling);setRosterOpen(false)}
  }
  function updateRosterToggle(){
    if(legacyStudentView||teacherDock||!rosterEl)return;
    const waiting=Array.from(rosterEl.querySelectorAll('button')).filter(b=>b.textContent.startsWith('Admit ')).length;
    const admittedCount=rosterEl.querySelectorAll('.roster-row').length-waiting;
    rosterToggle.textContent=waiting?`Students · ${waiting} waiting`:`Students (${admittedCount})`;
    rosterToggle.classList.toggle('alert',waiting>0);
  }
  stage.appendChild(toolbar);exit.dataset.stageUi='true';

  const proxySpecs=legacyStudentView?[
    {source:'studentTool',label:'Tool',type:'select'},
    {source:'studentColor',label:'Color',type:'select'},
    {source:'studentSize',label:'Size',type:'select'},
    {source:'undoStudentHighlight',label:'Undo',type:'button'},
    {source:'clearStudentHighlights',label:'Clear mine',type:'button'}
  ]:[
    {source:'teacherTool',label:'Tool',type:'select'},
    {source:'teacherColor',label:'Color',type:'select'},
    {source:'teacherSize',label:'Size',type:'select'},
    {source:'accessMode',label:'Students',type:'select'},
    {source:'spotlight',label:'Spotlight',type:'check'},
    {source:'viewChooseArea',label:'Choose area',type:'button',share:true},
    {source:'viewShareFull',label:'Full view',type:'button',share:true},
    {source:'viewZoomOut',label:'Zoom −',type:'button',share:true},
    {source:'viewZoomIn',label:'Zoom +',type:'button',share:true},
    {source:'viewMove',label:'Move',type:'button',share:true},
    {source:'undoTeacherHighlight',label:'Undo',type:'button'},
    {source:'clearTeacherHighlights',label:'Clear mine',type:'button'},
    {source:'clearAllHighlights',label:'Clear highlights',type:'button'},
    {source:'clearTeacher',label:'Clear pointer',type:'button'},
    {source:'clearAll',label:'Clear pointers',type:'button'},
    {source:'stopScreen',label:'Stop sharing',type:'button',danger:true}
  ];
  const proxies=new Map();

  function build(){
    body.replaceChildren();proxies.clear();
    for(const spec of proxySpecs){
      const source=document.getElementById(spec.source);
      if(!source)continue;
      const wrap=document.createElement(spec.type==='check'?'label':'div');wrap.className='fullscreen-toolbar-control';wrap.dataset.source=spec.source;
      if(spec.share)wrap.classList.add('share-control');
      if(spec.type==='select'){
        const text=document.createElement('span');text.textContent=spec.label;
        const proxy=document.createElement('select');proxy.innerHTML=source.innerHTML;proxy.setAttribute('aria-label',spec.label);
        proxy.addEventListener('change',()=>{source.value=proxy.value;source.dispatchEvent(new Event('change',{bubbles:true}))});
        wrap.append(text,proxy);proxies.set(spec.source,proxy);
      }else if(spec.type==='check'){
        const proxy=document.createElement('input');proxy.type='checkbox';
        proxy.addEventListener('change',()=>{source.checked=proxy.checked;source.dispatchEvent(new Event('change',{bubbles:true}))});
        wrap.append(proxy,document.createTextNode(' '+spec.label));proxies.set(spec.source,proxy);
      }else{
        const proxy=document.createElement('button');proxy.type='button';proxy.textContent=spec.label;if(spec.danger)proxy.classList.add('danger');
        proxy.addEventListener('click',()=>source.click());wrap.append(proxy);proxies.set(spec.source,proxy);
      }
      body.appendChild(wrap);
    }
    const zoom=document.createElement('span');zoom.className='fullscreen-zoom-readout';zoom.dataset.source='viewZoomLabel';body.appendChild(zoom);proxies.set('viewZoomLabel',zoom);
    syncControls();
  }
  function syncControls(){
    for(const spec of proxySpecs){
      const source=document.getElementById(spec.source),proxy=proxies.get(spec.source),wrap=proxy?.closest?.('.fullscreen-toolbar-control');
      if(!proxy||!wrap)continue;
      const available=!!source;
      wrap.hidden=!available;
      if(!available)continue;
      if(spec.type==='select'){proxy.value=source.value;proxy.disabled=source.disabled;for(const option of proxy.options){const original=Array.from(source.options).find(item=>item.value===option.value);option.disabled=original?.disabled||false}}
      else if(spec.type==='check'){proxy.checked=source.checked;proxy.disabled=source.disabled}
      else{proxy.disabled=source.disabled;proxy.classList.toggle('active',source.classList.contains('active')||source.getAttribute('aria-pressed')==='true')}
    }
    const zoomSource=document.getElementById('viewZoomLabel'),zoomProxy=proxies.get('viewZoomLabel');
    if(zoomProxy){zoomProxy.hidden=!zoomSource;zoomProxy.textContent=zoomSource?.textContent||''}
    updateRosterToggle();
  }
  function expanded(){return document.fullscreenElement===stage||stage.classList.contains('lesson-fullscreen')}
  function teacherView(){return !teacherDock&&teacherPanel&&!teacherPanel.hidden}
  function startSync(){clearInterval(syncTimer);syncTimer=setInterval(syncControls,200)}
  function stopSync(){clearInterval(syncTimer);syncTimer=null}
  function sync(){
    const active=expanded();exit.hidden=!active;enter.setAttribute('aria-expanded',String(active));
    toolbar.hidden=!(legacyStudentView||(active&&teacherView()));
    placeRoster(active&&teacherView());
    if(legacyStudentView||(active&&teacherView())){build();startSync()}else{stopSync();if(!active)enter.focus()}
  }
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
  collapse.addEventListener('click',event=>{
    event.stopPropagation();const collapsed=toolbar.classList.toggle('collapsed');body.hidden=collapsed;collapse.textContent=collapsed?'Show controls':'Hide controls';collapse.setAttribute('aria-expanded',String(!collapsed));
    if(collapsed)rosterPanel.hidden=true;else if(rosterToggle.getAttribute('aria-expanded')==='true')rosterPanel.hidden=false;
  });
  // UI inside the lesson must never place a pointer or start a highlight.
  [toolbar,exit].forEach(control=>{
    ['pointerdown','pointermove','pointerup','pointercancel','click'].forEach(type=>control.addEventListener(type,event=>event.stopPropagation()));
  });
  exit.addEventListener('click',event=>{event.stopPropagation();close()});
  if(legacyStudentView){
    toolbar.classList.add('student-floating-toolbar');
    let drag=null;
    top.addEventListener('pointerdown',event=>{
      if(event.target.closest('button')||event.button!==0)return;
      event.preventDefault();event.stopPropagation();
      const box=toolbar.getBoundingClientRect(),bounds=stage.getBoundingClientRect();
      drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:box.left-bounds.left,top:box.top-bounds.top};
      top.setPointerCapture(event.pointerId);
    });
    top.addEventListener('pointermove',event=>{
      if(!drag||drag.id!==event.pointerId)return;
      toolbar.style.right='auto';
      toolbar.style.left=Math.max(0,Math.min(stage.clientWidth-toolbar.offsetWidth,drag.left+event.clientX-drag.x))+'px';
      toolbar.style.top=Math.max(0,Math.min(stage.clientHeight-toolbar.offsetHeight,drag.top+event.clientY-drag.y))+'px';
    });
    const endDrag=()=>{drag=null};
    top.addEventListener('pointerup',endDrag);top.addEventListener('pointercancel',endDrag);top.addEventListener('lostpointercapture',endDrag);
    const keepVisible=()=>{
      if(!toolbar.style.left)return;
      toolbar.style.left=Math.max(0,Math.min(stage.clientWidth-toolbar.offsetWidth,parseFloat(toolbar.style.left)||0))+'px';
      toolbar.style.top=Math.max(0,Math.min(stage.clientHeight-toolbar.offsetHeight,parseFloat(toolbar.style.top)||0))+'px';
    };
    new ResizeObserver(keepVisible).observe(stage);
    document.querySelector('.student-tool-card').hidden=true;
    sync();
  }
  document.addEventListener('fullscreenchange',sync);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&stage.classList.contains('lesson-fullscreen'))close()});
})();
