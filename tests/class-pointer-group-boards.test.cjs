'use strict';
// Group work on student boards: students in a group share ONE board. The teacher's page checks every line a member draws,
// marks it with that member's code, and passes it on to the others; the teacher watches one tile per group and can draw
// on it; a member can only change their own lines; a student who leaves and comes back returns to the same group.
// Runs the real student-boards.js against small fakes (no browser, no Firebase), like the other board tests.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const wait=(predicate,message)=>new Promise((resolve,reject)=>{
  const start=Date.now(),timer=setInterval(()=>{
    let ok=false;try{ok=predicate()}catch{}
    if(ok){clearInterval(timer);resolve()}
    else if(Date.now()-start>2000){clearInterval(timer);reject(Error(message))}
  },5);
});

function makeDom(){
  const created=[],byId=new Map(),docListeners={};
  function element(tag){
    const node={
      tag,className:'',style:{cssText:'',setProperty(){}},dataset:{},children:[],listeners:{},attrs:{},hidden:false,disabled:false,
      textContent:'',title:'',value:'',clientWidth:800,clientHeight:600,tabIndex:0,srcObject:null,videoWidth:0,width:0,height:0,
      classList:{toggle(){},add(){},remove(){},contains(){return false}},
      setAttribute(k,v){this.attrs[k]=String(v)},getAttribute(k){return this.attrs[k]??null},
      append(...n){this.children.push(...n)},appendChild(n){this.children.push(n);return n},prepend(...n){this.children.unshift(...n)},
      replaceChildren(...n){this.children=n},after(){},before(){},insertBefore(n){this.children.push(n);return n},remove(){this.removed=true},focus(){},
      addEventListener(type,fn){(this.listeners[type]??=[]).push(fn)},
      dispatchEvent(){return true},
      click(){for(const fn of this.listeners.click||[])fn({stopPropagation(){},preventDefault(){},target:this})},
      change(){for(const fn of this.listeners.change||[])fn({stopPropagation(){},target:this})},
      getBoundingClientRect(){return{left:0,top:0,width:800,height:450}},getClientRects(){return[{}]},
      toDataURL(){return 'data:image/jpeg;base64,AAAA'},toBlob(fn){fn({size:1,type:'image/png'})},
      play(){return Promise.resolve()},getContext(){return new Proxy({},{get:(t,k)=>k in t?t[k]:()=>({width:10}),set:(t,k,v)=>{t[k]=v;return true}})},closest(){return null},querySelector(){return null},querySelectorAll(){return[]}
    };
    created.push(node);return node;
  }
  const document={
    activeElement:null,createElement:element,createTextNode:text=>({textContent:text}),
    getElementById:id=>byId.get(id)||null,
    addEventListener(type,fn){(docListeners[type]??=[]).push(fn)},
    dispatchEvent(event){for(const fn of docListeners[event.type]||[])fn(event);return true},
    querySelector:()=>null,querySelectorAll:()=>[],fullscreenElement:null,head:element('head'),body:element('body'),currentScript:null
  };
  class Event{constructor(type){this.type=type}}
  class CustomEvent extends Event{}
  class PointerEvent extends Event{}
  class ResizeObserver{observe(){}}
  class MutationObserver{observe(){}}
  return{created,byId,document,Event,CustomEvent,PointerEvent,ResizeObserver,MutationObserver,element};
}
function fakeToolbar(){
  const pushed=[];
  return{pushed,stack:[],
    push(s){if(!this.stack.includes(s)){this.stack.push(s);pushed.push(s.id)}},
    release(s){const i=this.stack.indexOf(s);if(i>=0)this.stack.splice(i,1);try{s.live?.(null,null)}catch{}},
    setReason(){},refresh(){},state:()=>({surface:'classroom'}),
    drawItem(){},cleanItem:item=>item,PALETTE:[]};
}
const stroke=(id,extra={})=>({id,tool:'pen',color:'#1f2937',size:0.006,points:[{x:.1,y:.1},{x:.4,y:.3}],...extra});
const ids=list=>Array.from(list,item=>item.id);
const memory=()=>{const data=new Map();return{getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k),data}};

