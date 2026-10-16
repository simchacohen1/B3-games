'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const room='class-pointer-12345678-1234-1234-1234-123456789abc';

async function activityFixture({capture}={}){
  let listener,policy={},holder,overlay,navigation=null,captureCount=0,stopCount=0,requests=0;
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
    body:{appendChild(node){if(node.id==='fttActivityScreenShare')holder=node;if(node.id==='fttShareRequestOverlay')overlay=node}}
  };
  const db={ref:path=>({on:(_event,cb)=>{if(path.includes('/classPointerSessions'))listener=cb},off(){}})};
  const firebase={apps:[{}],database:()=>db};
  const location={
    href:'https://funtorahtools.com/shorashim/index.html',
    pathname:'/shorashim/index.html',
    assign(url){navigation=url}
  };
  const window={
    firebase,B3_FIREBASE_CONFIG:{},
    FunTorahStudentClass:{resolve:async()=>({workspaceId:'b3-2026',classId:'et'})},
    open(){return null},addEventListener(){}
  };
  const navigator={mediaDevices:{getDisplayMedia(){
    captureCount++;
    if(capture)return capture();
    const track={stop(){stopCount++},addEventListener(){}};
    return Promise.resolve({active:true,getTracks:()=>[track],getVideoTracks:()=>[track]});
  }}};
  async function fetch(url,options){
    if(String(url).includes('funTorahStudentAuth'))return{ok:true,json:async()=>({ok:true})};
    const body=JSON.parse(options?.body||'{}');
    if(body.action==='permissions')return{ok:true,json:async()=>({ok:true,...policy})};
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
  const [choose,cancel]=overlay.children[0].children;
  const emit=async(mode,denied={})=>{
    const now=Date.now();
    policy={screenSharingDenied:denied.screens?.['test-boy']===true,whiteboardDenied:denied.boards?.['test-boy']===true};
    await listener({val:()=>({[room]:{
      roomId:room,createdAt:now,studentScreenSharing:mode==='screens',
      permissionRevision:now+Math.random(),destinationRequest:{mode,at:now}
    }})});
  };
  return {
    emit,shareButton,label,fallback,overlay,choose,cancel,
    get navigation(){return navigation},
    get captureCount(){return captureCount},
    get stopCount(){return stopCount},
    get requests(){return requests}
  };
}

test('screen request stays on activity, with explicit browser permission and same-class fallback',async()=>{
  const a=await activityFixture();
  await a.emit('screens');
  assert.equal(a.navigation,null);
  assert.equal(a.overlay.style.display,'flex','teacher request opens centered consent');
  assert.equal(a.fallback.hidden,true);
  await a.choose.listeners.click();
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
  await a.emit('boards');
  assert.match(a.navigation,/class-pointer-prototype\/dashboard.html/);
  assert.equal(a.captureCount,0);
});
test('denied students cannot receive screen prompts or whiteboard navigation',async()=>{
  const a=await activityFixture();
  await a.emit('screens',{screens:{'test-boy':true}});
  assert.equal(a.navigation,null);
  assert.equal(a.captureCount,0);
  await a.emit('boards',{boards:{'test-boy':true}});
  assert.equal(a.navigation,null);
});
test('per-student denial is checked by backend on ticket issue and verification',()=>{
  const src=read('backend/functions/class-pointer-share-auth.js');
  assert.match(src,/action==='permissions'/);
  assert.match(src,/permission\?\.screenSharingDenied===true/);
  // TEMPORARY compatibility: the live site still writes denials to the public session record; every read must be OR'd with the private policy.
  for (const line of src.split(/\r?\n/).filter(l => /session\.(screenSharingDenied|whiteboardDenied)/.test(l))) assert.match(line, /permission\??\.(screenSharing|whiteboard)Denied===true\|\|/);});
test('restart is gated on cleanup, never races with prior Firebase session removal',()=>{
  const src=read('class-pointer-prototype/classroom.js');
  const session=read('class-pointer-prototype/dashboard-session.js');
  const boards=read('class-pointer-prototype/student-boards.js');
  assert.match(src,/let closingClass=false,endPromise=Promise\.resolve\(\)/);
  assert.match(src,/await endPromise/);
  assert.match(src,/button\.disabled=true;button\.hidden=false;button\.textContent='Ending class…'/);
  assert.match(src,/endPromise=Promise\.resolve\(\)\.then/);
  assert.match(src,/button\.disabled=false;button\.textContent='↻ Start another class'/);
  assert.match(session,/policyRef\?\.remove\(\)/);
  assert.match(session,/policyRef\?\.onDisconnect\(\)\.cancel\(\)/);
  assert.match(boards,/Do not send an asynchronous child update here/);
});


test('permission revoked while browser picker is open stops capture before any ticket request',async()=>{
  let finish,stops=0;
  const a=await activityFixture({capture:()=>new Promise(resolve=>finish=resolve)});
  await a.emit('screens');
  const sharing=a.shareButton.listeners.click();
  await a.emit('screens',{screens:{'test-boy':true}});
  const track={stop(){stops++},addEventListener(){}};
  finish({active:true,getTracks:()=>[track],getVideoTracks:()=>[track]});
  await sharing;
  assert.equal(a.requests,0);
  assert.equal(stops,1);
  assert.match(a.label.textContent,/permission changed/);
  assert.equal(a.shareButton.disabled,false);
});
