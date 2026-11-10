'use strict';
/* Issue #770.
   1. A student's shared screen stays up until the student or the teacher stops it on purpose:
      a failed permission check, a dropped connection or a teacher network blip must not end it.
   2. While the teacher is showing the lesson (screen, PDF, webpage or whiteboard) students get no
      Share My Screen button; a share that is already running keeps going with its Stop button. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const room='class-pointer-12345678-1234-1234-1234-123456789abc';
const tick=(ms=20)=>new Promise(resolve=>setTimeout(resolve,ms));

// ---------- Student side (activity-share.js) ----------
async function studentFixture({persistent=false,openWindow=()=>({closed:false})}={}){
  let listener,holder,captureCount=0,stopCount=0,closed=false,issued=0;
  const control={permissions:async()=>({ok:true,status:200,json:async()=>({ok:true})}),issue:null,answers:true};
  const values=new Map([['b3Games_studentId','test-boy'],['b3Games_classPin','test-pin']]);
  const sessionStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const element=tag=>({tag,style:{cssText:''},dataset:{},children:[],listeners:{},textContent:'',hidden:false,disabled:false,
    setAttribute(){},addEventListener(type,fn){this.listeners[type]=fn},append(...args){this.children.push(...args)}});
  const document={currentScript:{src:'https://funtorahtools.com/class-pointer-prototype/activity-share.js'},createElement:element,
    head:{appendChild(){}},body:{appendChild(node){if(node.id==='fttActivityScreenShare')holder=node}}};
  const db={ref:p=>({on:(_e,cb)=>{if(p.includes('/classPointerSessions'))listener=cb},off(){}})};
  const firebase={apps:[{}],database:()=>db};
  const location={href:'https://funtorahtools.com/shorashim/index.html'+(persistent?'?pointerShare=1':''),pathname:'/shorashim/index.html'};
  const peerCalls=[],peers=[],opened=[];
  class FakePeer extends EventEmitter{
    constructor(id){super();this.id=id;this.destroyed=false;peers.push(this)}
    once(event,callback){if(event==='open')callback();else super.once(event,callback);return this}
    call(target,stream,options){const media=new EventEmitter();Object.assign(media,{target,stream,options,closed:false,close(){this.closed=true}});peerCalls.push(media);
      // The picture reaches the teacher a moment later (unless this test says the teacher never answers).
      if(control.answers)setTimeout(()=>media.emit('iceStateChanged','connected'),0);
      return media}
    destroy(){this.destroyed=true}
  }
  const window={firebase,B3_FIREBASE_CONFIG:{},Peer:FakePeer,
    FunTorahStudentClass:{resolve:async()=>({workspaceId:'b3-2026',classId:'et'})},
    open(...args){opened.push(args);return openWindow(...args)},close(){closed=true},addEventListener(){}};
  const track={stop(){stopCount++},addEventListener(){}};
  const navigator={mediaDevices:{getDisplayMedia(){captureCount++;return Promise.resolve({active:true,getTracks:()=>[track],getVideoTracks:()=>[track]})}}};
  async function fetch(url,options){
    if(String(url).includes('funTorahStudentAuth'))return{ok:true,json:async()=>({ok:true})};
    const body=JSON.parse(options?.body||'{}');
    if(body.action==='permissions')return control.permissions(body);
    if(body.action==='issue'){
      if(control.issue)return control.issue(body);
      issued++;return{ok:true,status:200,json:async()=>({ok:true,token:'ticket-'+issued})};
    }
    throw new TypeError('Failed to fetch');
  }
  await vm.runInNewContext(read('class-pointer-prototype/activity-share.js'),{
    window,document,location,URL,sessionStorage,firebase,fetch,navigator,Peer:FakePeer,
    crypto:{randomUUID:()=>'synthetic-peer-id'},AbortSignal,Date,setTimeout,clearTimeout,console});
  assert.ok(listener&&holder);
  const [shareButton,label]=holder.children;
  let revision=1;
  const row=(extra={})=>({roomId:room,createdAt:Date.now(),studentScreenSharing:true,permissionRevision:revision,destinationRequest:{mode:'screens',at:revision},...extra});
  return{control,holder,shareButton,label,peerCalls,peers,opened,
    // The teacher's lesson record changed (a new permissionRevision each time, like every teacher action).
    emit:async(extra={})=>{revision++;await listener({val:()=>({[room]:row(extra)})})},
    // The same record again, unchanged apart from the extra fields.
    same:async(extra={})=>{await listener({val:()=>({[room]:row(extra)})})},
    gone:async()=>{await listener({val:()=>null})},
    get captureCount(){return captureCount},get stopCount(){return stopCount},get closed(){return closed},get issued(){return issued}};
}

test('a failed permission check never ends a running share; only a clear "no" does',async()=>{
  const s=await studentFixture({persistent:true});
  await s.emit();await tick();
  assert.equal(s.peerCalls.length,1,'the sharing tab is sharing');
  // The teacher changes something (opens the Student screens tab again, pauses another boy...) and this
  // student's check fails: no internet for a moment.
  s.control.permissions=async()=>{throw new TypeError('Failed to fetch')};
  await s.emit();await tick();
  assert.equal(s.stopCount,0,'a network error must not stop the capture');
  assert.equal(s.peerCalls[0].closed,false);
  assert.equal(s.shareButton.textContent,'⏹ Stop Sharing');
  // A busy or broken server is not a "no" either.
  s.control.permissions=async()=>({ok:false,status:503,json:async()=>({error:'unavailable'})});
  await s.emit();await tick();
  assert.equal(s.stopCount,0,'a server error must not stop the capture');
  s.control.permissions=async()=>({ok:false,status:429,json:async()=>({error:'slow down'})});
  await s.emit();await tick();
  assert.equal(s.stopCount,0,'a rate limit must not stop the capture');
  // The teacher really turned this student off.
  s.control.permissions=async()=>({ok:true,status:200,json:async()=>({ok:true,screenSharingDenied:true})});
  await s.emit();await tick();
  assert.equal(s.stopCount,1,'an explicit denial stops the share');
});

test('turning student sharing off still stops a running share',async()=>{
  const s=await studentFixture({persistent:true});
  await s.emit();await tick();
  assert.equal(s.peerCalls.length,1);
  await s.emit({studentScreenSharing:false,destinationRequest:null});await tick();
  assert.equal(s.stopCount,1);
});

test('a dropped connection is called again quietly with a fresh ticket; the capture keeps running',async()=>{
  const s=await studentFixture({persistent:true});
  await s.emit();await tick();
  assert.equal(s.peerCalls.length,1);
  assert.equal(s.peerCalls[0].options.metadata.token,'ticket-1');
  assert.equal(s.peerCalls[0].options.metadata.resume,undefined,'the first call is a new share');
  s.peerCalls[0].emit('close'); // network blip
  assert.equal(s.stopCount,0,'the capture is not stopped');
  assert.match(s.label.textContent,/Reconnecting/);
  assert.equal(s.shareButton.textContent,'⏹ Stop Sharing','the student can still stop');
  await tick(1300);
  assert.equal(s.peerCalls.length,2,'the sharing tab called the teacher again');
  assert.equal(s.peerCalls[1].options.metadata.token,'ticket-2','with a fresh ticket');
  assert.equal(s.peerCalls[1].options.metadata.resume,true,'marked as the same share continuing');
  assert.equal(s.peerCalls[1].stream,s.peerCalls[0].stream,'the same captured screen: no new browser prompt');
  assert.equal(s.captureCount,1);
  assert.equal(s.stopCount,0);
  assert.equal(s.peers[0].destroyed,true,'the old connection is cleaned up');
  // Stop still ends it for good.
  await s.shareButton.listeners.click();
  assert.equal(s.stopCount,1);
  s.peerCalls[1].emit('close');
  await tick(1300);
  assert.equal(s.peerCalls.length,2,'a stopped share is never called again');
});

test('a teacher who cannot be reached for a moment (peer-unavailable) is called again too',async()=>{
  const s=await studentFixture({persistent:true});
  await s.emit();await tick();
  s.peers[0].emit('error',{type:'peer-unavailable'});
  assert.equal(s.stopCount,0);
  await tick(1300);
  assert.equal(s.peerCalls.length,2);
  assert.equal(s.stopCount,0);
});

test('a brand-new share that never reaches the teacher says so instead of pretending',async()=>{
  const s=await studentFixture({persistent:true});
  s.control.answers=false;
  await s.emit();await tick();
  assert.equal(s.peerCalls.length,1);
  s.peers[0].emit('error',{type:'peer-unavailable'});
  assert.equal(s.stopCount,1,'the capture is released');
  assert.match(s.label.textContent,/did not reach your teacher/);
  await tick(1300);
  assert.equal(s.peerCalls.length,1,'no background retries for a share that never started');
});

test('a failed ticket while reconnecting is tried again; a clear denial ends the share',async()=>{
  const s=await studentFixture({persistent:true});
  await s.emit();await tick();
  s.control.issue=async()=>{throw new TypeError('Failed to fetch')};
  s.peerCalls[0].emit('close');
  await tick(1300);
  assert.equal(s.peerCalls.length,1);
  assert.equal(s.stopCount,0,'no ticket yet: keep the capture and try again');
  assert.match(s.label.textContent,/Reconnecting/);
  s.control.issue=async()=>({ok:false,status:403,json:async()=>({error:'Your teacher has turned off your screen sharing.'})});
  await tick(2300);
  assert.equal(s.stopCount,1,'the teacher turned this student off');
  assert.equal(s.peerCalls.length,1);
});

test('the lesson record vanishing for a moment (teacher internet blink) does not end a running share',async()=>{
  const s=await studentFixture({persistent:true});
  await s.emit();await tick();
  assert.equal(s.peerCalls.length,1);
  await s.gone();await tick();
  assert.equal(s.stopCount,0,'the share waits for the lesson to come back');
  assert.equal(s.peerCalls[0].closed,false);
  await s.same();await tick();
  assert.equal(s.stopCount,0);
  assert.equal(s.shareButton.textContent,'⏹ Stop Sharing');
  assert.equal(s.captureCount,1);
});

test('no Share My Screen button on activity pages while the teacher is showing the lesson',async()=>{
  const s=await studentFixture();
  await s.emit();
  assert.equal(s.holder.style.display,'flex','sharing allowed: the button shows');
  await s.same({teacherPresenting:true});
  assert.equal(s.holder.style.display,'none','hidden while the teacher is showing the lesson');
  await s.shareButton.listeners.click();
  assert.equal(s.opened.length,0,'and the click itself is blocked, not only hidden');
  await s.same({teacherPresenting:false});
  assert.equal(s.holder.style.display,'flex','back when the teacher stops');
  await s.shareButton.listeners.click();
  assert.equal(s.opened.length,1);
});

test('the sharing tab cannot start a share while the teacher is showing the lesson, and starts when it ends',async()=>{
  const s=await studentFixture({persistent:true});
  await s.emit({teacherPresenting:true});await tick();
  assert.equal(s.captureCount,0,'no screen picker');
  assert.equal(s.shareButton.hidden,true,'no start button');
  assert.match(s.label.textContent,/teacher is showing the lesson/);
  await s.shareButton.listeners.click();await tick();
  assert.equal(s.captureCount,0,'the click handler refuses too');
  assert.equal(s.issued,0);
  await s.same({teacherPresenting:false});await tick();
  assert.equal(s.shareButton.hidden,false,'the button is back');
  assert.equal(s.captureCount,1);
});

test('a share that is already running keeps going, with Stop, when the teacher starts showing the lesson',async()=>{
  const s=await studentFixture({persistent:true});
  await s.emit();await tick();
  assert.equal(s.peerCalls.length,1);
  await s.same({teacherPresenting:true});await tick();
  assert.equal(s.stopCount,0,'not interrupted');
  assert.equal(s.peerCalls[0].closed,false);
  assert.equal(s.shareButton.hidden,false,'Stop Sharing stays visible');
  assert.equal(s.shareButton.textContent,'⏹ Stop Sharing');
  // It may even reconnect during the lesson (marked resume, so the teacher's page lets it back in).
  s.peerCalls[0].emit('close');
  await tick(1300);
  assert.equal(s.peerCalls.length,2);
  assert.equal(s.peerCalls[1].options.metadata.resume,true);
  await s.shareButton.listeners.click();
  assert.equal(s.stopCount,1,'the student can always stop');
  await tick();
  assert.equal(s.shareButton.hidden,true,'and cannot start again until the lesson stops');
});

// ---------- Teacher side (activity-screen-teacher.js) ----------
function element(tag){
  return{tag,style:{cssText:''},dataset:{},children:[],hidden:false,disabled:false,removed:false,textContent:'',srcObject:null,
    append(...nodes){this.children.push(...nodes);for(const node of nodes)node.parent=this},
    appendChild(node){this.append(node)},
    remove(){this.removed=true;if(this.parent)this.parent.children=this.parent.children.filter(item=>item!==this)}};
}
function receiverFixture(){
  const stage=element('stage'),endClass=element('button'),joinLink=element('input');
  endClass.disabled=false;joinLink.value='https://example.test/class-pointer-prototype/classroom.html?room='+room;
  const elements={stage,endClass,joinLink};
  const state={presenting:false,sent:[]};
  const presence=new Map([['presence:a',{admitted:true,studentId:'student-a',connection:{id:'conn-a'}}],['presence:b',{admitted:true,studentId:'student-b',connection:{id:'conn-b'}}]]);
  const window={ClassPointerBridge:{presenting:()=>state.presenting,presence:()=>presence,send:(connection,message)=>state.sent.push([connection.id,message])}};
  const context=vm.createContext({window,document:{getElementById:id=>elements[id]||null,createElement:element,dispatchEvent(){}},
    location:{search:'?dashboard=teacher&class=pointer-test'},URLSearchParams,URL,MutationObserver:class{observe(){}},CustomEvent:class{constructor(type){this.type=type}},
    firebase:{auth:()=>({currentUser:{getIdToken:async()=>'teacher-token'}})},
    fetch:async(_url,options)=>{const token=JSON.parse(options.body).token,studentId=token[0]==='a'?'student-a':'student-b';return{ok:true,status:200,json:async()=>({ok:true,studentId,studentName:studentId==='student-a'?'Student A':'Student B'})}},
    console:{warn(){}},setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref();return t},clearTimeout,queueMicrotask,Date});
  vm.runInContext(read('class-pointer-prototype/activity-screen-teacher.js'),context);
  const tray=()=>stage.children.find(node=>node.id==='activityScreenTray');
  return{shares:window.ClassPointerActivityShares,state,tray,failure:()=>stage.children.find(node=>node.id==='activityScreenFailure')};
}
function callFor(student='student-a',resume=false){
  const listeners=new Map();
  return{metadata:{kind:'activity-screen',token:(student==='student-a'?'a':'b').repeat(64),...(resume?{resume:true}:{})},closed:0,answered:0,
    on(event,handler){listeners.set(event,handler)},answer(){this.answered++},
    close(){this.closed++},emit(event,value){listeners.get(event)?.(value)}};
}
const picture=id=>({id,getVideoTracks:()=>[{readyState:'live',muted:false,addEventListener(){}}]});

test('a second call from the same student never blanks his tile or his large view',async()=>{
  const f=receiverFixture(),first=callFor(),again=callFor('student-a',true),one=picture('one'),two=picture('two');
  await f.shares.incomingCall(first);first.emit('stream',one);
  assert.equal(f.shares.streamFor('student-a'),one);
  assert.equal(f.shares.enlarge('student-a'),true);
  // His computer calls again (reconnect): the new call has no picture for a moment.
  await f.shares.incomingCall(again);
  assert.equal(again.answered,1);
  assert.equal(f.shares.streamFor('student-a'),one,'the last picture stays until the new one arrives');
  assert.equal(f.tray().children.length,1,'still one tile');
  again.emit('stream',two);
  assert.equal(f.shares.streamFor('student-a'),two,'then the new picture replaces it');
  // The old call finally reports closed: nothing flashes, the tile and large view stay.
  first.emit('close');await tick(5);
  assert.equal(f.shares.streamFor('student-a'),two);
  assert.equal(f.tray().children.length,1);
  assert.equal(f.tray().children[0].hidden,false,'the enlarged tile is still shown');
});

test('a connection that drops by itself keeps the tile while the student reconnects; a deliberate stop removes it at once',async()=>{
  const f=receiverFixture(),first=callFor(),one=picture('one');
  await f.shares.incomingCall(first);first.emit('stream',one);
  first.emit('close');await tick(5);
  assert.equal(f.shares.count(),1,'the tile waits for the student to call again');
  assert.equal(f.shares.streamFor('student-a'),one,'showing the last picture');
  assert.match(f.tray().children[0].children[0].children[0].textContent,/Reconnecting/);
  const again=callFor('student-a',true),two=picture('two');
  await f.shares.incomingCall(again);again.emit('stream',two);
  assert.equal(f.shares.count(),1);
  assert.equal(f.shares.streamFor('student-a'),two);
  assert.match(f.tray().children[0].children[0].children[0].textContent,/Live screen/);
  // The student's own page reports that he stopped.
  f.shares.studentStopped('student-a');
  assert.equal(f.shares.count(),0);
  assert.equal(again.closed,1);
  assert.equal(f.shares.streamFor('student-a'),null);
});

test('turning sharing off or denying a student still removes a waiting tile immediately',async()=>{
  const f=receiverFixture(),first=callFor();
  await f.shares.incomingCall(first);first.emit('stream',picture('one'));
  first.emit('close');await tick(5);
  assert.equal(f.shares.count(),1);
  f.shares.revokeStudents(['student-a']);
  assert.equal(f.shares.count(),0);
});

test('while the teacher is showing the lesson a new student share is refused quietly; a running one may reconnect',async()=>{
  const f=receiverFixture(),running=callFor('student-a');
  await f.shares.incomingCall(running);running.emit('stream',picture('one'));
  f.state.presenting=true;
  const fresh=callFor('student-b');
  assert.equal(await f.shares.incomingCall(fresh),true);
  assert.equal(fresh.answered,0,'a new share is not accepted during the lesson');
  assert.equal(fresh.closed,1);
  assert.equal(f.shares.count(),1);
  assert.equal(f.failure(),undefined,'and the teacher is not shown an error for it');
  // A student cannot get in by merely claiming to be reconnecting.
  const pretend=callFor('student-b',true);
  await f.shares.incomingCall(pretend);
  assert.equal(pretend.answered,0);
  // The share that was already running reconnects fine.
  running.emit('close');await tick(5);
  const again=callFor('student-a',true);
  await f.shares.incomingCall(again);
  assert.equal(again.answered,1);
  // After the lesson, new shares work again.
  f.state.presenting=false;
  const later=callFor('student-b');
  await f.shares.incomingCall(later);
  assert.equal(later.answered,1);
});

test('Stop viewing tells the student\'s computer to stop and refuses its automatic call back',async()=>{
  const f=receiverFixture(),first=callFor();
  await f.shares.incomingCall(first);first.emit('stream',picture('one'));
  const card=f.tray().children[0],stopViewing=card.children[2];
  assert.equal(stopViewing.textContent,'Stop viewing');
  stopViewing.onclick();
  assert.equal(first.closed,1);
  assert.equal(f.shares.count(),0);
  assert.deepEqual(JSON.parse(JSON.stringify(f.state.sent)),[['conn-a',{type:'share-stop'}]],'only that student is told to stop');
  const back=callFor('student-a',true);
  await f.shares.incomingCall(back);
  assert.equal(back.answered,0,'an automatic reconnect is not let back in');
  const deliberate=callFor('student-a');
  await f.shares.incomingCall(deliberate);
  assert.equal(deliberate.answered,1,'the student may share again himself');
});

// ---------- Teacher lesson record (dashboard-session.js) ----------
async function sessionFixture(){
  let auth;const operations=[],listeners=new Map(),refs=new Map();
  const ref=p=>{
    if(refs.has(p))return refs.get(p);
    const node={key:p.split('/').pop(),child:key=>ref(p+'/'+key),once:async()=>({val:()=>({active:true,toolGrants:{'class-pointer':true}})}),
      onDisconnect:()=>({remove:async()=>{operations.push(['arm',p])},cancel:async()=>{operations.push(['cancel',p])}}),
      set:async value=>{operations.push(['set',p,value])},update:async value=>{operations.push(['update',p,value])},remove:async()=>{operations.push(['remove',p])},
      on(_event,fn){listeners.set(p,fn)},off(){listeners.delete(p)}};
    refs.set(p,node);return node;
  };
  const database=()=>({ref});database.ServerValue={TIMESTAMP:{'.sv':'timestamp'}};
  const window={B3_APP_CONTEXT:{workspaceId:'b3-2026'},B3SiteSettings:{onAuthStateChanged:fn=>auth=fn}};
  const context=vm.createContext({window,URL,console,Date,location:{href:'https://example.test/classroom.html?dashboard=teacher&class=wt'},document:{getElementById:()=>null},firebase:{database,auth:()=>({currentUser:{uid:'wt-teacher'}})}});
  for(const name of ['dashboard-core.js','dashboard-session.js'])vm.runInContext(read('class-pointer-prototype/'+name),context);
  await auth({uid:'wt-teacher'},true,{authorized:true,role:'teacher',classIds:['wt']});
  const dashboard=window.ClassPointerDashboard;await dashboard.publish(room);
  const sessionPath='b3Games/workspaces/b3-2026/classes/wt/classPointerSessions/'+room;
  return{dashboard,operations,sessionPath,policyPath:'b3Private/classPointerSharePermissions/b3-2026/wt/'+room,
    snapshot:value=>listeners.get(sessionPath)?.({val:()=>value}),connected:value=>listeners.get('.info/connected')?.({val:()=>value}),watching:()=>listeners.has(sessionPath)};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,10));

test('the lesson record is put back when the teacher\'s connection blinks, with the students\' permissions',async()=>{
  const f=await sessionFixture();
  await f.dashboard.requestStudentDestination('screens',{screens:{boy:true}});
  const live={roomId:room,teacherUid:'wt-teacher',createdAt:1700000000000,studentScreenSharing:true,permissionRevision:5,destinationRequest:{mode:'screens',at:5}};
  f.snapshot(live); // what the database holds
  f.operations.length=0;
  f.snapshot(null); // Firebase removed it when the teacher's connection dropped
  await settle();
  const sets=f.operations.filter(([op])=>op==='set');
  assert.deepEqual(JSON.parse(JSON.stringify(sets.find(([,p])=>p===f.sessionPath)?.[2])),live,'the same lesson (same room, same start time, same settings) is written back');
  assert.deepEqual(JSON.parse(JSON.stringify(sets.find(([,p])=>p===f.policyPath)?.[2])),{boy:{screenSharingDenied:true}},'and the private permissions');
  assert.ok(f.operations.findIndex(([op])=>op==='arm')<f.operations.findIndex(([op])=>op==='set'),'cleanup-on-disconnect is set up again first');
});

test('reconnecting sets up the cleanup again; a lesson the teacher ended is never put back',async()=>{
  const f=await sessionFixture();
  f.snapshot({roomId:room,teacherUid:'wt-teacher',createdAt:1700000000000,studentScreenSharing:false});
  f.connected(true);f.operations.length=0; // first connection: nothing to do
  f.connected(false);f.connected(true);await settle();
  assert.deepEqual(f.operations.map(([op])=>op),['arm','arm']);
  f.operations.length=0;
  await f.dashboard.end();
  assert.equal(f.watching(),false,'the watch ends with the class');
  f.snapshot(null);await settle();
  assert.equal(f.operations.filter(([op])=>op==='set').length,0,'an ended lesson is not restored');
});

test('the teacher page publishes whether it is showing the lesson',async()=>{
  const f=await sessionFixture();f.operations.length=0;
  await f.dashboard.setTeacherPresenting(true);
  await f.dashboard.setTeacherPresenting(false);
  assert.deepEqual(JSON.parse(JSON.stringify(f.operations)),[['set',f.sessionPath+'/teacherPresenting',true],['set',f.sessionPath+'/teacherPresenting',false]]);
  await f.dashboard.end();f.operations.length=0;
  await f.dashboard.setTeacherPresenting(true);
  assert.equal(f.operations.length,0,'nothing is written after the class ended');
});

test('the database rules let the teacher add fields to the lesson record (no rule change needed)',()=>{
  const rules=JSON.parse(read('firebase-rules.json'));
  const sessions=rules.rules.b3Games.workspaces.$workspaceId.classes.$classId.classPointerSessions;
  assert.ok(sessions['.write'],'teachers of the class write the whole session subtree');
  assert.equal(sessions['.validate'],undefined);
  assert.equal(Object.keys(sessions).filter(key=>key.startsWith('$')).length,0,'no per-field restrictions that would reject teacherPresenting');
});

// ---------- Teacher page: what counts as "showing the lesson" (classroom.js) ----------
function classroomFixture(){
  const nodes=new Map(),events={},published=[];let workspace=null;
  const node=()=>({value:'nobody',hidden:false,dataset:{},style:{setProperty(){}},classList:{toggle(){}},setAttribute(){},append(){},appendChild(){},replaceChildren(){},remove(){},addEventListener(){},getBoundingClientRect(){return{width:800,height:450,left:0,top:0}}});
  const window={ClassPointerCore:require('../class-pointer-prototype/classroom-core.js'),addEventListener(){},
    ClassPointerDashboard:{setTeacherPresenting:async value=>{published.push(value)}},ClassPointerBoards:{workspace:()=>workspace}};
  const context=vm.createContext({window,document:{addEventListener(type,fn){(events[type]??=[]).push(fn)},dispatchEvent(){},getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},createElement:node,createTextNode:t=>t},
    location:{href:'https://test/classroom.html?dashboard=teacher&class=et'},URL,ResizeObserver:class{observe(){}},CustomEvent:class{},
    setTimeout:fn=>{fn();return 1},clearTimeout(){},Date,console,crypto:require('node:crypto').webcrypto});
  vm.runInContext(read('class-pointer-prototype/classroom.js'),context);
  vm.runInContext('started=true',context);
  const fire=(type,detail)=>{for(const fn of events[type]||[])fn({detail})};
  return{run:code=>vm.runInContext(code,context),fire,published,setWorkspace:value=>{workspace=value},bridge:window.ClassPointerBridge};
}

test('"showing the lesson" covers screen, PDF, webpage and whiteboard, and only while students see it',async()=>{
  const f=classroomFixture();
  f.run('publish()');await tick(5);
  assert.deepEqual(f.published,[],'nothing open: not presenting, nothing to write');
  f.run('state.sharing=true;publish()');await tick(5);
  assert.deepEqual(f.published,[true],'live screen share');
  assert.equal(f.bridge.presenting(),true);
  assert.equal(f.run('state.presenting'),true,'joined students get it in the class state');
  f.run('state.sharing=false;publish()');await tick(5);
  assert.deepEqual(f.published,[true,false]);
  // PDF, webpage and whiteboard all open through setPdf.
  for(const kind of ['pdf','webpage','whiteboard']){
    f.published.length=0;
    f.bridge.setPdf(true,kind);await tick(5);
    assert.deepEqual(f.published,[true],kind+' counts as showing the lesson');
    f.bridge.setPdf(false);await tick(5);
    assert.deepEqual(f.published,[true,false],kind+' closed');
  }
  // With a PDF open, the teacher switches to the Student screens tab: students no longer see the lesson,
  // so they may share. Back on My screen they may not.
  f.published.length=0;
  f.bridge.setPdf(true,'pdf');await tick(5);
  f.setWorkspace('screens');f.fire('classpointer:sharing-state');f.fire('class-pointer-workspace','screens');await tick(5);
  assert.deepEqual(f.published,[true,false]);
  f.setWorkspace(null);f.fire('classpointer:sharing-state');f.fire('class-pointer-workspace','teach');await tick(5);
  assert.deepEqual(f.published,[true,false,true]);
});

// ---------- Wiring that cannot be exercised without a browser ----------
test('the joined-student Share My Screen panel hides and blocks its button while the teacher is showing the lesson',()=>{
  const boards=read('class-pointer-prototype/student-boards.js');
  assert.match(boards,/const lessonShowing=\(\)=>B\.presenting\?\.\(\)===true/);
  assert.match(boards,/shareBtn\.hidden=lessonShowing\(\)&&!stream/,'hidden unless a share is already running (Stop stays)');
  assert.match(boards,/function openShareWindow\(\)\{\s*if\(lessonShowing\(\)\)\{[^}]*return\}/,'the click is refused, not only hidden');
  assert.match(boards,/async function startShare\(\)\{\s*shareNote\.textContent='';\s*if\(lessonShowing\(\)\)\{[^}]*return\}/);
  assert.match(boards,/addEventListener\('classpointer:teacher-presenting',\(\)=>redraw\(\)\)/);
  const classroom=read('class-pointer-prototype/classroom.js');
  assert.match(classroom,/presenting:\(\)=>isTeacher\?teacherPresenting\(\):state\?\.presenting===true/);
  assert.match(classroom,/dispatchEvent\(new Event\('classpointer:teacher-presenting'\)\)/);
});

test('opening the shared whiteboard hides the student gallery without switching student sharing off',()=>{
  const boards=read('class-pointer-prototype/student-boards.js');
  const start=boards.indexOf("$('openWhiteboard')?.addEventListener('click'");
  assert.ok(start>0);
  const handler=boards.slice(start,start+900);
  assert.doesNotMatch(handler,/setOn\(false\)\s*;/,'setOn(false) revoked every student\'s screen share');
  assert.match(handler,/if\(on&&!suspended\)hideWorkspace\(\)/);
});

test('a student\'s own page tells the teacher when he stops, and hears Stop viewing and the end of the lesson',()=>{
  const share=read('class-pointer-prototype/activity-share.js');
  assert.match(share,/presenceConn\.send\(\{type:'board-screen',sharing:false,from:'share-tab'\}\)/);
  assert.match(share,/message\.type==='share-stop'\)\{if\(admitted&&holderState\?\.open\)tell\(\{type:'stop'\}\)/);
  assert.match(share,/message\.type==='ended'\)\{stopPresence\(\);tell\(\{type:'lesson-ended',room\}\);lessonEnded\(room\)\}/);
  const boards=read('class-pointer-prototype/student-boards.js');
  assert.match(boards,/message\.from==='share-tab'\)\{window\.ClassPointerActivityShares\?\.studentStopped\?\.\(m\.studentId\);return\}/);
  // A long lesson: the 4 hour limit does not drop a lesson this page is already following.
  assert.match(share,/Date\.now\(\)-v\.createdAt<14400000\|\|key===latestSession\?\.roomId/);
});