function context(dom,window,extra={}){
  const ctx={
    window,document:dom.document,Event:dom.Event,CustomEvent:dom.CustomEvent,PointerEvent:dom.PointerEvent,ResizeObserver:dom.ResizeObserver,MutationObserver:dom.MutationObserver,
    URL,URLSearchParams,console,Promise,Date,JSON,Image:class{set src(v){this._s=v}get src(){return this._s}},
    getComputedStyle:()=>({columnGap:'10px',paddingLeft:'10px',paddingRight:'10px',paddingTop:'10px',paddingBottom:'10px'}),
    requestAnimationFrame:fn=>setTimeout(fn,0),
    setTimeout,clearTimeout,setInterval:(fn,ms)=>{const t=setInterval(fn,ms);t.unref?.();return t},clearInterval,
    location:{search:'?dashboard=teacher&class=et',href:'https://funtorahtools.com/class-pointer-prototype/classroom.html?dashboard=teacher&class=et'},
    firebase:{auth:()=>({currentUser:{getIdToken:async()=>'t'}})},
    fetch:async()=>({ok:true,status:200,json:async()=>({ok:true})}),
    confirm:()=>true,crypto:{randomUUID:()=>'send-'+Math.random().toString(36).slice(2,12)},
    ...extra
  };
  vm.createContext(ctx);
  for(const file of ['board-pages-core.js','board-groups-core.js','student-boards.js'])vm.runInContext(read('class-pointer-prototype/'+file),ctx);
  return ctx;
}

// A teacher with three students. Arik (m1) and Dan (m2) are in group g1; Yossi has no group.
async function teacherFixture({grouped=true}={}){
  const dom=makeDom(),{element}=dom;
  dom.byId.set('stage',element('section'));dom.byId.set('studentBoards',element('button'));dom.byId.set('joinLink',element('input'));dom.byId.set('endClass',element('button'));
  const sent=[];
  const make=(id,name)=>({id,name,studentId:id,admitted:true,peerId:'p'+id,connection:{open:true,id:'c-'+id}});
  const arik=make('arik','Arik'),dan=make('dan','Dan'),yossi=make('yossi','Yossi');
  const members=new Map([['arik',arik],['dan',dan],['yossi',yossi]]);
  const bridge={isTeacher:true,members:()=>members,started:()=>true,send:(connection,message)=>sent.push({connection,message,to:connection.id.slice(2)}),status(){},fail(error){throw Error(String(error))}};
  const toolbar=fakeToolbar(),storage=memory();
  if(grouped)storage.setItem('fttPointerGroups:et',JSON.stringify({at:Date.now(),state:{v:1,groups:[{id:'g1',name:'Lions'}],assign:{arik:{g:'g1',c:'m1',n:'Arik'},dan:{g:'g1',c:'m2',n:'Dan'}},next:3}}));
  const window={ClassPointerBridge:bridge,FTTAnnotate:toolbar,ClassPointerDashboard:{requestStudentDestination:async()=>{},setStudentScreenSharing:async()=>{},students:async()=>[]}};
  context(dom,window,{localStorage:storage});
  window.ClassPointerBoards.navigateWorkspace('whiteboards');
  await wait(()=>dom.created.some(node=>node.className==='boards-grid'&&node.children.length),'a tile appears');
  const grid=dom.created.find(node=>node.className==='boards-grid');
  const boards=window.ClassPointerBoards;
  const modeFor=(member)=>{sent.length=0;boards.studentJoined(member);return sent.map(e=>e.message).find(m=>m.type==='board-mode'&&m.on)};
  return{dom,window,toolbar,sent,arik,dan,yossi,members,grid,boards,storage,modeFor,
    from:(member,message)=>boards.fromStudent(member,message),
    to:who=>sent.filter(e=>e.to===who).map(e=>e.message),
    button:text=>dom.created.find(n=>n.tag==='button'&&n.textContent&&n.textContent.includes(text))};
}

test('students in a group get the same board and the group\'s name and members; a student with no group is on their own',async()=>{
  const f=await teacherFixture();
  const a=f.modeFor(f.arik),d=f.modeFor(f.dan),y=f.modeFor(f.yossi);
  assert.deepEqual([a.group.id,a.group.name,a.group.me],['g1','Lions','m1']);
  assert.deepEqual([d.group.id,d.group.me],['g1','m2'],'each member has a code of their own');
  assert.deepEqual(Array.from(a.group.members),['Arik','Dan']);
  assert.equal(y.group,undefined,'a student in no group is sent no group');
});

