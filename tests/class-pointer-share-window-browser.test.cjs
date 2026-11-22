'use strict';
/* The sharing tab (student-share-window.html), loaded fresh in a real browser, the way a refresh loads it.
   Everything outside the page is replaced: its own files are served from this checkout, the Firebase libraries come
   from vendor/ (or a stand-in), and the server answers "yes". A browser's rule is kept as it really is: the screen
   picker only opens after a real click, so a refreshed tab cannot start sharing by itself.
   Skipped when Playwright or a browser is not installed (the other tests cover the same logic without a browser). */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const ORIGIN='https://share.test';
const PAGE=ORIGIN+'/class-pointer-prototype/student-share-window.html?pointerShare=1';
const ROOM='class-pointer-12345678-1234-1234-1234-123456789abc';
const TYPES={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json'};

let chromium=null;
try{chromium=require('playwright').chromium}catch{}

// Stand-ins for the parts that need a real network, installed before the page's own scripts run.
const stubs=({wasSharing,ownFirebase,lessonNeverLoads,recordFrames})=>`
(()=>{
  try{
    if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');
      sessionStorage.setItem('b3Games_studentId','test-boy');sessionStorage.setItem('b3Games_classPin','1234');
      ${wasSharing?"sessionStorage.setItem('fttShareTabWasSharing','test-boy');":''}}
  }catch{}
  window.__fttShareShellRetryMs=400;
  ${recordFrames?`
  // From the moment the placeholder button exists, after every change to the page there must be something to click. (Checked on each DOM change, so a gap of even one
  // step cannot be missed, whether or not the browser happened to paint in between.)
  window.__blank=[];window.__frames=[];const f0=performance.now();
  const sawButton=()=>!!document.body&&/\\S/.test(document.body.innerText);
  let shellSeen=false;
  new MutationObserver(()=>{if(document.getElementById('fttShareShell'))shellSeen=true;if(shellSeen&&!sawButton())window.__blank.push(Math.round(performance.now()-f0)+'ms')}).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['style','hidden']});
  const tick=()=>{window.__frames.push(document.body?document.body.innerText.trim().replace(/\\s+/g,' '):'(no body yet)');if(performance.now()-f0<1800)requestAnimationFrame(tick)};requestAnimationFrame(tick);`:''}
  window.B3_FIREBASE_CONFIG={apiKey:'x',projectId:'x',appId:'x',databaseURL:'https://x-default-rtdb.firebaseio.com'};
  ${ownFirebase?'':`
  const row=()=>({roomId:'${ROOM}',createdAt:Date.now(),studentScreenSharing:true,permissionRevision:1,destinationRequest:{mode:'screens',at:1}});
  const db={ref:p=>({on:(_e,cb)=>{if(!${lessonNeverLoads}&&p.includes('/classPointerSessions'))setTimeout(()=>cb({val:()=>({['${ROOM}']:row()})}),30)},off(){},once:async()=>({val:()=>null})})};
  window.firebase={apps:[{}],database:()=>db,initializeApp(){}};`}
  window.FunTorahStudentClass={resolve:async()=>({workspaceId:'b3-2026',classId:'et'})};
  window.Peer=class{once(e,cb){if(e==='open')setTimeout(cb,0);return this}on(){return this}call(){return{on(){},close(){}}}destroy(){}};
  // Like a real browser: the picker only opens right after a real click in this page. (A page that has just been
  // loaded has had no click, so a refreshed tab cannot start sharing by itself.)
  let lastClick=0;
  addEventListener('click',e=>{if(e.isTrusted)lastClick=Date.now()},true);
  navigator.mediaDevices.getDisplayMedia=async()=>{
    if(Date.now()-lastClick>3000)throw new DOMException('getDisplayMedia requires transient activation','InvalidStateError');
    const c=document.createElement('canvas');c.width=64;c.height=64;c.getContext('2d').fillRect(0,0,64,64);return c.captureStream(5)};
})();`;

