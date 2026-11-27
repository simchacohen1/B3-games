'use strict';
// Whiteboard round 2: student boards get the right-click menu, layers and text alignment; New Slides; and auto-save.
// The pure logic is run for real (sliced out of the shipped files); the page wiring is checked in the source.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const Core=require('../class-pointer-prototype/saved-work-core.js');
const dir=path.join(__dirname,'../class-pointer-prototype');
const read=name=>fs.readFileSync(path.join(dir,name),'utf8');
const toolbar=read('annotation-toolbar.js'),boards=read('student-boards.js'),saved=read('saved-work.js'),pdf=read('pdf-mode.js'),annotate=read('classroom-annotate.js');
const plain=value=>JSON.parse(JSON.stringify(value));
const part=(source,from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a+1);assert.ok(a>=0&&b>a,'found: '+from);return source.slice(a,b)};

// ---------- the toolbar's pure parts ----------
function loadToolbar(){
  const line=re=>toolbar.match(re)[0];
  const code=[line(/  const KINDS=[^\n]*\n/),line(/  const CLOSED=[^\n]*\n/),line(/  const MAX_TEXT=[^\n]*\n/),line(/  const ALIGNS=[^\n]*\n/),line(/  const round=[^\n]*\n/),line(/  const validPoint=[^\n]*\n/),
    part(toolbar,'  function cleanItem(raw,opts={}){','  const measurer=document.createElement'),
    toolbar.match(/  function reorder\(list,ids,how\)\{[\s\S]*?\r?\n  \}\r?\n/)[0],'this.api={cleanItem,drawItem,reorder};'].join('\n');
  const context={};vm.runInNewContext(code,context);return context.api;
}
const {cleanItem,drawItem,reorder}=loadToolbar();
const mark=(id,extra={})=>({id,tool:'rect',color:'#1f2937',size:.006,points:[{x:.1,y:.1},{x:.3,y:.3}],...extra});
const ids=list=>list.map(item=>item.id).join(',');

test('layers: front, forward, backward and back; nothing to do gives null',()=>{
  const list=['a','b','c','d'].map(id=>mark(id));
  assert.equal(ids(reorder(list,['b'],'front')),'a,c,d,b');
  assert.equal(ids(reorder(list,['c'],'back')),'c,a,b,d');
  assert.equal(ids(reorder(list,['b'],'forward')),'a,c,b,d');
  assert.equal(ids(reorder(list,['c'],'backward')),'a,c,b,d');
  assert.equal(reorder(list,['d'],'front'),null,'already on top');
  assert.equal(reorder(list,['d'],'forward'),null);
  assert.equal(reorder(list,['a'],'back'),null,'already at the bottom');
  assert.equal(reorder(list,['a'],'backward'),null);
  assert.equal(reorder(list,['zzz'],'front'),null,'not on the board');
  assert.equal(reorder([mark('only')],['only'],'front'),null,'one mark has no layers');
  assert.equal(reorder(list,['a'],'sideways'),null);
  // Two marks moved together keep their order among themselves.
  assert.equal(ids(reorder(list,['a','b'],'front')),'c,d,a,b');
  assert.equal(ids(reorder(list,['b','c'],'forward')),'a,d,b,c');
  assert.equal(ids(list),'a,b,c,d','the original list is not changed');
});

test('text alignment: only center and right are kept (left is the usual); other marks never carry it',()=>{
  const words={id:'s1',tool:'text',color:'#1f2937',size:.02,points:[{x:.1,y:.1}],text:'one\ntwo'};
  assert.equal(cleanItem({...words,align:'center'}).align,'center');
  assert.equal(cleanItem({...words,align:'right'}).align,'right');
  for(const bad of ['left','',null,'justify',5,{}])assert.equal('align' in cleanItem({...words,align:bad}),false,String(bad));
  assert.equal('align' in cleanItem(mark('s2',{align:'center'})),false,'a shape has no alignment');
});

test('text alignment is drawn: the lines sit left, centered or right inside the widest line',()=>{
  const calls=[];
  const ctx={save(){},restore(){},measureText:text=>({width:text.length*10}),fillText:(text,x,y)=>calls.push([text,x,y])};
  const draw=align=>{calls.length=0;drawItem(ctx,{id:'s1',tool:'text',color:'#1f2937',size:.02,points:[{x:.1,y:.1}],text:'aaaa\nbb',...(align?{align}:{})},p=>[p.x*1000,p.y*1000],1000);return calls.map(c=>c[1])};
  assert.deepEqual(draw(),[100,100],'left: both lines start at the corner');
  assert.deepEqual(draw('center'),[100,110],'the short line is centered under the long one');
  assert.deepEqual(draw('right'),[100,120],'the short line ends where the long one ends');
});

