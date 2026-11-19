'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const room='class-pointer-12345678-1234-1234-1234-123456789abc';

async function activityFixture({capture,persistent=false,sessionStorageValues:initialStorage,openWindow=()=>null,validTicket=false,BroadcastChannel}={}){
  let listener,policy={},holder,navigation=null,captureCount=0,stopCount=0,requests=0,closed=false;
  const sessionStorageValues=initialStorage||new Map([['b3Games_studentId','test-boy'],['b3Games_classPin','test-pin']]);
  const sessionStorage={
    getItem:k=>sessionStorageValues.get(k)||null,
    setItem:(k,v)=>sessionStorageValues.set(k,v),
    removeItem:k=>sessionStorageValues.delete(k)
  };
  const element=tag=>({
    tag,style:{cssText:''},dataset:{},children:[],listeners:{},textContent:'',hidden:false,disabled:false,
    setAttribute(){},
    addEventListener(type,fn){this.listeners[type]=fn},
    append(...args){this.children.push(...args)}
  });
  const document={
    currentScript:{src:'https://funtorahtools.com/class-pointer-prototype/activity-share.js'},
    createElement:element,
    head:{appendChild(){}},
    body:{appendChild(node){if(node.id==='fttActivityScreenShare')holder=node}}
  };
  const db={ref:path=>({on:(_event,cb)=>{if(path.includes('/classPointerSessions'))listener=cb},off(){}})};
  const firebase={apps:[{}],database:()=>db};
  const location={
    href:'https://funtorahtools.com/shorashim/index.html'+(persistent?'?pointerShare=1':''),
    pathname:'/shorashim/index.html',
    assign(url){navigation=url}
  };
  const windowEvents={},peerCalls=[];
  class FakePeer{
    constructor(id){this.id=id}
    once(event,callback){if(event==='open')callback()}
    call(target,stream,options){const media={target,stream,options,closed:false,on(){},close(){this.closed=true}};peerCalls.push(media);return media}
    destroy(){this.destroyed=true}
  }
  const window={
    firebase,B3_FIREBASE_CONFIG:{},Peer:FakePeer,
    FunTorahStudentClass:{resolve:async()=>({workspaceId:'b3-2026',classId:'et'})},
    open(...args){return openWindow(...args)},close(){closed=true},addEventListener(type,fn){windowEvents[type]=fn}
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
    if(body.action==='issue'&&validTicket)return{ok:true,json:async()=>({ok:true,token:'synthetic-ticket'})};
    throw new TypeError('Failed to fetch');
  }
  await vm.runInNewContext(read('class-pointer-prototype/activity-share.js'),{
    window,document,location,URL,sessionStorage,firebase,fetch,navigator,
    Peer:FakePeer,crypto:{randomUUID:()=> 'synthetic-peer-id'},AbortSignal,Date,setTimeout,clearTimeout,console,
    ...(BroadcastChannel?{BroadcastChannel}:{})
  });
  assert.ok(listener,'authenticated session should subscribe to teacher requests');
  assert.ok(holder,'activity sharing invitation must exist');
  const [shareButton,label,fallback]=holder.children;
  const emit=async(mode,denied={})=>{
    const now=Date.now();
    policy={screenSharingDenied:denied.screens?.['test-boy']===true,whiteboardDenied:denied.boards?.['test-boy']===true};
    await listener({val:()=>({[room]:{
      roomId:room,createdAt:now,studentScreenSharing:mode==='screens',
      permissionRevision:now+Math.random(),destinationRequest:{mode,at:now}
    }})});
  };
  return {
    emit,shareButton,label,fallback,holder,
    // The lesson record is gone (the class ended).
    gone:async()=>{await listener({val:()=>null})},
    get navigation(){return navigation},
    get captureCount(){return captureCount},
    get stopCount(){return stopCount},
    get requests(){return requests},get closed(){return closed},sessionStorageValues,peerCalls,
    pagehide(){windowEvents.pagehide?.()},
    get peerClosed(){return peerCalls[0]?.closed===true}
  };
}

