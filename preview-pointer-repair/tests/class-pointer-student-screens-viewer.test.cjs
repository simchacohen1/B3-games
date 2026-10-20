'use strict';
// Teacher "Student Screens" viewer: a boy sharing from Shorashim (not joined to Pointer) must appear in the gallery
// tile and in the large viewer, Back to gallery must return, and the teacher dashboard must open a class without
// flashing the class chooser. Runs the real scripts against small fakes (no browser, no Firebase).
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
      textContent:'',title:'',value:'',clientWidth:800,clientHeight:600,tabIndex:0,srcObject:null,
      classList:{toggle(){},add(){},remove(){},contains(){return false}},
      setAttribute(k,v){this.attrs[k]=String(v)},getAttribute(k){return this.attrs[k]??null},
      append(...n){this.children.push(...n)},appendChild(n){this.children.push(n);return n},prepend(...n){this.children.unshift(...n)},
      replaceChildren(...n){this.children=n},after(){},remove(){this.removed=true},focus(){},
      addEventListener(type,fn){(this.listeners[type]??=[]).push(fn)},
      dispatchEvent(){return true},
      click(){for(const fn of this.listeners.click||[])fn({stopPropagation(){},target:this})},
      play(){return Promise.resolve()},getContext(){return{}},closest(){return null},querySelector(){return null},querySelectorAll(){return[]}
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

// ---------- Student Screens: gallery, large viewer, Back to gallery ----------
async function viewerFixture(){
  const dom=makeDom(),{document,element}=dom;
  const stage=element('section'),toggle=element('button'),joinLink=element('input'),endClass=element('button');
  const room='class-pointer-12345678-1234-1234-1234-123456789abc';
  joinLink.value='https://funtorahtools.com/class-pointer-prototype/classroom.html?room='+room;
  dom.byId.set('stage',stage);dom.byId.set('studentBoards',toggle);dom.byId.set('joinLink',joinLink);dom.byId.set('endClass',endClass);
  // A boy who is connected from Shorashim: on the roster and admitted, but he has no Pointer screen call.
  const member={id:'m1',name:'Arik',studentId:'arik',admitted:true,peerId:'p1'};
  const members=new Map([['m1',member]]);
  const bridge={isTeacher:true,members:()=>members,started:()=>true,send(){},status(){},fail(error){throw Error(String(error))}};
  const window={ClassPointerBridge:bridge};
  const ctx={
    window,document,Event:dom.Event,CustomEvent:dom.CustomEvent,PointerEvent:dom.PointerEvent,ResizeObserver:dom.ResizeObserver,MutationObserver:dom.MutationObserver,
    URL,URLSearchParams,console,Promise,
    getComputedStyle:()=>({columnGap:'10px',paddingLeft:'10px',paddingRight:'10px',paddingTop:'10px',paddingBottom:'10px'}),
    requestAnimationFrame:fn=>setTimeout(fn,0),
    setTimeout,clearTimeout,setInterval:(fn,ms)=>{const t=setInterval(fn,ms);t.unref?.();return t},clearInterval,
    location:{search:'?dashboard=teacher&class=et',href:'https://funtorahtools.com/class-pointer-prototype/classroom.html?dashboard=teacher&class=et'},
    firebase:{auth:()=>({currentUser:{getIdToken:async()=>'teacher-id-token'}})},
    fetch:async()=>({ok:true,status:200,json:async()=>({ok:true,studentId:'arik',studentName:'Arik'})})
  };
  vm.createContext(ctx);
  vm.runInContext(read('class-pointer-prototype/student-boards.js'),ctx);
  vm.runInContext(read('class-pointer-prototype/activity-screen-teacher.js'),ctx);
  toggle.click(); // teacher opens Student Screens (mode: screens)
  const find=(cls)=>dom.created.find(node=>node.className===cls);
  const box=find('board-screen-large'),grid=find('boards-grid');
  const video=box.children[0],note=box.children[1];
  const back=dom.created.find(node=>node.tag==='button'&&/Back to gallery/.test(node.textContent));
  const tile=()=>find('board-tile'),tileVideo=()=>tile()?.children.find(node=>node.tag==='video'),tileNote=()=>tile()?.children.find(node=>node.className==='board-note');
  const focusPane=find('boards-focus'),gridBar=dom.created.find(node=>node.className==='boards-bar'&&node.children.some(child=>child.className==='boards-modes'));
  // A boy's screen arrives through the authenticated Shorashim receiver.
  class Call{
    constructor(){this.metadata={kind:'activity-screen',token:'a'.repeat(64)};this.listeners={}}
    on(type,fn){(this.listeners[type]??=[]).push(fn)}
    emit(type,value){for(const fn of this.listeners[type]||[])fn(value)}
    answer(){}close(){}
  }
  const shared={id:'shorashim-screen'};
  async function startSharing(){
    const call=new Call();
    await window.ClassPointerActivityShares.incomingCall(call);
    call.emit('stream',shared);
    return call;
  }
  return{window,member,get tile(){return tile()},get tileVideo(){return tileVideo()},get tileNote(){return tileNote()},box,video,note,grid,back,focusPane,gridBar,startSharing,shared,endClass,stage};
}

