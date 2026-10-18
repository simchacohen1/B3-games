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
      ['teach','✏️','My screen'],
      ['screens','🖥️','Student screens'],
      ['whiteboards','🎨','Student whiteboards']
    ];
    const buttons=new Map();
    for(const [id,icon,name] of items){
      const b=document.createElement('button');
      b.type='button';b.className='cp-workspace-tab';b.dataset.workspace=id;
      b.innerHTML='<span class="cp-tab-icon" aria-hidden="true">'+icon+'</span><span>'+name+'</span>';
      b.setAttribute('aria-selected',String(id==='teach'));
      b.setAttribute('aria-label',name);
      b.addEventListener('click',()=>activate(id));
      tabs.appendChild(b);buttons.set(id,b);
    }
    const hint=document.getElementById('navigationHint');
    if(hint)hint.before(tabs);else dock.before(tabs);
    function activate(id){
      const launch=document.getElementById('studentBoards');
      if((id==='screens'||id==='whiteboards')&&(!launch||launch.disabled))return;
      document.dispatchEvent(new CustomEvent('class-pointer-workspace',{detail:id}));
      for(const [key,button] of buttons)button.setAttribute('aria-selected',String(key===id));
      if(id==='students'){
        const menu=document.getElementById('tbStudentsMenu');
        if(menu?.hidden)document.getElementById('tbStudentsBtn')?.click();
      }else if(id==='screens'||id==='whiteboards'){
        const boards=document.getElementById('studentBoards');
        if(boards&&!boards.disabled){
          /* Selecting Student whiteboards also sends the selected, authorized
             class to their own boards. The existing broadcaster enforces class
             scope and each student's whiteboard permission. */
          if(boards.getAttribute('aria-pressed')!=='true')boards.click();
          const gallery=document.getElementById('boardsView');
          const chooser=[...gallery?.querySelectorAll('button')||[]].find(b=>b.textContent.trim()===(id==='screens'?'🖥 Screens':'📝 Whiteboards'));
          if(chooser)chooser.click();
          if(id==='whiteboards')document.dispatchEvent(new Event('classpointer:send-to-whiteboards'));
        }
      }else{
        if(launch?.getAttribute('aria-pressed')==='true')launch.click();
        document.querySelector('.tb-mode[data-mode="point"]')?.click();
      }
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
    new MutationObserver(organize).observe(dock,{childList:true,subtree:false});
    const observer=new MutationObserver(()=>{tabs.hidden=panel.hidden});
    observer.observe(panel,{attributes:true,attributeFilter:['hidden']});
    tabs.hidden=panel.hidden;
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();