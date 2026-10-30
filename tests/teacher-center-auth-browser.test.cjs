'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
let chromium;try{({chromium}=require('playwright'))}catch{({chromium}=require('@playwright/test'))}
const ROOT=path.resolve(__dirname,'..');
const tree={b3Games:{admins:{},workspaces:{'b3-2026':{teachers:{
  owner:{active:true,classIds:{'*':true}},
  teacher_et:{active:true,classIds:{et:true}},
  teacher_wt:{active:true,classIds:{wt:true}},
  teacher_new:{active:true,classIds:{'new-room':true}},
  principal:{active:true,accountType:'principal',email:'principal@example.test',
    inviteId:'principal_invite',classIds:{et:true,'new-room':true},
    supervisedTeachers:{teacher_et:{classIds:{et:true}},teacher_new:{classIds:{'new-room':true}}}}
 },teacherInvites:{
  principal_invite:{active:true,accountType:'principal',email:'principal@example.test',
    claimedUid:'principal',classIds:{et:true,'new-room':true},
    supervisedTeacherIds:{teacher_et:true,teacher_new:true}},
  teacher_et:{active:true,role:'teacher',classIds:{et:true},claimedUid:'teacher_et'},
  teacher_new:{active:true,role:'teacher',classIds:{'new-room':true},claimedUid:'teacher_new'}
 },classes:{
  et:{name:'ET',active:true,toolGrants:{chazara:true},members:{student_et:{active:true,name:'ET Student'}}},
  wt:{name:'WT',active:true,toolGrants:{chazara:true},members:{student_wt:{active:true,name:'WT Student'}}},
  'new-room':{name:'New Room',active:true,toolGrants:{chazara:true},members:{student_new:{active:true,name:'New Student'}}}
 }}}}};