test('one tile for the group and one for the student with no group',async()=>{
  const f=await teacherFixture();
  await wait(()=>f.grid.children.length===2,'two tiles');
  const labels=f.grid.children.map(tile=>tile.children.find(c=>c.className==='board-name')?.textContent);
  assert.ok(labels.some(t=>/Lions/.test(t)&&/Arik/.test(t)&&/Dan/.test(t)),'the group tile names the group and its members: '+labels);
  assert.ok(labels.includes('Yossi'));
});

test('a line one member draws is marked with their code and passed on to the rest of the group, and to nobody else',async()=>{
  const f=await teacherFixture();
  f.sent.length=0;
  f.from(f.arik,{type:'board-add',pg:'pg0',stroke:stroke('s1',{who:'m9'})});
  const to=f.sent.filter(e=>e.message.type==='board-peer');
  assert.deepEqual(to.map(e=>e.to),['dan'],'only the other member of the group gets it');
  assert.equal(to[0].message.op.stroke.who,'m1','marked with Arik\'s code, whatever the message said');
  assert.equal(f.sent.filter(e=>e.to==='yossi').length,0);
  // A member who joins later (or refreshes) is sent the board with everyone's lines on it.
  const d=f.modeFor(f.dan);
  assert.deepEqual(ids(d.strokes),['s1']);assert.equal(d.strokes[0].who,'m1');
  assert.deepEqual(ids(f.modeFor(f.yossi).strokes),[],'a board of their own stays theirs');
});

test('a member can only change their own lines: others\' lines cannot be removed, moved or cleared',async()=>{
  const f=await teacherFixture();
  f.from(f.arik,{type:'board-add',pg:'pg0',stroke:stroke('s1')});
  f.from(f.dan,{type:'board-add',pg:'pg0',stroke:stroke('s2')});
  f.sent.length=0;
  f.from(f.arik,{type:'board-remove',pg:'pg0',ids:['s2']});
  f.from(f.arik,{type:'board-move',id:'s2',pg:'pg0',points:[{x:.2,y:.2},{x:.5,y:.5}]});
  assert.equal(f.sent.length,0,'nothing is changed or passed on');
  assert.deepEqual(ids(f.modeFor(f.dan).strokes),['s1','s2']);
  f.sent.length=0;
  f.from(f.arik,{type:'board-remove',pg:'pg0',ids:['s2','s1']});
  const removal=f.sent.find(e=>e.message.type==='board-peer');
  assert.deepEqual(Array.from(removal.message.op.ids),['s1'],'only the line that is theirs');
  // Clear removes only the clearing member\'s lines, for everyone.
  f.from(f.arik,{type:'board-add',pg:'pg0',stroke:stroke('s3')});
  f.sent.length=0;
  f.from(f.arik,{type:'board-clear',pg:'pg0'});
  const clear=f.sent.find(e=>e.message.type==='board-peer');
  assert.equal(clear.message.op.type,'board-remove');assert.deepEqual(Array.from(clear.message.op.ids),['s3']);
  assert.deepEqual(ids(f.modeFor(f.dan).strokes),['s2'],'Dan\'s line is still there');
});

test('pages: a page one member adds or removes is shared; moving to a page is each member\'s own',async()=>{
  const f=await teacherFixture();
  f.sent.length=0;
  f.from(f.arik,{type:'board-page-add',id:'pgB',after:'pg0'});
  f.from(f.arik,{type:'board-page-at',pg:'pgB'});
  const ops=f.sent.filter(e=>e.message.type==='board-peer').map(e=>e.message.op.type);
  assert.deepEqual(ops,['board-page-add'],'the new page is shared; walking to it is not');
  const d=f.modeFor(f.dan);
  assert.deepEqual(Array.from(d.pages,p=>p.id),['pg0','pgB']);
});

test('what one member is drawing right now is shown to the group',async()=>{
  const f=await teacherFixture();
  f.sent.length=0;
  f.from(f.arik,{type:'board-draft',pg:'pg0',stroke:stroke('s7')});
  const draft=f.sent.find(e=>e.message.type==='board-peer');
  assert.equal(draft.to,'dan');assert.equal(draft.message.op.type,'board-draft');
  f.from(f.arik,{type:'board-draft',pg:'pg0',stroke:null});
  assert.equal(f.sent.filter(e=>e.message.type==='board-peer').pop().message.op.stroke,null,'and cleared when the line is finished');
});

