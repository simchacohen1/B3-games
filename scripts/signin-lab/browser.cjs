'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
module.exports=async function(lab){
 const {base,activities,requests,rest,setDelay,setDeny,setBaseline}=lab;
 const candidate=process.env.SIGNIN_LAB_CHROMIUM||path.join(os.homedir(),'.cache/ms-playwright/chromium_headless_shell-1161/chrome-linux/headless_shell');
 const browsers=[];
 const launch=()=>chromium.launch({...(fs.existsSync(candidate)?{executablePath:candidate}:{}),args:['--no-sandbox','--no-zygote','--single-process']});
 const results=[],timings=[];
 const permitted=new Set([new URL(base).origin,`http://127.0.0.1:${lab.authPort}`,`http://127.0.0.1:${lab.dbPort}`,`ws://127.0.0.1:${lab.dbPort}`]);
 let blocked=[],expectedCDNFailures=0;
 async function fresh(options={}){
  const browser=await launch();browsers.push(browser);
  const context=await browser.newContext();
  context.on('close',()=>browser.close().catch(()=>{}));
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(['fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname))return route.fulfill({contentType:'text/css',body:''});
   if(options.cdnFailure&&url.hostname==='www.gstatic.com'&&/firebase-(auth|database)-compat\.js$/.test(url.pathname)){expectedCDNFailures++;return route.abort();}
   return permitted.has(url.origin)?route.continue():(blocked.push(url.href),route.abort());
  });
  return {context,page:await context.newPage()};
 }
 const encode=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url');
 const token=track=>encode({alg:'none',typ:'JWT'})+'.'+encode({iss:'synthetic@'+lab.namespace,sub:'synthetic@'+lab.namespace,aud:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,uid:'synthetic_'+track,claims:{b3StudentId:'synthetic_'+track,b3ClassId:track,b3StudentRole:'student'}})+'.';
 async function login(page,track){await page.goto(base+'/login');await page.evaluate(async({token,track})=>{await window.labReady;await firebase.auth().signInWithCustomToken(token);sessionStorage.setItem('b3Games_studentId','synthetic_'+track);sessionStorage.setItem('b3Games_studentClass',track);}, {token:token(track),track});}
 async function open(page,tool,track){await page.goto(base+'/tool?tool='+tool+'&class='+track);await page.waitForFunction(()=>!document.getElementById('b3-gate-hide-style')&&!document.getElementById('b3-gate-overlay'),{},{timeout:10000}).catch(async error=>{console.log('ACCESS FAILURE',await page.evaluate(()=>({title:document.getElementById('b3GateTitle')?.textContent,uid:firebase.auth().currentUser?.uid,access:window.B3SiteSettings?.getCurrentAccess?.()})));throw error;});}
 async function closed(page,pattern){await page.waitForFunction(()=>document.getElementById('b3GateTitle')?.textContent,{},{timeout:10000});assert.match(await page.textContent('#b3GateTitle'),pattern);}
 async function run(name,fn){await fn();results.push({name,status:'passed'});console.log('PASS '+name);}
 try{
 for(const track of ['et','wt'])await run(track+' custom-token login, six tool identities, refresh, no progress writes',async()=>{
  const {context,page}=await fresh();await login(page,track);
  for(const tool of activities){await open(page,tool,track);assert.equal(await page.evaluate(()=>firebase.auth().currentUser.uid),'synthetic_'+track);await page.reload();await page.waitForFunction(()=>!document.getElementById('b3-gate-overlay')&&!document.getElementById('b3-gate-hide-style'));}
  assert.equal(await rest('posukPractice/attempts'),null);assert.equal(await rest('studentRewards/students'),null);await context.close();
 });
 await run('signed-out direct entry is denied',async()=>{const {context,page}=await fresh();await page.goto(base+'/tool?tool=halacha&class=et');await closed(page,/access|sign in/i);await context.close();});
 await run('disabled membership, profile, and tool are denied',async()=>{
  const {context,page}=await fresh();await login(page,'et');
  for(const [p,v,pattern] of [
   ['b3Games/workspaces/b3-2026/classes/et/members/synthetic_et/active',false,/sign in/i],
   ['b3Games/students/synthetic_et/profile/active',false,/sign in/i],
   ['b3Games/siteSettings/classGames/et/halacha',false,/turned off/i]
  ]){await rest(p,'PUT',v);await page.goto(base+'/tool?tool=halacha&class=et');await closed(page,pattern);await rest(p,'PUT',true);}
  await context.close();
 });
 await run('class lock and failed refresh close access, recovery reopens',async()=>{
  const {context,page}=await fresh();await login(page,'et');await open(page,'halacha','et');
  await rest('b3Games/siteSettings/classAccess/et/mode','PUT','locked');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await closed(page,/locked/i);
  await rest('b3Games/siteSettings/classAccess/et/mode','PUT','open');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>!document.getElementById('b3-gate-overlay'));
  setDeny(true);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await closed(page,/trouble/i);setDeny(false);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>!document.getElementById('b3-gate-overlay'));await context.close();
 });
 await run('synthetic Google teacher persists, preview stays teacher, and unassigned class denied',async()=>{
  const {context,page}=await fresh();await page.goto(base+'/login');
  const user=await page.evaluate(async()=>{await labReady;const credential=firebase.auth.GoogleAuthProvider.credential(JSON.stringify({sub:'synthetic_teacher',email:'teacher@example.test',email_verified:true,name:'Synthetic Teacher'}));const result=await firebase.app('FTTRememberedTeacher').auth().signInWithCredential(credential);await firebase.auth().updateCurrentUser(result.user);return {uid:result.user.uid};});
  await rest('b3Games/workspaces/b3-2026/teachers/'+user.uid,'PUT',{active:true,classIds:{et:true}});
  for(const tool of activities){await open(page,tool,'et');assert.equal(await page.evaluate(()=>firebase.auth().currentUser.providerData[0].providerId),'google.com');assert.equal(await page.evaluate(()=>sessionStorage.getItem('b3Games_studentId')),null);}
  const teacherTab=await context.newPage();
  await open(teacherTab,'halacha','et');assert.equal(await teacherTab.evaluate(()=>firebase.auth().currentUser.uid),user.uid);
  await login(page,'et');await open(page,'halacha','et');assert.equal(await page.evaluate(()=>firebase.auth().currentUser.uid),'synthetic_et');
  assert.equal(await teacherTab.evaluate(()=>firebase.auth().currentUser.uid),user.uid);
  await teacherTab.close();
  // Restore the teacher in this tab before checking class assignment.
  await page.evaluate(async()=>{sessionStorage.removeItem('b3Games_studentId');sessionStorage.removeItem('b3Games_studentClass');await firebase.auth().signOut();});
  await page.goto(base+'/tool?tool=halacha&class=wt');await closed(page,/assigned class/i);
  assert.equal(await rest('posukPractice/attempts'),null);await context.close();
 });
 await run('blocked Firebase CDN falls back to local SDK and restores student session',async()=>{
  const {context,page}=await fresh({cdnFailure:true});await login(page,'wt');
  await page.goto(base+'/tool?tool=halacha&class=wt&gateLoadsSDK=1');
  await page.waitForFunction(()=>!document.getElementById('b3-gate-overlay')&&!document.getElementById('b3-gate-hide-style'),{},{timeout:10000});
  assert.equal(await page.evaluate(()=>firebase.auth().currentUser.uid),'synthetic_wt');assert.equal(expectedCDNFailures,2);await context.close();
 });
 await run('teacher sign-out during pending access reads stays denied',async()=>{
  const {context,page}=await fresh();await page.goto(base+'/login');
  const uid=await page.evaluate(async()=>{await labReady;const credential=firebase.auth.GoogleAuthProvider.credential(JSON.stringify({sub:'signout_teacher',email:'signout@example.test',email_verified:true}));const result=await firebase.auth().signInWithCredential(credential);return result.user.uid;});
  await rest('b3Games/workspaces/b3-2026/teachers/'+uid,'PUT',{active:true,classIds:{et:true}});
  await open(page,'halacha','et');setDelay(250);const before=requests.length;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  for(let i=0;i<20&&requests.length===before;i++)await new Promise(r=>setTimeout(r,10));
  await page.evaluate(()=>window.B3SiteSettings.signOut());
  await closed(page,/access|sign in/i);await page.waitForTimeout(600);assert.ok(await page.locator('#b3-gate-overlay').count());setDelay(0);await context.close();
 });
 await run('actual Halacha and Rewards student-preview pages retain teacher identity without progress writes',async()=>{
  const {context,page}=await fresh();await page.goto(base+'/login');
  const uid=await page.evaluate(async()=>{await labReady;const credential=firebase.auth.GoogleAuthProvider.credential(JSON.stringify({sub:'full_page_teacher',email:'fullpage@example.test',email_verified:true}));const result=await firebase.auth().signInWithCredential(credential);return result.user.uid;});
  await rest('b3Games/workspaces/b3-2026/teachers/'+uid,'PUT',{active:true,classIds:{et:true}});
  await rest('studentRewards/rewards','PUT',{sample:{id:'sample',name:'Synthetic Reward',active:true,cost:10}});
  const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
  page.on('console',m=>{if(m.type()==='warning')console.log('ACTUAL PAGE WARNING',m.text().slice(0,200));});
  const attemptBefore=JSON.stringify(await rest('posukPractice/attempts'));
  const rewardBefore=JSON.stringify(await rest('studentRewards/students'));
  for(const [file,selector] of [['halacha/index.html','#teacherPreviewBanner'],['student-rewards/student.html','#portalView:not(.hidden)']]){
   await page.goto(base+'/'+file+'?class=et&demo=1'+(file.startsWith('halacha/')?'&teacher=1':''));
   await page.waitForSelector(selector,{timeout:15000});
   await page.waitForFunction(()=>!document.getElementById('b3-gate-overlay')&&!document.getElementById('b3-gate-hide-style'),{},{timeout:10000});
   assert.equal(await page.evaluate(()=>firebase.auth().currentUser.uid),uid);
   assert.equal(await page.evaluate(()=>sessionStorage.getItem('b3Games_studentId')),null);
   if(file.startsWith('halacha/')){await page.evaluate(()=>{S.__syntheticPreview=true;save();});}
   await page.reload();await page.waitForSelector(selector,{timeout:15000});
  }
  await page.click('[data-tab="Rewards"]');await page.click('[data-redeem="sample"]');
  await page.waitForTimeout(150);
  assert.equal(await rest('studentRewards/redemptions'),null);
  assert.equal(await rest('b3Games/teachers/'+uid+'/halacha/siman1'),null);
  assert.deepEqual(pageErrors,[],'actual preview pages must not throw');
  assert.equal(JSON.stringify(await rest('posukPractice/attempts')),attemptBefore);
  assert.equal(JSON.stringify(await rest('studentRewards/students')),rewardBefore);
  await context.close();
 });
 // Before/after comparison uses the exact pre-repair gate from the PR history.
 // These are local controlled-delay gate timings, not live website login timings.
 for(const kind of ['student','teacher'])for(const baseline of [true,false]){
  setBaseline(baseline);setDelay(120);
  const samples=[],counts=[],settledCounts=[];
  const {context,page}=await fresh();
  if(kind==='student')await login(page,'et');
  else{
   await page.goto(base+'/login');
   const uid=await page.evaluate(async()=>{await labReady;const credential=firebase.auth.GoogleAuthProvider.credential(JSON.stringify({sub:'performance_teacher',email:'performance@example.test',email_verified:true}));return (await firebase.auth().signInWithCredential(credential)).user.uid;});
   await rest('b3Games/workspaces/b3-2026/teachers/'+uid,'PUT',{active:true,classIds:{et:true}});
  }
  for(let i=0;i<10;i++){const start=requests.length,t=performance.now();await open(page,'halacha','et');samples.push(Math.round(performance.now()-t));counts.push(requests.length-start);await page.waitForTimeout(600);settledCounts.push(requests.length-start);}
  timings.push({version:baseline?'pre-repair':'candidate',kind,delayPerRESTms:120,samplesMs:samples,requestsAtOpen:counts,requestsAfterSettling:settledCounts,p50:samples.slice().sort((a,b)=>a-b)[4],p95:samples.slice().sort((a,b)=>a-b)[9]});await context.close();
 }
 setDelay(0);setBaseline(false);
 assert.equal(blocked.length,0,'unexpected outbound requests: '+blocked.join(', '));
 const report={results,timings,expectedCDNFailures,blockedExternalRequests:blocked};
 if(process.env.SIGNIN_LAB_RESULTS)fs.writeFileSync(process.env.SIGNIN_LAB_RESULTS,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
 }finally{await Promise.all(browsers.map(b=>b.close().catch(()=>{})));}
};
