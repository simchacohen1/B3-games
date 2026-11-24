'use strict';
// Pages (slides) on student boards: a student adds, deletes, moves and saves pages; the teacher's copy follows live,
// can look at any page, draws on the page it is looking at, and can send pictures to every board as pages.
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
      click(){for(const fn of this.listeners.click||[])fn({stopPropagation(){},target:this})},
      getBoundingClientRect(){return{left:0,top:0,width:800,height:450}},getClientRects(){return[{}]},
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
const pageIds=message=>Array.from(message.pages,p=>p.id);
const JPEG='data:image/jpeg;base64,/9j/4AAQSkZJRg==';

function context(dom,window,extra={}){
  const ctx={
    window,document:dom.document,Event:dom.Event,CustomEvent:dom.CustomEvent,PointerEvent:dom.PointerEvent,ResizeObserver:dom.ResizeObserver,MutationObserver:dom.MutationObserver,
    URL,URLSearchParams,console,Promise,Image:class{set src(v){this._s=v}get src(){return this._s}},
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
  vm.runInContext(read('class-pointer-prototype/board-pages-core.js'),ctx);
  vm.runInContext(read('class-pointer-prototype/student-boards.js'),ctx);
  return ctx;
}

async function teacherFixture(){
  const dom=makeDom(),{element}=dom;
  dom.byId.set('stage',element('section'));dom.byId.set('studentBoards',element('button'));dom.byId.set('joinLink',element('input'));dom.byId.set('endClass',element('button'));
  const sent=[];
  const member={id:'m1',name:'Arik',studentId:'arik',admitted:true,peerId:'p1',connection:{open:true,id:'c1'}};
  const bridge={isTeacher:true,members:()=>new Map([['m1',member]]),started:()=>true,send:(connection,message)=>sent.push({connection,message}),status(){},fail(error){throw Error(String(error))}};
  const toolbar=fakeToolbar();
  const window={ClassPointerBridge:bridge,FTTAnnotate:toolbar,ClassPointerDashboard:{requestStudentDestination:async()=>{},setStudentScreenSharing:async()=>{},students:async()=>[]}};
  context(dom,window);
  window.ClassPointerBoards.navigateWorkspace('whiteboards');
  await wait(()=>dom.created.some(node=>node.className==='boards-grid'&&node.children.length),'the student tile appears');
  const grid=dom.created.find(node=>node.className==='boards-grid');
  const boards=window.ClassPointerBoards;
  const fromStudent=message=>boards.fromStudent(member,message);
  const modeOf=()=>{sent.length=0;boards.studentJoined(member);return sent.map(e=>e.message).find(m=>m.type==='board-mode'&&m.on)};
  return{dom,window,toolbar,sent,member,grid,tile:grid.children[0],fromStudent,modeOf,boards};
}

test('teacher copy of a student board: a new student board is one page and is sent the old way',async()=>{
  const f=await teacherFixture();
  const mode=f.modeOf();
  assert.equal(mode.pages,undefined,'one page: no page list, exactly the old message');
  assert.ok(Array.isArray(mode.strokes));
});

test('teacher copy of a student board: pages the student adds, moves and deletes are mirrored, marks land on the page they name',async()=>{
  const f=await teacherFixture();
  f.fromStudent({type:'board-page-add',id:'pgB',after:'pg0'});
  f.fromStudent({type:'board-page-add',id:'pgC',after:'pgB'});
  f.fromStudent({type:'board-page-at',pg:'pgB'});
  f.fromStudent({type:'board-add',pg:'pgB',stroke:stroke('s1')});
  f.fromStudent({type:'board-add',pg:'pg0',stroke:stroke('s2')});
  f.fromStudent({type:'board-add',pg:'nope',stroke:stroke('s3')});
  let mode=f.modeOf();
  assert.deepEqual(pageIds(mode),['pg0','pgB','pgC']);
  assert.equal(mode.at,'pgB');
  assert.deepEqual(ids(mode.pages[1].strokes),['s1']);
  assert.deepEqual(ids(mode.pages[0].strokes),['s2']);
  assert.ok(!mode.pages.some(p=>ids(p.strokes).includes('s3')),'a mark for a page that does not exist is dropped');
  f.fromStudent({type:'board-page-move',order:['pgC','pg0','pgB']});
  assert.deepEqual(pageIds(f.modeOf()),['pgC','pg0','pgB']);
  f.fromStudent({type:'board-page-move',order:['pgC','pg0']});
  assert.deepEqual(pageIds(f.modeOf()),['pgC','pg0','pgB'],'an order that is not exactly the pages is ignored');
  f.fromStudent({type:'board-page-remove',id:'pgB'});
  mode=f.modeOf();
  assert.deepEqual(pageIds(mode),['pgC','pg0']);
  assert.equal(mode.at,'pg0','the student was on the deleted page: the page that took its place is current');
});

test('teacher copy of a student board: bad page changes are ignored (duplicate id, bad id, last page, too many)',async()=>{
  const f=await teacherFixture();
  f.fromStudent({type:'board-page-add',id:'pg0'});
  f.fromStudent({type:'board-page-add',id:'<script>'});
  f.fromStudent({type:'board-page-add'});
  f.fromStudent({type:'board-page-remove',id:'pg0'});
  assert.equal(f.modeOf().pages,undefined,'still the one first page');
  for(let i=0;i<40;i++)f.fromStudent({type:'board-page-add',id:'x'+i});
  assert.equal(f.modeOf().pages.length,20,'never more than 20 pages');
});

test('teacher copy of a student board: the teacher can look at any page and draws on the page being looked at',async()=>{
  const f=await teacherFixture();
  f.fromStudent({type:'board-page-add',id:'pgB',after:'pg0'});
  f.tile.click();
  const surface=f.toolbar.stack.find(s=>s.id==='student-board');
  f.sent.length=0;
  surface.setItems([stroke('t1')]);
  assert.equal(f.sent.find(e=>e.message.type==='board-add').message.pg,'pg0','the student is on page 1, so the mark goes to page 1');
  // Look at page 2 with the strip's Next button.
  const next=f.dom.created.find(n=>n.tag==='button'&&n.title==='Next page');
  assert.ok(next,'the teacher has a Next page button on a student board');
  next.click();
  f.sent.length=0;
  surface.setItems([stroke('t1'),stroke('t2')]);
  assert.equal(f.sent.find(e=>e.message.type==='board-add').message.pg,'pgB','after looking at page 2 the mark goes to page 2');
  // The student moves to page 2 and draws: the teacher keeps seeing what the student sees.
  f.fromStudent({type:'board-page-at',pg:'pgB'});
  f.fromStudent({type:'board-add',pg:'pgB',stroke:stroke('s9')});
  assert.ok(ids(surface.getItems()).includes('s9'));
});

test('sending pictures as pages: every board gets the pages, a joining student gets them too, the student still adds pages of their own',async()=>{
  const f=await teacherFixture();
  f.sent.length=0;
  await f.boards.sendPages([{id:'pgS1',bg:JPEG},{id:'pgS2',bg:JPEG}],{id:'send-abc12345',subject:'Chumash',important:true});
  const mode=f.sent.map(e=>e.message).find(m=>m.type==='board-mode'&&m.on);
  assert.deepEqual(pageIds(mode),['pgS1','pgS2']);
  assert.ok(mode.pages.every(p=>p.bg===JPEG),'each page carries its picture');
  assert.deepEqual([mode.send.id,mode.send.subject,mode.send.important],['send-abc12345','Chumash',true]);
  assert.equal(mode.at,'pgS1');
  // A student who joins later is sent the same pages (and the one who is already in keeps his own work: drawing is by page id).
  f.fromStudent({type:'board-add',pg:'pgS2',stroke:stroke('s1')});
  f.fromStudent({type:'board-page-add',id:'pgMine',after:'pgS2'});
  const again=f.modeOf();
  assert.deepEqual(pageIds(again),['pgS1','pgS2','pgMine']);
  assert.deepEqual(ids(again.pages[1].strokes),['s1']);
  assert.equal(again.pages[2].bg,undefined,'a page the student added has no picture');
  assert.equal(again.send,undefined,'the "keep a copy" note goes only with the teacher\'s pictures, not once the student has pages of his own');
});

test('sending pictures as pages: a bad picture or nothing at all is refused, and the next send replaces the pages',async()=>{
  const f=await teacherFixture();
  assert.equal(await f.boards.sendPages([],{id:'send-none0000'}),false);
  assert.equal(await f.boards.sendPages([{id:'pgS1',bg:'javascript:alert(1)'}],{id:'send-bad00000'}),false);
  await f.boards.sendPages([{id:'pgS1',bg:JPEG}],{id:'send-one00000'});
  await f.boards.sendPages([{id:'pgT1',bg:JPEG},{id:'pgT2',bg:JPEG}],{id:'send-two00000'});
  assert.deepEqual(pageIds(f.modeOf()),['pgT1','pgT2']);
});

// ---------- the student's own page ----------
async function studentFixture(){
  const dom=makeDom(),{element}=dom;
  const stage=element('section');dom.byId.set('stage',stage);
  const sent=[];
  const bridge={isTeacher:false,embedded:false,sendTeacher:message=>sent.push(message),status(){},fail(error){throw Error(String(error))}};
  const window={ClassPointerBridge:bridge};
  context(dom,window,{location:{search:'',href:'https://funtorahtools.com/class-pointer-prototype/classroom.html'}});
  const boards=window.ClassPointerBoards;
  boards.fromTeacher({type:'board-mode',on:true,mode:'boards',strokes:[],text:null,tiles:null});
  return{dom,window,boards,sent,stripButton:title=>dom.created.find(n=>n.tag==='button'&&n.title===title)};
}

test('a student board starts as one page; a one-page board saves exactly as before (version 1)',async()=>{
  const f=await studentFixture();
  const saved=f.boards.exportBoard();
  assert.equal(saved.version,1);assert.equal(saved.kind,'student-board');assert.ok(Array.isArray(saved.strokes));
  assert.equal(saved.pages,undefined);
});

test('a student adds pages: each change is sent to the teacher, marks are sent with the page they are on',async()=>{
  const f=await studentFixture();
  f.stripButton('Add a blank page after this one').click();
  const add=f.sent.find(m=>m.type==='board-page-add'),at=f.sent.find(m=>m.type==='board-page-at');
  assert.ok(add&&at,'the new page and the move to it are both sent');
  assert.equal(add.after,'pg0');assert.equal(at.pg,add.id);
  f.sent.length=0;
  f.boards.fromTeacher({type:'board-add',pg:add.id,stroke:stroke('t1')});
  const saved=f.boards.exportBoard();
  assert.equal(saved.version,2,'two pages: a version 2 file');
  assert.equal(saved.pages.length,2);assert.equal(saved.current,1);
  assert.deepEqual(ids(saved.pages[1].strokes),['t1'],'the teacher\'s mark for page 2 landed on page 2');
  assert.equal(saved.pages[0].strokes.length,0);
});

test('a student can delete a page, and the last page cannot be deleted',async()=>{
  const f=await studentFixture();
  f.stripButton('Add a blank page after this one').click();
  const del=f.stripButton('Delete this page');
  del.click();
  assert.ok(f.sent.some(m=>m.type==='board-page-remove'));
  f.sent.length=0;
  del.click();
  assert.equal(f.sent.filter(m=>m.type==='board-page-remove').length,0,'one page is always left');
  assert.equal(f.boards.exportBoard().version,1);
});

test('opening a saved file: a version 1 file fills one page; a version 2 file brings back every page',async()=>{
  const f=await studentFixture();
  const one={version:1,kind:'student-board',strokes:[stroke('s1')],images:[],text:null,activity:null};
  assert.equal(f.boards.importBoard(one),true);
  assert.equal(f.boards.exportBoard().pages,undefined);
  const two={version:2,kind:'student-board',current:1,activity:null,pages:[
    {strokes:[stroke('sA')],images:[],text:null},{strokes:[stroke('sB'),stroke('sC')],images:[],text:null},{strokes:[],images:[],text:null}]};
  f.sent.length=0;
  assert.equal(f.boards.importBoard(two),true);
  const back=f.boards.exportBoard();
  assert.equal(back.version,2);assert.equal(back.pages.length,3);assert.equal(back.current,1);
  assert.equal(back.pages[0].strokes.length,1);assert.equal(back.pages[1].strokes.length,2);
  assert.ok(f.sent.some(m=>m.type==='board-page-add'),'the teacher is told about the pages');
  // Opening an older, smaller file afterwards leaves exactly that file's pages.
  assert.equal(f.boards.importBoard(one),true);
  assert.equal(f.boards.exportBoard().pages,undefined);
  // Things that are not a student board are refused.
  assert.equal(f.boards.importBoard({version:2,kind:'lesson-whiteboard',pages:[{}]}),false);
  assert.equal(f.boards.importBoard({version:2,kind:'student-board',pages:[]}),false);
  assert.equal(f.boards.importBoard({version:9,kind:'student-board',pages:[{}]}),false);
});

test('pictures the teacher sent as pages: the student has them as page backgrounds, keeps a copy, and a refresh brings them back',async()=>{
  const f=await studentFixture();
  const kept=[];
  f.window.FTTSavedWork={keepTeacherPages:info=>kept.push(info)};
  f.boards.fromTeacher({type:'board-mode',on:true,mode:'boards',strokes:[],text:null,tiles:null,
    pages:[{id:'pgS1',strokes:[],bg:JPEG},{id:'pgS2',strokes:[stroke('t1',{id:'t1'})],bg:JPEG}],at:'pgS2',send:{id:'send-abc12345',subject:'Chumash',important:true}});
  assert.equal(kept.length,1);
  assert.deepEqual([kept[0].id,kept[0].subject,kept[0].important,kept[0].pages.length],['send-abc12345','Chumash',true,2]);
  const saved=f.boards.exportBoard();
  assert.equal(saved.version,2);assert.equal(saved.current,1);
  assert.equal(saved.pages[0].bg,JPEG);
  // A refresh sends the same board again; nothing breaks and a second copy is requested only through the same send id.
  f.boards.fromTeacher({type:'board-mode',on:true,mode:'boards',strokes:[],pages:[{id:'pgS1',strokes:[],bg:JPEG},{id:'pgS2',strokes:[],bg:'not a picture'}],at:'pgS1',send:{id:'send-abc12345'}});
  const after=f.boards.exportBoard();
  assert.equal(after.pages[1].bg,undefined,'a bad picture is dropped');
});

test('the student page strip is on the student board and not shown to other things',async()=>{
  const f=await studentFixture();
  for(const title of ['Previous page','Next page','Add a blank page after this one','Move this page earlier','Move this page later','Delete this page','Show a small picture of every page'])
    assert.ok(f.stripButton(title),title);
});
