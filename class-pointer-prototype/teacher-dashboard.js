/* Compact teacher workspace; existing controls retain their event handlers. */
(function(){
'use strict';
function init(){
 if(new URL(location.href).searchParams.has('room'))return;
 const panel=document.getElementById('teacherPanel');
 const controls=panel?.querySelector('.session-controls');
 if(!controls||panel.dataset.dashboardReady)return;
 panel.dataset.dashboardReady='true';
 const sidebar=document.createElement('aside');sidebar.className='cp-permissions-sidebar';
 sidebar.setAttribute('aria-label','Students and permissions');
 const heading=document.createElement('h2');heading.textContent='Students & Permissions';sidebar.append(heading);
 const picker=controls.querySelector('.pointer-class-picker');if(picker)sidebar.append(picker);
 const menu=document.getElementById('tbStudentsMenu');
 const menuHome=menu?.parentElement;
 if(menu){menu.hidden=false;menu.classList.add('teacher-dashboard-roster');sidebar.append(menu);
 const tools=menu.querySelector('.permission-tools strong');if(tools)tools.textContent='On my teaching area';
 const note=document.createElement('p');note.className='cp-permission-help';note.textContent='Select students below, then allow Pointer, Highlight or Pen on your screen or whiteboard.';
 menu.querySelector('.permission-tools')?.before(note);
 }
 const menuSlot=document.createComment('student-permissions-home');if(menu)menu.after(menuSlot);
 const retry=document.getElementById('startClass');if(retry)sidebar.append(retry);
 const join=document.getElementById('joinInstructions');if(join)sidebar.append(join);
 panel.append(sidebar);
 const actions=document.createElement('div');actions.className='cp-teaching-actions';actions.setAttribute('aria-label','Teaching materials and sharing');
 for(const id of ['shareScreen','stopScreen','openWhiteboard','openPdf','openWebpage','openBrowserTab','tabControls','pdfFile','fullScreenLesson']){
 const node=document.getElementById(id);if(node)actions.append(node);
 }
 const sharing=document.createElement('div');sharing.className='cp-student-sharing';
 const label=document.createElement('strong');label.textContent='Student sharing';sharing.append(label);
 const toggle=document.getElementById('cpShareEnabled');if(toggle)sharing.append(toggle);
 const help=document.createElement('p');help.textContent='Screen sharing always needs the student’s browser approval.';sharing.append(help);sidebar.append(sharing);
 // Preserve original launch nodes for classroom listeners; navigation uses studentBoards.
 controls.hidden=true;controls.classList.add('teacher-dashboard-source');
 panel.prepend(actions);
 document.getElementById('tbStudentsBtn')?.closest('.tb-menu-wrap')?.classList.add('teacher-dashboard-menu-trigger');
 document.getElementById('teacherDock')?.querySelector('[data-menu="tbShareMenu"]')?.closest('.tb-menu-wrap')?.classList.add('teacher-dashboard-share-trigger');
 const emptyActions=document.querySelector('.lesson-actions');if(emptyActions&&!emptyActions.children.length)emptyActions.hidden=true;
 document.body.classList.add('cp-compact-workspace');
 const stage=document.getElementById('stage');
 let wasExpanded=false;
 function syncExpanded(){
  const expanded=stage?.classList.contains('lesson-fullscreen')||document.fullscreenElement===stage;
  if(expanded===wasExpanded)return;
  wasExpanded=expanded;
  if(menu&&menuHome){
   menu.classList.toggle('teacher-dashboard-roster',!expanded);
   menuHome.classList.toggle('teacher-dashboard-menu-trigger',!expanded);
   if(expanded)menuHome.append(menu);else sidebar.insertBefore(menu,menuSlot);
   menu.hidden=expanded;
  }
 }
 if(stage)new MutationObserver(syncExpanded).observe(stage,{attributes:true,attributeFilter:['class']});
 document.addEventListener('fullscreenchange',syncExpanded);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