test('bad things are refused: unknown changes, other pages, and the page change of the teacher',async()=>{
  const f=await teacherFixture();
  f.sent.length=0;
  f.from(f.arik,{type:'board-put',stroke:stroke('t1')});
  f.from(f.arik,{type:'board-nonsense'});
  f.from(f.arik,{type:'board-add',pg:'nope',stroke:stroke('s1')});
  assert.equal(f.sent.filter(e=>e.message.type==='board-peer').length,0);
});

test('the teacher opens the group\'s tile and draws: every member gets the line',async()=>{
  const f=await teacherFixture();
  await wait(()=>f.grid.children.length===2,'two tiles');
  const groupTile=f.grid.children.find(tile=>tile.children.some(c=>c.className==='board-name'&&/Lions/.test(c.textContent)));
  groupTile.click();
  const surface=f.toolbar.stack.find(s=>s.id==='student-board');
  assert.ok(surface,'the toolbar is on the group board');
  assert.match(surface.label(),/Lions/);
  f.sent.length=0;
  surface.setItems([stroke('t1')]);
  const adds=f.sent.filter(e=>e.message.type==='board-add');
  assert.deepEqual(adds.map(e=>e.to).sort(),['arik','dan'],'both members, nobody else');
  assert.equal(adds[0].message.pg,'pg0');
  // A line from a member shows up on the teacher\'s view of the same board.
  f.from(f.arik,{type:'board-add',pg:'pg0',stroke:stroke('s1')});
  assert.deepEqual(ids(surface.getItems()),['t1','s1']);
});

test('pausing a group pauses all of its members, and allowing it lets them all back',async()=>{
  const f=await teacherFixture();
  await wait(()=>f.grid.children.length===2,'two tiles');
  const groupTile=f.grid.children.find(tile=>tile.children.some(c=>c.className==='board-name'&&/Lions/.test(c.textContent)));
  const block=groupTile.children.find(c=>c.tag==='button');
  f.sent.length=0;block.click();
  const paused=f.sent.filter(e=>e.message.type==='board-mode');
  assert.deepEqual(paused.map(e=>e.to).sort(),['arik','dan']);
  assert.ok(paused.every(e=>e.message.blocked===true));
  f.sent.length=0;
  f.from(f.arik,{type:'board-add',pg:'pg0',stroke:stroke('s1')});
  assert.equal(f.sent.filter(e=>e.message.type==='board-peer').length,0,'while the group is paused, a line from a member is not accepted');
  f.sent.length=0;block.click();
  assert.ok(f.sent.filter(e=>e.message.type==='board-mode').every(e=>e.message.blocked===false));
});

test('a student who leaves and comes back is in the same group, with the same board',async()=>{
  const f=await teacherFixture();
  f.from(f.dan,{type:'board-add',pg:'pg0',stroke:stroke('s5')});
  f.boards.studentLeft(f.dan);
  const back=f.modeFor(f.dan);
  assert.equal(back.group.id,'g1');assert.equal(back.group.me,'m2','the same code, so their lines are still theirs');
  assert.deepEqual(ids(back.strokes),['s5']);
});

test('Make random groups: every student here is placed, everyone is sent their group, and it is remembered',async()=>{
  const f=await teacherFixture({grouped:false});
  assert.equal(f.modeFor(f.arik).group,undefined);
  f.button('Groups').click();
  const amount=f.dom.created.find(n=>n.tag==='input'&&n.type==='number');
  assert.ok(amount,'the Groups window asks how many');
  amount.value='2';
  f.sent.length=0;
  f.button('Make random groups').click();
  const modes=f.sent.map(e=>e.message).filter(m=>m.type==='board-mode'&&m.on);
  assert.equal(modes.length,3);
  assert.ok(modes.every(m=>m.group),'everyone is in a group');
  assert.equal(new Set(modes.map(m=>m.group.id)).size,2);
  const saved=JSON.parse(f.storage.getItem('fttPointerGroups:et'));
  assert.equal(Object.keys(saved.state.assign).length,3,'the groups are kept in the browser');
});

