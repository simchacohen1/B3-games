'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const room='class-pointer-12345678-1234-1234-1234-123456789abc';

async function activityFixture({capture}={}){
  let listener,holder,navigation=null,captureCount=0,stopCount=0,requests=0;
  const sessionStorageValues=new Map([['b3Games_studentId','test-boy'],['b3Games_classPin','test-pin']]);
  const sessionStorage={
    getItem:k=>sessionStorageValues.get(k)||null,
    setItem:(k,v)=>sessionStorageValues.set(k,v)
  };
  const element=tag=>({
    tag,style:{cssText:''},children:[],listeners:{},textContent:'',hidden:false,disabled:false,
    setAttribute(){},
    addEventListener(type,fn){this.listeners[type]=fn},
    append(...args){this.children.push(...args)}
  });
  const document={
    currentScript:{src:'https://funtorahtools.com/class-pointer-prototype/activity-share.js'},
    createElement:element,
    head:{appendChild(){}},
    body:{appendChild(node){holder=node}}
  };
  const db={ref:()=>({on:(_event,cb)=>{listener=cb}})};
  const firebase={apps:[{}],database:()=>db};
  const location={
    href:'https://funtorahtools.com/shorashim/index.html',
    pathname:'/shorashim/index.html',
    assign(url){navigation=url}
  };
  const window={
    firebase,B3_FIREBASE_CONFIG:{},
    FunTorahStudentClass:{resolve:async()=>({workspaceId:'b3-2026',classId:'et'})},
    addEventListener(){}
  };
  const navigator={mediaDevices:{getDisplayMedia(){
    captureCount++;
    if(capture)return capture();
    const track={stop(){stopCount++},addEventListener(){}};
    return Promise.resolve({active:true,getTracks:()=>[track],getVideoTracks:()=>[track]});
  }}};
  async function fetch(url){
    if(String(url).includes('funTorahStudentAuth'))return{ok:true,json:async()=>({ok:true})};
    requests++;
    throw new TypeError('Failed to fetch');
  }
  await vm.runInNewContext(read('class-pointer-prototype/activity-share.js'),{
    window,document,location,URL,sessionStorage,firebase,fetch,navigator,
    AbortSignal,Date,console
  });
  assert.ok(listener,'authenticated session should subscribe to teacher requests');
  assert.ok(holder,'activity sharing invitation must exist');
  const [shareButton,label,fallback]=holder.children;
  const emit=(mode,denied={})=>{
    const now=Date.now();
    listener({val:()=>({[room]:{
      roomId:room,createdAt:now,studentScreenSharing:mode==='screens',
      destinationRequest:{mode,at:now},
      screenSharingDenied:denied.screens||{},whiteboardDenied:denied.boards||{}
    }})});
  };
  return {
    emit,shareButton,label,fallback,
    get navigation(){return navigation},
    get captureCount(){return captureCount},
    get stopCount(){return stopCount},
    get requests(){return requests}
  };
}

test('screen request stays on activity, with explicit browser permission and same-class fallback',async()=>{
  const a=await activityFixture();
  a.emit('screens');
  assert.equal(a.navigation,null);
  assert.match(a.label.textContent,/teacher requested your screen/);
  assert.equal(a.fallback.hidden,false);
  await a.shareButton.listeners.click();
  assert.equal(a.captureCount,1);
  assert.equal(a.requests,1);
  assert.equal(a.stopCount,1); // permission granted but capture is stopped after network failure
  assert.match(a.label.textContent,/service unavailable/);
  assert.equal(a.fallback.hidden,false);
  a.fallback.listeners.click();
  assert.match(a.navigation,/class-pointer-prototype\/dashboard.html/);
});
test('whiteboard request still opens the private classroom board',async()=>{
  const a=await activityFixture();
  a.emit('boards');
  assert.match(a.navigation,/class-pointer-prototype\/dashboard.html/);
  assert.equal(a.captureCount,0);
});
test('denied students cannot receive screen prompts or whiteboard navigation',async()=>{
  const a=await activityFixture();
  a.emit('screens',{screens:{'test-boy':true}});
  assert.equal(a.navigation,null);
  assert.equal(a.captureCount,0);
  await a.shareButton.listeners.click();
  assert.equal(a.captureCount,0);
  a.emit('boards',{boards:{'test-boy':true}});
  assert.equal(a.navigation,null);
});
test('per-student denial is checked by backend on ticket issue and verification',()=>{
  const src=read('backend/functions/class-pointer-share-auth.js');
  assert.match(src,/session\.screenSharingDenied\?\.\[studentId\]===true/);
  assert.match(src,/session\.screenSharingDenied\?\.\[ticket\.studentId\]===true/);
});
test('restart is gated on cleanup, never races with prior Firebase session removal',()=>{
  const src=read('class-pointer-prototype/classroom.js');
  const session=read('class-pointer-prototype/dashboard-session.js');
  const boards=read('class-pointer-prototype/student-boards.js');
  assert.match(src,/let closingClass=false,endPromise=Promise\.resolve\(\)/);
  assert.match(src,/await endPromise/);
  assert.match(src,/button\.disabled=true;button\.hidden=false;button\.textContent='Ending class…'/);
  assert.match(src,/endPromise=Promise\.resolve\(\)\.then/);
  assert.match(src,/button\.disabled=false;button\.textContent='↻ Start another class'/);
  assert.match(session,/await ref\.remove\(\);\s*await ref\.onDisconnect\(\)\.cancel\(\);/);
  assert.match(boards,/Do not send an asynchronous child update here/);
});


test('permission revoked while browser picker is open stops capture before any ticket request',async()=>{
  let finish,stops=0;
  const a=await activityFixture({capture:()=>new Promise(resolve=>finish=resolve)});
  a.emit('screens');
  const sharing=a.shareButton.listeners.click();
  a.emit('screens',{screens:{'test-boy':true}});
  const track={stop(){stops++},addEventListener(){}};
  finish({active:true,getTracks:()=>[track],getVideoTracks:()=>[track]});
  await sharing;
  assert.equal(a.requests,0);
  assert.equal(stops,1);
  assert.match(a.label.textContent,/permission changed/);
  assert.equal(a.shareButton.disabled,false);
});
