'use strict';
// Public, anonymous checks only. No accounts, capture, data reads/writes or deploys.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {chromium}=require('playwright');
const root='https://funtorahtools.com/';
const overlay=process.env.POINTER_CANDIDATE_OVERLAY==='1';
const paths=['class-pointer-prototype/dashboard.html','class-pointer-prototype/dashboard.js','class-pointer-prototype/dashboard-session.js','class-pointer-prototype/classroom.html','class-pointer-prototype/classroom.js','class-pointer-prototype/classroom.css','class-pointer-prototype/student-boards.js','class-pointer-prototype/student-boards.css','class-pointer-prototype/teacher-toolbar.js','class-pointer-prototype/activity-share.js'];
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const pending=new Set(paths.filter(p=>!overlay||p!=='class-pointer-prototype/dashboard.html')),deadline=Date.now()+6*60*1000;
 while(pending.size&&Date.now()<deadline){
  for(const path of Array.from(pending)){
   try{
    const url=new URL(path,root);url.searchParams.set('release-check',process.env.GITHUB_SHA||'pointer');
    const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(r.ok&&hash(await r.text())===hash(fs.readFileSync(path,'utf8'))){pending.delete(path);console.log('Published asset verified:',path)}
   }catch(error){console.log('Public fetch pending:',path,error.name)}
  }
  if(pending.size){console.log('Waiting for Pages/CDN:',pending.size,'assets');await pause(15000)}
 }
 assert.equal(pending.size,0,'Live deployment must match release: '+Array.from(pending).join(', '));
 const browser=await chromium.launch();
 try{
  const context=await browser.newContext();
  // Keep the check anonymous and prevent database/Storage/Functions access.
  await context.route(/(?:firebaseio\.com|firebasedatabase\.app|firebasestorage\.googleapis\.com|cloudfunctions\.net)/,route=>route.abort());
  await context.routeWebSocket(/(?:firebaseio\.com|firebasedatabase\.app)/,ws=>ws.close());
  if(overlay)await context.route('**/class-pointer-prototype/dashboard.html?*',route=>route.fulfill({contentType:'text/html',body:fs.readFileSync('class-pointer-prototype/dashboard.html','utf8')}));
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const response=await page.goto(root+'class-pointer-prototype/dashboard.html?teacher=1&release-check='+encodeURIComponent(process.env.GITHUB_SHA||'pointer'),{waitUntil:'domcontentloaded'});
  assert.equal(response.status(),200);
  await page.getByRole('heading',{name:'Classroom Sharing',exact:true}).waitFor();
  assert.equal(await page.locator('[data-classroom-mode]').count(),3);
  try{
    await page.getByRole('button',{name:'Sign in with Google',exact:true}).waitFor({state:'visible',timeout:20000});
  }catch(error){
    console.log('Anonymous chooser diagnostics:',JSON.stringify(await page.evaluate(()=>({
      message:document.getElementById('message')?.textContent,
      welcome:document.getElementById('welcome')?.textContent,
      teacherChoiceHidden:document.getElementById('teacherChoice')?.hidden,
      teacherSignInHidden:document.getElementById('teacherSignIn')?.hidden,
      firebaseLoaded:typeof window.firebase,
      sdkVersion:window.firebase?.SDK_VERSION,
      authInitialized:window.firebase?.auth?.()._delegate?._isInitialized,
      authMethod:typeof window.firebase?.auth?.().onAuthStateChanged,
      settingsLoaded:typeof window.B3SiteSettings,
      contextLoaded:typeof window.B3_APP_CONTEXT,
      visibleButtons:Array.from(document.querySelectorAll('button')).filter(b=>b.getClientRects().length).map(b=>b.textContent)
    }))));
    console.log('Uncaught public page errors:',JSON.stringify(errors));
    throw error;
  }
  assert.equal(await page.locator('#teacherClassButtons button').count(),0,'Anonymous visitors cannot select or start a class');
  for(const mode of ['screens','boards','lesson']){
   await page.locator('[data-classroom-mode="'+mode+'"]').click();
   assert.equal(await page.locator('[data-classroom-mode="'+mode+'"]').getAttribute('aria-pressed'),'true');
  }
  assert.deepEqual(errors,[],'No uncaught JavaScript errors on the live anonymous chooser');
  console.log('Live chooser rendered, mode selection works, anonymous class access remains gated; no database access performed.');
 }finally{await browser.close()}
 try{
  const response=await fetch('https://us-central1-b3-games.cloudfunctions.net/classPointerShareAuth',{method:'GET',signal:AbortSignal.timeout(15000)});
  console.log('Optional activity-sharing endpoint unauthenticated GET status:',response.status);
 }catch(error){console.log('Optional activity-sharing endpoint reachability UNVERIFIED:',error.name)}
 console.log('Signed-in teacher/student video acceptance and Firebase deployment are outside this public smoke check.');
})().catch(error=>{console.error(error);process.exitCode=1});