const USER_STUB=`(()=>{
 const T=${JSON.stringify(tree)},params=new URLSearchParams(location.search),role=params.get('synthetic')||'teacher_new';
 const records={owner:{uid:'owner',email:'simcha5770@gmail.com',providerData:[{providerId:'google.com'}],getIdToken:async()=> 'owner-token'},teacher_et:{uid:'teacher_et',email:'et@example.test',providerData:[{providerId:'google.com'}],getIdToken:async()=> 'et-token'},teacher_wt:{uid:'teacher_wt',email:'wt@example.test',providerData:[{providerId:'google.com'}],getIdToken:async()=> 'wt-token'},teacher_new:{uid:'teacher_new',email:'new@example.test',providerData:[{providerId:'google.com'}],getIdToken:async()=> 'new-token'},principal:{uid:'principal',email:'principal@example.test',emailVerified:true,providerData:[{providerId:'google.com'}],getIdToken:async()=> 'principal-token'}};
 const user=records[role],returning=params.get('returning')==='1',signIn=params.get('signin')==='1',delay=Number(params.get('authDelay')||35),reads=[];
 const snap=v=>({val:()=>v==null?null:structuredClone(v),exists:()=>v!=null});
 function at(p){return p.split('/').filter(Boolean).reduce((v,k)=>v==null?undefined:v[k],T)}
 const db={ref:p=>({once:async()=>{reads.push(p);await new Promise(r=>setTimeout(r,20));return snap(at(p))},set:async()=>{},update:async()=>{}})};
 const listeners=[];
 const auth={currentUser:returning||signIn?null:user,onAuthStateChanged(cb){listeners.push(cb);setTimeout(()=>cb(this.currentUser),delay);return()=>{}},authStateReady:async()=>{},signOut:async()=>{},setPersistence:async()=>{},updateCurrentUser:async next=>{auth.currentUser=next;for(const cb of listeners)queueMicrotask(()=>cb(next))}};
 const rememberedAuth={currentUser:returning?user:null,onAuthStateChanged(cb){setTimeout(()=>cb(this.currentUser),0);return()=>{}},authStateReady:async()=>{},setPersistence:async()=>{},signOut:async()=>{},signInWithPopup:async()=>{rememberedAuth.currentUser=user;return{user}}};
 function GoogleAuthProvider(){this.setCustomParameters=()=>{}}
 const rememberedApp={auth:()=>rememberedAuth},firebase={apps:[{}],initializeApp(){return rememberedApp},app:name=>{if(name==='FTTRememberedTeacher')return rememberedApp;throw Error('unknown app')},database:()=>db,auth:Object.assign(()=>auth,{Auth:{Persistence:{LOCAL:'local',SESSION:'session'}},GoogleAuthProvider}),storage:()=>({})};
 window.firebase=firebase;window.__syntheticReads=reads;
})();`;
function server(){return new Promise(resolve=>{const instance=http.createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(ROOT,'.'+pathname);if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end()}res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});fs.createReadStream(file).pipe(res)}).listen(0,'127.0.0.1',()=>resolve(instance))})}
async function signInRun(browser,port,settingsSource){
 const page=await browser.newPage();
 await page.route(/gstatic\.com\/firebasejs\//,route=>route.fulfill({contentType:'text/javascript',body:USER_STUB}));
 await page.route(/firebase-config\.js/,route=>route.fulfill({contentType:'text/javascript',body:"window.B3_FIREBASE_CONFIG={apiKey:'synthetic',authDomain:'localhost',databaseURL:'https://synthetic.invalid',projectId:'demo',storageBucket:'synthetic',messagingSenderId:'1',appId:'synthetic'};window.B3_APP_CONTEXT={workspaceId:'b3-2026'};"}));
 await page.route(/site-settings\.js/,route=>route.fulfill({contentType:'text/javascript',body:settingsSource}));
 await page.goto(`http://127.0.0.1:${port}/teacher-home.html?synthetic=teacher_new&signin=1&authDelay=10`);
 await page.getByRole('button',{name:'Sign in with Google'}).waitFor({state:'visible'});
 const start=Date.now();await page.getByRole('button',{name:'Sign in with Google'}).click();
 await page.waitForSelector('#classes .class-card',{timeout:10000});
 const result={elapsedMs:Date.now()-start,...await page.evaluate(()=>({classes:[...document.querySelectorAll('#classes .class-card h2')].map(x=>x.textContent.trim()),appVisible:!document.getElementById('app').classList.contains('hidden'),signInVisible:!document.getElementById('gate').classList.contains('hidden'),reads:window.__syntheticReads.slice()}))};
 await page.close();return result;
}

test('Teacher Center waits for authorization, scopes synthetic identities, and measures usable class render',{timeout:60000},async()=>{
 const httpServer=await server(),port=httpServer.address().port;let browser;
 try{
  browser=await chromium.launch().catch(()=>chromium.launch());
  const results={};
  for(const [role,query] of Object.entries({teacher_et:'?synthetic=teacher_et&authDelay=90',teacher_wt:'?synthetic=teacher_wt&authDelay=35',teacher_new:'?synthetic=teacher_new&authDelay=35',teacher_return:'?synthetic=teacher_new&returning=1&authDelay=20',principal:'?synthetic=principal&authDelay=35',owner:'?synthetic=owner&authDelay=35&manageStudentTools=1'})){
   const page=await browser.newPage();
   await page.route(/gstatic\.com\/firebasejs\//,route=>route.fulfill({contentType:'text/javascript',body:USER_STUB}));
   await page.route(/firebase-config\.js/,route=>route.fulfill({contentType:'text/javascript',body:"window.B3_FIREBASE_CONFIG={apiKey:'synthetic',authDomain:'localhost',databaseURL:'https://synthetic.invalid',projectId:'demo',storageBucket:'synthetic',messagingSenderId:'1',appId:'synthetic'};window.B3_APP_CONTEXT={workspaceId:'b3-2026'};"}));
   const start=Date.now();
   await page.goto(`http://127.0.0.1:${port}/teacher-home.html${query}`);
   await page.waitForSelector('#classes .class-card',{timeout:10000});
   const measuredMs=Date.now()-start;
   results[role]=await page.evaluate(()=>({
    elapsedMs:performance.now(),
    classes:[...document.querySelectorAll('#classes .class-card h2')].map(x=>x.textContent.trim()),
    etStudentTools:(()=>{const card=[...document.querySelectorAll('#classes .class-card')].find(x=>x.querySelector('h2')?.textContent.trim()==='ET');return card?[...card.querySelectorAll('.student-tool-controls input[data-tool]')].map(x=>x.dataset.tool).sort():[]})(),
    appVisible:!document.getElementById('app').classList.contains('hidden'),
    signInVisible:!document.getElementById('gate').classList.contains('hidden'),
    reads:window.__syntheticReads.slice()
   }));
   results[role].measuredMs=measuredMs;
   await page.close();
  }
  {
   const currentSettings=fs.readFileSync(path.join(ROOT,'site-settings.js'),'utf8');
   const baseSettings=currentSettings
    .replace(/  \/\/ Popup completion and Firebase's auth-state callback can request the same\n  \/\/ authorization check at the same time\. Share only in-flight work for this\n  \/\/ UID; once it settles, the next auth event performs fresh permission reads\.\n  const accessChecksInFlight = new Map\(\);\n\n/, '')
    .replace('function readUserAccessFromFirebase(user)', 'function readUserAccess(user)')
    .replace(/  function readUserAccess\(user\) \{\n    const uid = user && String\(user\.uid \|\| ""\);[\s\S]*?\n  \}\n\n  function isAuthorizedUser/, '  function isAuthorizedUser');
   const currentRuns=[],baseRuns=[];
   for(let i=0;i<3;i++){currentRuns.push(await signInRun(browser,port,currentSettings));baseRuns.push(await signInRun(browser,port,baseSettings));}
   const median=rows=>rows.map(x=>x.elapsedMs).sort((a,b)=>a-b)[Math.floor(rows.length/2)];
   results.teacher_signin={measuredMs:median(currentRuns),classes:currentRuns[0].classes,appVisible:currentRuns[0].appVisible,signInVisible:currentRuns[0].signInVisible,reads:currentRuns[0].reads,baselineMs:median(baseRuns),baselineReads:baseRuns[0].reads};
  }
  assert.deepEqual(results.teacher_et.classes,['ET']);
  assert.deepEqual(results.teacher_wt.classes,['WT']);
  assert.deepEqual(results.teacher_new.classes,['New Room']);
  assert.deepEqual(results.teacher_return.classes,['New Room']);
  assert.deepEqual(results.principal.classes,['ET','New Room']);
  assert.deepEqual(results.owner.classes,['ET','WT','New Room']);
  assert.deepEqual(results.owner.etStudentTools,results.teacher_et.etStudentTools,'owner and classroom teacher get the same ET student-tool controls');
  assert.deepEqual(results.teacher_signin.classes,['New Room']);
  assert.equal(results.teacher_signin.reads.filter(p=>p==='b3Games/admins/teacher_new').length,1,'Google popup and auth restoration share the in-flight admin check');
  assert.equal(results.teacher_signin.reads.filter(p=>p==='b3Games/workspaces/b3-2026/teachers/teacher_new').length,1,'Google popup and auth restoration share the in-flight teacher check');
  assert.equal(results.teacher_signin.baselineReads.filter(p=>p==='b3Games/admins/teacher_new').length,2,'baseline confirms duplicate admin reads in the popup/auth race');
  assert.equal(results.teacher_signin.baselineReads.filter(p=>p==='b3Games/workspaces/b3-2026/teachers/teacher_new').length,2,'baseline confirms duplicate teacher reads in the popup/auth race');
  for(const role of Object.keys(results)){
   assert.equal(results[role].appVisible,true,role+' renders only after authorized callback');
   assert.equal(results[role].signInVisible,false,role+' does not fall back to sign-in after authorization');
   assert.ok(results[role].measuredMs<5000,role+' reaches usable Teacher Center');
  }
  assert.ok(!results.teacher_new.reads.some(p=>p.includes('/classes/et')||p.includes('/classes/wt')),'regular teacher never reads unassigned class data');
  console.log('Synthetic Teacher Center time-to-usable ms '+JSON.stringify(Object.fromEntries(Object.entries(results).map(([k,v])=>[k,v.measuredMs]))));
  console.log('Popup sign-in median baseline/current '+JSON.stringify({baselineMs:results.teacher_signin.baselineMs,currentMs:results.teacher_signin.measuredMs,authorizationReadsPerPath:{baseline:2,current:1}}));
 }finally{await browser?.close();httpServer.close()}
});