// ---------- student-boards.js: the board's own rules ----------
function loadBoards(){
  const code=[part(boards,'  const PALETTE=','  const FULL='),part(boards,'  const validPoint=','  // One teacher-owned activity'),
    part(boards,'  function applyOp(board,op,by){','  // Where a change from the network goes'),
    part(boards,'  // The shared drawing toolbar hands over the whole list','  function cleanGroup(raw){'),
    part(boards,'  function groupOp(set,op,code){','  function relayToGroup'),
    'let activity=null,Tiles=null,Pages=null;const cleanWord=()=>null;',
    'this.api={cleanStroke,applyOp,syncBoardItems,syncTeacherBoardItems,groupOp};'].join('\n');
  const context={};vm.runInNewContext(code,context);return context.api;
}
const B=loadBoards();
const item=(id,extra={})=>({id,tool:'rect',color:'#1f2937',size:.006,points:[{x:.1,y:.1},{x:.3,y:.3}],...extra});
const board=(...list)=>({strokes:list.map(s=>({...s})),drafts:{student:null,teacher:null}});
const order=b=>b.strokes.map(s=>s.id).join(',');

test('a board keeps the alignment of words, and only for words',()=>{
  const words={id:'s1',tool:'text',color:'#1f2937',size:.02,points:[{x:.1,y:.1}],text:'hello'};
  assert.equal(B.cleanStroke({...words,align:'center'}).align,'center');
  assert.equal(B.cleanStroke({...words,align:'right'}).align,'right');
  assert.equal('align' in B.cleanStroke({...words,align:'left'}),false);
  assert.equal('align' in B.cleanStroke({...words,align:'bogus'}),false);
  assert.equal('align' in B.cleanStroke(item('s2',{align:'center'})),false);
});

test('board-order: a student orders only their own marks, in the places those marks hold',()=>{
  const b=board({...item('s1'),by:'student'},{...item('t1'),by:'teacher'},{...item('s2'),by:'student'},{...item('s3'),by:'student'});
  assert.equal(B.applyOp(b,{type:'board-order',ids:['s3','s1','s2']},'student'),true);
  assert.equal(order(b),'s3,t1,s1,s2','the teacher\'s mark did not move; the student\'s marks took each other\'s places');
  // Marks that are not theirs are ignored (a student cannot move the teacher's mark in the pile).
  assert.equal(B.applyOp(b,{type:'board-order',ids:['t1','s3']},'student'),false);
  assert.equal(order(b),'s3,t1,s1,s2');
  // Nothing changes, so nothing is reported.
  assert.equal(B.applyOp(b,{type:'board-order',ids:['s3','s1','s2']},'student'),false);
  assert.equal(B.applyOp(b,{type:'board-order',ids:'nope'},'student'),false);
  assert.equal(B.applyOp(b,{type:'board-order',ids:[5,null]},'student'),false);
});

test('board-order: the teacher may order any marks on a student\'s board',()=>{
  const b=board({...item('s1'),by:'student'},{...item('t1'),by:'teacher'},{...item('s2'),by:'student'});
  assert.equal(B.applyOp(b,{type:'board-order',ids:['s2','s1','t1']},'teacher'),true);
  assert.equal(order(b),'s2,s1,t1');
});

test('board-order never loses or doubles a mark',()=>{
  const b=board({...item('s1'),by:'student'},{...item('s2'),by:'student'},{...item('s3'),by:'student'});
  B.applyOp(b,{type:'board-order',ids:['s3','s3','s1','unknown']},'student');
  assert.deepEqual(b.strokes.map(s=>s.id).sort(),['s1','s2','s3']);
});

test('moving or recoloring a mark keeps it where it was in the pile (it used to jump to the top)',()=>{
  const b=board({...item('s1'),by:'student'},{...item('s2'),by:'student'},{...item('s3'),by:'student'});
  const sent=[];const act=op=>{sent.push(op.type);B.applyOp(b,op,'student')};
  // The toolbar gives a changed mark a new id, in the same place of its list.
  B.syncBoardItems(b,'student',[item('s1'),item('s2x'),item('s3')],act);
  assert.equal(order(b),'s1,s2x,s3');
  assert.ok(sent.includes('board-order'),'the order is sent so the teacher and group see it too');
});