// Minimal same-origin BroadcastChannel shared by the fixtures of one test (one per browser).
function fakeBus(){
  const channels=new Set();
  return class{
    constructor(name){this.name=name;this.onmessage=null;channels.add(this)}
    postMessage(data){for(const c of channels)if(c!==this&&c.name===this.name)setTimeout(()=>c.onmessage?.({data:structuredClone(data)}),0)}
    close(){channels.delete(this)}
  };
}
const tick=(ms=20)=>new Promise(resolve=>setTimeout(resolve,ms));
// A window as window.open('', name) returns it: a brand-new blank one, or the sharing window that is already open.
// Every navigation of it is recorded, because a navigation reloads the page and a reload ends a screen capture.
function fakeWindow({existing=false}={}){
  const w={closed:false,focused:0,navigations:[],focus(){this.focused++},
    location:{pathname:existing?'/class-pointer-prototype/student-share-window.html':'blank'}};
  Object.defineProperty(w.location,'href',{get(){return ''},set(value){w.navigations.push(value)}});
  return w;
}

test('screen request shows only the Share My Screen button; the click opens the sharing tab, never captures in the activity',async()=>{
  const opened=[],blank=fakeWindow();
  const a=await activityFixture({openWindow:(...args)=>{opened.push(args);return blank}});
  await a.emit('screens');
  assert.equal(a.navigation,null);
  assert.equal(a.shareButton.textContent,'🖥 Share My Screen');
  assert.equal(a.captureCount,0,'teacher cannot start browser capture without a student click');
  assert.equal(a.fallback.hidden,true);
  await a.emit('screens'); // Repeated teacher selection must not require dismissing a new modal.
  assert.equal(opened.length,0);
  await a.shareButton.listeners.click();
  assert.equal(opened.length,1,'one dedicated sharing tab opens');
  assert.equal(opened[0][0],'','an existing sharing tab is looked up by name only, never navigated');
  assert.equal(opened[0][1],'classPointerStudentShare','the tab is opened by name so only one exists');
  assert.deepEqual(blank.navigations,['https://funtorahtools.com/class-pointer-prototype/student-share-window.html?pointerShare=1'],'a new, blank tab is sent to the sharing page exactly once');
  assert.equal(a.captureCount,0,'the activity page itself never captures, so changing pages cannot end the share');
  assert.equal(a.shareButton.textContent,'✖ Cancel');
  assert.equal(a.navigation,null,'the retired student Pointer page must never open');
});

test('when the browser blocks the sharing tab the student shares from the page, as before, and leaving the page stops it',async()=>{
  const a=await activityFixture({openWindow:()=>null,validTicket:true});
  await a.emit('screens');
  await a.shareButton.listeners.click();
  await tick();
  assert.equal(a.captureCount,1,'he is never left unable to share');
  assert.equal(a.peerCalls.length,1);
  assert.equal(a.shareButton.textContent,'⏹ Stop Sharing');
  assert.match(a.label.textContent,/leaving it stops sharing/);
  a.pagehide();
  assert.equal(a.stopCount,1,'a share held by the page itself ends with the page');
  assert.equal(a.peerClosed,true);
});

test('the sharing tab asks for the screen by itself and reports an unavailable service',async()=>{
  const a=await activityFixture({persistent:true});
  await a.emit('screens');
  await tick();
  assert.equal(a.captureCount,1,'the sharing tab opens the browser screen picker as soon as it opens');
  assert.equal(a.requests,1);
  assert.equal(a.stopCount,1); // capture stopped when the backend is unavailable
  assert.match(a.label.textContent,/service unavailable/);
  assert.equal(a.fallback.hidden,false);
  assert.equal(a.fallback.textContent,'Try again');
  await a.emit('screens');await tick();
  assert.equal(a.captureCount,1,'it asks by itself only once');
});

test('the sharing tab sends the screen to the teacher; Stop ends it and closes the tab',async()=>{
  const a=await activityFixture({persistent:true,validTicket:true});
  await a.emit('screens');
  await tick();
  assert.equal(a.captureCount,1);
  assert.equal(a.peerCalls.length,1);
  assert.equal(a.peerCalls[0].target,room);
  assert.equal(a.peerCalls[0].options.metadata.token,'synthetic-ticket');
  assert.equal(a.shareButton.textContent,'⏹ Stop Sharing');
  await a.shareButton.listeners.click();
  assert.equal(a.stopCount,1);
  assert.equal(a.peerClosed,true);
  await tick(200);
  assert.equal(a.closed,true,'Stop closes the sharing tab');
});

