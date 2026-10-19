'use strict';
const {test,expect}=require('@playwright/test');
const path=require('node:path');
const fs=require('node:fs');

test('student shares directly from small activity button without an extra popup, and can stop and restart',async({page,browserName})=>{
  test.skip(browserName!=='chromium','Synthetic canvas capture video dimensions are only asserted in Chromium');
  await page.route('https://share.test/**',route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/activity-screen-teacher.js'))return route.fulfill({status:200,contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'..','class-pointer-prototype','activity-screen-teacher.js'),'utf8')});
    if(url.pathname.endsWith('/activity-share.js'))return route.fulfill({status:200,contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'..','class-pointer-prototype','activity-share.js'),'utf8')});
    return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><head></head><body><main id="stage"></main><input id="joinLink"><button id="endClass"></button></body></html>'});
  });
  await page.goto('https://share.test/shorashim/index.html?dashboard=teacher&class=et');
  await page.evaluate(()=>{
    const room='class-pointer-12345678-1234-1234-1234-123456789abc';
    sessionStorage.setItem('b3Games_studentId','arik');
    sessionStorage.setItem('b3Games_classPin','123456');
    document.getElementById('joinLink').value='https://share.test/class-pointer-prototype/classroom.html?room='+room;
    window.__room=room;
    window.__calls=[];window.__streams=[];window.__verified=[];window.__issuedCount=0;
    window.firebase={apps:[{}],database(){return {ref(path){return {on(_event,callback){window.__sessionCallback=callback;window.__sessionPath=path}}}}},auth(){return {currentUser:{getIdToken:async()=> 'teacher-id-token'}}}};
    window.B3_FIREBASE_CONFIG={};
    window.FunTorahStudentClass={resolve:async()=>({workspaceId:'b3-2026',classId:'et'})};
    // The activity must not open a second tab or popup to ask for sharing.
    window.__openCount=0;window.open=()=>{window.__openCount++;return null};
    window.fetch=async(url,options)=>{
      const body=options?.body?JSON.parse(options.body):{};
      if(String(url).includes('funTorahStudentAuth'))return {ok:true,status:200,json:async()=>({ok:true})};
      if(body.action==='permissions'){
        window.__permissionCheck={...body};
        return {ok:true,status:200,json:async()=>({ok:true,screenSharingDenied:false,whiteboardDenied:false})};
      }
      if(body.action==='issue'){
        window.__issuedCount++;
        return {ok:true,status:200,json:async()=>({ok:true,token:window.__issuedCount.toString(16).padStart(64,'0'),studentName:'Arik'})};
      }
      if(body.action==='verify'){
        window.__verified.push({...body,authorization:options.headers.Authorization});
        return {ok:true,status:200,json:async()=>({ok:true,studentId:'arik',studentName:'Arik'})};
      }
      throw Error('Unexpected request '+String(url));
    };
    Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{configurable:true,value:async()=>{
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
      const context=canvas.getContext('2d');let frame=0;
      const paint=()=>{context.fillStyle=frame++%2?'#ef4444':'#1d4ed8';context.fillRect(0,0,320,180)};
      paint();const timer=setInterval(paint,180);
      const synthetic=canvas.captureStream(10);window.__streams.push({stream:synthetic,canvas,timer});
      return synthetic;
    }});
    class MediaCall{
      constructor(metadata,stream){this.metadata=metadata;this.stream=stream;this.listeners={}}
      on(type,fn){(this.listeners[type]??=[]).push(fn)}
      emit(type,value){for(const fn of this.listeners[type]||[])fn(value)}
      answer(){this.answered=true;setTimeout(()=>this.emit('stream',this.stream),0)}
      close(){this.closed=true;this.emit('close')}
    }
    class Peer{
      constructor(id){this.id=id;this.handlers={};queueMicrotask(()=>this.emit('open',id))}
      once(type,fn){this.handlers[type]=fn}
      emit(type,value){this.handlers[type]?.(value)}
      call(target,stream,options){
        if(target!==window.__room)throw Error('Student dialed an unexpected PeerJS room');
        const call=new MediaCall(options.metadata,stream);window.__calls.push(call);
        queueMicrotask(()=>void window.ClassPointerActivityShares.incomingCall(call));
        return call;
      }
      destroy(){}
    }
    window.Peer=Peer;
  });
  await page.addScriptTag({url:'https://share.test/class-pointer-prototype/activity-screen-teacher.js'});
  await page.addScriptTag({url:'https://share.test/class-pointer-prototype/activity-share.js'});
  await expect.poll(()=>page.evaluate(()=>typeof window.__sessionCallback)).toBe('function');
  for(let cycle=0;cycle<3;cycle++){
    const requestAt=Date.now()+cycle;
    await page.evaluate(at=>window.__sessionCallback({val:()=>({[window.__room]:{
      roomId:window.__room,createdAt:Date.now(),teacherUid:'teacher-et',studentScreenSharing:true,shareRequest:{at}
    }})}),requestAt);
    await expect(page.getByRole('dialog',{name:'Teacher screen sharing request'})).toHaveCount(0);
    await expect(page.locator('#fttActivityScreenShare')).toBeVisible();
    await page.getByRole('button',{name:'🖥 Share My Screen'}).click();
    await expect.poll(()=>page.evaluate(()=>window.__calls.at(-1)?.answered===true)).toBe(true);
    await expect.poll(()=>page.evaluate(()=>document.querySelector('#activityScreenTray video')?.videoWidth||0)).toBe(320);
    const initialFrame=await page.locator('#activityScreenTray video').evaluate(video=>{
      const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;
      const context=canvas.getContext('2d');context.drawImage(video,0,0,1,1);
      return [...context.getImageData(0,0,1,1).data];
    });
    await expect.poll(async()=>page.locator('#activityScreenTray video').evaluate(video=>{
      const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;
      const context=canvas.getContext('2d');context.drawImage(video,0,0,1,1);
      return [...context.getImageData(0,0,1,1).data];
    }),{timeout:5000}).not.toEqual(initialFrame);
    expect(await page.locator('#activityScreenTray video').count()).toBe(1);
    expect(await page.evaluate(()=>window.__verified.length)).toBe(cycle+1);
    await page.locator('#fttActivityScreenShare button').first().click();
    await expect.poll(()=>page.evaluate(()=>window.__calls.at(-1)?.closed===true)).toBe(true);
    await expect(page.locator('#activityScreenTray video')).toHaveCount(0);
    expect(await page.evaluate(()=>window.__streams.at(-1).stream.getVideoTracks()[0].readyState)).toBe('ended');
  }
  const finalRequestAt=Date.now()+10;
  await page.evaluate(at=>window.__sessionCallback({val:()=>({[window.__room]:{
    roomId:window.__room,createdAt:Date.now(),teacherUid:'teacher-et',studentScreenSharing:true,shareRequest:{at}
  }})}),finalRequestAt);
  await expect(page.getByRole('dialog',{name:'Teacher screen sharing request'})).toHaveCount(0);
  await page.getByRole('button',{name:'🖥 Share My Screen'}).click();
  await expect.poll(()=>page.evaluate(()=>window.__calls.at(-1)?.answered===true)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>document.querySelector('#activityScreenTray video')?.videoWidth||0)).toBe(320);
  await page.evaluate(()=>window.ClassPointerActivityShares.closeAll());
  await expect(page.locator('#activityScreenTray video')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>window.__calls.at(-1)?.closed===true)).toBe(true);
  expect(await page.evaluate(()=>window.__streams.at(-1).stream.getVideoTracks()[0].readyState)).toBe('ended');
  const result=await page.evaluate(()=>({
    verified:window.__verified,
    permissionCheck:window.__permissionCheck,
    sessionPath:window.__sessionPath,
    issued:window.__issuedCount,
    activeCalls:window.__calls.filter(call=>!call.closed).length
  }));
  expect(result.issued).toBe(4);
  expect(await page.evaluate(()=>window.__openCount)).toBe(0);
  expect(result.activeCalls).toBe(0);
  expect(result.permissionCheck).toEqual({action:'permissions',studentId:'arik',pin:'123456',classId:'et',room:'class-pointer-12345678-1234-1234-1234-123456789abc'});
  expect(result.verified).toHaveLength(4);
  for(const verified of result.verified)expect(verified).toMatchObject({action:'verify',classId:'et',room:'class-pointer-12345678-1234-1234-1234-123456789abc',authorization:'Bearer teacher-id-token'});
  expect(result.sessionPath).toContain('/classes/et/classPointerSessions');
});