test('Bring forward / Send back on a student board is sent and applied',()=>{
  const b=board({...item('s1'),by:'student'},{...item('s2'),by:'student'},{...item('s3'),by:'student'});
  const sent=[];const act=op=>{sent.push(op);B.applyOp(b,op,'student')};
  B.syncBoardItems(b,'student',[item('s2'),item('s3'),item('s1')],act);
  assert.equal(order(b),'s2,s3,s1');
  assert.deepEqual(plain(sent),[{type:'board-order',ids:['s2','s3','s1']}]);
  // Unchanged: nothing is sent.
  sent.length=0;B.syncBoardItems(b,'student',[item('s2'),item('s3'),item('s1')],act);
  assert.deepEqual(sent,[]);
});

test('a group board: a member orders only their own lines; the others stay',()=>{
  const b=board({...item('s1',{who:'m1'}),by:'student'},{...item('s2',{who:'m2'}),by:'student'},{...item('s3',{who:'m1'}),by:'student'});
  const set={pages:[b],at:0};
  const checked=B.groupOp(set,{type:'board-order',ids:['s3','s2','s1']},'m1');
  assert.deepEqual(plain(checked.ids),['s3','s1'],'only the member\'s own lines are kept');
  assert.equal(B.groupOp(set,{type:'board-order',ids:['s2']},'m1'),null,'someone else\'s line alone is dropped');
  assert.equal(B.groupOp(set,{type:'board-order',ids:['s2','s1']},'m1'),null,'one of their own is not an order');
  B.applyOp(b,checked,'student');
  assert.equal(order(b),'s3,s2,s1');
});

test('the teacher\'s toolbar on a student board orders the whole pile',()=>{
  const b=board({...item('s1'),by:'student'},{...item('t1'),by:'teacher'},{...item('s2'),by:'student'});
  const sent=[];const act=op=>{sent.push(op.type);B.applyOp(b,op,'teacher')};
  B.syncTeacherBoardItems(b,[item('t1'),item('s1'),item('s2')],act);
  assert.equal(order(b),'t1,s1,s2');
  assert.deepEqual(sent,['board-order']);
});

