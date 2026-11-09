'use strict';
/* Primary classroom navigation forwards to existing, tested Pointer actions.
   It never changes class membership, sharing permissions or drawing state. */
(function(){
  function init(){
    const panel=document.getElementById('teacherPanel');
    const dock=document.getElementById('teacherDock');
    if(!panel||!dock)return;
    const tabs=document.createElement('nav');
    tabs.className='cp-workspace-tabs';
    tabs.setAttribute('aria-label','Classroom sections');
    const items=[
      ['teach','✏️','My screen','Teach from your screen, a PDF, a webpage or a whiteboard. Students see it.'],
      ['screens','🖥️','Student screens','Asks every student to share their screen with you. Click My screen to bring them back.'],
      ['whiteboards','🎨','Student whiteboards','Opens a private whiteboard on every student’s computer. Click My screen to bring them back.']
    ];
    const buttons=new Map();
    for(const [id,icon,name,help] of items){
      const b=document.createElement('button');
      b.type='button';b.className='cp-workspace-tab';b.dataset.workspace=id;
      b.innerHTML='<span class="cp-tab-icon" aria-hidden="true">'+icon+'</span><span>'+name+'</span>';
      b.setAttribute('aria-selected',String(id==='teach'));
      b.setAttribute('aria-label',name);b.title=help;
      b.addEventListener('click',()=>activate(id));
      tabs.appendChild(b);buttons.set(id,b);
    }
    const hint=document.getElementById('navigationHint');
    if(hint)hint.before(tabs);else dock.before(tabs);
    function activate(id){
      const launch=document.getElementById('studentBoards');
      if((id==='screens'||id==='whiteboards')&&(!launch||launch.disabled))return;
      // Use the real gallery state machine, not repeated clicks on hidden
      // toggles. Hiding a workspace must preserve screen capture and board data.
      const navigate=window.ClassPointerBoards?.navigateWorkspace;
      if(!navigate||navigate(id)!==true)return;
      document.dispatchEvent(new CustomEvent('class-pointer-workspace',{detail:id}));
      for(const [key,button] of buttons)button.setAttribute('aria-selected',String(key===id));
      if(id==='teach')document.querySelector('.tb-mode[data-mode="point"]')?.click();
    }
    // Primary tabs replace the extra quick-launch buttons, not their underlying functions.
    // Keep their original DOM nodes for existing code and observers.
    function organize(){
      const quick=document.getElementById('tbStudentScreensQuick');
      if(quick)quick.hidden=true;
      const menu=document.getElementById('tbStudentsMenu');
      if(menu){
        menu.setAttribute('aria-label','Student permissions');
        const handle=menu.querySelector('.tb-roster-handle');
        if(handle&&handle.textContent!=='Student permissions')handle.textContent='Student permissions';
      }
    }
    organize();
    // Keep the tabs truthful when the gallery is opened or closed some other way
    // (Student sharing button, Students menu, closing the gallery).
    function syncTabs(){
      const current=window.ClassPointerBoards?.workspace?.();
      const id=current==='screens'?'screens':current==='boards'?'whiteboards':'teach';
      for(const [key,button] of buttons)button.setAttribute('aria-selected',String(key===id));
      document.body.classList.toggle('cp-student-workspace',id!=='teach');
    }
    document.addEventListener('classpointer:sharing-state',syncTabs);
    document.addEventListener('class-pointer-workspace',()=>setTimeout(syncTabs,0));
    new MutationObserver(organize).observe(dock,{childList:true,subtree:false});
    const observer=new MutationObserver(()=>{tabs.hidden=panel.hidden});
    observer.observe(panel,{attributes:true,attributeFilter:['hidden']});
    tabs.hidden=panel.hidden;
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();