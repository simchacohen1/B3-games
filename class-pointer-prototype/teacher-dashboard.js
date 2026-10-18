/* Simplified teacher workspace.
   Only moves and relabels existing controls; every original element keeps its
   id and event handlers, so classroom.js, pdf-mode.js and student-boards.js
   behave exactly as before. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n}
function readPref(key,fallback){try{const v=localStorage.getItem(key);return v==null?fallback:v==='1'}catch{return fallback}}
function writePref(key,on){try{localStorage.setItem(key,on?'1':'0')}catch{}}

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
 const logo=el('span','cp-topbar-logo','✨');logo.setAttribute('aria-hidden','true');
 const h1=header?.querySelector('h1')||el('h1',null,'Class Pointer');
 title.append(logo,h1);
 topbar.append(title);
 const picker=controls.querySelector('.pointer-class-picker');if(picker)topbar.append(picker);
 topbar.append(el('span','cp-topbar-spacer'));
 const joined=el('span','cp-joined','No students yet');joined.setAttribute('role','status');
 topbar.append(joined);
 const invite=el('button','cp-topbar-btn','🔗 Invite students');invite.type='button';invite.id='cpInviteBtn';
 invite.title='Copy the student join link';
 topbar.append(invite);
 const studentsBtn=el('button','cp-topbar-btn cp-students-toggle','👥 Students');studentsBtn.type='button';studentsBtn.id='cpStudentsToggle';
 studentsBtn.setAttribute('aria-controls','cpStudentsDrawer');
 topbar.append(studentsBtn);
 const back=header?.querySelector('a[href]');
 if(back){back.classList.add('cp-topbar-back');topbar.append(back)}
 if(header){header.replaceChildren(topbar);header.classList.add('cp-header')}

 /* ---------- Students drawer (right side) ---------- */
 const sidebar=el('aside','cp-permissions-sidebar');sidebar.id='cpStudentsDrawer';
 sidebar.setAttribute('aria-label','Students');
 const drawerHead=el('div','cp-drawer-head');
 drawerHead.append(el('h2',null,'Students'));
 const closeDrawer=el('button','cp-drawer-close','✕');closeDrawer.type='button';closeDrawer.setAttribute('aria-label','Close students panel');
 drawerHead.append(closeDrawer);
 sidebar.append(drawerHead);
 const menu=$('tbStudentsMenu');
 const menuHome=menu?.parentElement;
 if(menu){
  menu.hidden=false;menu.classList.add('teacher-dashboard-roster');sidebar.append(menu);
  const tools=menu.querySelector('.permission-tools strong');if(tools)tools.textContent='Can use on my screen';
  const note=el('p','cp-permission-help','Tick students below (or Select all), then choose what they can use on your screen.');
  menu.querySelector('.permission-tools')?.before(note);
 }
 const menuSlot=document.createComment('student-permissions-home');if(menu)menu.after(menuSlot);
 const retry=$('startClass');if(retry)sidebar.append(retry);
 const join=$('joinInstructions');if(join)sidebar.append(join);
 const sharing=el('div','cp-student-sharing');
 sharing.append(el('strong',null,'Student sharing'));
 const toggle=$('cpShareEnabled');if(toggle)sharing.append(toggle);
 sharing.append(el('p',null,'Screen sharing always needs the student’s browser approval. Students sharing from Shorashim or another activity appear on your screen after they accept. They do not need to join Pointer.'));
 sidebar.append(sharing);
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

 /* ---------- Invite button forwards to the original Copy join link ---------- */
 const copyLink=$('copyLink'),invitePanel=$('invitePanel');
 function syncInvite(){invite.disabled=!copyLink||!invitePanel||invitePanel.hidden}
 if(invitePanel)new MutationObserver(syncInvite).observe(invitePanel,{attributes:true,attributeFilter:['hidden']});
 syncInvite();
 invite.addEventListener('click',()=>{
  if(invite.disabled)return;copyLink.click();
  invite.textContent='✓ Link copied';setTimeout(()=>{invite.textContent='🔗 Invite students'},2200);
 });

 /* ---------- Joined count from the live roster ---------- */
 const roster=$('roster');
 function syncJoined(){
  if(!roster)return;
  const rows=roster.querySelectorAll('.roster-row').length;
  const waiting=Array.from(roster.querySelectorAll('button')).filter(b=>b.textContent.startsWith('Admit ')).length;
  const inClass=rows-waiting;
  joined.textContent=(inClass?inClass+' joined':'No students yet')+(waiting?' · '+waiting+' waiting':'');
  joined.classList.toggle('cp-joined-alert',waiting>0);
 }
 if(roster)new MutationObserver(syncJoined).observe(roster,{childList:true,subtree:true,characterData:true});
 syncJoined();

 /* ---------- Live bar (shown only while something is being presented) ---------- */
 const actions=el('div','cp-teaching-actions');actions.setAttribute('aria-label','Teaching materials and sharing');
 const live=el('span','cp-live-chip','Live');
 actions.append(live,el('span','cp-switch-label','Switch to:'));
 for(const id of ['shareScreen','openWhiteboard','openPdf','openWebpage','openBrowserTab','tabControls','pdfFile','stopScreen','fullScreenLesson']){
  const node=$(id);if(node)actions.append(node);
 }
 const short={shareScreen:'🖥 Screen',openWhiteboard:'🧾 Whiteboard',openPdf:'📄 PDF',openWebpage:'🌐 Webpage',openBrowserTab:'📸 Still picture'};
 controls.hidden=true;controls.classList.add('teacher-dashboard-source');
 const dock=$('teacherDock');
 if(dock)dock.before(actions);else panel.prepend(actions);
 for(const [id,label] of Object.entries(short)){const b=$(id);if(b){b.dataset.longLabel=b.textContent;b.textContent=label}}
 document.getElementById('tbStudentsBtn')?.closest('.tb-menu-wrap')?.classList.add('teacher-dashboard-menu-trigger');
 document.getElementById('teacherDock')?.querySelector('[data-menu="tbShareMenu"]')?.closest('.tb-menu-wrap')?.classList.add('teacher-dashboard-share-trigger');
 const emptyActions=document.querySelector('.lesson-actions');if(emptyActions&&!emptyActions.children.length)emptyActions.hidden=true;

 /* ---------- "What are you teaching from?" picker inside the empty stage ---------- */
 const stage=$('stage');
 const pickerCard=el('div','cp-source-picker');pickerCard.id='cpSourcePicker';pickerCard.dataset.stageUi='true';
 pickerCard.append(el('h2',null,'What are you teaching from?'));
 const grid=el('div','cp-source-grid');
 const tiles=[
  ['shareScreen','🖥','Share my screen','A tab, window or full screen'],
  ['openWhiteboard','🧾','Whiteboard','A blank page to write on'],
  ['openPdf','📄','PDF','Open a PDF from this computer'],
  ['openWebpage','🌐','Webpage','Paste a link or open an HTML file']
 ];
 const tileButtons=[];
 for(const [id,icon,name,desc] of tiles){
  const original=$(id);if(!original)continue;
  const b=el('button','cp-source-tile');b.type='button';b.dataset.source=id;
  const i=el('span','cp-source-icon',icon);i.setAttribute('aria-hidden','true');
  b.append(i,el('span','cp-source-name',name),el('span','cp-source-desc',desc));
  b.addEventListener('click',()=>{if(!original.disabled)original.click()});
  grid.append(b);tileButtons.push([b,original]);
 }
 pickerCard.append(grid);
 const capture=$('openBrowserTab');
 const foot=el('p','cp-source-foot');
 if(capture){
  const link=el('button','cp-source-link','Or capture a still picture of a tab or window');link.type='button';
  link.addEventListener('click',()=>{if(!capture.disabled)capture.click()});
  foot.append(link);tileButtons.push([link,capture]);
 }
 pickerCard.append(foot);
 stage?.append(pickerCard);
 for(const [b,original] of tileButtons){
  const sync=()=>{b.disabled=original.disabled};
  new MutationObserver(sync).observe(original,{attributes:true,attributeFilter:['disabled']});sync();
 }

 const stopScreen=$('stopScreen');
 function syncLive(){
  const isLive=!!stage&&(stage.classList.contains('pdf-open')||(stopScreen&&!stopScreen.disabled));
  const boards=document.body.classList.contains('boards-on');
  document.body.classList.toggle('cp-is-live',isLive);
  pickerCard.hidden=isLive||boards||panel.hidden;
  actions.hidden=!isLive||boards;
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

 /* ---------- Full screen keeps the roster inside the floating toolbar ---------- */
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
