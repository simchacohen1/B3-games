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
      ['teach','✏️','Teach'],
      ['screens','🖥️','Screens'],
      ['whiteboards','🎨','Whiteboards'],
      ['students','👥','Students']
    ];
    const buttons=new Map();
    for(const [id,icon,name] of items){
      const b=document.createElement('button');
      b.type='button';b.className='cp-workspace-tab';
      b.innerHTML='<span class="cp-tab-icon" aria-hidden="true">'+icon+'</span><span>'+name+'</span>';
      b.setAttribute('aria-selected',String(id==='teach'));
      b.setAttribute('aria-label',name);
      b.addEventListener('click',()=>activate(id));
      tabs.appendChild(b);buttons.set(id,b);
    }
    const hint=document.getElementById('navigationHint');
    if(hint)hint.before(tabs);else dock.before(tabs);
    function activate(id){
      for(const [key,button] of buttons)button.setAttribute('aria-selected',String(key===id));
      if(id==='students'){
        document.getElementById('tbStudentsBtn')?.click();
      }else if(id==='screens'||id==='whiteboards'){
        const boards=document.getElementById('studentBoards');
        if(boards&&!boards.disabled){
          /* Open the existing Screens/Whiteboards workspace. Teacher chooses
             screen or board mode there; do not silently change class mode. */
          if(boards.getAttribute('aria-pressed')!=='true')boards.click();
        }
      }else{
        document.querySelector('.tb-mode[data-mode="point"]')?.click();
      }
    }
    const observer=new MutationObserver(()=>{tabs.hidden=panel.hidden});
    observer.observe(panel,{attributes:true,attributeFilter:['hidden']});
    tabs.hidden=panel.hidden;
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();