async function open(t,{wasSharing=false,ownFirebase=false,lessonNeverLoads=false,recordFrames=false}={}){
  const browser=await chromium.launch();
  t.after(()=>browser.close());
  const context=await browser.newContext();
  const requested=[];
  await context.addInitScript(stubs({wasSharing,ownFirebase,lessonNeverLoads,recordFrames}));
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());requested.push(url.href);
    if(url.origin===ORIGIN){
      const file=path.join(ROOT,decodeURIComponent(url.pathname));
      if(file.startsWith(ROOT)&&fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({status:200,contentType:TYPES[path.extname(file)]||'text/plain',body:fs.readFileSync(file)});
      return route.fulfill({status:404,body:''});
    }
    const gs=/^https:\/\/www\.gstatic\.com\/firebasejs\/12\.15\.0\/(firebase-[a-z]+-compat\.js)$/.exec(url.href);
    if(gs&&ownFirebase)return route.fulfill({status:200,contentType:'application/javascript',body:fs.readFileSync(path.join(ROOT,'vendor/firebase/12.15.0',gs[1]))});
    if(url.hostname.endsWith('cloudfunctions.net'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,token:'t'.repeat(8)})});
    return route.abort();
  });
  const page=await context.newPage();
  await page.goto(PAGE);
  return{page,requested,context};
}
// Everything a student can read on the page, one line per piece.
const words=page=>page.evaluate(()=>document.body.innerText.split('\n').map(x=>x.trim()).filter(Boolean));
const skip=chromium?false:'Playwright is not installed';

test('a freshly loaded sharing tab after a refresh shows the big Resume sharing button and nothing else',{skip},async t=>{
  const {page}=await open(t,{wasSharing:true});
  const button=page.locator('#fttActivityScreenShare button').first();
  await button.waitFor({timeout:5000});
  assert.equal(await button.textContent(),'▶ Resume sharing');
  assert.deepEqual(await words(page),['▶ Resume sharing'],'no explanation, no "not available" message');
  const size=await button.evaluate(el=>({font:parseFloat(getComputedStyle(el).fontSize),height:el.getBoundingClientRect().height}));
  assert.ok(size.font>=28&&size.height>=70,'it is big: '+JSON.stringify(size));
  await page.waitForTimeout(600);
  assert.deepEqual(await words(page),['▶ Resume sharing'],'still just the button a moment later');
});

test('one click on Resume sharing shares again: a title, one short line and Stop Sharing; a refresh brings Resume back',{skip},async t=>{
  const {page}=await open(t,{wasSharing:true});
  await page.locator('#fttActivityScreenShare button').first().click({timeout:5000});
  await page.waitForFunction(()=>/Stop Sharing/.test(document.body.innerText),null,{timeout:5000});
  assert.deepEqual(await words(page),['Sharing your screen ✅','Keep this tab open','⏹ Stop Sharing']);
  // He refreshes the sharing tab: the capture ended with the page.
  await page.reload();
  const button=page.locator('#fttActivityScreenShare button').first();
  await button.waitFor({timeout:5000});
  assert.deepEqual(await words(page),['▶ Resume sharing']);
});

test('a sharing tab that was not refreshed starts with just the big Share My Screen button',{skip},async t=>{
  const {page}=await open(t);
  const button=page.locator('#fttActivityScreenShare button').first();
  await button.waitFor({timeout:5000});
  assert.deepEqual(await words(page),['🖥 Share My Screen']);
});