test('Ungroup everyone puts every student back on their own board',async()=>{
  const f=await teacherFixture();
  f.from(f.arik,{type:'board-add',pg:'pg0',stroke:stroke('s1')});
  f.button('Groups').click();
  f.sent.length=0;
  f.button('Ungroup everyone').click();
  const modes=f.sent.map(e=>e.message).filter(m=>m.type==='board-mode'&&m.on);
  assert.ok(modes.length>=3&&modes.every(m=>!m.group));
  assert.deepEqual(ids(f.modeFor(f.arik).strokes),[],'their own board, not the group\'s');
  assert.equal(f.storage.getItem('fttPointerGroups:et'),null);
});

test('Send pages to the class: group boards get the pages too',async()=>{
  const f=await teacherFixture();
  const JPEG='data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  f.sent.length=0;
  await f.boards.sendPages([{id:'pgS1',bg:JPEG},{id:'pgS2',bg:JPEG}],{id:'send-abc12345'});
  const a=f.sent.map(e=>e.message).filter(m=>m.type==='board-mode'&&m.on);
  assert.equal(a.length,3);
  for(const m of a)assert.deepEqual(Array.from(m.pages,p=>p.id),['pgS1','pgS2']);
  assert.equal(a.filter(m=>m.group).length,2,'and the group is still a group');
});

test('Save group boards: one entry for each group that has something on it, with a picture of every page',async()=>{
  const f=await teacherFixture();
  let saved=null;
  f.window.FTTSavedWork={saveGroupBoards:async items=>{saved=items;return true}};
  await f.button('Save group boards').listeners.click[0]({});
  assert.equal(saved,null,'an empty group board is not saved');
  f.from(f.arik,{type:'board-add',pg:'pg0',stroke:stroke('s1')});
  f.from(f.arik,{type:'board-page-add',id:'pgB',after:'pg0'});
  await f.button('Save group boards').listeners.click[0]({});
  await wait(()=>saved,'it saved');
  assert.equal(saved.length,1);
  assert.match(saved[0].name,/Lions/);assert.match(saved[0].name,/Arik/);
  assert.equal(saved[0].pages.length,2);
  assert.match(saved[0].pages[0],/^data:image\/jpeg;base64,/);
  assert.ok(saved[0].picture);
});

// ---------- the student's side ----------
async function studentFixture(){
  const dom=makeDom(),{element}=dom;
  dom.byId.set('stage',element('section'));
  const sent=[],toolbar=fakeToolbar();
  const bridge={isTeacher:false,embedded:false,sendTeacher:message=>sent.push(message),status(){},fail(error){throw Error(String(error))}};
  const window={ClassPointerBridge:bridge,FTTAnnotate:toolbar};
  context(dom,window,{location:{search:'',href:'https://funtorahtools.com/class-pointer-prototype/classroom.html'},localStorage:memory()});
  const boards=window.ClassPointerBoards;
  const mode=(extra={})=>boards.fromTeacher({type:'board-mode',on:true,mode:'boards',strokes:[],text:null,tiles:null,...extra});
  return{dom,window,boards,sent,toolbar,mode,button:text=>dom.created.find(n=>n.tag==='button'&&n.textContent&&n.textContent.includes(text))};
}
const GROUP={id:'g1',name:'Lions',me:'m1',members:['Arik','Dan']};

test('a student in a group: the title shows the group, lines of the others arrive and are drawn but are not theirs to edit',async()=>{
  const f=await studentFixture();
  f.mode({group:GROUP,strokes:[stroke('s1',{who:'m2'}),stroke('s2',{who:'m1'}),stroke('s3')]});
  await wait(()=>f.toolbar.stack.some(s=>s.id==='board'),'the board is a toolbar surface');
  const surface=f.toolbar.stack.find(s=>s.id==='board');
  assert.deepEqual(ids(surface.getItems()),['s2','s3'],'my own lines (and ones with no owner mark yet), not Dan\'s');
  f.sent.length=0;
  surface.setItems([]);
  const removed=f.sent.find(m=>m.type==='board-remove');
  assert.deepEqual(Array.from(removed.ids).sort(),['s2','s3'],'taking my lines away never takes Dan\'s');
  assert.equal(f.boards.exportBoard().strokes.some(s=>s.id==='s1'),true,'Dan\'s line is still on the board');
  assert.match(f.dom.created.filter(n=>n.tag==='strong').map(n=>n.textContent).join('|'),/Lions/);
});

