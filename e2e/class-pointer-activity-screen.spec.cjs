'use strict';
const {test,expect}=require('@playwright/test');
const path=require('node:path');
const fs=require('node:fs');

test('synthetic Shorashim display capture is authorized and rendered by teacher',async({page})=>{
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
    window.__calls={};
    window.firebase={apps:[{}],database(){return {ref(path){return {on(_event,callback){window.__sessionCallback=callback;window.__sessionPath=path}}}}},auth(){return {currentUser:{getIdToken:async()=> 'teacher-id-token'}}}};
    window.B3_FIREBASE_CONFIG={};
    window.FunTorahStudentClass={resolve:async()=>({workspaceId:'b3-2026',classId:'et'})};
    window.fetch=async(url,options)=>{
      const body=options?.body?JSON.parse(options.body):{};
      if(String(url).includes('funTorahStudentAuth'))return {ok:true,status:200,json:async()=>({ok:true})};
      if(body.action==='issue')return {ok:true,status:200,json:async()=>({ok:true,token:'a'.repeat(64),studentName:'Arik'})};
      if(body.action==='verify'){
        window.__verified={...body,authorization:options.headers.Authorization};
        return {ok:true,status:200,json:async()=>({ok:true,studentId:'arik',studentName:'Arik'})};
      }
      throw Error('Unexpected request '+String(url));
    };
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
    const context=canvas.getContext('2d');context.fillStyle='#1d4ed8';context.fillRect(0,0,320,180);
    const synthetic=canvas.captureStream(5);window.__syntheticStream=synthetic;
    Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{configurable:true,value:async()=>synthetic});
    class MediaCall{
      constructor(metadata,stream){this.metadata=metadata;this.stream=stream;this.listeners={}}
      on(type,fn){(this.listeners[type]??=[]).push(fn)}
      emit(type,value){for(const fn of this.listeners[type]||[])fn(value)}
      answer(){this.answered=true;setTimeout(()=>this.emit('stream',this.stream),0)}
      close(){}
    }
    class Peer{
      constructor(id){this.id=id;this.handlers={};queueMicrotask(()=>this.emit('open',id))}
      once(type,fn){this.handlers[type]=fn}
      emit(type,value){this.handlers[type]?.(value)}
      call(target,stream,options){
        if(target!==window.__room)throw Error('Student dialed an unexpected PeerJS room');
        const call=new MediaCall(options.metadata,stream);window.__calls.media=call;
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
  await page.evaluate(()=>window.__sessionCallback({val:()=>({[window.__room]:{
    roomId:window.__room,createdAt:Date.now(),teacherUid:'teacher-et',studentScreenSharing:true,shareRequest:{at:Date.now()}
  }})}));
  await expect(page.getByRole('dialog',{name:'Teacher screen sharing request'})).toBeVisible();
  await page.getByRole('button',{name:'Choose What to Share'}).click();
  await expect(page.locator('#activityScreenTray video')).toHaveCount(1);
  await expect.poll(()=>page.evaluate(()=>!!window.__calls.media?.answered)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>!!document.querySelector('#activityScreenTray video')?.srcObject)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>document.querySelector('#activityScreenTray video')?.videoWidth||0)).toBe(320);
  const result=await page.evaluate(()=>({
    videoStream:document.querySelector('#activityScreenTray video')?.srcObject===window.__syntheticStream,
    videoWidth:document.querySelector('#activityScreenTray video')?.videoWidth,
    trayVisible:!document.getElementById('activityScreenTray')?.hidden,
    verified:window.__verified,
    sessionPath:window.__sessionPath
  }));
  expect(result.videoStream).toBe(true);
  expect(result.trayVisible).toBe(true);
  expect(result.videoWidth).toBe(320);
  expect(result.verified).toMatchObject({action:'verify',classId:'et',room:'class-pointer-12345678-1234-1234-1234-123456789abc',authorization:'Bearer teacher-id-token'});
  expect(result.sessionPath).toContain('/classes/et/classPointerSessions');
});