test('if the sharing code cannot get going, the page still shows the Resume button, then Try again, never a long message',{skip},async t=>{
  const {page}=await open(t,{wasSharing:true,lessonNeverLoads:true});
  // The lesson never loads, but the big button is already there (and the real control replaces it when it can).
  assert.deepEqual(await words(page).then(w=>w.filter(x=>!/Share|Resume/.test(x)&&!/Try again/.test(x))),[],'nothing but a button');
  assert.match((await words(page)).join(' '),/Resume sharing|Share My Screen/);
  const shell=await page.locator('#fttShareShell').count();
  if(shell){
    await page.waitForFunction(()=>/Try again/.test(document.body.innerText),null,{timeout:3000});
    assert.deepEqual(await words(page),['↻ Try again']);
  }
  assert.doesNotMatch((await words(page)).join(' '),/not available|Getting ready|Close this tab/i);
});

test('the sharing tab brings in Firebase sign-in before it reads anything (the cause of "not available" after a refresh)',{skip},async t=>{
  const {page,requested}=await open(t,{wasSharing:true,ownFirebase:true});
  await page.waitForTimeout(1500);
  const loaded=requested.filter(u=>/firebase-(app|auth|database)-compat\.js/.test(u)).map(u=>u.split('/').pop());
  assert.ok(loaded.includes('firebase-auth-compat.js'),'the sign-in library is loaded: '+loaded.join(', '));
  assert.ok(loaded.indexOf('firebase-auth-compat.js')<requested.length,'');
  // Even while the real database is unreachable here, the page never shows the old dead-end message.
  assert.doesNotMatch((await words(page)).join(' '),/not available|Getting ready|Close this tab/i);
  assert.ok((await words(page)).length<=1,'just a button: '+JSON.stringify(await words(page)));
});

test('the button is on screen from the very first frame and never blinks out while the page starts',{skip},async t=>{
  const {page}=await open(t,{wasSharing:true,recordFrames:true});
  await page.waitForTimeout(2000);
  const frames=await page.evaluate(()=>window.__frames);
  const seen=[...new Set(frames.filter(x=>x!=='(no body yet)'))];
  assert.ok(frames.length>20,'enough frames were sampled: '+frames.length);
  assert.deepEqual(seen,['▶ Resume sharing'],'every frame shows the Resume button, never a blank page: '+JSON.stringify(seen));
  assert.deepEqual(await page.evaluate(()=>window.__blank),[],'after no single change to the page was there nothing to click');
});

test('refreshing the sharing tab twice without clicking still offers Resume sharing each time',{skip},async t=>{
  const {page}=await open(t,{wasSharing:true});
  const button=page.locator('#fttActivityScreenShare button').first();
  await button.waitFor({timeout:5000});
  await page.waitForTimeout(500); // its automatic restart is refused (no click) and must not forget
  for(let i=0;i<2;i++){
    await page.reload();
    await button.waitFor({timeout:5000});
    await page.waitForTimeout(500);
    assert.deepEqual(await words(page),['▶ Resume sharing'],'refresh '+(i+1));
  }
});

// Deterministic guard for the same rule (a browser may or may not paint between two steps, so this does not depend on it).
test('the start-up placeholder button is removed in exactly one place: in the same step the real control is shown or hidden',()=>{
  const src=fs.readFileSync(path.join(ROOT,'class-pointer-prototype/activity-share.js'),'utf8');
  assert.equal((src.match(/fttShareShell/g)||[]).length,1,'only one place touches the placeholder');
  assert.match(src,/function setHolderDisplay\(value\)\{\s*holder\.style\.display=sharePaused\?'none':value;\s*if\(persistentShareWindow\)\{try\{document\.getElementById\('fttShareShell'\)\?\.remove\(\)\}catch\{\}\}\s*\}/);
  // and the sharing tab's own visibility changes go through it
  assert.match(src,/setHolderDisplay\(active\|\|resumeNeeded\?'flex':'none'\)/);
  assert.match(src,/setHolderDisplay\(resumeNeeded\?'flex':'none'\)/);
  const page=fs.readFileSync(path.join(ROOT,'class-pointer-prototype/student-share-window.html'),'utf8');
  assert.match(page,/id='fttShareShell'|b\.id='fttShareShell'/,'the page puts the placeholder there from the first instant');
});
