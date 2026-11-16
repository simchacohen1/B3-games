'use strict';
// The teacher's drawing toolbar on a student's board and on a student's shared screen: the marks must be sent to
// that student (so they show live on his own screen and come back after he refreshes), and the toolbar must offer
// the same tools as the main whiteboard. Runs the real scripts against small fakes (no browser, no Firebase).
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
      textContent:'',title:'',value:'',clientWidth:800,clientHeight:600,tabIndex:0,srcObject:null,videoWidth:0,
      classList:{toggle(){},add(){},remove(){},contains(){return false}},
      setAttribute(k,v){this.attrs[k]=String(v)},getAttribute(k){return this.attrs[k]??null},
      append(...n){this.children.push(...n)},appendChild(n){this.children.push(n);return n},prepend(...n){this.children.unshift(...n)},
      replaceChildren(...n){this.children=n},after(){},remove(){this.removed=true},focus(){},
      addEventListener(type,fn){(this.listeners[type]??=[]).push(fn)},
      dispatchEvent(){return true},
      click(){for(const fn of this.listeners.click||[])fn({stopPropagation(){},target:this})},
      getBoundingClientRect(){return{left:0,top:0,width:800,height:450}},
      play(){return Promise.resolve()},getContext(){return new Proxy({},{get:(t,k)=>k in t?t[k]:()=>({width:10})  ,set:(t,k,v)=>{t[k]=v;return true}})},closest(){return null},querySelector(){return null},querySelectorAll(){return[]}
    };
    created.push(node);return node;
  }
  const document={
    activeElement:null,createElement:element,createTextNode:text=>({textContent:text}),
    getElementById:id=>byId.get(id)||null,
    addEventListener(type,fn){(docListeners[type]??=[]).push(fn)},
    dispatchEvent(event){for(const fn of docListeners[event.type]||[])fn(event);return true},
    querySelector:()=>null,querySelectorAll:()=>[]
  };
  class Event{constructor(type){this.type=type}}
  class CustomEvent extends Event{}
  class PointerEvent extends Event{}
  class ResizeObserver{observe(){}}
  class MutationObserver{observe(){}}
  return{created,byId,document,Event,CustomEvent,PointerEvent,ResizeObserver,MutationObserver,element};
}

// A stand-in for the shared drawing toolbar: it only remembers which surfaces were pushed and released.
function fakeToolbar(){
  const pushed=[];
  return{pushed,stack:[],
    push(s){if(!this.stack.includes(s)){this.stack.push(s);pushed.push(s.id)}},
    release(s){const i=this.stack.indexOf(s);if(i>=0)this.stack.splice(i,1);try{s.live?.(null,null)}catch{}},
    setReason(){},refresh(){},state:()=>({surface:'classroom'}),
    drawItem(){},cleanItem:item=>item,PALETTE:[]};
}

const ids=list=>Array.from(list,item=>item.id);
const stroke=(id,extra={})=>({id,tool:'pen',color:'#1f2937',size:0.006,points:[{x:.1,y:.1},{x:.4,y:.3}],...extra});

