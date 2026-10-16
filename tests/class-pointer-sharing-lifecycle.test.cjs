'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const read=file=>fs.readFileSync(__dirname+'/../class-pointer-prototype/'+file,'utf8');
const room='class-pointer-12345678-1234-1234-1234-123456789abc';
const otherRoom='class-pointer-22345678-1234-1234-1234-123456789abc';
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}}
function element(tag){return{tag,children:[],style:{},dataset:{},hidden:false,disabled:false,
  append(...nodes){this.children.push(...nodes)},appendChild(node){this.children.push(node)},
  remove(){this.removed=true},setAttribute(){},play:()=>Promise.resolve()};}
function teacherFixture({getToken,verify}={}){
  const stage=element('main'),joinLink={value:'https://synthetic.test/?room='+room},endClass={disabled:false};
  const events={},denied=new Set();let enabled=true;
  const document={createElement:element,getElementById:id=>({stage,joinLink,endClass}[id]||stage.children.find(n=>n.id===id)),
    addEventListener:(name,fn)=>events[name]=fn};
  const user={uid:'synthetic-teacher',getIdToken:getToken||(()=>Promise.resolve('synthetic-token'))};
  const auth={currentUser:user};
  const window={ClassPointerBoards:{canReceiveActivityScreen:id=>enabled&&!denied.has(id)}};
  vm.runInNewContext(read('activity-screen-teacher.js'),{window,document,location:{search:'?dashboard=teacher&class=et'},
    firebase:{auth:()=>auth},URL,URLSearchParams,AbortSignal,
    MutationObserver:class{observe(){}},console:{warn(){}},
    fetch:verify||(()=>Promise.resolve({ok:true,status:200,json:async()=>({ok:true,studentId:'one',studentName:'Synthetic One'})}))});
  function call(){const listeners={};return{metadata:{kind:'activity-screen',token:'a'.repeat(64)},answered:0,closed:0,
    on(type,fn){(listeners[type]??=[]).push(fn)},emit(type,value){for(const fn of listeners[type]||[])fn(value)},
    answer(){this.answered++},close(){this.closed++;this.emit('close')}};}
  const tray=stage.children.find(n=>n.id==='activityScreenTray');
  return{api:window.ClassPointerActivityShares,call,joinLink,endClass,auth,denied,stage,
    disable(){enabled=false;events['classpointer:sharing-state']?.()},
    changed(){events['classpointer:sharing-state']?.()},
    cards:()=>tray.children.filter(n=>!n.removed)};
}
test('End/Restart cancels authorization still waiting for the teacher token',async()=>{
  const token=deferred(),f=teacherFixture({getToken:()=>token.promise}),call=f.call();
  const receiving=f.api.incomingCall(call);
  f.api.closeAll();f.joinLink.value='https://synthetic.test/?room='+otherRoom;
  token.resolve('synthetic-token');await receiving;
  assert.equal(call.answered,0);assert.ok(call.closed>0);assert.equal(f.cards().length,0);
});
test('End/Restart cancels a successful but stale verification response',async()=>{
  const response=deferred(),f=teacherFixture({verify:()=>response.promise}),call=f.call();
  const receiving=f.api.incomingCall(call);await new Promise(setImmediate);
  f.api.closeAll();f.joinLink.value='https://synthetic.test/?room='+otherRoom;
  response.resolve({ok:true,status:200,json:async()=>({ok:true,studentId:'one',studentName:'Synthetic One'})});await receiving;
  assert.equal(call.answered,0);assert.equal(f.cards().length,0);
});
test('a caller that disconnected during verification never creates a ghost tile',async()=>{
  const token=deferred(),f=teacherFixture({getToken:()=>token.promise}),call=f.call();
  const receiving=f.api.incomingCall(call);call.emit('close');token.resolve('synthetic-token');await receiving;
  assert.equal(call.answered,0);assert.equal(f.cards().length,0);
});
test('teacher sign-out during verification refuses the incoming media',async()=>{
  const token=deferred(),f=teacherFixture({getToken:()=>token.promise}),call=f.call();
  const receiving=f.api.incomingCall(call);f.auth.currentUser=null;token.resolve('synthetic-token');await receiving;
  assert.equal(call.answered,0);assert.equal(f.cards().length,0);
});
test('unchecking one student immediately closes only that verified activity stream',async()=>{
  let next='one';
  const f=teacherFixture({verify:async()=>({ok:true,status:200,json:async()=>({ok:true,studentId:next,studentName:next})})});
  const one=f.call();await f.api.incomingCall(one);next='two';const two=f.call();await f.api.incomingCall(two);
  assert.equal(f.cards().length,2);
  const video=f.cards()[0].children.find(n=>n.tag==='video');video.srcObject={synthetic:true};
  f.denied.add('one');f.changed();
  assert.ok(one.closed>0);assert.equal(two.closed,0);assert.equal(f.cards().length,1);
  assert.equal(video.srcObject,null,'release media from the removed tile');
});
test('disabling sharing closes all activity streams locally without waiting for student Firebase delivery',async()=>{
  const f=teacherFixture(),call=f.call();await f.api.incomingCall(call);assert.equal(call.answered,1);
  f.disable();assert.ok(call.closed>0);assert.equal(f.cards().length,0);
});
test('a denied student is not answered even if its older server ticket verifies',async()=>{
  const f=teacherFixture();f.denied.add('one');const call=f.call();await f.api.incomingCall(call);
  assert.equal(call.answered,0);assert.equal(f.cards().length,0);
});

