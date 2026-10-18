'use strict';
const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
async function setup(page,{activity='/shorashim/',classId='et',joinAuthorized=true,expired=false}={}){
  await page.route('https://lesson.test/**',route=>route.fulfill({contentType:route.request().url().endsWith('.js')?'text/javascript':'text/html',body:route.request().url().endsWith('.js')?fs.readFileSync(path.join(__dirname,'../class-pointer-prototype/activity-share.js'),'utf8'):'<!doctype html><title>Shorashim</title><input id="answer" value="unfinished answer"><main>My activity</main>'}));
  await page.goto('https://lesson.test'+activity);
  await page.evaluate(({classId,joinAuthorized})=>{
    window.room=classId==='et'?'class-pointer-12345678-1234-1234-1234-123456789abc':'class-pointer-12345678-1234-1234-1234-123456789abd';
    sessionStorage.setItem('b3Games_studentId','test-boy');sessionStorage.setItem('b3Games_classPin','test-pin');
    window.firebase={apps:[{}],database:()=>({ref:path=>{window.sessionPath=path;return {on:(_e,fn)=>window.sessionListener=fn}}})};
    window.B3_FIREBASE_CONFIG={};window.FunTorahStudentClass={resolve:async()=>({workspaceId:'b3-2026',classId})};
    window.requests=[];window.fetch=async(url,options)=>{const body=JSON.parse(options?.body||'{}');window.requests.push(body);const ok=body.action!=='joinIssue'||joinAuthorized;return {ok,status:ok?200:403,json:async()=>({ok,token:'test-ticket'})}};
    window.sent=[];window.calls=[];window.captureCount=0;
    navigator.mediaDevices.getDisplayMedia=()=>{window.captureCount++;throw Error('No capture allowed')};
    class Emitter{constructor(){this.handlers={}}on(e,fn){(this.handlers[e]??=[]).push(fn)}once(e,fn){this.on(e,fn)}emit(e,v){for(const fn of this.handlers[e]||[])fn(v)}}
    window.Peer=class extends Emitter{
      constructor(id){super();this.id=id;window.presence=this;setTimeout(()=>this.emit('open'),0)}
      connect(peer){const c=new Emitter();c.peer=peer;c.open=true;c.send=m=>window.sent.push(m);c.close=()=>{c.open=false;c.emit('close')};window.connection=c;setTimeout(()=>c.emit('open'),0);return c}
      destroy(){this.destroyed=true}
    };
    window.deliver=(id,peer=window.room)=>{
      const c=new Emitter();c.peer=peer;c.metadata={kind:'activity-lesson',presentationId:id};c.close=()=>{c.closed=true;c.emit('close')};
      c.answer=()=>{c.answered=true;const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d');ctx.fillStyle='#2563eb';ctx.fillRect(0,0,320,180);c.canvas=canvas;c.stream=canvas.captureStream(5);c.emit('stream',c.stream)};
      window.calls.push(c);window.presence.emit('call',c);return window.calls.length-1;
    };
  },{classId,joinAuthorized});
  await page.addScriptTag({url:'https://lesson.test/class-pointer-prototype/activity-share.js'});
  await expect.poll(()=>page.evaluate(()=>!!window.sessionListener)).toBe(true);
  await page.evaluate(expired=>window.sessionListener({val:()=>({[window.room]:{roomId:window.room,createdAt:Date.now()-(expired?14400001:0)}})}),expired);
  if(!expired)await expect.poll(()=>page.evaluate(()=>window.requests.some(m=>m.action==='joinIssue'))).toBe(true);
  if(!expired&&joinAuthorized)await expect.poll(()=>page.evaluate(()=>window.sent.some(m=>m.type==='join'))).toBe(true);
}
async function announce(page,id,active=true){await page.evaluate(({id,active})=>window.connection.emit('data',{type:'lesson-presentation',id,active}),{id,active})}

test('teacher canvas fills the webpage without navigating or discarding activity work; dismiss, reopen and next presentation',async({page,browserName})=>{
  test.skip(browserName!=='chromium');await setup(page);
  await page.evaluate(()=>window.connection.emit('data',{type:'present'}));await announce(page,'one');await page.evaluate(()=>window.deliver('one'));
  const overlay=page.locator('#fttTeacherLessonOverlay');await expect(overlay).toBeVisible();
  await expect.poll(()=>overlay.locator('video').evaluate(v=>v.videoWidth)).toBe(320);
  await expect(overlay).toHaveCSS('position','fixed');await expect(page.locator('#answer')).toHaveValue('unfinished answer');
  expect(page.url()).toBe('https://lesson.test/shorashim/');expect(await page.evaluate(()=>window.captureCount)).toBe(0);
  await page.getByRole('button',{name:'Back to Activity'}).click();await expect(overlay).toBeHidden();
  await page.locator('#answer').fill('still here');await page.getByRole('button',{name:'Show Lesson'}).click();await expect(overlay).toBeVisible();
  await page.getByRole('button',{name:'Back to Activity'}).click();await announce(page,'two');await expect(overlay).toBeVisible();
  await page.evaluate(()=>window.deliver('two'));await announce(page,'two',false);await expect(overlay).toBeHidden();
  await expect(page.locator('#answer')).toHaveValue('still here');expect(await page.evaluate(()=>window.calls.every(c=>c.closed))).toBe(true);
});

test('only admitted, current teacher presentation receives media including announcement race',async({page,browserName})=>{
  test.skip(browserName!=='chromium');await setup(page);
  await announce(page,'unverified');await page.evaluate(()=>window.deliver('unverified'));expect(await page.evaluate(()=>!!window.calls[0].answered)).toBe(false);
  await page.evaluate(()=>window.connection.emit('data',{type:'present'}));await announce(page,'current');
  await page.evaluate(()=>{window.deliver('current','wrong-room');window.deliver('stale')});
  expect(await page.evaluate(()=>window.calls.slice(1).every(c=>!c.answered))).toBe(true);
  await page.evaluate(()=>window.deliver('next'));await announce(page,'next');
  await expect.poll(()=>page.evaluate(()=>window.calls.at(-1).answered)).toBe(true);
  await announce(page,'current',false);await expect(page.locator('#fttTeacherLessonOverlay')).toBeVisible();
  await page.evaluate(()=>window.connection.emit('data',{type:'removed'}));await expect(page.locator('#fttTeacherLessonOverlay')).toBeHidden();
  expect(await page.evaluate(()=>window.calls.at(-1).closed)).toBe(true);
});

test('media failure requests bounded retry and logout clears lesson',async({page,browserName})=>{
  test.skip(browserName!=='chromium');await setup(page);
  await page.evaluate(()=>window.connection.emit('data',{type:'present'}));await announce(page,'retry');await page.evaluate(()=>window.deliver('retry'));
  await page.evaluate(()=>{window.calls.at(-1).emit('error',new Error('network'));window.calls.at(-1).emit('error',new Error('network'))});
  await expect.poll(()=>page.evaluate(()=>window.sent.filter(m=>m.type==='lesson-retry').length)).toBe(1);
  await page.evaluate(()=>window.deliver('retry'));await page.evaluate(()=>sessionStorage.removeItem('b3Games_studentId'));
  await expect(page.locator('#fttTeacherLessonOverlay')).toBeHidden();await expect(page.locator('#fttShowTeacherLesson')).toBeHidden();
});

 test('missing media times out and retries at most six times; new ID resets the budget',async({page,browserName})=>{
  test.skip(browserName!=='chromium');await setup(page);await page.clock.install();
  await page.evaluate(()=>window.connection.emit('data',{type:'present'}));await announce(page,'missing');
  for(let i=0;i<9;i++)await page.clock.runFor(17000);
  expect(await page.evaluate(()=>window.sent.filter(m=>m.type==='lesson-retry').length)).toBe(6);
  await announce(page,'new');await page.clock.runFor(17000);
  expect(await page.evaluate(()=>window.sent.filter(m=>m.type==='lesson-retry'&&m.id==='new').length)).toBe(1);
  await page.evaluate(()=>window.deliver('new'));await expect.poll(()=>page.evaluate(()=>window.calls.at(-1).answered)).toBe(true);
 });


test('home and another activity independently receive only their resolved ET and WT class',async({page,context,browserName})=>{
  test.skip(browserName!=='chromium');const wt=await context.newPage();
  await setup(page,{activity:'/',classId:'et'});await setup(wt,{activity:'/chazara/',classId:'wt'});
  expect(await page.evaluate(()=>window.sessionPath)).toContain('/classes/et/');expect(await wt.evaluate(()=>window.sessionPath)).toContain('/classes/wt/');
  for(const target of [page,wt]){await target.evaluate(()=>window.connection.emit('data',{type:'present'}));await announce(target,'lesson');await target.evaluate(()=>window.deliver('lesson'));
    await expect.poll(()=>target.locator('#fttTeacherLessonOverlay video').evaluate(v=>v.videoWidth)).toBe(320);
    const request=await target.evaluate(()=>window.requests.find(m=>m.action==='joinIssue'));expect(request.classId).toBe(target===page?'et':'wt');
  }
  await wt.evaluate(()=>window.deliver('lesson','class-pointer-12345678-1234-1234-1234-123456789abc'));
  expect(await wt.evaluate(()=>window.calls.at(-1).closed&&!window.calls.at(-1).answered)).toBe(true);
});

test('unauthorized join and expired class sessions never admit teacher media',async({page,context,browserName})=>{
  test.skip(browserName!=='chromium');await setup(page,{joinAuthorized:false});
  expect(await page.evaluate(()=>!!window.connection)).toBe(false);expect(await page.evaluate(()=>window.presence.destroyed)).toBe(true);
  await expect(page.locator('#fttTeacherLessonOverlay')).toBeHidden();
  const expired=await context.newPage();await setup(expired,{expired:true});
  await expired.waitForTimeout(600);expect(await expired.evaluate(()=>window.requests.some(m=>m.action==='joinIssue'))).toBe(false);
  expect(await expired.evaluate(()=>!!window.presence)).toBe(false);await expect(expired.locator('#fttTeacherLessonOverlay')).toBeHidden();
});

test('room replacement rejects old connection and stream; ending replacement clears lesson',async({page,browserName})=>{
  test.skip(browserName!=='chromium');await setup(page);await page.evaluate(()=>window.connection.emit('data',{type:'present'}));await announce(page,'old');await page.evaluate(()=>window.deliver('old'));
  await page.evaluate(()=>{window.oldConnection=window.connection;window.oldPeer=window.presence;window.room='class-pointer-87654321-4321-4321-4321-cba987654321';window.sessionListener({val:()=>({[window.room]:{roomId:window.room,createdAt:Date.now()}})})});
  await expect(page.locator('#fttTeacherLessonOverlay')).toBeHidden();await expect.poll(()=>page.evaluate(()=>window.connection!==window.oldConnection)).toBe(true);
  expect(await page.evaluate(()=>window.calls[0].closed&&window.oldPeer.destroyed)).toBe(true);
  await page.evaluate(()=>window.oldConnection.emit('data',{type:'lesson-presentation',id:'old',active:true}));await expect(page.locator('#fttTeacherLessonOverlay')).toBeHidden();
  await page.evaluate(()=>window.connection.emit('data',{type:'present'}));await announce(page,'replacement');await page.evaluate(()=>window.deliver('replacement'));
  await expect.poll(()=>page.locator('#fttTeacherLessonOverlay video').evaluate(v=>v.videoWidth)).toBe(320);
  await page.evaluate(()=>window.connection.emit('data',{type:'ended'}));await expect(page.locator('#fttTeacherLessonOverlay')).toBeHidden();
  expect(await page.evaluate(()=>window.calls.at(-1).closed)).toBe(true);await expect(page.locator('#answer')).toHaveValue('unfinished answer');
});

test('lost authenticated connection reconnects and requires fresh admission before resuming',async({page,browserName})=>{
  test.skip(browserName!=='chromium');await setup(page);await page.evaluate(()=>window.connection.emit('data',{type:'present'}));await announce(page,'before');await page.evaluate(()=>window.deliver('before'));
  await page.evaluate(()=>{window.oldConnection=window.connection;window.connection.close()});await expect(page.locator('#fttTeacherLessonOverlay')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>window.connection!==window.oldConnection),{timeout:10000}).toBe(true);
  await announce(page,'after');await page.evaluate(()=>window.deliver('after'));expect(await page.evaluate(()=>!!window.calls.at(-1).answered)).toBe(false);
  await page.evaluate(()=>window.connection.emit('data',{type:'present'}));await announce(page,'after');
  await expect.poll(()=>page.locator('#fttTeacherLessonOverlay video').evaluate(v=>v.videoWidth)).toBe(320);
});