test('a student in a group: a line from the group arrives as a peer message and shows on the board',async()=>{
  const f=await studentFixture();
  f.mode({group:GROUP});
  f.boards.fromTeacher({type:'board-peer',op:{type:'board-add',pg:'pg0',stroke:stroke('s9',{who:'m2'})}});
  assert.deepEqual(ids(f.boards.exportBoard().strokes),['s9']);
  f.sent.length=0;
  f.boards.fromTeacher({type:'board-peer',op:{type:'board-remove',pg:'pg0',ids:['s9']}});
  assert.equal(f.boards.exportBoard().strokes.length,0);
  assert.equal(f.sent.length,0,'what arrives is never sent back');
});

test('a student with no group ignores peer messages, and an invalid group is ignored',async()=>{
  const f=await studentFixture();
  f.mode({});
  f.boards.fromTeacher({type:'board-peer',op:{type:'board-add',pg:'pg0',stroke:stroke('s9')}});
  assert.equal(f.boards.exportBoard().strokes.length,0);
  f.mode({group:{id:'<b>',name:'x',me:'m1',members:[]}});
  f.boards.fromTeacher({type:'board-peer',op:{type:'board-add',pg:'pg0',stroke:stroke('s9')}});
  assert.equal(f.boards.exportBoard().strokes.length,0,'a bad group means no group');
});

test('Clear in a group clears only my lines; with no group it clears as before',async()=>{
  const f=await studentFixture();
  f.mode({group:GROUP,strokes:[stroke('s1',{who:'m2'}),stroke('s2',{who:'m1'})]});
  f.sent.length=0;
  f.button('Clear').click();
  const sent=f.sent.find(m=>m.type==='board-remove');
  assert.deepEqual(Array.from(sent.ids),['s2']);
  assert.equal(f.sent.some(m=>m.type==='board-clear'),false);
  const solo=await studentFixture();
  solo.mode({strokes:[stroke('s2')]});
  solo.sent.length=0;
  solo.button('Clear').click();
  assert.ok(solo.sent.some(m=>m.type==='board-clear'));
});

test('the group name and the member codes are the only things a student takes from the group message',async()=>{
  const f=await studentFixture();
  f.mode({group:{...GROUP,name:'A'.repeat(100),members:Array.from({length:40},(_,i)=>'Student '+i)}});
  const saved=f.boards.exportBoard();
  assert.equal(saved.version,1,'saving a group board is an ordinary board file');
  assert.equal(f.dom.created.some(n=>n.tag==='strong'&&n.textContent.length>40),false,'the name is cut to a sensible length');
});

test('the teacher\'s classroom page loads the groups rules before the boards, with the release version',()=>{
  const html=read('class-pointer-prototype/classroom.html');
  assert.ok(html.indexOf('board-groups-core.js')>0&&html.indexOf('board-groups-core.js')<html.indexOf('student-boards.js'));
  assert.match(html,/board-groups-core\.js\?v=20261124-groups1/);
  assert.match(html,/student-boards\.js\?v=20261126-zn1/);
  // Students never need the groups rules: their board only shows the group the teacher names.
  assert.doesNotMatch(read('class-pointer-prototype/activity-share.js'),/board-groups-core/);
});

test('no rules, storage or function files are touched by group work',()=>{
  const board=read('class-pointer-prototype/student-boards.js');
  assert.doesNotMatch(board,/firebase\.(database|storage)\(\)/,'group boards live on the teacher\'s page; nothing is stored online');
});

