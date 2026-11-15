'use strict';
// One toolbar for Class Pointer (#770): the old dock above the lesson is gone and the shared drawing toolbar
// (annotation-toolbar.js) carries everything it had. classroom-annotate.js supplies the classroom parts.
// The two scripts run here against a small stand-in for the page, so the buttons are really clicked.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const repo=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(repo,name),'utf8');
const toolbarSrc=read('class-pointer-prototype/annotation-toolbar.js');
const adapterSrc=read('class-pointer-prototype/classroom-annotate.js');

// ---------- A very small page ----------
function page(){
  const timers=[];
  class El{
    constructor(tag){
      this.tagName=String(tag).toUpperCase();this.children=[];this.parentNode=null;this.dataset={};this.attrs={};this.listeners={};
      this.hidden=false;this.disabled=false;this.id='';this.className='';this._text='';this.value='';this.options=[];
      this.style={setProperty(k,v){this[k]=v},removeProperty(k){delete this[k]}};
      const el=this;
      this.classList={
        contains:c=>el.className.split(/\s+/).includes(c),
        add(...cs){for(const c of cs)if(!this.contains(c))el.className=(el.className+' '+c).trim()},
        remove(...cs){el.className=el.className.split(/\s+/).filter(c=>!cs.includes(c)).join(' ')},
        toggle(c,on){const want=on===undefined?!this.contains(c):!!on;if(want)this.add(c);else this.remove(c);return want}
      };
    }
    get parentElement(){return this.parentNode}
    get isConnected(){let n=this;while(n){if(n===doc.body||n===doc.head)return true;n=n.parentNode}return false}
    get textContent(){return this._text+this.children.map(c=>c.textContent).join('')}
    set textContent(v){this.children=[];this._text=String(v)}
    set innerHTML(html){
      this.children=[];this._text='';
      const tags=[...String(html).matchAll(/<(span|i)(?: class="([^"]*)")?><\/\1>/g)];
      if(!tags.length){this._text=String(html);return}
      for(const m of tags){const c=new El(m[1]);c.className=m[2]||'';this.append(c)}
    }
    append(...nodes){for(const n of nodes){n.remove();n.parentNode=this;this.children.push(n)}}
    remove(){if(!this.parentNode)return;const list=this.parentNode.children,i=list.indexOf(this);if(i>=0)list.splice(i,1);this.parentNode=null}
    replaceChildren(...nodes){for(const c of this.children.slice())c.remove();this._text='';this.append(...nodes)}
    contains(n){while(n){if(n===this)return true;n=n.parentNode}return false}
    setAttribute(k,v){this.attrs[k]=String(v)}
    getAttribute(k){return k in this.attrs?this.attrs[k]:null}
    addEventListener(type,fn){(this.listeners[type]||(this.listeners[type]=[])).push(fn)}
    dispatchEvent(event){event.target=event.target||this;for(const fn of this.listeners[event.type]||[])fn(event);return true}
    click(){if(this.disabled)return;this.dispatchEvent(new Ev('click'))}
    closest(){return null}
    matches(sel){
      let m;
      if((m=sel.match(/^\.([\w-]+)$/)))return this.classList.contains(m[1]);
      if((m=sel.match(/^\[data-action="([^"]*)"\]$/)))return this.dataset.action===m[1];
      return this.tagName===sel.toUpperCase();
    }
    all(sel,out=[]){for(const c of this.children){if(c.matches(sel))out.push(c);c.all(sel,out)}return out}
    querySelector(sel){return this.all(sel)[0]||null}
    querySelectorAll(sel){return this.all(sel)}
    getBoundingClientRect(){return this.rect||{left:12,top:100,width:64,height:500,right:76,bottom:600}}
    get offsetWidth(){return 64}get offsetHeight(){return 40}get scrollHeight(){return 0}get clientHeight(){return 0}
    setPointerCapture(){}focus(){}
    getContext(){return new Proxy({},{get:(t,k)=>k==='measureText'?()=>({width:10}):()=>{}})}
  }
  class Ev{constructor(type,init={}){this.type=type;Object.assign(this,init)}stopPropagation(){this.stopped=true}preventDefault(){}stopImmediatePropagation(){}}
  const find=(root,id)=>{if(root.id===id)return root;for(const c of root.children){const hit=find(c,id);if(hit)return hit}return null};
  const doc={
    body:new El('body'),head:new El('head'),readyState:'complete',fullscreenElement:null,listeners:{},
    createElement:tag=>new El(tag),
    getElementById:id=>find(doc.body,id)||find(doc.head,id),
    addEventListener(type,fn){(this.listeners[type]||(this.listeners[type]=[])).push(fn)},
    fire(type,init={}){const e=new Ev(type,init);e.target=init.target||doc.body;for(const fn of this.listeners[type]||[])fn(e);return e}
  };
  doc.documentElement=doc.head;
  const win={innerWidth:1280,innerHeight:800,devicePixelRatio:1,addEventListener(){},dispatchEvent(){},document:doc};
  const ctx={window:win,document:doc,console,Date,Math,Number,String,Object,Array,JSON,Set,Map,WeakSet,Event:Ev,PointerEvent:Ev,
    localStorage:{getItem:()=>null,setItem(){}},requestAnimationFrame:()=>1,getComputedStyle:()=>({paddingLeft:'16px'}),
    setInterval:fn=>{timers.push(fn);return timers.length},setTimeout:()=>0,clearTimeout(){}};
  const add=(tag,id,parent=doc.body)=>{const n=new El(tag);n.id=id;parent.append(n);return n};
  return{El,Ev,doc,win,ctx,add,tick:()=>timers.forEach(fn=>fn()),run:src=>vm.runInNewContext(src,ctx)};
}
function withToolbar(){
  const p=page();p.run(toolbarSrc);
  const FA=p.win.FTTAnnotate,root=p.doc.getElementById('fttAnnotate');
  const tool=name=>root.querySelectorAll('.fa-tool').find(b=>b.dataset.tool===name);
  const fly=root.querySelector('.fa-fly');
  return{...p,FA,root,tool,fly,bar:root.querySelector('.fa-bar'),
    flyRows:()=>fly.hidden?[]:fly.children.filter(c=>c.tagName==='BUTTON'),
    flyRow:text=>fly.children.find(c=>c.tagName==='BUTTON'&&(c.textContent.includes(text)||c.title===text)),
    action:id=>root.querySelector('[data-action="'+id+'"]'),
    byTitle:title=>root.querySelectorAll('button').find(b=>b.title===title)};
}
// A lesson-like surface: the toolbar only tells it which tool was chosen.
function delegateSurface(extra={}){
  const calls=[];
  return{calls,surface:{id:'lesson',rect:()=>({left:0,top:0,width:800,height:600}),defaultTool:'pointer',
    tools:['pointer','hand','highlight','text','shape','eraser','pen'],
    delegate:{apply:state=>calls.push(state),undo:()=>calls.push('undo'),clear:()=>calls.push('clear')},...extra}};
}

test('a tool can have kinds: clicking the chosen tool again opens them, and the choice reaches the lesson',()=>{
  const t=withToolbar();
  const {calls,surface}=delegateSurface({variants:{pointer:[['target','◎','Target'],['star','★','Star']],highlight:[['highlight','🖍','Highlighter'],['box','▧','Highlight box']]}});
  t.FA.setRole('teacher');t.FA.push(surface);t.FA.open();
  t.tool('pointer').click();
  assert.equal(t.fly.hidden,true,'first click only chooses the tool');
  assert.ok(t.tool('pointer').classList.contains('fa-more'),'tools with kinds are marked');
  assert.ok(!t.tool('pen').classList.contains('fa-more'));
  t.tool('pointer').click();
  assert.deepEqual(t.flyRows().map(b=>b.title),['Target','Star']);
  t.flyRow('Star').click();
  assert.equal(t.fly.hidden,true);
  assert.equal(calls.at(-1).tool,'pointer');assert.equal(calls.at(-1).variant,'star');
  assert.equal(t.tool('pointer').querySelector('.fa-ico').textContent,'★','the button shows the chosen kind');
  // Shapes keep opening on the first click, as before.
  t.tool('shape').click();
  assert.deepEqual(t.flyRows().map(b=>b.title),['Rectangle','Circle','Line','Arrow']);
});

test('Clear clears right away, or opens a menu of choices when the lesson offers one',()=>{
  const t=withToolbar(),plain=delegateSurface();
  t.FA.setRole('teacher');t.FA.push(plain.surface);t.FA.open();
  t.byTitle('Erase all my marks here').click();
  assert.equal(plain.calls.at(-1),'clear');
  t.FA.release(plain.surface);
  const done=[],menu=delegateSurface();
  menu.surface.delegate.clear=undefined;
  menu.surface.delegate.clearMenu=()=>[{heading:'Mine'},{label:'My drawings',onClick:()=>done.push('mine')},{heading:'Whole class'},{label:'All pointers',danger:true,onClick:()=>done.push('all')}];
  t.FA.push(menu.surface);
  const clear=t.byTitle('Erase all my marks here');
  assert.equal(clear.disabled,false);
  clear.click();
  assert.ok(t.fly.classList.contains('fa-list'));
  assert.deepEqual(t.flyRows().map(b=>b.textContent),['My drawings','All pointers']);
  assert.ok(t.flyRow('All pointers').classList.contains('fa-danger'));
  t.flyRow('All pointers').click();
  assert.deepEqual(done,['all']);assert.equal(t.fly.hidden,true);
});

test('page buttons: plain buttons, menus, hidden ones left out, and menus read fresh each time',()=>{
  const t=withToolbar(),log=[];let saved=false;
  t.FA.setRole('teacher');t.FA.open();
  t.FA.setActions(()=>[
    {id:'students',icon:'👥',label:'Students',primary:true,badge:'2',onClick:()=>log.push('students')},
    {id:'stop',label:'Stop',danger:true,hidden:true,onClick:()=>log.push('stop')},
    {id:'more',label:'More',items:()=>[{label:'Full screen',onClick:()=>log.push('full')},...(saved?[{label:'Save',onClick:()=>log.push('save')}]:[])]}
  ]);
  assert.ok(t.action('students').classList.contains('fa-primary'));
  assert.equal(t.action('students').querySelector('.fa-badge').textContent,'2');
  assert.equal(t.action('stop'),null,'hidden buttons are not drawn');
  t.action('students').click();assert.deepEqual(log,['students']);
  t.action('more').click();
  assert.deepEqual(t.flyRows().map(b=>b.textContent),['Full screen']);
  t.action('more').click();assert.equal(t.fly.hidden,true,'clicking the button again closes its menu');
  saved=true;t.action('more').click();
  assert.deepEqual(t.flyRows().map(b=>b.textContent),['Full screen','Save']);
  t.flyRow('Save').click();assert.deepEqual(log,['students','save']);
  // A click somewhere else closes an open menu.
  t.action('more').click();assert.equal(t.fly.hidden,false);
  t.doc.fire('pointerdown',{target:t.doc.body});assert.equal(t.fly.hidden,true);
  t.FA.setActions(null);assert.equal(t.root.querySelector('.fa-actions').hidden,true);
});

test('one-letter keys the lesson asks for work, also while shrunk to the pencil, but never while typing',()=>{
  const t=withToolbar();
  const {calls,surface}=delegateSurface({variants:{highlight:[['highlight','🖍','Highlighter'],['box','▧','Highlight box']]},
    keys:{p:{tool:'pointer'},b:{tool:'highlight',variant:'box'},d:{tool:'pen'},u:'undo'}});
  t.FA.setRole('teacher');t.FA.push(surface);t.FA.open();
  t.doc.fire('keydown',{key:'b'});
  assert.equal(calls.at(-1).tool,'highlight');assert.equal(calls.at(-1).variant,'box');
  t.doc.fire('keydown',{key:'U'});assert.equal(calls.at(-1),'undo');
  const before=calls.length;
  t.doc.fire('keydown',{key:'d',ctrlKey:true});
  t.doc.fire('keydown',{key:'d',target:{closest:()=>({})}});
  assert.equal(calls.length,before,'Ctrl+D and typing in a box are left alone');
  t.FA.minimize();
  t.doc.fire('keydown',{key:'d'});
  assert.equal(calls.at(-1).tool,'pen');assert.equal(t.FA.state().mode,'mini');
});

test('a tool the lesson stops allowing gives way to one that is allowed',()=>{
  const t=withToolbar();let list=['pointer','hand','pen'];
  const {calls,surface}=delegateSurface();
  Object.defineProperty(surface,'tools',{get:()=>list});
  t.FA.setRole('teacher');t.FA.push(surface);t.FA.open();
  t.tool('pen').click();assert.equal(t.FA.state().tool,'pen');
  list=['pointer','hand'];t.FA.refresh();
  assert.equal(t.FA.state().tool,'pointer');assert.equal(calls.at(-1).tool,'pointer');
  assert.equal(t.tool('pen').disabled,true);
});

test('real full screen: the toolbar moves into the full-screen element and back',()=>{
  const t=withToolbar();t.FA.setRole('teacher');
  const stage=t.add('section','stage');
  assert.equal(t.root.parentNode,t.doc.body);
  t.doc.fullscreenElement=stage;t.doc.fire('fullscreenchange');
  assert.equal(t.root.parentNode,stage);
  t.doc.fullscreenElement=null;t.doc.fire('fullscreenchange');
  assert.equal(t.root.parentNode,t.doc.body);
  // A full-screen video cannot hold the toolbar.
  t.doc.fullscreenElement=t.add('video','v');t.doc.fire('fullscreenchange');
  assert.equal(t.root.parentNode,t.doc.body);
  assert.equal(t.root.dataset.stageUi,'true');
  assert.doesNotMatch(toolbarSrc,/setSide|data-side/,'the keep-right workaround is gone');
});

// ---------- The classroom page ----------
const TOOL_OPTIONS=['target','arrow','star','heart','paw','sparkle','highlight','box','pen','line','pen-arrow','rectangle','ellipse','triangle','text'];
function classroom({teacher=true,kind='pdf'}={}){
  const t=withToolbar(),clicks=[];
  const select=(id,values)=>{const s=t.add('select',id);s.options=values.map(v=>({value:v,textContent:v==='#1f2937'?'Black':v||'Class color',disabled:false}));s.value=values[0];return s};
  const who=teacher?'teacher':'student';
  const toolSel=select(who+'Tool',teacher?[...TOOL_OPTIONS,'eraser']:TOOL_OPTIONS);
  const colorSel=select(who+'Color',teacher?['#ffcc00','#1f2937']:['','#ffcc00','#1f2937']);
  select(who+'Size',['0.008','0.016','0.028']);
  const main=t.add('main','main'),stage=t.add('section','stage',main);
  main.rect={left:0,top:0,width:1280,height:800,right:1280,bottom:800};
  stage.rect={left:16,top:120,width:900,height:500,right:916,bottom:620};
  for(const id of ['undoTeacherHighlight','clearTeacherHighlights','clearTeacher','clearAllHighlights','clearAll','undoStudentHighlight','clearStudentHighlights',
    'shareScreen','openWhiteboard','openPdf','openWebpage','openBrowserTab','stopScreen','fullScreenLesson','exitFullScreenLesson','cpStopBtn'])
    t.add('button',id).addEventListener('click',()=>clicks.push(id));
  t.doc.getElementById('cpStopBtn').textContent='Stop PDF';
  const spotlight=t.add('input','spotlight');spotlight.checked=false;spotlight.addEventListener('change',()=>clicks.push('spotlight:'+spotlight.checked));
  const state={kind,may:{pointer:true,highlight:true,pen:true},nav:false,panelOpen:false};
  t.win.ClassPointerBridge={isTeacher:teacher,lessonKind:()=>state.kind,setNavigation:on=>{state.nav=on},navigating:()=>state.nav,
    allowed:()=>state.may.pointer,writingAllowed:tool=>state.may[tool==='pen'?'pen':'highlight']};
  if(teacher){t.doc.body.classList.add('teacher-view');if(kind)t.doc.body.classList.add('cp-is-live')}
  t.win.ClassPointerStudentsPanel={toggle(){state.panelOpen=!state.panelOpen;clicks.push('students')},isOpen:()=>state.panelOpen,waiting:()=>0};
  t.run(adapterSrc);
  return{...t,clicks,state,toolSel,colorSel,stage,spotlight};
}

test('teacher: every old dock tool is on the one toolbar and drives the lesson’s own tool menu',()=>{
  const c=classroom();
  assert.deepEqual({...c.FA.state(),reasons:undefined},{role:'teacher',mode:'open',tool:'pointer',reasons:undefined,surface:'classroom'},'opens by itself for a PDF');
  // Pointer shapes.
  c.tool('pointer').click();
  assert.deepEqual(c.flyRows().map(b=>b.title),['Target','Arrow','Star','Heart','Paw print','Sparkle']);
  c.flyRow('Heart').click();assert.equal(c.toolSel.value,'heart');
  // Highlight box.
  c.tool('highlight').click();assert.equal(c.toolSel.value,'highlight');
  c.tool('highlight').click();c.flyRow('Highlight box').click();assert.equal(c.toolSel.value,'box');
  // Shapes, with the triangle.
  c.tool('shape').click();
  assert.deepEqual(c.flyRows().map(b=>b.title),['Rectangle','Circle','Line','Arrow','Triangle']);
  c.flyRow('Triangle').click();assert.equal(c.toolSel.value,'triangle');
  c.tool('shape').click();c.flyRow('Arrow').click();assert.equal(c.toolSel.value,'pen-arrow');
  for(const [name,value] of [['pen','pen'],['text','text'],['eraser','eraser']]){c.tool(name).click();assert.equal(c.toolSel.value,value)}
  assert.equal(c.tool('select').disabled,true);
  // Keys.
  for(const [key,value] of [['h','highlight'],['b','box'],['d','pen'],['e','eraser']]){c.doc.fire('keydown',{key});assert.equal(c.toolSel.value,value,key)}
  c.doc.fire('keydown',{key:'p'});assert.equal(c.toolSel.value,'heart','P goes back to the pointer shape in use');
  c.doc.fire('keydown',{key:'u'});assert.equal(c.clicks.at(-1),'undoTeacherHighlight');
  // The pointer keeps its own color; picking a color does not jump to the pen.
  c.root.querySelectorAll('.fa-color').find(b=>b.dataset.color==='#1f2937').click();
  assert.equal(c.colorSel.value,'#1f2937');assert.equal(c.FA.state().tool,'pointer');
  // Hand is the lesson's mouse mode.
  c.tool('hand').click();assert.equal(c.state.nav,true);
  c.tool('pointer').click();assert.equal(c.state.nav,false);
});

test('teacher: Clear offers the four choices of the old Clear menu',()=>{
  const c=classroom();
  for(const [label,id] of [['My drawings','clearTeacherHighlights'],['My pointer','clearTeacher'],['Everyone’s drawings','clearAllHighlights'],['All pointers','clearAll']]){
    c.byTitle('Erase all my marks here').click();
    assert.equal(c.flyRows().length,4);
    c.flyRow(label).click();assert.equal(c.clicks.at(-1),id);
  }
});

test('teacher: Students, Stop, Lesson and More carry the lesson-level actions',()=>{
  const c=classroom();
  // Students: same yellow button as the top bar, opens the same panel.
  const students=c.action('students');
  assert.ok(students.classList.contains('fa-primary'));
  students.click();assert.equal(c.state.panelOpen,true);
  c.tick();assert.equal(c.action('students').attrs['aria-pressed'],'true');
  // Stop is on the toolbar only in full screen (outside it the red Stop is right above the lesson).
  assert.equal(c.action('stop'),null);
  c.stage.classList.add('lesson-fullscreen');c.tick();
  assert.ok(c.action('stop').classList.contains('fa-danger'));
  assert.equal(c.action('stop').title,'Stop PDF');
  c.action('stop').click();assert.equal(c.clicks.at(-1),'cpStopBtn');
  // Lesson: switch what students see.
  c.action('lesson').click();
  assert.deepEqual(c.flyRows().map(b=>b.textContent),['🖥Share my screen','📝Whiteboard','📄PDF from this computer','🌐Webpage','📷Still picture of a tab','⏹Stop PDF']);
  c.flyRow('Whiteboard').click();assert.equal(c.clicks.at(-1),'openWhiteboard');
  // The PDF library and the share-view buttons appear once those scripts have added their buttons.
  c.add('button','pointerPdfLibrary').addEventListener('click',()=>c.clicks.push('library'));
  for(const id of ['viewChooseArea','viewShareFull','viewZoomIn','viewZoomOut','viewMove'])c.add('button',id).addEventListener('click',()=>c.clicks.push(id));
  c.action('lesson').click();
  c.flyRow('My PDF library').click();assert.equal(c.clicks.at(-1),'library');
  c.action('lesson').click();
  c.flyRow('Zoom in').click();assert.equal(c.clicks.at(-1),'viewZoomIn');
  assert.equal(c.fly.hidden,false,'zooming keeps the menu open');
  c.flyRow('Choose the part to share').click();assert.equal(c.clicks.at(-1),'viewChooseArea');
  // More: leave full screen, spotlight.
  c.action('more').click();
  assert.deepEqual(c.flyRows().map(b=>b.textContent),['⤢Exit full screen','🔦Spotlight']);
  c.flyRow('Spotlight').click();assert.equal(c.clicks.at(-1),'spotlight:true');
  c.action('more').click();
  assert.equal(c.flyRow('Spotlight: on').attrs['aria-pressed'],'true');
  c.flyRow('Exit full screen').click();assert.equal(c.clicks.at(-1),'exitFullScreenLesson');
  c.stage.classList.remove('lesson-fullscreen');c.tick();
  c.action('more').click();
  c.flyRow('Full screen').click();assert.equal(c.clicks.at(-1),'fullScreenLesson');
});

test('teacher: the More menu has no Save or My files rows (saved work is not part of the one-toolbar change)',()=>{
  const c=classroom();
  c.action('more').click();
  assert.equal(c.flyRow('Save'),undefined);assert.equal(c.flyRow('My files'),undefined);
  assert.doesNotMatch(adapterSrc,/FTTSavedWork/);
});

test('teacher: the toolbar has its own strip, so the lesson is never covered; it shrinks to the pencil when the lesson ends',()=>{
  const c=classroom();
  // Bar is 12..76px from the left: the page starts 8px after the bar.
  assert.ok(c.doc.body.classList.contains('cp-tool-gutter'));
  assert.equal(c.doc.body.style['--cp-tool-gutter'],'84px');
  c.stage.classList.add('lesson-fullscreen');c.tick();
  assert.equal(c.doc.body.style['--cp-tool-gutter'],'84px','the same strip in full screen');
  c.stage.classList.remove('lesson-fullscreen');c.tick();
  c.state.kind=null;c.tick();
  assert.equal(c.FA.state().mode,'mini');assert.equal(c.FA.state().surface,'viewport');
  assert.ok(!c.doc.body.classList.contains('cp-tool-gutter'),'no strip while the toolbar is a pencil');
  // In full screen the toolbar is the way out, so it stays open when the lesson ends there.
  c.state.kind='whiteboard';c.tick();
  assert.equal(c.FA.state().tool,'pen','a whiteboard starts with the pen');
  c.stage.classList.add('lesson-fullscreen');c.tick();c.state.kind=null;c.tick();
  assert.equal(c.FA.state().mode,'open');
  assert.ok(c.action('more'),'More (Exit full screen) is still there');
  const css=read('class-pointer-prototype/teacher-dashboard.css');
  assert.match(css,/body\.teacher-view\.cp-tool-gutter main\{padding-left:var\(--cp-tool-gutter\)!important\}/);
  assert.match(css,/body\.teacher-view\.cp-tool-gutter\.lesson-expanded #stage\.lesson-fullscreen\{left:var\(--cp-tool-gutter\)!important/);
});

test('student with a class link: the same toolbar, only with the tools the teacher allowed',()=>{
  const c=classroom({teacher:false});
  assert.equal(c.FA.state().mode,'open');assert.equal(c.FA.state().surface,'classroom');
  assert.equal(c.root.querySelector('.fa-actions').hidden,true,'no teacher buttons');
  assert.equal(c.tool('eraser').disabled,true);
  assert.equal(c.colorSel.value,'','starts on the class color');
  c.tool('pen').click();assert.equal(c.toolSel.value,'pen');
  c.byTitle('Undo my last change').click();assert.equal(c.clicks.at(-1),'undoStudentHighlight');
  c.byTitle('Erase all my marks here').click();assert.equal(c.clicks.at(-1),'clearStudentHighlights');
  // The teacher takes the pen and highlighter away: classroom.js disables those options and moves to a pointer.
  c.state.may={pointer:true,highlight:false,pen:false};
  for(const o of c.toolSel.options)if(!['target','arrow','star','heart','paw','sparkle'].includes(o.value))o.disabled=true;
  c.toolSel.value='target';c.toolSel.dispatchEvent(new c.Ev('change'));c.tick();
  assert.equal(c.FA.state().tool,'pointer');
  for(const name of ['pen','highlight','shape','text','eraser','select'])assert.equal(c.tool(name).disabled,true,name);
  assert.equal(c.tool('pointer').disabled,false);
  // Nothing allowed: no toolbar at all.
  c.state.may={pointer:false,highlight:false,pen:false};c.tick();
  assert.equal(c.FA.state().mode,'hidden');
});

test('the old dock is gone from the page; only hidden source controls stay',()=>{
  const html=read('class-pointer-prototype/classroom.html');
  assert.match(html,/<div id="teacherDock" hidden>/);
  assert.doesNotMatch(html,/class="teacher-dock"|tb-btn|tb-mode|tbFullscreen|tbStudentsBtn|tbCollapse|teacher-dock-left\.js|controls-redesign\.css/);
  for(const id of ['undoTeacherHighlight','clearTeacherHighlights','clearTeacher','clearAllHighlights','clearAll','spotlight','tbShareMenu','tbViewSlot','tbStudentsMenu','allowPointer','allowHighlight','allowPen','accessMode','pointerSelectAll','pointerClearAll','roster'])
    assert.ok(html.includes('id="'+id+'"'),'source control kept: '+id);
  assert.match(html,/<section class="tool-card student-tool-card" hidden>/);
  assert.ok(!fs.existsSync(path.join(repo,'class-pointer-prototype/teacher-dock-left.js')));
  assert.ok(!fs.existsSync(path.join(repo,'class-pointer-prototype/controls-redesign.css')));
  const plumbing=read('class-pointer-prototype/teacher-toolbar.js');
  assert.match(plumbing,/classList\.toggle\('teacher-view',!teacherPanel\.hidden\)/);
  assert.doesNotMatch(plumbing,/studentDock|cloneNode|tb-move-handle/);
  const full=read('class-pointer-prototype/lesson-fullscreen.js');
  assert.doesNotMatch(full,/fullscreenTeacherToolbar|studentDock|teacherDock/);
  for(const file of ['classroom.css','teacher-dashboard.css','workspace-layout.css'])
    assert.doesNotMatch(read('class-pointer-prototype/'+file),/\.teacher-dock|#teacherDock|\.tb-btn|\.tb-menu|dock-left|fullscreen-teacher-toolbar|student-dock-view/,file);
});

test('Students button: big, yellow, says what it is for, with a pulse and a one-time tip while live',()=>{
  const dash=read('class-pointer-prototype/teacher-dashboard.js'),css=read('class-pointer-prototype/teacher-dashboard.css');
  assert.match(dash,/el\('strong',null,'Students'\),el\('small',null,'who can point & draw'\)/);
  assert.match(dash,/'Let students point or draw: click here'/);
  assert.match(dash,/const HINT_KEY='classPointerStudentsHintSeen'/);
  assert.match(dash,/function dismissHint\(\)\{studentsHint\.hidden=true;if\(hintSeen\)return;hintSeen=true;try\{localStorage\.setItem\(HINT_KEY,'1'\)\}catch\{\}\}/);
  assert.match(dash,/studentsHint\.hidden=hintSeen\|\|!document\.body\.classList\.contains\('cp-is-live'\)\|\|!document\.body\.classList\.contains\('cp-drawer-closed'\)/);
  assert.match(dash,/studentsBtn\.addEventListener\('click',\(\)=>\{dismissHint\(\);/);
  // The toolbar's Students button opens the same panel (drawer, or overlay in full screen) and also dismisses the tip.
  assert.match(dash,/window\.ClassPointerStudentsPanel=\{\s*toggle\(\)\{dismissHint\(\);if\(isExpanded\(\)\)setOverlay\(!studentsOpen\(\)\);else setDrawer\(!studentsOpen\(\)\)\}/);
  assert.match(dash,/path\.some\(node=>node\?\.dataset\?\.action==='students'\)/);
  assert.match(css,/\.cp-students-toggle\{min-height:54px;[^}]*background:#ffd60a;[^}]*color:#17233b/);
  assert.match(css,/body\.cp-is-live\.cp-drawer-closed \.cp-students-toggle\{animation:cpStudentsPulse/);
  assert.match(css,/@media \(prefers-reduced-motion:reduce\)\{body\.cp-is-live\.cp-drawer-closed \.cp-students-toggle\{animation:none/);
  assert.match(toolbarSrc,/\.fa-act\.fa-primary\{[^}]*background:#ffd60a;color:#17233b/);
  // The guide tells the teacher where the button and the tools are.
  assert.match(dash,/Click the big yellow Students button \(top bar, or on the white toolbar in full screen\)/);
});
