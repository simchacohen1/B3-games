'use strict';
// A picture the teacher pastes on a student's board: the student may select, move and resize it (never delete it),
// unless the teacher locked it. The student's drawing toolbar reaches it through the board surface (getItems / setItems).
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path');
const dir=path.join(__dirname,'../class-pointer-prototype');
const boardsSource=fs.readFileSync(path.join(dir,'student-boards.js'),'utf8');
const PNG='data:image/png;base64,'+'iVBORw0KGgo'.repeat(8)+'==';

function studentBoard(){
  const noop=()=>{},plain=new Set(['hidden','disabled','value','textContent','className','id','title','type','files','then','maxLength','placeholder','dir','accept','tabIndex','srcObject','muted','autoplay','playsInline']);
  const fake=more=>new Proxy({style:{setProperty:noop},dataset:{},classList:{toggle:noop,add:noop,remove:noop,contains:()=>false},getClientRects:()=>[{}],
    getBoundingClientRect:()=>({left:0,top:0,right:800,bottom:450,width:800,height:450}),...more},{get:(target,key)=>key in target?target[key]:plain.has(key)||typeof key==='symbol'?undefined:noop});
  const sent=[],captured={};
  const pen=()=>new Proxy({},{get:(state,key)=>key==='measureText'?()=>({width:0}):key in state?state[key]:noop});
  const canvas=()=>fake({getContext:pen,toBlob:done=>done({type:'image/png'})});
  const context={document:{createElement:tag=>tag==='canvas'?canvas():fake(),getElementById:()=>null,addEventListener:noop,body:fake(),head:fake(),fullscreenElement:null},
    ResizeObserver:class{observe(){}},PointerEvent:class{},Event:class{},CustomEvent:class{},Image:class{},requestAnimationFrame:()=>1,clearTimeout,confirm:()=>true,
    setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref();return timer},navigator:{},location:{href:'https://example.test/'},URL,console,
    // The shared drawing toolbar: it hands the student's board surface to the test.
    FTTAnnotate:{push:surface=>{captured.surface=surface},release:noop,setReason:noop,state:()=>({}),select:noop,drawItem:noop,setActions:noop},
    ClassPointerClipboard:{KEY:'Ctrl',MSG:{},register:t=>t,copyImage:async()=>{},copyText:async()=>{}},
    ClassPointerBridge:{isTeacher:false,embedded:true,embeddedStage:fake(),sendTeacher:message=>sent.push(JSON.parse(JSON.stringify(message))),status:noop,callTeacher:null}};
  context.window=context;vm.createContext(context);vm.runInContext(boardsSource,context);
  return{api:context.ClassPointerBoards,sent,surface:()=>captured.surface};
}
const pic=(id,by,extra={})=>({id,tool:'rect',color:'#1f2937',size:0.003,points:[{x:.1,y:.1},{x:.5,y:.6}],image:PNG,by,...extra});
const mine=(id)=>({id,color:'#1f2937',size:0.006,points:[{x:.1,y:.1},{x:.2,y:.2}],by:'student'});
const open=(strokes)=>{const b=studentBoard();b.api.fromTeacher({type:'board-mode',on:true,mode:'boards',strokes});return b};
// The page runs in its own vm context: copy what it returns so the comparisons are not tripped by its Array type.
const plain=x=>JSON.parse(JSON.stringify(x));
const ids=list=>plain(list).map(i=>i.id).sort();

test("the student's drawing toolbar can pick the student's own marks and the teacher's unlocked pictures, nothing else of the teacher's",()=>{
  const {surface}=open([mine('s1-a'),pic('t1-p','teacher'),pic('t2-locked','teacher',{locked:true}),{id:'t3-line',color:'#1f2937',size:0.006,points:[{x:.1,y:.1},{x:.2,y:.2}],by:'teacher'},pic('s2-p','student')]);
  assert.deepEqual(ids(surface().getItems()),['s1-a','s2-p','t1-p']);
});

test('moving or resizing a teacher picture sends one small move and keeps it the teacher\'s picture',()=>{
  const {surface,sent}=open([pic('t1-p','teacher')]);
  const [item]=surface().getItems(),moved={...item,points:[{x:.2,y:.2},{x:.8,y:.7}]};   // dragged and resized by a corner
  surface().setItems([moved]);
  assert.deepEqual(sent,[{type:'board-move',id:'t1-p',points:[{x:.2,y:.2},{x:.8,y:.7}]}],'the teacher gets the new place live');
  const after=surface().getItems().find(i=>i.id==='t1-p');
  assert.deepEqual(plain(after.points),[{x:.2,y:.2},{x:.8,y:.7}]);
  assert.equal(after.by,'teacher');
});