// ---------- the teacher's toolbar carries the Groups button (the gallery's own top bar is hidden on the teacher page) ----------
test('the gallery\'s own top bar is hidden on the teacher page, so the drawing toolbar has the Groups button',()=>{
  assert.match(read('class-pointer-prototype/teacher-dashboard.css'),/body\.teacher-view\.cp-simple \.boards-view > \.boards-bar:first-child\{display:none!important\}/);
  const bar=read('class-pointer-prototype/classroom-annotate.js');
  assert.match(bar,/\{id:'groups',icon:'[^']+',label:'Groups'/);
  assert.match(bar,/hidden:!window\.ClassPointerBoards\?\.groups\?\.available\?\.\(\)/,'only while the student whiteboards are on screen');
  assert.match(bar,/label:active\?'Change groups':'Make groups'/);
  assert.match(bar,/label:'Save group boards'/);
  assert.match(read('class-pointer-prototype/classroom.html'),/classroom-annotate\.js\?v=20261126-zn1/);
});

test('the toolbar\'s Groups button works from the real boards: available with whiteboards, active with groups, opens the window, saves',async()=>{
  const f=await teacherFixture();
  const groups=f.boards.groups;
  assert.equal(groups.available(),true);assert.equal(groups.active(),true);
  groups.open();
  assert.ok(f.button('Make random groups'),'the Groups window is open');
  let saved=null;f.window.FTTSavedWork={saveGroupBoards:async items=>{saved=items}};
  f.from(f.arik,{type:'board-add',pg:'pg0',stroke:stroke('s1')});
  groups.save();
  await wait(()=>saved,'it saved');
  assert.equal(saved.length,1);
  const none=await teacherFixture({grouped:false});
  assert.equal(none.boards.groups.active(),false);
  none.boards.navigateWorkspace('teach');
  assert.equal(none.boards.groups.available(),false,'not while the teacher is showing the lesson');
});

test('Groups and Save group boards are in the "Send to all boards" bar, which is the bar the teacher sees',async()=>{
  const f=await teacherFixture();
  const bar=f.dom.created.find(n=>n.className==='boards-activity-bar');
  assert.ok(bar,'the Send to all boards bar exists');
  const labels=bar.children.filter(n=>n.tag==='button').map(n=>n.textContent);
  assert.ok(labels.some(t=>/Groups/.test(t)),'Groups: '+labels);
  assert.ok(labels.some(t=>/Save group boards/.test(t)));
  assert.equal(bar.hidden,false,'shown with the student whiteboards');
  const groups=bar.children.find(n=>n.tag==='button'&&/Groups/.test(n.textContent));
  assert.equal(groups.hidden,false);
  groups.click();
  assert.ok(f.button('Make random groups'),'it opens the Groups window');
  const solo=await teacherFixture({grouped:false});
  const soloBar=solo.dom.created.find(n=>n.className==='boards-activity-bar');
  assert.equal(soloBar.children.find(n=>n.tag==='button'&&/Save group boards/.test(n.textContent)).hidden,true,'Save group boards appears once there are groups');
});

// ---------- the regular Save on the toolbar saves the group board that is open large ----------
test('with a group board open large, the regular Save has that board to save; other screens do not',async()=>{
  const f=await teacherFixture();
  const api=f.boards;
  assert.equal(api.groupBoardOpen(),false,'in the gallery nothing is open large');
  await wait(()=>f.grid.children.length===2,'two tiles');
  const soloTile=f.grid.children.find(tile=>tile.children.some(c=>c.className==='board-name'&&c.textContent==='Yossi'));
  soloTile.click();
  assert.equal(api.groupBoardOpen(),false,'one student\'s own board is not a group board');
  f.dom.created.find(n=>n.tag==='button'&&/Back to gallery/.test(n.textContent)).click();
  const groupTile=f.grid.children.find(tile=>tile.children.some(c=>c.className==='board-name'&&/Lions/.test(c.textContent)));
  groupTile.click();
  assert.equal(api.groupBoardOpen(),true);
  assert.equal(await api.openGroupBoardItem(),null,'an empty group board has nothing to save yet');
  f.from(f.arik,{type:'board-add',pg:'pg0',stroke:stroke('s1')});
  const item=await api.openGroupBoardItem();
  assert.match(item.name,/Lions/);assert.equal(item.pages.length,1);assert.match(item.pages[0],/^data:image\/jpeg/);assert.ok(item.picture);
  api.navigateWorkspace('teach');
  assert.equal(api.groupBoardOpen(),false,'not while the teacher shows the lesson');
});

test('saved-work.js: Save checks for an open group board first, and saves it with the same code as Save group boards',()=>{
  const src=read('class-pointer-prototype/saved-work.js');
  const start=src.indexOf('async function saveCurrent(){');
  const head=src.slice(start,src.indexOf("const ui=openDialog(teacherPage?'Save whiteboard'",start));
  assert.match(head,/teacherPage&&window\.ClassPointerBoards\?\.groupBoardOpen\?\.\(\)/);
  assert.match(head,/return saveGroupBoards\(\[item\]\)/);
  assert.match(head,/This group board is empty/);
  assert.match(read('class-pointer-prototype/saved-work.js'),/saveGroupBoards,keepTeacherCopy/);
});