// ---------- wiring ----------
test('both whiteboards turn on the menu, layers and alignment; the lesson does not',()=>{
  assert.match(boards,/const boardSurface=\{id:'board',idPrefix:'s',defaultTool:'select',renders:true,arrange:true/);
  assert.match(boards,/const boardInk=FA&&\{id:'student-board',idPrefix:'t',autoOpen:true,defaultTool:'select',renders:true,arrange:true/);
  assert.doesNotMatch(read('classroom-annotate.js'),/arrange:true/);
  assert.match(toolbar,/document\.addEventListener\('contextmenu',e=>\{\s*const s=surface\(\);\s*if\(mode!=='open'\|\|root\.hidden\|\|!s\.arrange\|\|isDelegate\(s\)\)return;/);
  assert.match(toolbar,/alignBox\.hidden=!\(s\.arrange&&!isDelegate\(s\)/);
  assert.match(toolbar,/layerBox\.hidden=!picked;/);
  for(const word of ['Bring to Front','Bring Forward','Send Backward','Send to Back'])assert.match(toolbar,new RegExp(word.replace(/ /g,'\\s')+'|title\\.split'),word);
  assert.match(toolbar,/'To front','Bring to front: above everything else'/);
});

test('the right-click menu has Cut, Copy, Paste and Delete, keeps the browser menu in typing boxes, and closes on Escape',()=>{
  for(const label of ['Cut','Copy','Paste','Delete'])assert.match(toolbar,new RegExp("add\\('"+label+"'"),label);
  assert.match(toolbar,/if\(e\.target\?\.closest\?\.\('textarea,input'\)\)return;\s*if\(!insideSurface\(e,s\)\)return;/);
  assert.match(toolbar,/if\(menu&&e\.key==='Escape'\)/);
});

test('New Slides: a button on the teacher\'s board strip and toolbar, and on a student\'s board bar; the old board is saved first',()=>{
  assert.match(pdf,/btn\('🆕 New Slides'/);
  assert.match(pdf,/async function newSlides\(\)\{/);
  assert.match(pdf,/window\.FTTSavedWork\?\.auto\?\.flush\?\.\(\)/);
  assert.match(pdf,/could not be saved to My files\. If you start new slides, what is on this board will be lost/);
  assert.match(pdf,/newSlides,\s*\n?\s*\/\/ Which whiteboard is open/);
  assert.match(annotate,/id:'quick-new',icon:'🆕',label:'New Slides'/);
  assert.match(boards,/const newSlidesBtn=button\('🆕 New Slides'/);
  assert.match(boards,/newSlidesBtn\.hidden=!boardsOn\|\|!!group/,'a shared group board has no New Slides');
  assert.match(boards,/could not be saved to My files\. If you start new slides, what you drew will be lost/);
  assert.match(boards,/boardId:\(\)=>boardOpen\(\)\?'b'\+boardSerial:null/);
});

test('a new board gets a new id (so auto-save starts a new file): New Slides, a board the teacher sends, a file opened',()=>{
  assert.match(boards,/if\(message\.send\)boardSerial\+\+;/);
  assert.match(boards,/function importBoard\(data\)\{\s*if\(!boardOpen\(\)\|\|!data\|\|data\.kind!=='student-board'\)return false;\s*boardSerial\+\+;/);
  assert.match(boards,/clearMine\(\);boardSerial\+\+;redraw\(\);/);
  // The teacher's board id is set only when a whiteboard is opened. docId also changes when a page or picture is added,
  // which must NOT start a new file.
  assert.match(pdf,/boardId:\(\)=>isBoardOpen\(\)\?boardUid:null/);
  assert.match(pdf,/if\(board\)boardUid=docId;/);
});

// ---------- auto-save, against the same fake Firebase page as the saved-work tests ----------
class El{
  constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.attrs={};this.textContent='';this.className='';this.hidden=false;this.value='';this.style={}}
  append(...nodes){this.children.push(...nodes)}
  appendChild(node){this.children.push(node);if(node.tag==='script')queueMicrotask(()=>node.onload?.())}
  replaceChildren(...nodes){this.children=nodes}
  addEventListener(type,handler){this.listeners[type]=handler}
  setAttribute(name,value){this.attrs[name]=value}
  querySelector(){return null}
  querySelectorAll(){return[]}
  remove(){this.removed=true}
  focus(){}
  click(){return this.listeners.click?.({target:this})}
}
const walk=node=>[node,...(node.children||[]).flatMap(walk)];
const wait=()=>new Promise(resolve=>setTimeout(resolve,5));
const STUDENT={b3StudentRole:'student',b3StudentId:'stu1',b3ClassId:'et'};
const DENIED={code:'storage/unauthorized',message:'Firebase Storage: User does not have permission to access this object.'};

function harness({teacher=false,signedIn=true,deny=false,existing={},drafts={}}={}){
  const objects=new Map(Object.entries(existing)),puts=[];
  const store={};for(const key of Object.keys(drafts))store[key]=drafts[key];
  const user=signedIn?{uid:'teacherA',getIdToken:async()=>'T',getIdTokenResult:async()=>({claims:teacher?{}:STUDENT})}:null;
  const ref=full=>({
    name:full.split('/').pop(),fullPath:full,bucket:'bucket',child:name=>ref(full+name),
    put(blob,metadata){
      if(!deny){puts.push({path:full,metadata});objects.set(full,metadata)}
      const done=deny?Promise.reject(DENIED):Promise.resolve();done.catch(()=>{});
      return Object.assign(done,{on(_,next,reject,resolve){if(deny)reject(DENIED);else resolve()}});
    },
    async listAll(){if(deny)throw DENIED;return{items:[...objects.keys()].filter(key=>key.startsWith(full)).map(ref)}},
    async getMetadata(){if(!objects.has(full))throw{code:'storage/object-not-found'};return{name:full.split('/').pop(),size:10,customMetadata:objects.get(full)?.customMetadata}},
    async delete(){objects.delete(full)}
  });
  const firebase={apps:[{}],auth:()=>({currentUser:user,onAuthStateChanged(cb){queueMicrotask(()=>cb(user));return()=>{}}}),storage:()=>({ref}),database:()=>({ref:()=>({once:async()=>({val:()=>null}),async update(){}})})};
  const body=new El('body'),head=new El('head');
  const document={title:'Chumash | Fun Torah Tools',body,head,currentScript:{src:'https://site.example/class-pointer-prototype/saved-work.js'},createElement:tag=>new El(tag),querySelector:()=>null};
  // The whiteboard on the page: its data and its id can be changed by the test.
  const state={data:null,id:'b0',imported:[]};
  const png=async()=>new Blob(['png'],{type:'image/png'});
  const studentApi={exportBoard:()=>state.data,importBoard(data){state.imported.push(data);return true},exportPng:png,boardId:()=>state.id};
  const lessonApi={exportWhiteboard:async()=>state.data,importWhiteboard:async data=>{state.imported.push(data);return true},exportPng:png,boardId:()=>state.id};
  const window={FTTSavedWorkCore:Core,firebase,B3_FIREBASE_CONFIG:{},ClassPointerBoards:teacher?undefined:studentApi,ClassPointerPdf:teacher?lessonApi:undefined,
    ClassPointerDashboard:teacher?{ready:Promise.resolve({user:{uid:'teacherA'}})}:undefined,addEventListener(){},dispatchEvent(){}};
  const nav={onLine:true};
  const context={navigator:nav,window,document,firebase,URL,Blob,Date,Intl,Promise,Object,JSON,Error,String,CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail}},queueMicrotask,setTimeout,
    localStorage:{getItem:key=>key in store?store[key]:null,setItem:(key,value)=>{store[key]=String(value)},removeItem:key=>{delete store[key]}},
    location:{href:'https://site.example/class-pointer-prototype/classroom.html?'+(teacher?'dashboard=teacher&class=et':'dashboard=student&room=x')},
    sessionStorage:{getItem:key=>key==='b3Games_studentId'?'stu1':null},confirm:()=>true,
    fetch:async()=>({ok:true,status:200,blob:async()=>new Blob(['{}'])})};
  vm.runInNewContext(saved,context);
  return{nav,auto:window.FTTSavedWork.auto,api:window.FTTSavedWork,state,puts,objects,store,body,jsonPuts:()=>puts.filter(put=>put.path.endsWith('.json'))};
}
const withMark=(id='s1')=>({version:1,kind:'student-board',strokes:[{id,tool:'rect',color:'#1f2937',size:.006,points:[{x:.1,y:.1},{x:.3,y:.3}]}],images:[],text:null,activity:null});
const blankBoard={version:1,kind:'student-board',strokes:[],images:[],text:null,activity:null};

test('auto-save never writes a blank board',async()=>{
  const h=harness();h.state.data=blankBoard;
  const result=await h.auto.flush();
  assert.equal(result.ok,true);assert.equal(result.blank,true);assert.equal(h.puts.length,0);
});

test('auto-save keeps ONE file for one board, and keeps the name the owner gave it',async()=>{
  const h=harness();
  h.state.data=withMark('s1');
  const first=await h.auto.flush();
  assert.equal(first.ok,true);assert.equal(h.jsonPuts().length,1);
  const path1=h.jsonPuts()[0].path;
  assert.match(path1,/^studentFiles\/et\/stu1\/[-A-Za-z0-9_]+\.json$/);
  // More work on the same board: the same file is written again, not a second one.
  h.state.data=withMark('s2');
  await h.auto.flush();
  assert.equal(h.jsonPuts().length,2);assert.equal(h.jsonPuts()[1].path,path1);
  // The student renames the file in My files; the next save keeps that name.
  h.objects.get(path1).customMetadata.displayName='My Chumash notes';
  h.state.data=withMark('s3');
  await h.auto.flush();
  assert.equal(h.jsonPuts()[2].path,path1);assert.equal(h.jsonPuts()[2].metadata.customMetadata.displayName,'My Chumash notes');
  // Nothing changed: nothing is written.
  const before=h.puts.length;await h.auto.flush();assert.equal(h.puts.length,before);
});

test('a NEW board (New Slides, a board the teacher sent) starts its own file and never overwrites the old one',async()=>{
  const h=harness();
  h.state.data=withMark('s1');await h.auto.flush();
  const first=h.jsonPuts()[0].path;
  h.state.id='b1';h.state.data=withMark('s9');await h.auto.flush();
  const second=h.jsonPuts()[1].path;
  assert.notEqual(second,first,'a different file');
  // Back to work on the new board: it keeps writing its own file only.
  h.state.data=withMark('s10');await h.auto.flush();
  assert.equal(h.jsonPuts()[2].path,second);
  assert.equal(h.jsonPuts().filter(put=>put.path===first).length,1,'the first board\'s file was written once and left alone');
});

test('clearing the board does not replace the saved copy with nothing',async()=>{
  const h=harness();
  h.state.data=withMark('s1');await h.auto.flush();
  const count=h.puts.length;
  h.state.data=blankBoard;const result=await h.auto.flush();
  assert.equal(result.ok,true);assert.equal(h.puts.length,count,'nothing was written for the empty board');
});

test('a file that was deleted in My files is not written over a stranger; the board gets a fresh file',async()=>{
  const h=harness();
  h.state.data=withMark('s1');await h.auto.flush();
  const first=h.jsonPuts()[0].path;h.objects.delete(first);
  h.state.data=withMark('s2');await h.auto.flush();
  assert.equal(h.jsonPuts().length,2);assert.notEqual(h.jsonPuts()[1].path,first);
});

test('auto-save for the teacher\'s whiteboard saves the picture too, and a copy of a template is a new file',async()=>{
  const h=harness({teacher:true});
  h.state.data={version:1,kind:'lesson-whiteboard',size:{w:1280,h:720},pictures:[],strokes:[{tool:'pen'}]};
  const result=await h.auto.flush();
  assert.equal(result.ok,true);
  assert.deepEqual(h.puts.map(put=>put.path.split('.').pop()),['png','json'],'the picture first, then the file');
  assert.match(h.puts[0].path,/^pointerWhiteboards\/teacherA\//);
});

test('when saving cannot happen, nothing is lost: a copy stays on this device for the signed-in person only',async()=>{
  const h=harness({deny:true});
  h.state.data=withMark('s1');
  const result=await h.auto.flush();
  assert.equal(result.ok,false);
  const keys=Object.keys(h.store);
  assert.equal(keys.length,1);assert.match(keys[0],/^ftt-board-draft:studentFiles\/et\/stu1\/$/);
  assert.equal(JSON.parse(JSON.parse(h.store[keys[0]]).json).strokes[0].id,'s1');
  // Not signed in: there is no one to keep a copy for (a shared computer never shows it to the next student).
  const guest=harness({signedIn:false});guest.state.data=withMark('s1');
  const failed=await guest.auto.flush();
  assert.equal(failed.ok,false);assert.match(failed.error,/sign in/);assert.deepEqual(Object.keys(guest.store),[]);
});

test('after a successful save the copy on the device is removed',async()=>{
  const h=harness({drafts:{}});
  h.state.data=withMark('s1');await h.auto.flush();
  assert.deepEqual(Object.keys(h.store).filter(key=>key.startsWith('ftt-board-draft:')),[]);
  assert.equal(Object.keys(h.store).filter(key=>key.startsWith('ftt-board-last:')).length,1);
});

test('a board that was not saved before the page closed is offered back, and only to its own owner',async()=>{
  const key='ftt-board-draft:studentFiles/et/stu1/';
  const draft=JSON.stringify({at:Date.now()-60000,json:JSON.stringify(withMark('s7'))});
  const h=harness({drafts:{[key]:draft,'ftt-board-draft:studentFiles/et/other/':draft}});
  h.state.data=blankBoard;
  await h.auto.flush();await wait();await wait();
  const dialog=walk(h.body).find(node=>node.attrs?.role==='alertdialog');
  assert.ok(dialog,'the offer is on the page');
  walk(dialog).find(node=>node.tag==='button'&&node.textContent==='Bring it back').click();
  await wait();
  assert.equal(h.state.imported.length,1);assert.equal(h.state.imported[0].strokes[0].id,'s7');
  // Someone else's copy on the same computer is never offered.
  const other=harness({drafts:{'ftt-board-draft:studentFiles/et/other/':draft}});other.state.data=blankBoard;
  await other.auto.flush();await wait();await wait();
  assert.equal(walk(other.body).find(node=>node.attrs?.role==='alertdialog'),undefined);
});

test('a board with something on it is never replaced by the offer',async()=>{
  const key='ftt-board-draft:studentFiles/et/stu1/';
  const h=harness({drafts:{[key]:JSON.stringify({at:Date.now(),json:JSON.stringify(withMark('s7'))})}});
  h.state.data=withMark('s1');await h.auto.flush();await wait();await wait();
  assert.equal(walk(h.body).find(node=>node.attrs?.role==='alertdialog'),undefined);
});

test('auto-save is wired: it runs by itself, waits while a file is opened, and manual Save hands over to it',()=>{
  assert.match(saved,/setInterval\(\(\)=>\{void run\(false\)\},POLL\)/);
  assert.match(saved,/window\.addEventListener\('pagehide',leaving\)/);
  assert.match(saved,/auto\.pause\(\);\s*try\{\s*if\(!await api\.write\(/);
  assert.match(saved,/await auto\.adopt\(\);/);
  assert.match(saved,/auto\.noteSaved\(data\)/);
  assert.match(saved,/window\.FTTSavedWork=\{[^}]*auto,/);
  assert.match(saved,/'✓ Saved'/);
});

test('a refresh brings the board back as a new board: if it is what was last saved, it carries on in the same file',async()=>{
  const first=harness();first.state.data=withMark('s1');
  const saved1=await first.auto.flush();assert.equal(saved1.ok,true);
  const path=first.jsonPuts()[0].path;
  // The page is reloaded: a new page, the same device storage, the same files, the board back as it was.
  const again=harness({existing:Object.fromEntries(first.objects),drafts:first.store});again.state.data=withMark('s1');
  const result=await again.auto.flush();
  assert.equal(result.ok,true);assert.equal(result.id,saved1.id);assert.equal(again.jsonPuts().length,0,'nothing is written for a board that is already saved');
  // More work after the refresh goes to the SAME file.
  again.state.data=withMark('s2');await again.auto.flush();
  assert.deepEqual(again.jsonPuts().map(put=>put.path),[path]);
});

test('a different board after a refresh gets its own file, and a template copy is never linked',async()=>{
  const first=harness();first.state.data=withMark('s1');await first.auto.flush();
  const again=harness({existing:Object.fromEntries(first.objects),drafts:first.store});again.state.data=withMark('other');
  await again.auto.flush();
  assert.equal(again.jsonPuts().length,1);assert.notEqual(again.jsonPuts()[0].path,first.jsonPuts()[0].path);
});

test('students may keep 200 files',()=>{assert.equal(Core.LIMITS.studentFiles,200);assert.equal(Core.LIMITS.teacherBoards,200)});

test('when My files is full the student is told so, the work stays on the device, and it saves as soon as there is room',async()=>{
  const existing={};for(let n=0;n<200;n+=1)existing['studentFiles/et/stu1/file'+n+'.json']={customMetadata:{}};
  const h=harness({existing});h.state.data=withMark('s1');
  const result=await h.auto.flush();
  assert.equal(result.ok,false);assert.match(result.error,/already have 200 saved files/);
  const banner=walk(h.body).find(node=>node.attrs?.role==='alert');
  assert.ok(banner&&!banner.hidden,'a banner stays on the page');
  const words=walk(banner).map(node=>node.textContent||'').join(' ');
  assert.match(words,/My files is full \(200 files\)/);assert.match(words,/only on this computer/);
  assert.ok(walk(banner).find(node=>node.tag==='button'&&node.textContent==='Open My files'));
  const chip=walk(h.body).find(node=>node.attrs?.role==='status');
  assert.match(chip.textContent,/My files full/);
  assert.equal(Object.keys(h.store).filter(key=>key.startsWith('ftt-board-draft:')).length,1,'the copy on the device is kept');
  // A file is deleted: the very next save goes through and the banner goes away.
  h.objects.delete('studentFiles/et/stu1/file0.json');
  const after=await h.auto.flush();
  assert.equal(after.ok,true);assert.equal(h.jsonPuts().length,1);
  assert.ok(banner.hidden,'the banner is gone once it is saved');
  assert.equal(Object.keys(h.store).filter(key=>key.startsWith('ftt-board-draft:')).length,0);
});

test('a new board never pushes an older unsaved board off the device',async()=>{
  const h=harness({deny:true});
  h.state.data=withMark('a1');h.state.id='b0';await h.auto.flush();
  h.state.data=withMark('b1');h.state.id='b1';await h.auto.flush();
  const keys=Object.keys(h.store).filter(key=>key.startsWith('ftt-board-draft:'));assert.equal(keys.length,1);
  const stored=JSON.parse(h.store[keys[0]]);
  assert.equal(JSON.parse(stored.json).strokes[0].id,'b1');
  assert.equal(stored.more.length,1);assert.equal(JSON.parse(stored.more[0].json).strokes[0].id,'a1');
});

test('after one unsaved board is answered, the next one is offered',async()=>{
  const key='ftt-board-draft:studentFiles/et/stu1/';
  const value=JSON.stringify({at:Date.now()-1000,json:JSON.stringify(withMark('new')),b:'x:1',more:[{at:Date.now()-5000,json:JSON.stringify(withMark('old')),b:'x:0'}]});
  const h=harness({drafts:{[key]:value}});h.state.data=blankBoard;
  await h.auto.flush();await wait();await wait();
  let dialog=walk(h.body).find(node=>node.attrs?.role==='alertdialog');assert.ok(dialog);
  walk(dialog).find(node=>node.tag==='button'&&node.textContent==='Not now').click();
  await wait();await wait();
  dialog=walk(h.body).filter(node=>node.attrs?.role==='alertdialog').pop();
  assert.ok(dialog,'the older one is offered next');
  walk(dialog).find(node=>node.tag==='button'&&node.textContent==='Bring it back').click();await wait();
  assert.equal(h.state.imported.at(-1).strokes[0].id,'old');
});

test('My files tells the auto-save when a file is deleted, so a full board saves at once',()=>{
  assert.match(saved,/detail:\{from:'delete'\}/);
  assert.match(saved,/ftt-myfiles-changed',event=>\{if\(full&&event\?\.detail\?\.from!=='autosave'\)\{failedAt=0;void run\(true\)\}/);
});

test('with no connection the save does not hang: it says so at once, keeps the copy on the device, and saves when back online',async()=>{
  const h=harness();h.nav.onLine=false;h.state.data=withMark('s1');
  const result=await h.auto.flush();
  assert.equal(result.ok,false);assert.match(result.error,/offline/i);assert.equal(h.puts.length,0);
  assert.match(walk(h.body).find(node=>node.attrs?.role==='status').textContent,/Saved on this device only/);
  assert.equal(Object.keys(h.store).filter(key=>key.startsWith('ftt-board-draft:')).length,1);
  h.nav.onLine=true;
  assert.equal((await h.auto.flush()).ok,true);assert.equal(h.jsonPuts().length,1);
  assert.match(saved,/addEventListener\?\.\('online',\(\)=>\{failedAt=0;void run\(true\)\}\)/);
});

test('after a refresh the older saved version comes back: the newer unsaved copy is still offered, and nothing with unsaved work is replaced',async()=>{
  const first=harness();first.state.data=withMark('s1');await first.auto.flush();
  const drafts={...first.store,'ftt-board-draft:studentFiles/et/stu1/':JSON.stringify({at:Date.now()-1000,json:JSON.stringify(withMark('newer')),b:'old:b3'})};
  const again=harness({existing:Object.fromEntries(first.objects),drafts});again.state.data=withMark('s1');
  await again.auto.flush();await wait();await wait();
  const dialog=walk(again.body).find(node=>node.attrs?.role==='alertdialog');
  assert.ok(dialog,'the newer copy is offered');
  walk(dialog).find(node=>node.tag==='button'&&node.textContent==='Bring it back').click();await wait();
  assert.equal(again.state.imported.at(-1).strokes[0].id,'newer');
  // A board that is not the saved one (it has work of its own) is never offered a replacement.
  const busy=harness({existing:Object.fromEntries(first.objects),drafts});busy.state.data=withMark('mine');
  await busy.auto.flush();await wait();await wait();
  assert.equal(walk(busy.body).find(node=>node.attrs?.role==='alertdialog'),undefined);
});

test('once the same work is saved, an older device copy of it is removed too',async()=>{
  const failed=harness({deny:true});failed.state.data=withMark('s1');await failed.auto.flush();
  assert.equal(Object.keys(failed.store).filter(key=>key.startsWith('ftt-board-draft:')).length,1);
  const later=harness({drafts:failed.store});later.state.data=withMark('s1');
  assert.equal((await later.auto.flush()).ok,true);
  assert.equal(Object.keys(later.store).filter(key=>key.startsWith('ftt-board-draft:')).length,0);
});

test('a student on their own board can move, resize and remove what the teacher put there (their copy); a group board cannot',()=>{
  const b=board({...item('t1'),by:'teacher'},{...item('s1'),by:'student'});
  const sent=[];const act=op=>{sent.push(op);B.applyOp(b,op,'student')};
  // Without the flag a student still cannot touch the teacher's mark.
  assert.equal(B.applyOp(b,{type:'board-move',id:'t1',newId:'s9',points:[{x:.2,y:.2},{x:.4,y:.4}]},'student'),false);
  assert.equal(B.applyOp(b,{type:'board-remove',ids:['t1']},'student'),false);
  // The toolbar (student's own, not a group's) hands over the teacher's mark with a new place: the old one goes, a student's one comes.
  const moved=item('s2',{points:[{x:.5,y:.5},{x:.7,y:.7}]});
  B.syncBoardItems(b,'student',[item('s1'),moved],act,null,true);
  assert.equal(order(b),'s1,s2');
  assert.equal(b.strokes.find(s=>s.id==='s2').by,'student');
  assert.ok(sent.some(op=>op.type==='board-remove'&&op.any===true));
  // A resized picture of the teacher's keeps its picture (board-move) and is then the student's.
  const pic=board({id:'t5',tool:'rect',color:'#1f2937',size:.006,points:[{x:.1,y:.1},{x:.3,y:.3}],image:'data:image/png;base64,AAAA',by:'teacher'});
  assert.equal(B.applyOp(pic,{type:'board-move',id:'t5',newId:'s5',points:[{x:.1,y:.1},{x:.5,y:.5}],any:true},'student'),true);
  assert.equal(pic.strokes[0].id,'s5');assert.equal(pic.strokes[0].by,'student');
  // A group board: the member's page never asks for it, and the relay keeps only the member's own lines.
  const g=board({...item('t1'),by:'teacher'});
  assert.equal(B.groupOp({pages:[g],at:0},{type:'board-move',id:'t1',newId:'s9',points:[{x:.2,y:.2},{x:.4,y:.4}],any:true},'m1'),null);
  assert.equal(B.groupOp({pages:[g],at:0},{type:'board-remove',ids:['t1'],any:true},'m1'),null);
});