async function boardFixture(){
  const dom=makeDom(),{document,element}=dom;
  const stage=element('section'),toggle=element('button'),joinLink=element('input'),endClass=element('button');
  dom.byId.set('stage',stage);dom.byId.set('studentBoards',toggle);dom.byId.set('joinLink',joinLink);dom.byId.set('endClass',endClass);
  const sent=[];
  const member={id:'m1',name:'Arik',studentId:'arik',admitted:true,peerId:'p1',connection:{open:true,id:'c1'}};
  const members=new Map([['m1',member]]);
  const bridge={isTeacher:true,members:()=>members,started:()=>true,send:(connection,message)=>sent.push({connection,message}),status(){},fail(error){throw Error(String(error))}};
  const toolbar=fakeToolbar();
  const window={ClassPointerBridge:bridge,FTTAnnotate:toolbar,
    ClassPointerDashboard:{requestStudentDestination:async()=>{},setStudentScreenSharing:async()=>{},students:async()=>[]}};
  const ctx={
    window,document,Event:dom.Event,CustomEvent:dom.CustomEvent,PointerEvent:dom.PointerEvent,ResizeObserver:dom.ResizeObserver,MutationObserver:dom.MutationObserver,
    URL,URLSearchParams,console,Promise,
    getComputedStyle:()=>({columnGap:'10px',paddingLeft:'10px',paddingRight:'10px',paddingTop:'10px',paddingBottom:'10px'}),
    requestAnimationFrame:fn=>setTimeout(fn,0),
    setTimeout,clearTimeout,setInterval:(fn,ms)=>{const t=setInterval(fn,ms);t.unref?.();return t},clearInterval,
    location:{search:'?dashboard=teacher&class=et',href:'https://funtorahtools.com/class-pointer-prototype/classroom.html?dashboard=teacher&class=et'},
    firebase:{auth:()=>({currentUser:{getIdToken:async()=>'teacher-id-token'}})},
    fetch:async()=>({ok:true,status:200,json:async()=>({ok:true})}),
    confirm:()=>true
  };
  vm.createContext(ctx);
  vm.runInContext(read('class-pointer-prototype/student-boards.js'),ctx);
  window.ClassPointerBoards.navigateWorkspace('whiteboards');
  await wait(()=>dom.created.some(node=>node.className==='boards-grid'&&node.children.length),'the student tile appears');
  const grid=dom.created.find(node=>node.className==='boards-grid');
  return{dom,window,toolbar,sent,member,grid,tile:grid.children[0]};
}

test('Student whiteboards: opening one board puts the shared toolbar on it, and leaving takes it off',async()=>{
  const f=await boardFixture();
  assert.ok(!f.toolbar.pushed.includes('student-board'),'nothing is pushed while only the gallery shows');
  f.tile.click();
  assert.ok(f.toolbar.pushed.includes('student-board'),'the student board is a surface of the toolbar');
  const surface=f.toolbar.stack.find(s=>s.id==='student-board');
  assert.equal(surface.idPrefix,'t','teacher marks carry teacher ids');
  assert.deepEqual(Array.from(surface.tools),['select','highlight','text','shape','eraser','pen'],'the same tools as the main whiteboard that a board can keep');
  assert.equal(surface.hideUnused,true);
  assert.ok(surface.rect(),'the surface covers the large board');
  assert.match(surface.label(),/Arik/);
  // Back to gallery
  const back=f.dom.created.find(node=>node.tag==='button'&&/Back to gallery/.test(node.textContent));
  back.click();
  assert.ok(!f.toolbar.stack.some(s=>s.id==='student-board'),'the toolbar surface is released');
});

test('Student whiteboards: the teacher\'s marks are sent to that student and kept for his refresh',async()=>{
  const f=await boardFixture();
  f.tile.click();
  const surface=f.toolbar.stack.find(s=>s.id==='student-board');
  f.sent.length=0;
  surface.setItems([stroke('t1'),stroke('t2',{tool:'rect',size:0.006})]);
  const adds=f.sent.filter(entry=>entry.message.type==='board-add');
  assert.equal(adds.length,2,'each new mark goes to the student');
  assert.ok(adds.every(entry=>entry.connection===f.member.connection),'to that student\'s connection');
  assert.deepEqual(Array.from(adds,entry=>entry.message.stroke.id),['t1','t2']);
  assert.deepEqual(ids(surface.getItems()),['t1','t2'],'the toolbar sees the marks it made');
  // The student refreshes: the board he is sent again carries the teacher's marks.
  f.sent.length=0;
  f.window.ClassPointerBoards.studentJoined(f.member);
  const mode=f.sent.map(entry=>entry.message).find(message=>message.type==='board-mode'&&message.on);
  assert.ok(mode,'the student is sent his board again');
  assert.deepEqual(ids(mode.strokes),['t1','t2'],'with the teacher\'s marks on it');
  // Erasing or undoing removes them from the student's board too.
  f.sent.length=0;
  surface.setItems([stroke('t2',{tool:'rect'})]);
  const removed=f.sent.find(entry=>entry.message.type==='board-remove');
  assert.deepEqual(Array.from(removed.message.ids),['t1']);
  // A student's own marks are never touched by the teacher's toolbar.
  f.window.ClassPointerBoards.fromStudent(f.member,{type:'board-add',stroke:stroke('s1')});
  assert.deepEqual(ids(surface.getItems()),['t2']);
});