test('the student keeps working in his own tab: banner follows him, Stop there closes the sharing tab',async()=>{
  const BroadcastChannel=fakeBus();
  const page=await activityFixture({BroadcastChannel,openWindow:()=>fakeWindow()});
  await page.emit('screens');
  await page.shareButton.listeners.click();
  const tab=await activityFixture({persistent:true,validTicket:true,BroadcastChannel});
  await tab.emit('screens');
  await tick(50);
  assert.equal(tab.peerCalls.length,1,'the sharing tab is sharing');
  assert.equal(page.captureCount,0);
  assert.equal(page.shareButton.textContent,'⏹ Stop Sharing','the working tab shows that sharing is on');
  assert.match(page.label.textContent,/sharing your screen/);
  // He moves to another page: that page unloads, the sharing tab keeps sharing.
  page.pagehide();
  await tick(50);
  assert.equal(tab.stopCount,0,'changing pages does not stop the share');
  // The next page finds the running share and shows the banner straight away.
  const next=await activityFixture({BroadcastChannel,openWindow:()=>{throw Error('must not reopen')}});
  await next.emit('screens');
  await tick(50);
  assert.equal(next.shareButton.textContent,'⏹ Stop Sharing');
  await next.shareButton.listeners.click();
  await tick(250);
  assert.equal(tab.stopCount,1,'Stop in the working tab ends the capture');
  assert.equal(tab.closed,true,'and closes the sharing tab');
  assert.equal(next.shareButton.textContent,'🖥 Share My Screen');
});
// ---- Case 1: the page he works in is refreshed; the sharing tab keeps going ----
test('Share My Screen clicked again after a refresh only brings the open sharing tab to the front; it is never reloaded',async()=>{
  const BroadcastChannel=fakeBus();
  const tab=await activityFixture({persistent:true,validTicket:true,BroadcastChannel});
  await tab.emit('screens');await tick(50);
  assert.equal(tab.peerCalls.length,1,'the sharing tab is sharing');
  // The refreshed page has not heard from the sharing tab yet (no channel here), so its button still says Share My Screen.
  const sharing=fakeWindow({existing:true}),opened=[];
  const page=await activityFixture({openWindow:(...args)=>{opened.push(args);return sharing}});
  await page.emit('screens');
  assert.equal(page.shareButton.textContent,'🖥 Share My Screen');
  await page.shareButton.listeners.click();
  await tick(30);
  assert.equal(opened.length,1);assert.equal(opened[0][0],'','looked up by name, no address');
  assert.deepEqual(sharing.navigations,[],'the sharing window is never navigated, so it is never reloaded');
  assert.equal(sharing.focused,1,'it is brought to the front');
  assert.equal(page.captureCount,0,'this page does not start a second share of its own');
  assert.match(page.label.textContent,/already open/);
  assert.equal(tab.stopCount,0,'the running share is untouched');
  assert.equal(tab.peerCalls[0].closed,false);
});

