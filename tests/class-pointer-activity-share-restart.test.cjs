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
    setItem:(k,v)=>sessionStorageValues.set(k,v)
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
    emit,shareButton,label,fallback,
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

test('screen request shows only the Share My Screen button; the click opens the sharing tab, never captures in the activity',async()=>{
  const opened=[];
  const a=await activityFixture({openWindow:(...args)=>{opened.push(args);return{closed:false}}});
  await a.emit('screens');
  assert.equal(a.navigation,null);
  assert.equal(a.shareButton.textContent,'🖥 Share My Screen');
  assert.equal(a.captureCount,0,'teacher cannot start browser capture without a student click');
  assert.equal(a.fallback.hidden,true);
  await a.emit('screens'); // Repeated teacher selection must not require dismissing a new modal.
  assert.equal(opened.length,0);
  await a.shareButton.listeners.click();
  assert.equal(opened.length,1,'one dedicated sharing tab opens');
  assert.equal(opened[0][0],'https://funtorahtools.com/class-pointer-prototype/student-share-window.html?pointerShare=1');
  assert.equal(opened[0][1],'classPointerStudentShare','the tab is opened by name so only one exists');
  assert.equal(a.captureCount,0,'the activity page itself never captures, so changing pages cannot end the share');
  assert.equal(a.shareButton.textContent,'✖ Cancel');
  assert.equal(a.navigation,null,'the retired student Pointer page must never open');
});

test('a blocked sharing tab tells the student what to do instead of sharing from the page',async()=>{
  const a=await activityFixture({openWindow:()=>null});
  await a.emit('screens');
  await a.shareButton.listeners.click();
  assert.equal(a.captureCount,0);
  assert.match(a.label.textContent,/blocked the sharing tab/);
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
  const page=await activityFixture({BroadcastChannel,openWindow:()=>({closed:false})});
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
  assert.match(session,/policyRef\?\.onDisconnect\(\)\.cancel\(\)/);
  assert.match(session,/lastSeenAt:firebase\.database\.ServerValue\.TIMESTAMP/);
  assert.match(session,/setInterval\(\(\)=>\{[\s\S]*?ref\.child\('lastSeenAt'\)\.set/);
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
