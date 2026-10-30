// Browser check of the Chazara teacher page with a stubbed Firebase backend:
// default (pending-only) view shows Approve All, hides Posuk milestones, pays
// them automatically, and does not load historical dashboard data.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
let chromium;try{({chromium}=require('playwright'))}catch{({chromium}=require('@playwright/test'))}

const ROOT=path.resolve(__dirname,'..');
const tree={b3Games:{workspaces:{'b3-2026':{classes:{
  et:{name:'B3 ET',members:{simcha_cohen:{name:'Simcha'}}},
  wt:{name:'B3 WT',members:{leib_wolf:{name:'Leib'}}}}}},students:{}},
  posukPractice:{chazara:{events:{simcha_cohen:{},leib_wolf:{}}}}};
const FIREBASE_STUB=`(function(){const T=${JSON.stringify(tree)};window.__reads=[];
const at=p=>p.split('/').filter(Boolean).reduce((o,k)=>o==null?undefined:o[k],T);
const snap=v=>({val:()=>v===undefined?null:v,exists:()=>v!=null});
const ref=p=>({once:async()=>{window.__reads.push(p);return snap(at(p))},on:(t,h)=>{window.__reads.push(p);setTimeout(()=>h(snap(at(p))),0)},off(){},child:c=>ref(p+'/'+c)});
const user={uid:'owner',email:'owner@example.com',getIdToken:async()=>'tok'};
window.firebase={apps:[1],initializeApp(){},database:()=>({ref}),auth:Object.assign(()=>({currentUser:user,onAuthStateChanged(){}}),{GoogleAuthProvider:function(){}}),storage:()=>({})};})();`;
const SITE_STUB=`window.B3SiteSettings={onAuthStateChanged(cb){setTimeout(()=>cb(firebase.auth().currentUser,true,{authorized:true,role:'admin'}),0)},signInWithGoogle(){}};`;

function serve(){return new Promise(r=>{const s=http.createServer((req,res)=>{const u=decodeURIComponent(req.url.split('?')[0]);const f=path.join(ROOT,u);
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end()}
  res.writeHead(200,{'Content-Type':f.endsWith('.js')?'text/javascript':'text/html'});fs.createReadStream(f).pipe(res)}).listen(0,()=>r(s))})}

test('Chazara teacher default view: Approve All present, Posuk milestones automatic, history deferred',{timeout:60000},async()=>{
  const server=await serve(),port=server.address().port;
  // Close the server and browser even if the browser cannot start, so a failure
  // fails fast instead of keeping node --test running.
  let browser;const approvals=[];
  try{
  browser=await chromium.launch({executablePath:fs.existsSync('/opt/pw-browsers/chromium')?'/opt/pw-browsers/chromium':undefined}).catch(()=>chromium.launch());
  const page=await browser.newPage();
  // Later routes win in Playwright, so register the catch-all first.
  await page.route(/gstatic\.com\/firebasejs\//,r=>r.fulfill({contentType:'text/javascript',body:''}));
  await page.route(/gstatic\.com\/firebasejs\/.*app-compat/,r=>r.fulfill({contentType:'text/javascript',body:FIREBASE_STUB}));
  await page.route(/site-settings\.js/,r=>r.fulfill({contentType:'text/javascript',body:SITE_STUB}));
  await page.route(/private-media\.js/,r=>r.fulfill({contentType:'text/javascript',body:'window.B3PrivateMedia={setSource:async()=>{}}'}));
  await page.route(/cloudfunctions\.net\/studentRewardsAutoAward/,async r=>{
    const body=JSON.parse(r.request().postData()||'{}');
    if(body.action==='list-chazara-pending')return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,requests:[
      {id:'c-et',status:'pending',source:'chazara',amount:1,practiceStudentId:'simcha_cohen',studentName:'Simcha',classId:'et',createdAt:2},
      {id:'c-wt',status:'pending',source:'chazara-recording',amount:2,recorded:true,practiceStudentId:'leib_wolf',studentName:'Leib',classId:'wt',createdAt:3},
      {id:'m-et',status:'pending',source:'reading100',amount:3,practiceStudentId:'simcha_cohen',studentName:'Simcha',classId:'et',createdAt:4},
      {id:'s-et',status:'pending',source:'shorashim-recording',amount:2,practiceStudentId:'simcha_cohen',studentName:'Simcha',classId:'et',createdAt:5}]})});
    if(body.action==='approve-point-request'){approvals.push(body.requestId);return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,status:'approved',actualAmount:1})})}
    return r.fulfill({contentType:'application/json',body:'{"ok":true}'});
  });
    await page.goto(`http://127.0.0.1:${port}/chazara/teacher.html`);
    await page.waitForFunction(()=>document.querySelectorAll('#approvalList .request-row').length>0,null,{timeout:15000});
    const state=await page.evaluate(()=>({
      reviewOnly:document.getElementById('teacherApp').classList.contains('review-only'),
      panelVisible:getComputedStyle(document.getElementById('approvalPanel')).display!=='none',
      rows:[...document.querySelectorAll('#approvalList .request-row')].map(r=>r.dataset.request),
      count:document.getElementById('approvalCount').textContent,
      approveAllVisible:!document.getElementById('approveAllBtn').classList.contains('hidden'),
      recordingsApproveAll:document.getElementById('recordingsApproveAllBtn').textContent,
      recordingsApproveAllVisible:!document.getElementById('recordingsApproveAllBtn').classList.contains('hidden'),
      reviewFilter:document.getElementById('recordingReviewFilter').value,
      historyReads:window.__reads.filter(p=>p.startsWith('posukPractice/attempts')||p.startsWith('posukPractice/chazara/students'))}));
    assert.equal(state.reviewOnly,true,'opens in pending-only view');
    assert.equal(state.panelVisible,true,'pending point approvals visible without the full dashboard');
    assert.deepEqual(state.rows.sort(),['c-et','c-wt'],'Chazara only: no Posuk milestone, no Shorashim');
    assert.equal(state.count,'2 pending');
    assert.equal(state.approveAllVisible,true);
    assert.equal(state.recordingsApproveAllVisible,true);
    assert.equal(state.recordingsApproveAll,'Approve All Pending Points (2)');
    assert.equal(state.reviewFilter,'pending');
    assert.deepEqual(state.historyReads,[],'historical data not loaded initially');
    await page.waitForFunction(()=>true);await page.waitForTimeout(300);
    assert.deepEqual(approvals,['m-et'],'Posuk milestone paid automatically, nothing else approved');
    // Approve All approves exactly the pending Chazara items.
    approvals.length=0;page.once('dialog',d=>d.accept());
    await page.click('#approveAllBtn');
    await page.waitForFunction(()=>!document.getElementById('approveAllBtn').disabled);
    await page.waitForTimeout(300);
    assert.deepEqual(approvals.filter(id=>id.startsWith('c-')).sort(),['c-et','c-wt']);
    assert.ok(!approvals.includes('s-et'),'Shorashim recordings are not bulk-approved here');
    // History loads only on request.
    await page.click('#showFullDashboard');
    await page.waitForFunction(()=>window.__reads.some(p=>p.startsWith('posukPractice/attempts')));
  }finally{await browser?.close();server.close()}
});
