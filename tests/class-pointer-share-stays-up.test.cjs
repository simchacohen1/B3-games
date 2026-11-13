'use strict';
/* Sharing tab (#700), built on the #809 teacher-disconnect design.
   A student's shared screen stays up until the student or the teacher stops it on purpose, or the
   lesson is over: a failed permission check or a dropped connection must not end it, and the sharing
   tab follows the lesson record exactly like every other student page (teacherOfflineAt, 120 seconds). */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const room='class-pointer-12345678-1234-1234-1234-123456789abc';
const tick=(ms=20)=>new Promise(resolve=>setTimeout(resolve,ms));
// Minimal same-origin BroadcastChannel shared by the pages of one test (one browser).
function fakeBus(){
  const channels=new Set();
  return class{
    constructor(name){this.name=name;this.onmessage=null;channels.add(this)}
    postMessage(data){for(const c of channels)if(c!==this&&c.name===this.name)setTimeout(()=>c.onmessage?.({data:structuredClone(data)}),0)}
    close(){channels.delete(this)}
  };
}

// ---------- Student side (activity-share.js) ----------
async function studentFixture({persistent=false,openWindow=()=>({closed:false}),BroadcastChannel}={}){
  let listener,holder,captureCount=0,stopCount=0,closed=false,issued=0;
  const control={permissions:async()=>({ok:true,status:200,json:async()=>({ok:true})}),issue:null,answers:true};
  const values=new Map([['b3Games_studentId','test-boy'],['b3Games_classPin','test-pin']]);
  const sessionStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const element=tag=>({tag,style:{cssText:''},dataset:{},children:[],listeners:{},textContent:'',hidden:false,disabled:false,
    setAttribute(){},addEventListener(type,fn){this.listeners[type]=fn},append(...args){this.children.push(...args)}});
  const headline=element('p');
  const document={currentScript:{src:'https://funtorahtools.com/class-pointer-prototype/activity-share.js'},createElement:element,
    getElementById:id=>id==='fttShareHeadline'?headline:null,
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
    crypto:{randomUUID:()=>'synthetic-peer-id'},AbortSignal,Date,setTimeout,clearTimeout,console,
    ...(BroadcastChannel?{BroadcastChannel}:{})});
  assert.ok(listener&&holder);
  const [shareButton,label]=holder.children;
  let revision=1;
  const row=(extra={})=>({roomId:room,createdAt:Date.now(),studentScreenSharing:true,permissionRevision:revision,destinationRequest:{mode:'screens',at:revision},...extra});
  return{control,holder,shareButton,label,headline,peerCalls,peers,opened,
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

// ---------- The sharing tab and the #809 teacher-disconnect design ----------
test('teacher offline for less than the grace period: the sharing tab keeps capturing, and carries on when he returns',async()=>{
  const s=await studentFixture({persistent:true});
  await s.emit();await tick();
  assert.equal(s.peerCalls.length,1);
  // The teacher's page lost its connection a moment ago: the record is stamped, not deleted.
  await s.same({teacherOfflineAt:Date.now()-5000});await tick();
  assert.equal(s.stopCount,0,'the share is not ended by a short drop');
  assert.equal(s.peerCalls[0].closed,false);
  assert.equal(s.shareButton.textContent,'⏹ Stop Sharing');
  assert.match(s.headline.textContent,/sharing your screen/);
  // The teacher is back: the stamp is cleared, nothing else happens.
  await s.same();await tick();
  assert.equal(s.stopCount,0);
  assert.equal(s.captureCount,1,'no second screen picker');
});

test('teacher offline past the grace period: the sharing tab releases the capture by itself and says sharing is off',async()=>{
  const s=await studentFixture({persistent:true});
  await s.emit();await tick();
  assert.equal(s.peerCalls.length,1);
  await s.same({teacherOfflineAt:Date.now()-119000}); // one second of grace left
  assert.equal(s.stopCount,0,'still inside the grace period');
  await tick(1700);
  assert.equal(s.stopCount,1,'capture is not left running for an absent teacher');
  assert.equal(s.peerCalls[0].closed,true);
  assert.equal(s.holder.style.display,'none');
  assert.match(s.headline.textContent,/Screen sharing is off right now/);
  s.peerCalls[0].emit('close');await tick(1300);
  assert.equal(s.peerCalls.length,1,'and it does not call the teacher again');
});

test('End Class (the lesson record is removed) ends the capture in the sharing tab at once; the working tab goes back to its button',async()=>{
  const BroadcastChannel=fakeBus();
  const page=await studentFixture({BroadcastChannel});
  await page.emit();
  await page.shareButton.listeners.click();
  assert.equal(page.opened.length,1);
  const tab=await studentFixture({persistent:true,BroadcastChannel});
  await tab.emit();await tick(50);
  assert.equal(tab.peerCalls.length,1);
  assert.equal(page.shareButton.textContent,'⏹ Stop Sharing');
  await tab.gone();await page.gone();await tick(50);
  assert.equal(tab.stopCount,1,'no waiting: the lesson is over');
  assert.match(tab.headline.textContent,/Screen sharing is off right now/);
  assert.equal(page.shareButton.textContent,'🖥 Share My Screen','no stale Stop or Cancel button in the working tab');
  assert.equal(page.holder.style.display,'none','and no button at all while there is no lesson');
});

test('another student signing in on the same computer ends and closes the first student\'s sharing tab',async()=>{
  const BroadcastChannel=fakeBus();
  const tab=await studentFixture({persistent:true,BroadcastChannel});
  await tab.emit();await tick(50);
  assert.equal(tab.peerCalls.length,1);
  // The next boy's page announces itself as every activity page does.
  new BroadcastChannel('ftt-class-pointer-share').postMessage({type:'ping',studentId:'other-boy'});
  await tick(250);
  assert.equal(tab.stopCount,1,'his screen is never shown under the first student\'s name');
  assert.equal(tab.closed,true);
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
  const state={sent:[]};
  const presence=new Map([['presence:a',{admitted:true,studentId:'student-a',connection:{id:'conn-a'}}],['presence:b',{admitted:true,studentId:'student-b',connection:{id:'conn-b'}}]]);
  const window={ClassPointerBridge:{presence:()=>presence,send:(connection,message)=>state.sent.push([connection.id,message])}};
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

// ---------- Wiring that cannot be exercised without a browser ----------
test('a student\'s own page tells the teacher when he stops and hears Stop viewing; the #809 lesson rules are untouched',()=>{
  const share=read('class-pointer-prototype/activity-share.js');
  assert.match(share,/presenceConn\.send\(\{type:'board-screen',sharing:false,from:'share-tab'\}\)/);
  assert.match(share,/message\.type==='share-stop'\)\{if\(admitted&&holderState\?\.open\)tell\(\{type:'stop'\}\)/);
  const boards=read('class-pointer-prototype/student-boards.js');
  assert.match(boards,/message\.from==='share-tab'\)\{window\.ClassPointerActivityShares\?\.studentStopped\?\.\(m\.studentId\);return\}/);
  // Nothing from the dropped #772 disconnect handling came along.
  assert.match(share,/const TEACHER_GRACE_MS=120000;/);
  assert.match(share,/&&!teacherGone\(v\)\)/);
  assert.doesNotMatch(share,/lastSeenAt|teacherPresenting|SESSION_GRACE|sessionGoneTimer|lesson-ended|board-clipboard|saved-work/);
  assert.doesNotMatch(read('class-pointer-prototype/activity-screen-teacher.js'),/presenting/);
});
