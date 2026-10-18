/* Simplified teacher workspace.
   Moves, relabels and forwards to existing controls; every original element keeps
   its id and event handlers, so classroom.js, pdf-mode.js and student-boards.js
   behave as before. The Students table reads and writes through
   window.ClassPointerRoster (classroom.js) and window.ClassPointerSharingPermissions
   (student-boards.js). */
(function(){
'use strict';
const $=id=>document.getElementById(id);
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n}
function readPref(key,fallback){try{const v=localStorage.getItem(key);return v==null?fallback:v==='1'}catch{return fallback}}
function writePref(key,on){try{localStorage.setItem(key,on?'1':'0')}catch{}}

/* Line icons (decorative; every button keeps a text label or aria-label). */
const P={
 pointer:'<path d="M4 3l7 17 2.5-7.5L21 10z"/>',
 link:'<path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1"/><path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1"/>',
 users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M16 4.5a3.5 3.5 0 010 7"/><path d="M18.5 14a6.5 6.5 0 013 6"/>',
 screen:'<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
 board:'<rect x="3" y="3" width="18" height="14" rx="2"/><path d="M7 13l3-3 2 2 4-4"/><path d="M9 21l3-4 3 4"/>',
 pdf:'<path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
 web:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>',
 camera:'<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
 full:'<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
 close:'<path d="M6 6l12 12M18 6L6 18"/>',
 stop:'<rect x="6" y="6" width="12" height="12" rx="2"/>'
};
function icon(name,size=18,color='currentColor'){
 const s=document.createElementNS('http://www.w3.org/2000/svg','svg');
 s.setAttribute('width',size);s.setAttribute('height',size);s.setAttribute('viewBox','0 0 24 24');s.setAttribute('fill','none');
 s.setAttribute('stroke',color);s.setAttribute('stroke-width','2');s.setAttribute('stroke-linecap','round');s.setAttribute('stroke-linejoin','round');
 s.setAttribute('aria-hidden','true');s.setAttribute('focusable','false');s.innerHTML=P[name]||'';return s;
}
function iconButton(cls,name,label){const b=el('button',cls);b.type='button';b.append(icon(name),el('span',null,label));return b}

function init(){
 if(new URL(location.href).searchParams.has('room'))return;
 const panel=$('teacherPanel');
 const controls=panel?.querySelector('.session-controls');
 if(!controls||panel.dataset.dashboardReady)return;
 panel.dataset.dashboardReady='true';
 document.body.classList.add('cp-compact-workspace','cp-simple');

 /* ---------- Top bar: title, class, joined count, invite, students, back ---------- */
 const header=document.querySelector('.app-header');
 const topbar=el('div','cp-topbar');
 const title=el('div','cp-topbar-title');
 const logo=el('span','cp-topbar-logo');logo.append(icon('pointer',28,'#F5B800'));
 const h1=header?.querySelector('h1')||el('h1',null,'Class Pointer');
 title.append(logo,h1);
 topbar.append(title);
 const picker=controls.querySelector('.pointer-class-picker');if(picker)topbar.append(picker);
 topbar.append(el('span','cp-topbar-spacer'));
 const joined=el('span','cp-joined','No students yet');joined.setAttribute('role','status');
 topbar.append(joined);
 const invite=iconButton('cp-topbar-btn','link','Invite students');invite.id='cpInviteBtn';
 invite.title='Copy the student join link';
 const inviteText=invite.querySelector('span');
 topbar.append(invite);
 const studentsBtn=iconButton('cp-topbar-btn cp-students-toggle','users','Students');studentsBtn.id='cpStudentsToggle';
 studentsBtn.setAttribute('aria-controls','cpStudentsDrawer');
 topbar.append(studentsBtn);
 const back=header?.querySelector('a[href]');
 if(back){back.classList.add('cp-topbar-back');topbar.append(back)}
 if(header){header.replaceChildren(topbar);header.classList.add('cp-header')}

 /* ---------- Students drawer (beside the lesson) ---------- */
 const sidebar=el('aside','cp-permissions-sidebar');sidebar.id='cpStudentsDrawer';
 sidebar.setAttribute('aria-label','Students');
 const drawerHead=el('div','cp-drawer-head');
 drawerHead.append(el('h2',null,'Students'));
 const closeDrawer=el('button','cp-drawer-close');closeDrawer.type='button';closeDrawer.setAttribute('aria-label','Close students panel');
 closeDrawer.append(icon('close'));
 drawerHead.append(closeDrawer);
 sidebar.append(drawerHead);

 /* Everyone: one level for the whole class. */
 const everyone=el('div','cp-everyone');
 everyone.append(el('strong',null,'Everyone'));
 const everyoneLabel=el('label','cp-everyone-row');
 everyoneLabel.append(el('span',null,'Can use on my screen'));
 const LEVEL_LONG=[['none','Nothing'],['point','Pointer'],['highlight','Pointer + highlight'],['pen','Pointer + highlight + pen']];
 const LEVEL_SHORT=[['none','Nothing'],['point','Pointer'],['highlight','+ Highlight'],['pen','+ Pen']];
 const everyoneSelect=el('select');everyoneSelect.id='cpEveryoneLevel';
 for(const [v,t] of LEVEL_LONG){const o=el('option',null,t);o.value=v;everyoneSelect.append(o)}
 everyoneLabel.append(everyoneSelect);
 everyone.append(everyoneLabel,el('span','cp-everyone-help','Change one student below if needed.'));
 everyoneSelect.addEventListener('change',()=>window.ClassPointerRoster?.setAll(everyoneSelect.value));
 sidebar.append(everyone);

 /* One table: name, level on my screen, screen sharing, whiteboard. */
 const table=el('div','cp-student-table');table.setAttribute('role','group');table.setAttribute('aria-label','Student permissions');
 const tableHead=el('div','cp-student-head');
 tableHead.append(el('span',null,'Name'),el('span',null,'On my screen'),el('span','cp-c','Screen'),el('span','cp-c','Board'));
 const tableBody=el('div','cp-student-body');
 table.append(tableHead,tableBody);
 sidebar.append(table);

 /* Original permissions menu stays in the drawer (hidden by CSS) so full screen keeps working. */
 const menu=$('tbStudentsMenu');
 const menuHome=menu?.parentElement;
 if(menu){menu.hidden=false;menu.classList.add('teacher-dashboard-roster');sidebar.append(menu)}
 const menuSlot=document.createComment('student-permissions-home');if(menu)menu.after(menuSlot);
 const retry=$('startClass');if(retry)sidebar.append(retry);

 /* Less-used settings, folded away. */
 const more=el('details','cp-more');
 more.append(el('summary',null,'More options'));
 const send=el('div','cp-more-send');
 for(const [label,match] of [['Send screens','Send screens'],['Send whiteboards','Send whiteboards']]){
  const b=el('button','cp-more-btn',label);b.type='button';
  b.addEventListener('click',()=>{Array.from(menu?.querySelectorAll('button')||[]).find(x=>x.textContent.includes(match))?.click()});
  send.append(b);
 }
 more.append(el('p','cp-more-help','Bring every signed-in student to screen sharing or to his own whiteboard.'),send);
 const join=$('joinInstructions');if(join)more.append(join);
 const sharing=el('div','cp-student-sharing');
 sharing.append(el('strong',null,'Student sharing'));
 const toggle=$('cpShareEnabled');if(toggle)sharing.append(toggle);
 sharing.append(el('p',null,'Screen sharing always needs the student’s browser approval. Students sharing from Shorashim or another activity appear on your screen after they accept. They do not need to join Pointer.'));
 more.append(sharing);
 sidebar.append(more);

 panel.append(sidebar);

 function setDrawer(open){
  document.body.classList.toggle('cp-drawer-closed',!open);
  studentsBtn.setAttribute('aria-expanded',String(open));
  writePref('cpStudentsDrawer',open);
  setTimeout(()=>window.dispatchEvent(new Event('resize')),60);
 }
 setDrawer(readPref('cpStudentsDrawer',window.innerWidth>=1000));
 studentsBtn.addEventListener('click',()=>setDrawer(document.body.classList.contains('cp-drawer-closed')));
 closeDrawer.addEventListener('click',()=>setDrawer(false));

 /* Drawer starts below the top bar, so the bar keeps its full width. */
 function placeDrawer(){
  const bottom=header?Math.round(header.getBoundingClientRect().bottom):12;
  document.body.style.setProperty('--cp-drawer-top',Math.max(12,bottom)+'px');
 }
 if(header&&window.ResizeObserver)new ResizeObserver(placeDrawer).observe(header);
 window.addEventListener('resize',placeDrawer);placeDrawer();

 /* ---------- Invite button forwards to the original Copy join link ---------- */
 const copyLink=$('copyLink'),invitePanel=$('invitePanel');
 function syncInvite(){invite.disabled=!copyLink||!invitePanel||invitePanel.hidden}
 if(invitePanel)new MutationObserver(syncInvite).observe(invitePanel,{attributes:true,attributeFilter:['hidden']});
 syncInvite();
 invite.addEventListener('click',()=>{
  if(invite.disabled)return;copyLink.click();
  inviteText.textContent='Link copied';setTimeout(()=>{inviteText.textContent='Invite students'},2200);
 });

 /* ---------- Students table ---------- */
 const R=()=>window.ClassPointerRoster,S=()=>window.ClassPointerSharingPermissions;
 function rows(){
  const live=R()?.list()||[];
  const cls=S()?.students()||[];
  const out=[],seen=new Set();
  for(const person of cls){
   const key=person.name.toLocaleLowerCase();seen.add(key);
   const member=live.find(m=>m.name.toLocaleLowerCase()===key);
   out.push({name:person.name,id:person.id,member});
  }
  for(const member of live){
   const key=member.name.toLocaleLowerCase();if(seen.has(key))continue;seen.add(key);
   out.push({name:member.name,id:S()?.personId?.(member)||member.studentId||null,member});
  }
  return out;
 }
 let renderQueued=false;
 function queueRender(){if(renderQueued)return;renderQueued=true;requestAnimationFrame(()=>{renderQueued=false;renderTable()})}
 function renderTable(){
  const list=rows();
  const focused=document.activeElement&&tableBody.contains(document.activeElement)?document.activeElement.dataset.key:null;
  tableBody.replaceChildren();
  if(R())everyoneSelect.value=R().everyone();
  if(!list.length){
   const empty=el('p','cp-student-empty',$('endClass')?.disabled?'Start a class to see your students here.':'No students yet. Use Invite students to send the join link.');
   tableBody.append(empty);
  }
  for(const row of list){
   const m=row.member;
   const nameCell=el('span','cp-student-name');
   const dot=el('span','cp-dot'+(m?.admitted?' cp-dot-on':''));
   dot.setAttribute('role','img');dot.setAttribute('aria-label',m?.admitted?'Joined':m?'Waiting':'Not joined');
   const name=el('span','cp-name-text',row.name);name.title=row.name;
   nameCell.append(dot,name);
   if(m&&!m.admitted){
    const admit=el('button','cp-mini-btn','Admit');admit.type='button';admit.setAttribute('aria-label','Admit '+row.name);
    admit.addEventListener('click',()=>R()?.admit(m.id));nameCell.append(admit);
   }
   if(m){
    const remove=el('button','cp-remove');remove.type='button';remove.setAttribute('aria-label',(m.admitted?'Remove ':'Decline ')+row.name);
    remove.title=m.admitted?'Remove from class':'Decline';remove.append(icon('close',14));
    remove.addEventListener('click',()=>{if(confirm((m.admitted?'Remove ':'Decline ')+row.name+'?'))R()?.remove(m.id)});
    nameCell.append(remove);
   }
   const level=el('select','cp-level');level.dataset.key='level:'+row.name;
   level.setAttribute('aria-label',row.name+' on my screen');
   for(const [v,t] of LEVEL_SHORT){const o=el('option',null,t);o.value=v;level.append(o)}
   level.value=R()?.levelForName(row.name)||'none';
   level.disabled=!R();
   level.addEventListener('change',()=>R()?.setLevelForName(row.name,level.value));
   const checks=[];
   for(const [kind,label] of [['screens','screen sharing'],['boards','whiteboard']]){
    const c=el('input','cp-check');c.type='checkbox';c.dataset.key=kind+':'+row.name;
    c.setAttribute('aria-label',row.name+' '+label);
    c.checked=!!row.id&&!!S()?.allowed(row.id,kind);
    c.disabled=!row.id||!S();
    if(!row.id)c.title='Available once this student is matched to your class list';
    c.addEventListener('change',()=>S()?.set(row.id,kind,c.checked));
    checks.push(c);
   }
   tableBody.append(nameCell,level,...checks);
  }
  if(focused){const again=tableBody.querySelector('[data-key="'+CSS.escape(focused)+'"]');again?.focus()}
  syncJoined(list);
 }

 /* ---------- Joined count ---------- */
 function syncJoined(list=rows()){
  const live=R()?.list()||[];
  const inClass=live.filter(m=>m.admitted).length,waiting=live.length-inClass;
  const total=(S()?.loaded?.()?list.length:0);
  joined.textContent=(total?inClass+' of '+total+' joined':inClass?inClass+' joined':'No students yet')+(waiting?' · '+waiting+' waiting':'');
  joined.classList.toggle('cp-joined-alert',waiting>0);
 }
 document.addEventListener('classpointer:roster',queueRender);
 document.addEventListener('classpointer:sharing-permissions',queueRender);
 const endClass=$('endClass');
 if(endClass)new MutationObserver(queueRender).observe(endClass,{attributes:true,attributeFilter:['disabled']});
 queueRender();

 /* ---------- Tabs row: tabs on the left, live status on the right ---------- */
 const tabs=document.querySelector('.cp-workspace-tabs');
 const tabsRow=el('div','cp-tabs-row');
 if(tabs){tabs.before(tabsRow);tabsRow.append(tabs)}else{const dock=$('teacherDock');(dock||panel).before(tabsRow)}
 tabsRow.append(el('span','cp-tabs-spacer'));
 const liveWrap=el('div','cp-live-wrap');
 const live=el('span','cp-live-chip','Live');
 const tabControls=$('tabControls');
 const switchWrap=el('div','cp-switch-wrap');
 const switchBtn=el('button','cp-switch-btn','Switch / stop');switchBtn.type='button';
 switchBtn.setAttribute('aria-haspopup','true');switchBtn.setAttribute('aria-expanded','false');switchBtn.setAttribute('aria-controls','cpSwitchMenu');
 const switchMenu=el('div','cp-switch-menu');switchMenu.id='cpSwitchMenu';switchMenu.hidden=true;
 switchMenu.append(el('small',null,'Switch to'));
 const short={shareScreen:['screen','Share my screen'],openWhiteboard:['board','Whiteboard'],openPdf:['pdf','PDF'],openWebpage:['web','Webpage'],openBrowserTab:['camera','Still picture of a tab']};
 for(const id of ['shareScreen','openWhiteboard','openPdf','openWebpage','openBrowserTab','pdfFile','stopScreen']){
  const node=$(id);if(!node)continue;
  if(short[id]){node.dataset.longLabel=node.textContent;node.replaceChildren(icon(short[id][0]),el('span',null,short[id][1]))}
  switchMenu.append(node);
 }
 const stopBtn=iconButton('cp-stop-btn','stop','Stop presenting');
 switchMenu.append(stopBtn);
 switchWrap.append(switchBtn,switchMenu);
 const fullBtn=$('fullScreenLesson');
 if(fullBtn){fullBtn.replaceChildren(icon('full'));fullBtn.setAttribute('aria-label','Full screen');fullBtn.title='Full screen';fullBtn.classList.add('cp-icon-btn')}
 liveWrap.append(live);
 if(tabControls)liveWrap.append(tabControls);
 liveWrap.append(switchWrap);
 if(fullBtn)liveWrap.append(fullBtn);
 tabsRow.append(liveWrap);
 controls.hidden=true;controls.classList.add('teacher-dashboard-source');
 document.getElementById('tbStudentsBtn')?.closest('.tb-menu-wrap')?.classList.add('teacher-dashboard-menu-trigger');
 document.getElementById('teacherDock')?.querySelector('[data-menu="tbShareMenu"]')?.closest('.tb-menu-wrap')?.classList.add('teacher-dashboard-share-trigger');
 const emptyActions=document.querySelector('.lesson-actions');if(emptyActions&&!emptyActions.children.length)emptyActions.hidden=true;

 function openSwitch(open){
  switchMenu.hidden=!open;switchBtn.setAttribute('aria-expanded',String(open));
  if(open)switchMenu.querySelector('button:not(:disabled)')?.focus();
 }
 switchBtn.addEventListener('click',()=>openSwitch(switchMenu.hidden));
 switchMenu.addEventListener('click',e=>{if(e.target.closest('button'))openSwitch(false)});
 document.addEventListener('click',e=>{if(!switchMenu.hidden&&!switchWrap.contains(e.target))openSwitch(false)});
 switchWrap.addEventListener('keydown',e=>{if(e.key==='Escape'&&!switchMenu.hidden){openSwitch(false);switchBtn.focus()}});

 /* ---------- What is live right now ---------- */
 const stage=$('stage'),stopScreen=$('stopScreen');
 const LABELS={shareScreen:'Shared screen',openWhiteboard:'Whiteboard',openPdf:'PDF',openWebpage:'Webpage',openBrowserTab:'Still picture',pointerPdfLibrary:'PDF'};
 let lastDoc='PDF';
 document.addEventListener('click',e=>{
  const b=e.target.closest?.('button');if(!b)return;
  const id=b.id||b.dataset.source;
  if(id&&id!=='shareScreen'&&LABELS[id])lastDoc=LABELS[id];
 },true);
 function sharingScreen(){return !!stopScreen&&!stopScreen.disabled}
 function docOpen(){return !!stage&&stage.classList.contains('pdf-open')}
 stopBtn.addEventListener('click',()=>{
  if(docOpen())window.ClassPointerPdf?.close?.();
  if(sharingScreen())stopScreen.click();
 });

 /* ---------- "What are you teaching from?" picker inside the empty stage ---------- */
 const pickerCard=el('div','cp-source-picker');pickerCard.id='cpSourcePicker';pickerCard.dataset.stageUi='true';
 pickerCard.append(el('h2',null,'What are you teaching from?'));
 const grid=el('div','cp-source-grid');
 const tiles=[
  ['shareScreen','screen','#2563EB','Share my screen','A tab, window or full screen'],
  ['openWhiteboard','board','#C2410C','Whiteboard','A blank page to write on'],
  ['openPdf','pdf','#15803D','PDF','Upload one or pick from your library'],
  ['openWebpage','web','#7C3AED','Webpage','Paste a link or open an HTML file']
 ];
 const tileButtons=[];
 for(const [id,ic,color,name,desc] of tiles){
  const original=$(id);if(!original)continue;
  const b=el('button','cp-source-tile');b.type='button';b.dataset.source=id;
  const i=el('span','cp-source-icon');i.append(icon(ic,32,color));
  b.append(i,el('span','cp-source-name',name),el('span','cp-source-desc',desc));
  b.addEventListener('click',()=>{if(!original.disabled)original.click()});
  grid.append(b);tileButtons.push([b,original]);
 }
 pickerCard.append(grid);
 const foot=el('p','cp-source-foot');
 const library=el('button','cp-source-link','Open my PDF library');library.type='button';library.dataset.source='pointerPdfLibrary';
 library.addEventListener('click',()=>$('pointerPdfLibrary')?.click());
 foot.append(library);
 const capture=$('openBrowserTab');
 if(capture){
  const link=el('button','cp-source-link','Capture a still picture of a tab or window');link.type='button';link.dataset.source='openBrowserTab';
  link.addEventListener('click',()=>{if(!capture.disabled)capture.click()});
  foot.append(el('span','cp-source-sep','·'),link);tileButtons.push([link,capture]);
 }
 pickerCard.append(foot,el('p','cp-source-note','Students join with the invite link. You can switch anytime.'));
 stage?.append(pickerCard);
 for(const [b,original] of tileButtons){
  const sync=()=>{b.disabled=original.disabled};
  new MutationObserver(sync).observe(original,{attributes:true,attributeFilter:['disabled']});sync();
 }
 function syncLibrary(){library.hidden=!$('pointerPdfLibrary')}
 syncLibrary();setTimeout(syncLibrary,1500);

 function syncLive(){
  const isLive=docOpen()||sharingScreen();
  const boards=document.body.classList.contains('boards-on');
  document.body.classList.toggle('cp-is-live',isLive);
  pickerCard.hidden=isLive||boards||panel.hidden;
  liveWrap.hidden=!isLive||boards;
  live.textContent='Live: '+(docOpen()?lastDoc:'Shared screen');
  stopBtn.textContent='';stopBtn.append(icon('stop'),el('span',null,'Stop '+(docOpen()?(lastDoc==='PDF'?'PDF':lastDoc.toLowerCase()):'sharing my screen')));
  if(!isLive)openSwitch(false);
  syncLibrary();
 }
 if(stage)new MutationObserver(syncLive).observe(stage,{attributes:true,attributeFilter:['class']});
 if(stopScreen)new MutationObserver(syncLive).observe(stopScreen,{attributes:true,attributeFilter:['disabled']});
 new MutationObserver(syncLive).observe(document.body,{attributes:true,attributeFilter:['class']});
 new MutationObserver(syncLive).observe(panel,{attributes:true,attributeFilter:['hidden']});
 syncLive();

 /* ---------- Toolbar: Box moves into the Shapes menu ---------- */
 const shapesMenu=$('tbPenShapes');
 if(shapesMenu&&!shapesMenu.querySelector('[data-draw="box"]')){
  const box=el('button',null,'▧ Highlight box');box.type='button';box.dataset.draw='box';
  shapesMenu.prepend(box);
 }

 /* ---------- Full screen keeps the original roster inside the floating toolbar ---------- */
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
