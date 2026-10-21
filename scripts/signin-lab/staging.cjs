'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require('playwright');
module.exports=async function(lab){
 const {base,authPort,dbPort,namespace,rest,backend}=lab;
 const results=[],blocked=[],browsers=[];
 async function fresh(){
  const executablePath=process.env.SIGNIN_LAB_CHROMIUM||path.join(os.homedir(),'.cache/ms-playwright/chromium_headless_shell-1161/chrome-linux/headless_shell');
  const browser=await chromium.launch({executablePath,args:['--no-sandbox','--no-zygote','--single-process']});browsers.push(browser);
  const context=await browser.newContext();
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='apis.google.com'&&u.pathname==='/js/api.js'){
    const callback=u.searchParams.get('onload')||'';if(callback&&!/^[A-Za-z0-9_$]+$/.test(callback))throw Error('Unexpected GAPI callback');
    return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(process.env.SIGNIN_LAB_GAPI||'/tmp/pr283-google-api.js','utf8')+(callback?';window['+JSON.stringify(callback)+']();':'')});
   }
   if(u.hostname==='apis.google.com'&&/^\/_\/scs\/(abc|apps)-static\/_\/js\//.test(u.pathname)){
    const asset=process.env.SIGNIN_LAB_GAPI_IFRAMES||'/tmp/pr283-google-iframes.js';
    if(fs.existsSync(asset))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(asset,'utf8')});
    console.log('MISSING STATIC ASSET',u.href);
   }
   if(u.hostname==='unpkg.com'&&u.pathname.startsWith('/material-components-web@10/'))return route.fulfill({contentType:u.pathname.endsWith('.css')?'text/css':'text/javascript',body:''});
   if(['fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname))return route.fulfill({contentType:'text/css',body:''});
   if(u.hostname===namespace+'.firebaseio.com'){
    const target=new URL(`http://127.0.0.1:${dbPort}`+u.pathname+u.search);target.searchParams.set('ns',namespace);
    const r=await fetch(target);return route.fulfill({status:r.status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:await r.text()});
   }
   if([new URL(base).origin,`http://127.0.0.1:${authPort}`,`http://127.0.0.1:${dbPort}`].includes(u.origin))return route.continue();
   console.log('BLOCKED',u.origin+u.pathname);blocked.push(u.origin+u.pathname);return route.abort();
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);if(process.env.SIGNIN_LAB_CASE)page.on('request',r=>console.log('REQUEST',new URL(r.url()).origin+new URL(r.url()).pathname));
  page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
  return {page,context,close:()=>browser.close()};
 }
 async function run(name,fn){if(process.env.SIGNIN_LAB_CASE&&!name.includes(process.env.SIGNIN_LAB_CASE))return;await fn();results.push({name,status:'passed'});console.log('PASS '+name);}
 async function post(page,name,body,token){return page.evaluate(async({base,name,body,token})=>{const r=await fetch(base+'/api/'+name,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};},{base,name,body,token});}
 try{
 for(const track of ['et','wt']){
  await rest('b3Private/passcodes/synthetic_'+track,'PUT',{passcode:track==='et'?'1234':'5678',chosenPinVersion:1});
 }
 await run('actual homepage rejects wrong passcode and accepts ET/WT private passcodes',async()=>{
  for(const track of ['et','wt']){
   const s=await fresh(),{page}=s;await page.goto(base+'/index.html');
   await page.fill('#studentNameInput','Synthetic '+track);await page.fill('#classPinInput','0000');await page.click('#studentSignInBtn');
   await page.waitForFunction(()=>document.getElementById('loginMsg').textContent.includes('passcode')&&!document.getElementById('studentSignInBtn').disabled);
   assert.equal(await page.evaluate(()=>firebase.auth().currentUser),null);
   await page.fill('#classPinInput',track==='et'?'1234':'5678');await page.click('#studentSignInBtn');
   await page.waitForFunction(()=>!!firebase.auth().currentUser&&document.getElementById('studentNameLabel').textContent.startsWith('Synthetic'),{},{timeout:20000});
   const claims=await page.evaluate(async()=> (await firebase.auth().currentUser.getIdTokenResult()).claims);
   assert.equal(claims.b3StudentId,'synthetic_'+track);assert.equal(claims.b3ClassId,track);assert.equal(claims.b3StudentRole,'student');
   await page.reload();await page.waitForFunction(()=>document.getElementById('studentNameLabel').textContent.startsWith('Synthetic'));
   await s.close();
  }
 });
 await run('actual student Halacha and Rewards exchanges persist in each tab without repeat login',async()=>{
  const s=await fresh(),{page}=s;
  const enter=async(p,track)=>{await p.goto(base+'/index.html');await p.fill('#studentNameInput','Synthetic '+track);await p.fill('#classPinInput',track==='et'?'1234':'5678');await p.click('#studentSignInBtn');await p.waitForFunction(()=>!!firebase.auth().currentUser&&document.getElementById('studentNameLabel').textContent.startsWith('Synthetic'));};
  await enter(page,'et');await page.goto(base+'/halacha/index.html');
  await page.waitForFunction(()=>firebase.apps.some(a=>a.name==='HalachaStudent')&&!!firebase.app('HalachaStudent').auth().currentUser);
  assert.equal(await page.evaluate(async()=> (await firebase.app('HalachaStudent').auth().currentUser.getIdTokenResult()).claims.b3ClassId),'et');
  const second=await s.context.newPage();await enter(second,'wt');await second.goto(base+'/halacha/index.html');
  await second.waitForFunction(()=>firebase.apps.some(a=>a.name==='HalachaStudent')&&!!firebase.app('HalachaStudent').auth().currentUser);
  assert.equal(await page.evaluate(async()=> (await firebase.app('HalachaStudent').auth().currentUser.getIdTokenResult()).claims.b3ClassId),'et');
  assert.equal(await second.evaluate(async()=> (await firebase.app('HalachaStudent').auth().currentUser.getIdTokenResult()).claims.b3ClassId),'wt');
  await second.close();
  await page.goto(base+'/student-rewards/student.html');await page.waitForSelector('#portalView:not(.hidden)',{timeout:20000});
  assert.equal(await page.evaluate(async()=> (await firebase.app('StudentRewardsStudent').auth().currentUser.getIdTokenResult()).claims.b3ClassId),'et');
  const before=backend.calls.filter(c=>c.name==='studentRewardsLogin').length;
  await page.reload();await page.waitForSelector('#portalView:not(.hidden)',{timeout:20000});await page.waitForTimeout(300);
  assert.equal(backend.calls.filter(c=>c.name==='studentRewardsLogin').length,before,'refresh must reuse valid rewards auth');
  const other=await s.context.newPage();await enter(other,'wt');await other.goto(base+'/student-rewards/student.html');await other.waitForSelector('#portalView:not(.hidden)',{timeout:20000});
  assert.equal(await other.evaluate(async()=> (await firebase.app('StudentRewardsStudent').auth().currentUser.getIdTokenResult()).claims.b3ClassId),'wt');
  assert.equal(await page.evaluate(async()=> (await firebase.app('StudentRewardsStudent').auth().currentUser.getIdTokenResult()).claims.b3ClassId),'et');
  await s.close();
 });
 await run('Google popup sign-in claims only the invited teacher and survives refresh',async()=>{
  await rest('b3Games/workspaces/b3-2026/teacherInvites/staging_example_test','PUT',{email:'staging@example.test',active:true,classIds:{et:true}});
  const s=await fresh(),{page,context}=s;await page.goto(base+'/login');await page.addScriptTag({url:base+'/site-settings.js'});
  await page.evaluate(()=>{const b=document.createElement('button');b.id='google';b.textContent='Teacher sign in';b.onclick=()=>{window.teacherLogin=B3SiteSettings.signInWithGoogle().catch(e=>{window.teacherError=e.message;return null;});};document.body.append(b);});
  const popupPromise=context.waitForEvent('page',{timeout:10000});await page.click('#google');const popup=await popupPromise.catch(async e=>{console.log('POPUP FAILURE',await page.evaluate(()=>window.teacherError));throw e;});
  await popup.locator('#add-account-button').click();await popup.fill('#email-input','staging@example.test');await popup.fill('#display-name-input','Synthetic Staging Teacher');await popup.click('#sign-in');
  await page.waitForFunction(()=>window.teacherError||window.B3SiteSettings.getCurrentAccess().authorized,{},{timeout:20000});
  assert.equal(await page.evaluate(()=>window.teacherError),undefined);
  const access=await page.evaluate(()=>B3SiteSettings.getCurrentAccess());assert.equal(access.role,'teacher');assert.deepEqual(access.classIds,['et']);
  const uid=await page.evaluate(()=>firebase.auth().currentUser.uid);const record=await rest('b3Games/workspaces/b3-2026/teachers/'+uid);assert.equal(record.email,'staging@example.test');
  await page.goto(base+'/tool?tool=halacha&class=et');await page.waitForFunction(()=>!document.getElementById('b3-gate-hide-style')&&!document.getElementById('b3-gate-overlay'));
  assert.equal(await page.evaluate(()=>firebase.auth().currentUser.uid),uid);await s.close();
 });
 await run('actual Quiz page loads and submits through the authenticated backend',async()=>{
  await rest('b3Quiz/launches/browser_stage','PUT',{classId:'et',started:true,mode:'test',showScore:false,quizSnapshot:{title:'Synthetic Browser Quiz',questions:[{q:'Synthetic question',choices:['A','B'],correctIndex:1}]}});
  await rest('b3Quiz/settings/activeLaunchByClass/et','PUT','browser_stage');
  const s=await fresh(),{page}=s;await page.goto(base+'/index.html');await page.fill('#studentNameInput','Synthetic et');await page.fill('#classPinInput','1234');await page.click('#studentSignInBtn');await page.waitForFunction(()=>!!firebase.auth().currentUser&&document.getElementById('studentNameLabel').textContent.startsWith('Synthetic'));
  await page.goto(base+'/weekly-quiz/index.html?launch=browser_stage');await page.waitForSelector('#quizCard:not(.hidden)',{timeout:20000});
  await page.locator('.choice').nth(1).click();await page.click('#submitBtn');
  for(let i=0;i<50;i++){const saved=await rest('b3Quiz/responses/browser_stage/synthetic_et/0');if(saved){assert.equal(saved.choiceIndex,1);break;}if(i===49)throw Error('Quiz answer was not saved through the backend');await page.waitForTimeout(100);}
  await s.close();
 });
 await run('uninvited Google teacher and student token cannot claim teacher access',async()=>{
  const s=await fresh(),{page}=s;await page.goto(base+'/login');
  const identity=await page.evaluate(async()=>{await labReady;const credential=firebase.auth.GoogleAuthProvider.credential(JSON.stringify({sub:'uninvited',email:'uninvited@example.test',email_verified:true}));const result=await firebase.auth().signInWithCredential(credential);return {uid:result.user.uid,token:await result.user.getIdToken()};});
  const claim=await post(page,'funTorahTeacherClaim',{},identity.token);assert.equal(claim.status,403);assert.equal(await rest('b3Games/workspaces/b3-2026/teachers/'+identity.uid),null);
  const login=await post(page,'funTorahStudentAuth',{action:'login',name:'Synthetic et',pin:'1234'});
  const token=await page.evaluate(async token=>{const result=await firebase.auth().signInWithCustomToken(token);return result.user.getIdToken();},login.body.customToken);
  const denied=await post(page,'funTorahTeacherClaim',{},token);assert.equal(denied.status,403);await s.close();
 });
 await run('real Halacha/rewards/quiz HTTP handlers enforce credentials, class, and token claims',async()=>{
  const s=await fresh(),{page}=s;await page.goto(base+'/login');
  for(const track of ['et','wt']){
   const credentials={name:'Synthetic '+track,pin:track==='et'?'1234':'5678',classId:track};
   const login=await post(page,'funTorahStudentAuth',{action:'login',...credentials});assert.equal(login.status,200);assert.ok(login.body.customToken);assert.equal(login.body.pin,undefined);
   const wrong=await post(page,'funTorahStudentAuth',{action:'halachaToken',...credentials,pin:'0000',studentId:'synthetic_'+track});assert.equal(wrong.status,401);
   const mismatch=await post(page,'funTorahStudentAuth',{action:'halachaToken',...credentials,studentId:'synthetic_'+track,classId:track==='et'?'wt':'et'});assert.equal(mismatch.status,403);
   const halacha=await post(page,'funTorahStudentAuth',{action:'halachaToken',...credentials,studentId:'synthetic_'+track});assert.equal(halacha.status,200);
   const reward=await post(page,'studentRewardsLogin',{...credentials,b3StudentId:'synthetic_'+track});assert.equal(reward.status,200);
   for(const [type,reply]of [['homepage',login],['halacha',halacha],['rewards',reward]]){
    const identity=await page.evaluate(async({token,type})=>{let app;try{app=firebase.app(type);}catch{app=firebase.initializeApp(window.B3_FIREBASE_CONFIG,type);}const result=await app.auth().signInWithCustomToken(token);const t=await result.user.getIdTokenResult();return {uid:result.user.uid,claims:t.claims,token:await result.user.getIdToken()};},{token:reply.body.customToken,type});
    assert.equal(identity.claims.b3StudentId,'synthetic_'+track);assert.equal(identity.claims.b3ClassId,track);
    if(type==='homepage'){
     await rest('b3Quiz/launches/stage_'+track,'PUT',{classId:track,started:true,mode:'test',showScore:false,quizSnapshot:{questions:[{q:'Synthetic question',choices:['A','B'],correctIndex:1}]}});
     const launch=await post(page,'weeklyQuizStudent',{action:'launch',launchId:'stage_'+track},identity.token);assert.equal(launch.status,200);assert.equal(launch.body.launch.quizSnapshot.questions[0].correctIndex,undefined);
     const answer=await post(page,'weeklyQuizStudent',{action:'answer',launchId:'stage_'+track,questionIndex:0,choiceIndex:1},identity.token);assert.equal(answer.status,200);
     const duplicate=await post(page,'weeklyQuizStudent',{action:'answer',launchId:'stage_'+track,questionIndex:0,choiceIndex:0},identity.token);assert.equal(duplicate.status,409);
     const complete=await post(page,'weeklyQuizStudent',{action:'complete',launchId:'stage_'+track},identity.token);assert.equal(complete.status,200);
     await backend.setDisabled(identity.uid,true);
     const disabled=await post(page,'weeklyQuizStudent',{action:'history'},identity.token);assert.equal(disabled.status,401);
     await backend.setDisabled(identity.uid,false);
     await rest('b3Games/students/synthetic_'+track+'/profile/active','PUT',false);
     const inactive=await post(page,'weeklyQuizStudent',{action:'history'},identity.token);assert.equal(inactive.status,403);
     await rest('b3Games/students/synthetic_'+track+'/profile/active','PUT',true);
     const history=await post(page,'weeklyQuizStudent' ,{action:'history'},identity.token);assert.equal(history.status,200);
     const noToken=await post(page,'weeklyQuizStudent',{action:'history'});assert.equal(noToken.status,401);
     const invalid=await post(page,'weeklyQuizStudent',{action:'history'},'invalid-token');assert.equal(invalid.status,401);
    }
   }
  }
  await s.close();
 });
 assert.equal(blocked.length,0,'unexpected outbound requests: '+blocked.join(', '));
 const report={results,backendCalls:backend.calls,unexpectedOutboundRequests:blocked};
 if(process.env.SIGNIN_LAB_RESULTS)fs.writeFileSync(process.env.SIGNIN_LAB_RESULTS,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
 }finally{await Promise.all(browsers.map(b=>b.close().catch(()=>{})));}
};