test('Student whiteboards: the line being drawn is shown live on the student\'s board',async()=>{
  const f=await boardFixture();
  f.tile.click();
  const surface=f.toolbar.stack.find(s=>s.id==='student-board');
  f.sent.length=0;
  surface.live(stroke('t9'),null);
  const draft=f.sent.find(entry=>entry.message.type==='board-draft');
  assert.ok(draft,'a live draft is sent');
  assert.equal(draft.message.stroke.id,'t9');
  assert.equal(draft.connection,f.member.connection);
  surface.live(null,null);
  assert.equal(f.sent.filter(entry=>entry.message.type==='board-draft').pop().message.stroke,null,'and cleared when the line is finished');
});

test('Student whiteboards: nothing is sent once the boards are hidden',async()=>{
  const f=await boardFixture();
  f.tile.click();
  const surface=f.toolbar.stack.find(s=>s.id==='student-board');
  f.window.ClassPointerBoards.navigateWorkspace('teach');
  f.sent.length=0;
  surface.setItems([stroke('t1')]);
  assert.equal(f.sent.filter(entry=>entry.message.type==='board-add').length,0,'nothing is sent when the boards are hidden');
  assert.equal(surface.rect(),null,'and the surface has no area');
});

test('Student screen: the teacher\'s toolbar there has the same tools as the main whiteboard',async()=>{
  const dom=makeDom(),{document,element}=dom;
  const sent=[];
  const member={id:'m1',name:'Arik',studentId:'arik',admitted:true,peerId:'p1',connection:{open:true}};
  const bridge={isTeacher:true,members:()=>new Map([['m1',member]]),presence:()=>new Map(),send:(connection,message)=>sent.push(message),status(){},fail(){}};
  const toolbar=fakeToolbar();
  const window={ClassPointerBridge:bridge,FTTAnnotate:toolbar};
  const ctx={window,document,console,Promise,URL,requestAnimationFrame:fn=>setTimeout(fn,0),setTimeout,clearTimeout,
    ResizeObserver:dom.ResizeObserver,devicePixelRatio:1};
  vm.createContext(ctx);
  vm.runInContext(read('class-pointer-prototype/screen-annotate.js'),ctx);
  const host=element('div'),video=element('video');
  video.srcObject={};video.videoWidth=1600;video.videoHeight=900;
  const api=window.ClassPointerScreenMarks.attach(host,video,()=>({id:'arik',name:'Arik',members:[member]}));
  api.refresh();
  await wait(()=>toolbar.stack.some(s=>s.id==='screen'),'the screen becomes a toolbar surface');
  const surface=toolbar.stack.find(s=>s.id==='screen');
  assert.deepEqual(Array.from(surface.tools),['select','pointer','highlight','text','shape','eraser','pen'],'Select, Pointer, Highlight, Text, Shapes, Eraser, Pen: no separate Hand');
  assert.equal(surface.hideUnused,true);
  assert.equal(surface.defaultTool,'pointer');
  // A mark made on the screen reaches the student.
  surface.setItems([stroke('t5')]);
  const marks=sent.filter(message=>message.type==='board-screen-marks').pop();
  assert.deepEqual(ids(marks.strokes),['t5']);
  // If the student's tab reconnects, the marks come back to it.
  sent.length=0;
  window.ClassPointerScreenMarks.resend(member);
  assert.deepEqual(ids(sent.filter(message=>message.type==='board-screen-marks')[0].strokes),['t5']);
});