test('gallery tile shows a Shorashim screen, not "Waiting", once the boy shares',async()=>{
  const f=await viewerFixture();
  assert.equal(f.tile,undefined,'no tiny waiting tiles before a student shares');
  await f.startSharing();
  await wait(()=>f.tileVideo.srcObject===f.shared,'gallery tile did not receive the Shorashim screen');
  assert.equal(f.tileVideo.hidden,false);
  assert.equal(f.tileNote.textContent,'');
});

test('clicking a boy enlarges his actual Shorashim screen in the large viewer',async()=>{
  const f=await viewerFixture();
  await f.startSharing();
  await wait(()=>f.tileVideo.srcObject===f.shared,'tile did not get the screen');
  f.tile.click();
  await wait(()=>f.video.srcObject===f.shared,'large viewer did not display the student screen');
  assert.equal(f.video.hidden,false,'large video is visible');
  assert.equal(f.note.hidden,true,'"Waiting" message is hidden');
  assert.equal(f.box.hidden,false);
  assert.equal(f.focusPane.hidden,false);
  assert.equal(f.grid.hidden,true,'gallery grid is replaced by the large viewer');
});

test('the large viewer picks up a screen that starts while it is already open, and shows Waiting when it stops',async()=>{
  const f=await viewerFixture();
  const call=await f.startSharing();
  await wait(()=>!!f.tile,'live student gets a tile');
  f.tile.click();
  await wait(()=>f.video.srcObject===f.shared,'open viewer did not pick up the new screen');
  call.emit('close');
  await wait(()=>f.tile?.removed===true&&f.video.srcObject===null,'stopped share removes its gallery tile');
});

test('Back to gallery returns to every student and keeps the screen live',async()=>{
  const f=await viewerFixture();
  await f.startSharing();
  f.tile.click();
  await wait(()=>f.video.srcObject===f.shared,'large viewer not showing screen');
  assert.ok(f.back,'Back to gallery button exists in the viewer itself');
  assert.match(f.back.textContent,/^◀ Back to gallery$/);
  f.back.click();
  await wait(()=>f.focusPane.hidden===true&&f.grid.hidden===false,'Back to gallery did not return to the grid');
  assert.equal(f.gridBar.hidden,false);
  assert.equal(f.video.srcObject,null,'large video released');
  await wait(()=>f.tileVideo.srcObject===f.shared,'the gallery tile still shows his live screen');
  f.tile.click(); // enlarging again works
  await wait(()=>f.video.srcObject===f.shared,'second enlarge did not show the screen');
});

test('a Pointer-joined student\'s direct screen still takes priority',async()=>{
  const f=await viewerFixture();
  const direct={id:'direct'};f.member.screenStream=direct;
  await f.startSharing();
  f.tile.click();
  await wait(()=>f.video.srcObject===direct,'direct Pointer stream should be shown first');
});

test('the receiver exposes streamFor and announces changes',async()=>{
  const f=await viewerFixture();
  assert.equal(f.window.ClassPointerActivityShares.streamFor('arik'),null);
  assert.equal(f.window.ClassPointerActivityShares.streamFor(undefined),null);
  await f.startSharing();
  assert.equal(f.window.ClassPointerActivityShares.streamFor('arik'),f.shared);
  assert.equal(f.window.ClassPointerActivityShares.streamFor('someone-else'),null);
});