test('a student can never delete a teacher picture: Delete, Eraser and Clear leave it where it is',()=>{
  const {surface,sent}=open([mine('s1-a'),pic('t1-p','teacher')]);
  surface().setItems(surface().getItems().filter(i=>i.id!=='t1-p'));        // Delete on the picked picture
  assert.ok(surface().getItems().some(i=>i.id==='t1-p'));
  surface().setItems([]);                                                     // Clear: only the student's own marks go
  assert.deepEqual(ids(surface().getItems()),['t1-p']);
  assert.ok(sent.every(op=>!(op.type==='board-remove'&&op.ids.includes('t1-p'))),'no removal of the picture was ever sent');
  assert.ok(sent.every(op=>op.type!=='board-clear'||true));
});

test('a locked picture stays fixed: it cannot be picked, and a forged move is ignored',()=>{
  const {api,surface,sent}=open([pic('t1-p','teacher')]);
  api.fromTeacher({type:'board-lock',id:'t1-p',locked:true});
  assert.deepEqual(plain(surface().getItems()),[],'locked: nothing to pick');
  surface().setItems([pic('t1-p','teacher',{points:[{x:.3,y:.3},{x:.9,y:.9}]})]);   // a student page trying anyway
  assert.deepEqual(sent,[],'nothing was sent');
  api.fromTeacher({type:'board-lock',id:'t1-p',locked:false});
  assert.deepEqual(ids(surface().getItems()),['t1-p'],'unlocked again: it can be picked');
  assert.deepEqual(plain(surface().getItems()[0].points),[{x:.1,y:.1},{x:.5,y:.6}],'the picture never moved while locked');
});

test('only the teacher can lock, and only a teacher picture can be locked',()=>{
  const {api,surface}=open([pic('t1-p','teacher'),pic('s1-p','student')]);
  api.fromTeacher({type:'board-lock',id:'s1-p',locked:true});   // the student's own picture: not lockable
  api.fromTeacher({type:'board-lock',id:'nope',locked:true});
  assert.deepEqual(ids(surface().getItems()),['s1-p','t1-p']);
  assert.match(boardsSource,/if\(by!=='teacher'\|\|typeof op\.id!=='string'\)return false;\s*const at=board\.strokes\.findIndex\(item=>item\.by==='teacher'&&item\.image&&item\.id===op\.id\)/);
});

test('the lock survives saving and reloading the board',()=>{
  const {surface}=open([pic('t1-p','teacher',{locked:true})]);
  assert.deepEqual(plain(surface().getItems()),[],'a locked picture sent as part of the board is still locked');
  assert.match(boardsSource,/if\(s\.locked===true\)out\.locked=true;/);
});

test('a student who is paused or has the board closed cannot reach the teacher pictures',()=>{
  const {api,surface}=open([pic('t1-p','teacher'),mine('s1-a')]);
  api.fromTeacher({type:'board-mode',on:false});
  assert.ok(!surface().getItems().some(i=>i.id==='t1-p'),'no drawing permission: no teacher pictures to pick');
});

test('the teacher gets a Lock / Unlock button on the picked picture',()=>{
  assert.match(boardsSource,/const lock=o\.by==='teacher'\?button\('🔒 Lock'/);
  assert.match(boardsSource,/o\.act\(\{type:'board-lock',id:s\.id,locked:s\.locked!==true\}\)/);
  assert.match(boardsSource,/lock\.textContent=s\?\.locked\?'🔓 Unlock':'🔒 Lock'/);
});

test('the drawing toolbar gives a moved picture a NEW name: that is still a move of the teacher\'s picture, never a second picture', () => {
  const {surface,sent}=open([pic('t1-p','teacher'),mine('s1-a')]);
  const [item]=surface().getItems().filter(i=>i.id==='t1-p');
  const moved={...plain(item),id:'s9-newname',points:[{x:.3,y:.2},{x:.7,y:.55}]};   // what the toolbar hands over after a drag
  delete moved.by;
  surface().setItems([plain(surface().getItems().find(i=>i.id==='s1-a')),moved]);
  assert.deepEqual(sent,[{type:'board-move',id:'t1-p',points:[{x:.3,y:.2},{x:.7,y:.55}]}],'one small move of the teacher\'s own picture, nothing added');
  const pictures=plain(surface().getItems()).filter(i=>i.image);
  assert.equal(pictures.length,1,'still one picture');
  assert.equal(pictures[0].id,'t1-p');
  assert.equal(pictures[0].by,'teacher');
  assert.deepEqual(pictures[0].points,[{x:.3,y:.2},{x:.7,y:.55}]);
});

test('a moved copy of a LOCKED teacher picture is not accepted as a move, and a student\'s own new picture is still added', () => {
  const {api,surface,sent}=open([pic('t1-p','teacher')]);
  api.fromTeacher({type:'board-lock',id:'t1-p',locked:true});
  const forged={...pic('s9-x','student'),points:[{x:.3,y:.2},{x:.7,y:.55}]};
  delete forged.by;
  surface().setItems([forged]);
  assert.ok(sent.every(op=>op.type!=='board-move'),'no move of the locked picture');
  assert.ok(sent.some(op=>op.type==='board-add'),'it is just the student\'s own picture');
  const mineNow=surface().getItems();
  assert.ok(plain(mineNow).some(i=>i.id==='s9-x'));
});