// ---- Case 2: the sharing tab itself is refreshed; one big button to share again ----
const okStream=()=>{const track={stop(){},addEventListener(){}};return{active:true,getTracks:()=>[track],getVideoTracks:()=>[track]}};
const needsClick=()=>Promise.reject(Object.assign(new Error('needs a click'),{name:'InvalidStateError'}));
test('a refreshed sharing tab shows a big Resume sharing button right away, and one click shares again',async()=>{
  const storage=new Map([['b3Games_studentId','test-boy'],['b3Games_classPin','test-pin']]);
  const first=await activityFixture({persistent:true,validTicket:true,sessionStorageValues:storage});
  await first.emit('screens');await tick(50);
  assert.equal(first.peerCalls.length,1);
  assert.equal(first.shareButton.textContent,'⏹ Stop Sharing');
  first.pagehide(); // the sharing tab is refreshed: its capture ends with the page
  assert.equal(first.peerClosed,true);
  assert.equal(storage.get('fttShareTabWasSharing'),'test-boy','the tab remembers it was sharing');
  // The page loads again. This browser will not open the picker without a click.
  let allowed=false;
  const second=await activityFixture({persistent:true,validTicket:true,sessionStorageValues:storage,capture:()=>allowed?Promise.resolve(okStream()):needsClick()});
  assert.equal(second.shareButton.textContent,'▶ Resume sharing','the Resume button is there before the lesson has even loaded');
  assert.equal(second.holder.style.display,'flex');
  assert.match(second.shareButton.style.cssText,/font:800 30px/,'and it is big');
  await second.shareButton.listeners.click();
  assert.match(second.label.textContent,/One moment/);
  assert.equal(second.captureCount,0,'nothing is captured before the lesson is known');
  await second.emit('screens');await tick(50);
  assert.equal(second.shareButton.textContent,'▶ Resume sharing','a refused automatic start leaves the big button in place');
  assert.equal(second.peerCalls.length,0);
  allowed=true;
  await second.shareButton.listeners.click();await tick(50);
  assert.equal(second.peerCalls.length,1,'one click and he is sharing again');
  assert.equal(second.shareButton.textContent,'⏹ Stop Sharing');
  assert.equal(storage.has('fttShareTabWasSharing'),false,'Resume is no longer pending');
});
test('Resume is never offered after he stopped on purpose, or when the class is over',async()=>{
  const storage=new Map([['b3Games_studentId','test-boy'],['b3Games_classPin','test-pin']]);
  const first=await activityFixture({persistent:true,validTicket:true,sessionStorageValues:storage});
  await first.emit('screens');await tick(50);
  await first.shareButton.listeners.click();await tick(250); // Stop Sharing
  assert.equal(first.peerClosed,true);
  first.pagehide();
  const afterStop=await activityFixture({persistent:true,validTicket:true,sessionStorageValues:storage,capture:needsClick});
  assert.equal(afterStop.shareButton.textContent,'🖥 Share My Screen','a deliberate stop is not "refreshed"');
  // Refreshed while sharing, but the class ends before the page is back.
  const live=await activityFixture({persistent:true,validTicket:true,sessionStorageValues:storage});
  await live.emit('screens');await tick(50);
  live.pagehide();
  const late=await activityFixture({persistent:true,validTicket:true,sessionStorageValues:storage,capture:needsClick});
  assert.equal(late.shareButton.textContent,'▶ Resume sharing');
  await late.gone();await tick(20);
  assert.equal(late.shareButton.textContent,'🖥 Share My Screen','no lesson, nothing to resume');
  assert.equal(late.holder.style.display,'none');
  assert.equal(storage.has('fttShareTabWasSharing'),false);
});
test('whiteboard request stays on the learning activity for embedded delivery',async()=>{
  const a=await activityFixture();
  await a.emit('boards');
  assert.equal(a.navigation,null);
  assert.equal(a.captureCount,0);
});
test('denied students cannot receive screen prompts or whiteboard redirects',async()=>{
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
  // #801: a dropped teacher connection no longer deletes the lesson or its permissions.
  assert.doesNotMatch(session,/onDisconnect\(\)\.remove\(\)/);
  assert.match(session,/await disarmOffline\(ref\)/);
  assert.match(boards,/Do not send an asynchronous child update here/);
});


test('permission revoked while browser picker is open stops capture before any ticket request',async()=>{
  let finish,stops=0;
  const a=await activityFixture({persistent:true,capture:()=>new Promise(resolve=>finish=resolve)});
  await a.emit('screens');
  assert.equal(a.captureCount,1,'the sharing tab opened the picker');
  await a.emit('screens',{screens:{'test-boy':true}});
  const track={stop(){stops++},addEventListener(){}};
  finish({active:true,getTracks:()=>[track],getVideoTracks:()=>[track]});
  await tick();
  assert.equal(a.requests,0);
  assert.equal(stops,1);
  assert.match(a.label.textContent,/permission changed/);
  assert.equal(a.shareButton.disabled,false);
});