// ---------- Teacher dashboard: automatic classroom opening, no chooser flash ----------
async function dashboardFixture({search='?teacher=1',classes={et:{name:'ET',active:true}},saved=''}={}){
  const dom=makeDom();
  const ids=['welcome','message','teacherChoice','teacherSignIn','classChoice','openTeacher','teacherClassButtons'];
  const nodes={};
  for(const id of ids){nodes[id]=dom.element('div');dom.byId.set(id,nodes[id])}
  nodes.teacherChoice.hidden=true; // as in dashboard.html
  nodes.welcome.textContent='Opening your classroom…';
  // Record every visibility change of the class chooser.
  const history=[];let hidden=true;
  Object.defineProperty(nodes.teacherChoice,'hidden',{get:()=>hidden,set:value=>{hidden=value;history.push(value)}});
  const welcomeTexts=[];let welcome=nodes.welcome.textContent;
  Object.defineProperty(nodes.welcome,'textContent',{get:()=>welcome,set:value=>{welcome=value;welcomeTexts.push(value)}});
  nodes.teacherClassButtons.childElementCount=0;
  const appendChild=nodes.teacherClassButtons.appendChild.bind(nodes.teacherClassButtons);
  nodes.teacherClassButtons.appendChild=node=>{appendChild(node);nodes.teacherClassButtons.childElementCount=nodes.teacherClassButtons.children.length;return node};
  nodes.teacherClassButtons.replaceChildren=()=>{nodes.teacherClassButtons.children=[];nodes.teacherClassButtons.childElementCount=0};
  nodes.teacherClassButtons.querySelectorAll=()=>nodes.teacherClassButtons.children;
  const assigned=[];let authCallback;
  const rows=classes;
  const ref=path=>({
    once:async()=>({val:()=>path.endsWith('/classes')?rows:rows[path.split('/').pop()]}),
    child:id=>ref(path+'/'+id)
  });
  const storage=new Map(saved?[['classPointerLastTeacherClass',saved]]:[]);
  const window={B3_APP_CONTEXT:{workspaceId:'b3-2026'},B3_FIREBASE_CONFIG:{},B3SiteSettings:{onAuthStateChanged:fn=>{authCallback=fn},signInWithGoogle:async()=>{}}};
  const ctx={
    window,document:dom.document,URL,URLSearchParams,console,Promise,Object,
    location:{href:'https://funtorahtools.com/class-pointer-prototype/dashboard.html'+search,assign:href=>assigned.push(href)},
    firebase:{apps:[{}],initializeApp(){},database:()=>({ref})},
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
    sessionStorage:{getItem:()=>null}
  };
  vm.createContext(ctx);
  vm.runInContext(read('class-pointer-prototype/dashboard-core.js'),ctx);
  vm.runInContext(read('class-pointer-prototype/dashboard.js'),ctx);
  await wait(()=>authCallback,'dashboard did not register for sign-in state');
  return{nodes,history,welcomeTexts,assigned,signIn:(access=({authorized:true,role:'admin'}))=>authCallback({uid:'t'},access.authorized,access),dom};
}

test('regular teacher entry opens the class automatically and never shows the class chooser',async()=>{
  const f=await dashboardFixture();
  assert.equal(f.nodes.teacherChoice.hidden,true,'chooser is hidden from the first moment');
  await f.signIn();
  assert.equal(f.assigned.length,1,'opens one class');
  assert.match(f.assigned[0],/classroom\.html\?dashboard=teacher&class=et$/);
  assert.equal(f.nodes.teacherChoice.hidden,true,'chooser never became visible');
  assert.ok(!f.history.includes(false),'chooser visibility was never switched on');
  assert.ok(!f.welcomeTexts.some(text=>/Choose a class/.test(text)),'"Choose a class" text never flashed');
  assert.match(f.nodes.message.textContent,/Opening ET/);
});

test('the last used class is opened automatically',async()=>{
  const f=await dashboardFixture({classes:{et:{name:'ET',active:true},wt:{name:'WT',active:true}},saved:'wt'});
  await f.signIn();
  assert.match(f.assigned[0],/class=wt$/);
  assert.equal(f.nodes.teacherChoice.hidden,true);
});

test('the chooser still appears when a class cannot open by itself',async()=>{
  const none=await dashboardFixture({classes:{}});
  await none.signIn();
  assert.equal(none.assigned.length,0);
  assert.equal(none.nodes.teacherChoice.hidden,false,'no classes: teacher sees the page');
  assert.match(none.nodes.message.textContent,/No classes with Class Pointer enabled/);
  const signedOut=await dashboardFixture();
  await signedOut.signIn({authorized:false});
  assert.equal(signedOut.nodes.teacherChoice.hidden,false,'signed out: Sign in button is reachable');
  assert.match(signedOut.nodes.message.textContent,/Sign in with your teacher account/);
});

test('Student Screens and Whiteboards entries still show the class chooser',async()=>{
  for(const search of ['?teacher=1&sendEveryoneShare=1','?teacher=1&sendEveryoneBoards=1']){
    const f=await dashboardFixture({search});
    assert.equal(f.nodes.teacherChoice.hidden,false,search+' shows the chooser immediately');
    await f.signIn();
    assert.equal(f.assigned.length,0,'a mode entry waits for the teacher to pick a class');
    assert.match(f.nodes.welcome.textContent,/Choose a class for/);
  }
});
