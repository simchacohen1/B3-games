/* Isolated sample video over native WebRTC. Capture permission and Firebase are
 * simulated; this does not verify a real teacher/student production session. */
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
let phase='launch';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.FTT_TEST_CHROMIUM||undefined,channel:process.env.FTT_TEST_CHANNEL||undefined,headless:true,args:['--use-fake-device-for-media-stream']});
 try{
  const context=await browser.newContext();await context.grantPermissions(['microphone'],{origin:'https://sharing.test'});
  await context.route('https://sharing.test/**',async route=>{
   const name=new URL(route.request().url()).pathname;
   if(name.endsWith('/share-window.html'))return route.fulfill({contentType:'text/html',body:fs.readFileSync('class-pointer-prototype/share-window.html','utf8')});
   if(name.endsWith('/activity-share.js'))return route.fulfill({contentType:'application/javascript',body:fs.readFileSync('class-pointer-prototype/activity-share.js','utf8')});
   return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><h1>Sample learning activity</h1></body></html>'});
  });
  await context.addInitScript(()=>{
   const room='class-pointer-12345678-1234-1234-1234-123456789abc';
   sessionStorage.setItem('b3Games_studentId','sample-et-student');sessionStorage.setItem('b3Games_studentClass','et');sessionStorage.setItem('b3Games_classPin','sample-only-pin');
   window.firebase={apps:[{}],database:()=>({ref:path=>({on:(_,callback)=>callback({val:()=>path.endsWith('/classPointerSessions')?{[room]:{roomId:room,createdAt:Date.now(),studentScreenSharing:true}}:{active:true,members:{'sample-et-student':{active:true}},toolGrants:{'class-pointer':true}}})})}),auth:()=>({currentUser:{getIdToken:async()=> 'sample-token'}})};
   window.B3_FIREBASE_CONFIG={};window.FunTorahStudentClass={resolve:async()=>({workspaceId:'b3-2026',classId:'et'})};
   window.fetch=async()=>({ok:true,json:async()=>({ok:true,token:'0'.repeat(64),studentId:'sample-et-student',studentName:'Sample ET pupil'})});
   window.captureCount=0;
   Object.defineProperty(navigator,'mediaDevices',{value:{getDisplayMedia:async options=>{
    window.captureCount++;window.captureOptions=options;
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const ctx=canvas.getContext('2d');
    const paint=()=>{ctx.fillStyle='#1266dd';ctx.fillRect(0,0,160,90);ctx.fillStyle='#fff';ctx.fillRect(100,20,30,30)};paint();window.samplePaintTimer=setInterval(paint,100);
    const stream=canvas.captureStream(10);window.sampleStream=stream;return stream;
   }}});
   window.Peer=class{
    once(event,callback){if(event==='open')setTimeout(callback,0)}
    destroy(){window.senderPC?.close();clearInterval(window.samplePaintTimer)}
    call(room,stream,options){
     const events={};const pc=new RTCPeerConnection({iceServers:[]});stream.getTracks().forEach(track=>pc.addTrack(track,stream));window.senderPC=pc;window.sentMetadata=options.metadata;
     return {peerConnection:pc,on:(event,callback)=>{(events[event]??=[]).push(callback)},close(){if(pc.signalingState==='closed')return;pc.close();(events.close||[]).forEach(callback=>callback())}};
    }
   };
  });
  const activity=await context.newPage();await activity.goto('https://sharing.test/activity-one.html');
  await activity.addScriptTag({url:'https://sharing.test/class-pointer-prototype/activity-share.js'});
  const popupPromise=activity.waitForEvent('popup');await activity.getByRole('button',{name:/Share My Screen/}).click();const companion=await popupPromise;
  await companion.waitForLoadState();await companion.getByRole('button',{name:/Share My Screen/}).click();
  phase='capture companion';await companion.waitForFunction(()=>!!window.senderPC);
  const offer=await companion.evaluate(async()=>{
   const pc=window.senderPC;await pc.setLocalDescription(await pc.createOffer());
   if(pc.iceGatheringState!=='complete')await new Promise(resolve=>pc.addEventListener('icegatheringstatechange',()=>{if(pc.iceGatheringState==='complete')resolve() }));
   return pc.localDescription.toJSON();
  });
  const teacher=await context.newPage();await teacher.goto('https://sharing.test/classroom.html?dashboard=teacher&class=et');
  await teacher.setContent('<main id="stage"></main><input id="joinLink" value="https://sharing.test/classroom.html?room=class-pointer-12345678-1234-1234-1234-123456789abc"><button id="endClass">End class</button>');
  await teacher.addStyleTag({content:fs.readFileSync('class-pointer-prototype/classroom.css','utf8')});
  await teacher.addScriptTag({content:fs.readFileSync('class-pointer-prototype/activity-screen-teacher.js','utf8')});
  const answer=await teacher.evaluate(async offer=>{
   const pc=new RTCPeerConnection({iceServers:[]}),events={};window.receiverPC=pc;
   const call={metadata:{kind:'activity-screen',token:'0'.repeat(64)},on:(name,fn)=>{(events[name]??=[]).push(fn)},close(){if(pc.signalingState==='closed')return;pc.close();(events.close||[]).forEach(fn=>fn())},answer(){window.sampleAnswerStarted=true}};window.sampleCall=call;
   pc.ontrack=e=>(events.stream||[]).forEach(fn=>fn(e.streams[0]));
   await window.ClassPointerActivityShares.incomingCall(call);
   await pc.setRemoteDescription(offer);await pc.setLocalDescription(await pc.createAnswer());
   if(pc.iceGatheringState!=='complete')await new Promise(resolve=>pc.addEventListener('icegatheringstatechange',()=>{if(pc.iceGatheringState==='complete')resolve()}));
   return pc.localDescription.toJSON();
  },offer);
  await companion.evaluate(answer=>window.senderPC.setRemoteDescription(answer),answer);
  phase='receive sample video';try{await teacher.waitForFunction(()=>{const v=document.querySelector('video');return v&&v.readyState>=2&&v.videoWidth===160})}
  catch(error){console.error('Sample RTC diagnostics',await companion.evaluate(()=>({state:senderPC.connectionState,ice:senderPC.iceConnectionState,candidateCount:(senderPC.localDescription.sdp.match(/a=candidate/g)||[]).length,track:sampleStream.getVideoTracks()[0].readyState})),await teacher.evaluate(()=>({state:receiverPC.connectionState,ice:receiverPC.iceConnectionState,video:document.querySelector('video')?.readyState,card:document.querySelector('#activityScreenTray')?.textContent})));if(process.env.CI)console.error('::error file=tests/persistent-sharing.browser.cjs::'+JSON.stringify(await companion.evaluate(()=>({state:senderPC.connectionState,candidates:(senderPC.localDescription.sdp.match(/a=candidate/g)||[]).length}))));throw error}
  const pixel=await teacher.evaluate(()=>{const v=document.querySelector('video'),c=document.createElement('canvas');c.width=160;c.height=90;const x=c.getContext('2d');x.drawImage(v,0,0);return [...x.getImageData(20,20,1,1).data]});assert.ok(pixel[2]>180&&pixel[0]<60,JSON.stringify(pixel));
  phase='navigate activity';await activity.goto('https://sharing.test/activity-two.html');
  assert.equal(await companion.evaluate(()=>window.sampleStream.getVideoTracks()[0].readyState),'live');assert.equal(await companion.evaluate(()=>window.captureCount),1);
  phase='confirm live label';await teacher.waitForFunction(()=>document.querySelector('#activityScreenTray strong').textContent.includes('Live activity screen'));
  const options=await companion.evaluate(()=>window.captureOptions);assert.equal(options.preferCurrentTab,false);assert.equal(options.video.displaySurface,undefined);
  phase='stop sharing';await companion.getByRole('button',{name:/Stop Sharing/}).click();assert.equal(await companion.evaluate(()=>window.sampleStream.getVideoTracks()[0].readyState),'ended');
  await teacher.evaluate(()=>window.sampleCall.close());assert.equal(await teacher.locator('#activityScreenTray').isVisible(),false);
  phase='logout ends capture';await companion.getByRole('button',{name:/Share My Screen/}).click();
  await companion.waitForFunction(()=>document.querySelector('#fttActivityScreenShare button').textContent.includes('Stop Sharing'));
  await activity.evaluate(()=>sessionStorage.removeItem('b3Games_studentId'));
  await companion.waitForFunction(()=>window.sampleStream.getVideoTracks()[0].readyState==='ended');
  assert.equal(await companion.getByRole('button',{name:/Share My Screen/}).isDisabled(),true);
  fs.mkdirSync('test-results/persistent-sharing',{recursive:true});fs.writeFileSync('test-results/persistent-sharing/results.json',JSON.stringify({sampleFramesReceived:true,activityNavigationPreservedCapture:true,captureRequests:1,stopEndedTrack:true,logoutEndedCapture:true,realDisplayCapture:'NOT VERIFIED',liveFirebaseAuthorization:'NOT VERIFIED'},null,2));
  console.log('PASS: native sample video received by teacher; companion survives activity navigation; stop and logout end capture.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);if(process.env.CI)console.error('::error file=tests/persistent-sharing.browser.cjs::'+phase+' '+error.stack.replace(/\n/g,' '));process.exitCode=1});