async function studentFixture(capture,{ticket,Peer}={}){
  let listener,requests=0;
  const stored=new Map([['b3Games_studentId','synthetic-student'],['b3Games_classPin','synthetic-pin']]);
  const make=tag=>({...element(tag),listeners:{},addEventListener(type,fn){this.listeners[type]=fn}});
  const body=make('body'),firebase={apps:[{}],database:()=>({ref:()=>({on:(_type,cb)=>listener=cb})})};
  const window={firebase,Peer,B3_FIREBASE_CONFIG:{},addEventListener(){},FunTorahStudentClass:{resolve:async()=>({workspaceId:'b3-2026',classId:'et'})}};
  await vm.runInNewContext(read('activity-share.js'),{window,firebase,URL,Date,AbortSignal,console,Peer,setTimeout,clearTimeout,
    crypto:require('node:crypto').webcrypto,
    document:{currentScript:{src:'https://synthetic.test/class-pointer-prototype/activity-share.js'},head:make('head'),body,createElement:make},
    location:{pathname:'/synthetic.html'},sessionStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)},
    navigator:{mediaDevices:{getDisplayMedia:capture}},fetch:async url=>{
      if(String(url).includes('funTorahStudentAuth'))return{ok:true,json:async()=>({ok:true})};
      requests++;
      if(ticket)return ticket();
      throw Error('No real network calls are allowed');
    }});
  const holder=body.children.find(n=>n.id==='fttActivityScreenShare');
  return{stored,requests:()=>requests,share:()=>holder.children[0].listeners.click(),emit(allowed){listener({val:()=>({[room]:{
    roomId:room,createdAt:Date.now(),studentScreenSharing:allowed
  }})})}};
}
test('revocation followed by re-enable cannot revive a browser picker from the old permission grant',async()=>{
  const picker=deferred();let stopped=0;
  const f=await studentFixture(()=>picker.promise);f.emit(true);const sharing=f.share();
  f.emit(false);f.emit(true);
  picker.resolve({active:true,getTracks:()=>[{stop(){stopped++}}],getVideoTracks:()=>[]});await sharing;
  assert.equal(f.requests(),0);assert.ok(stopped>0);
});
test('account changes while the picker is open cannot send the old student credentials',async()=>{
  const picker=deferred();const f=await studentFixture(()=>picker.promise);f.emit(true);const sharing=f.share();
  f.stored.set('b3Games_studentId','other-synthetic-student');
  picker.resolve({active:true,getTracks:()=>[{stop(){}}],getVideoTracks:()=>[]});await sharing;
  assert.equal(f.requests(),0);
});

test('late close and track-ended callbacks from an old share cannot stop a new one',async()=>{
  const calls=[],tracks=[];
  class Peer{
    once(type,fn){if(type==='open')queueMicrotask(fn)}
    destroy(){}
    call(){
      const handlers={};
      const call={closed:0,on(type,fn){handlers[type]=fn},emit:type=>handlers[type]?.(),
        close(){this.closed++;this.emit('close')}};
      calls.push(call);return call;
    }
  }
  const f=await studentFixture(()=>{
    const track={stopped:0,stop(){this.stopped++},addEventListener(type,fn){this[type]=fn}};
    tracks.push(track);return Promise.resolve({active:true,getTracks:()=>[track],getVideoTracks:()=>[track]});
  },{Peer,ticket:async()=>({ok:true,json:async()=>({ok:true,token:'a'.repeat(64)})})});
  f.emit(true);await f.share();assert.equal(calls.length,1);
  await f.share();assert.equal(calls[0].closed,1,'synchronous close does not recurse');
  await f.share();assert.equal(calls.length,2);
  calls[0].emit('close');tracks[0].ended();
  assert.equal(calls[1].closed,0);assert.equal(tracks[1].stopped,0);
  await f.share();assert.equal(calls[1].closed,1);assert.equal(tracks[1].stopped,1);
});

test('revocation stops captured media immediately while ticket issuance is still pending',async()=>{
  const response=deferred();let stopped=0;
  const f=await studentFixture(()=>Promise.resolve({active:true,getTracks:()=>[{stop(){stopped++}}],getVideoTracks:()=>[]}),
    {ticket:()=>response.promise});
  f.emit(true);const sharing=f.share();await new Promise(setImmediate);
  assert.equal(f.requests(),1);assert.equal(stopped,0);
  f.emit(false);assert.ok(stopped>0,'do not wait for the server before stopping capture');
  response.resolve({ok:true,json:async()=>({ok:true,token:'a'.repeat(64)})});await sharing;
});
