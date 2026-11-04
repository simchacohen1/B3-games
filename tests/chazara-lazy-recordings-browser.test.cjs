// Browser check of the Chazara teacher page with a stubbed Firebase backend:
// default (pending-only) view shows Approve All, hides Posuk milestones, pays
// them automatically, and does not load historical dashboard data.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
let chromium;try{({chromium}=require('playwright'))}catch{({chromium}=require('@playwright/test'))}

const ROOT=path.resolve(__dirname,'..');
const tree={b3Games:{workspaces:{'b3-2026':{classes:{
  et:{name:'B3 ET',members:{simcha_cohen:{name:'Simcha'}}},
  wt:{name:'B3 WT',members:{leib_wolf:{name:'Leib'}}}}}},students:{}},
  posukPractice:{chazara:{events:{simcha_cohen:{},leib_wolf:{rec1:{recorded:true,reviewApplied:true,pointRequestStatus:"pending",perek:18,posuk:1,createdAt:3},older:{recorded:true,reviewApplied:true,pointRequestStatus:"approved",teacherFullyChecked:true,perek:18,posuk:2,createdAt:1}}}}}};
const FIREBASE_STUB=`(function(){const T=${JSON.stringify(tree)};window.__reads=[];window.__unsubscribed=[];
const at=p=>p.split('/').filter(Boolean).reduce((o,k)=>o==null?undefined:o[k],T);
const snap=v=>({val:()=>v===undefined?null:v,exists:()=>v!=null});
const ref=p=>({once:async()=>{window.__reads.push(p);return snap(at(p))},on:(t,h)=>{window.__reads.push(p);setTimeout(()=>h(snap(at(p))),0)},off(){window.__unsubscribed.push(p)},child:c=>ref(p+'/'+c)});
const user={uid:'owner',email:'owner@example.com',getIdToken:async()=>'tok'};
window.firebase={apps:[1],initializeApp(){},database:()=>({ref}),auth:Object.assign(()=>({currentUser:user,onAuthStateChanged(){}}),{GoogleAuthProvider:function(){}}),storage:()=>({})};})();`;
const SITE_STUB=`window.B3SiteSettings={onAuthStateChanged(cb){setTimeout(()=>cb(firebase.auth().currentUser,true,{authorized:true,role:'admin'}),0)},signInWithGoogle(){}};`;

function serve(){return new Promise(r=>{const s=http.createServer((req,res)=>{const u=decodeURIComponent(req.url.split('?')[0]);const f=path.join(ROOT,u);
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end()}
  res.writeHead(200,{'Content-Type':f.endsWith('.js')?'text/javascript':'text/html'});fs.createReadStream(f).pipe(res)}).listen(0,()=>r(s))})}

test('Chazara pending-only startup and lazy historical recording loads with performance timing',{timeout:60000},async()=>{
  const server=await serve(),port=server.address().port;
  // Keep the HTTP server and browser cleanup active even if Chromium fails to start.
  let browser;const approvals=[],historyCalls=[],pendingEventCalls=[];
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
    if(body.action==='get-chazara-event'){
      pendingEventCalls.push(body.studentId+'/'+body.eventId);
      return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,event:tree.posukPractice.chazara.events[body.studentId]?.[body.eventId]||null})});
    }
    if(body.action==='list-chazara-history'){
      historyCalls.push(body.studentId);
      return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,events:tree.posukPractice.chazara.events[body.studentId]||{}})});
    }
    if(body.action==='list-chazara-pending')return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,requests:[
      {id:'c-et',status:'pending',source:'chazara',amount:1,practiceStudentId:'simcha_cohen',studentName:'Simcha',classId:'et',createdAt:2},
      {id:'c-wt',status:'pending',source:'chazara-recording',amount:2,recorded:true,practiceStudentId:'leib_wolf',eventId:'rec1',studentName:'Leib',classId:'wt',createdAt:3},
      {id:'m-et',status:'pending',source:'reading100',amount:3,practiceStudentId:'simcha_cohen',studentName:'Simcha',classId:'et',createdAt:4},
      {id:'s-et',status:'pending',source:'shorashim-recording',amount:2,practiceStudentId:'simcha_cohen',studentName:'Simcha',classId:'et',createdAt:5}]})});
    if(body.action==='approve-point-request'){approvals.push(body.requestId);return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,status:'approved',actualAmount:1})})}
    return r.fulfill({contentType:'application/json',body:'{"ok":true}'});
  });
    const initialStart=Date.now();
    await page.goto(`http://127.0.0.1:${port}/chazara/teacher.html`);
    await page.waitForFunction(()=>document.querySelectorAll('#approvalList .request-row').length>0,null,{timeout:15000});
    await page.waitForFunction(()=>document.querySelectorAll('#recordingsList .recording-row').length===1,null,{timeout:15000});
    const pendingLoadMs=Date.now()-initialStart;
    const state=await page.evaluate(()=>({
      reviewOnly:document.getElementById('teacherApp').classList.contains('review-only'),
      panelVisible:getComputedStyle(document.getElementById('approvalPanel')).display!=='none',
      rows:[...document.querySelectorAll('#approvalList .request-row')].map(r=>r.dataset.request),
      count:document.getElementById('approvalCount').textContent,
      approveAllVisible:!document.getElementById('approveAllBtn').classList.contains('hidden'),
      recordingsApproveAll:document.getElementById('recordingsApproveAllBtn').textContent,
      recordingsApproveAllVisible:!document.getElementById('recordingsApproveAllBtn').classList.contains('hidden'),
      reviewFilter:document.getElementById('recordingReviewFilter').value,
      historyReads:window.__reads.filter(p=>p.startsWith('posukPractice/attempts')||p.startsWith('posukPractice/chazara/students')||p==='posukPractice/chazara/events/simcha_cohen'||p==='posukPractice/chazara/events/leib_wolf')}));
    assert.equal(state.reviewOnly,true,'opens in pending-only view');
    assert.equal(state.panelVisible,true,'pending point approvals visible without the full dashboard');
    assert.deepEqual(state.rows.sort(),['c-et','c-wt'],'Chazara only: no Posuk milestone, no Shorashim');
    assert.equal(state.count,'2 pending');
    assert.equal(state.approveAllVisible,true);
    assert.equal(state.recordingsApproveAllVisible,true);
    assert.equal(state.recordingsApproveAll,'Approve All Pending Points (2)');
    assert.equal(state.reviewFilter,'pending');
    assert.deepEqual(state.historyReads,[],'no full student recording history fetched on startup');
    assert.deepEqual(await page.evaluate(()=>window.__reads.filter(p=>p.startsWith('posukPractice/chazara/events/'))),[],'no direct event reads, including exact pending events');
    assert.deepEqual(pendingEventCalls,['leib_wolf/rec1'],'only the pending recording was fetched via scoped API');
    const historyStart=Date.now();
    await page.selectOption('#recordingReviewFilter','checked');
    await page.waitForFunction(()=>document.querySelector('#recordingsList .recording-row [data-review-status]')?.textContent==='✓ Fully checked');
    const historyLoadMs=Date.now()-historyStart;
    assert.equal(await page.locator('#recordingsList .recording-row [data-review-status]').textContent(),'✓ Fully checked','historical checked recording loads on demand');
    assert.ok(historyCalls.includes('leib_wolf'),'history requested from scoped API');
    await page.selectOption('#recordingReviewFilter','pending');
    await page.waitForFunction(()=>document.querySelectorAll('#recordingsList .recording-row').length===1);
    assert.match(await page.locator('#recordingsList .recording-row [data-review-status]').textContent(),/Needs full review/,'pending-only view restored');
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
    const fullHistoryReads=await page.evaluate(()=>window.__reads.filter(p=>/^posukPractice\/chazara\/events\/[^/]+$/.test(p)).length);
    const pendingReturnStart=Date.now();
    await page.click('#showPendingOnly');
    await page.waitForFunction(()=>document.getElementById('recordingReviewFilter').value==='pending'&&!document.getElementById('teacherApp').classList.contains('hidden')&&document.querySelectorAll('#recordingsList .recording-row').length===1);
    const pendingReturnMs=Date.now()-pendingReturnStart;
    const after=await page.evaluate(()=>({
      reviewOnly:document.getElementById('teacherApp').classList.contains('review-only'),
      historyReads:window.__reads.filter(p=>/^posukPractice\/chazara\/events\/[^/]+$/.test(p)).length,
      detached:window.__unsubscribed.filter(p=>/^posukPractice\/chazara\/events\/[^/]+$/.test(p)).length,
      pendingEventReads:window.__reads.filter(p=>p==='posukPractice/chazara/events/leib_wolf/rec1').length
    }));
    assert.equal(after.reviewOnly,true,'return to pending-only view');
    assert.equal(after.historyReads,fullHistoryReads,'return to pending does not subscribe to more complete histories');
    assert.equal(after.detached,0,'full-dashboard never attaches raw event-history subscriptions');
    assert.equal(after.historyReads,0,'no whole-student recording subtree is read directly');
    assert.ok(pendingEventCalls.filter(x=>x==='leib_wolf/rec1').length>=2,'return to pending reloads exact pending event via API');
    console.log('Chazara synthetic browser timings '+JSON.stringify({pendingLoadMs,historyLoadMs,pendingReturnMs,fullHistoryReads,pendingEventApiCalls:pendingEventCalls.length,historyApiCalls:historyCalls.length}));
  }finally{await browser?.close();server.close()}
});


test('Chazara pending and lazy-history reads stay within a teacher assigned to ET, even if API sends a WT row',{timeout:60000},async()=>{
  const scopedTree=structuredClone(tree);
  // A real assigned teacher can open Chazara only when the class explicitly grants it.
  // Keep the production access check enabled; the synthetic class must include the grant.
  scopedTree.b3Games.workspaces['b3-2026'].classes.et.toolGrants={chazara:true};
  scopedTree.b3Games.workspaces['b3-2026'].teachers={owner:{active:true,classIds:{et:true}}};
  scopedTree.b3Games.students.simcha_cohen={
    profile:{name:'Simcha',active:true},
    memberships:{
      a:{workspaceId:'b3-2026',classId:'et',active:true},
      b:{workspaceId:'b3-2026',classId:'wt',active:true}
    }
  };
  scopedTree.posukPractice.chazara.events.simcha_cohen.etold={
    recorded:true,reviewApplied:true,pointRequestStatus:'approved',teacherFullyChecked:true,
    workspaceClassId:'et',perek:18,posuk:4,createdAt:4
  };
  scopedTree.posukPractice.chazara.events.simcha_cohen.wtshared={
    recorded:true,reviewApplied:true,pointRequestStatus:'approved',teacherFullyChecked:true,
    workspaceClassId:'wt',perek:18,posuk:5,createdAt:5
  };
  scopedTree.posukPractice.chazara.events.simcha_cohen.etrec={
    recorded:true,reviewApplied:true,pointRequestStatus:'pending',
    workspaceClassId:'et',perek:18,posuk:3,createdAt:8
  };
  const scopedFirebaseStub=FIREBASE_STUB.replace(JSON.stringify(tree),JSON.stringify(scopedTree));
  const scopedSiteStub=SITE_STUB.replace("{authorized:true,role:'admin'}","{authorized:true,role:'teacher',classIds:['et']}");
  const server=await serve(),port=server.address().port;
  let browser;const historyCalls=[],pendingEventCalls=[];
  try{
    browser=await chromium.launch({executablePath:fs.existsSync('/opt/pw-browsers/chromium')?'/opt/pw-browsers/chromium':undefined}).catch(()=>chromium.launch());
    const page=await browser.newPage();
    await page.route(/gstatic\.com\/firebasejs\//,r=>r.fulfill({contentType:'text/javascript',body:''}));
    await page.route(/gstatic\.com\/firebasejs\/.*app-compat/,r=>r.fulfill({contentType:'text/javascript',body:scopedFirebaseStub}));
    await page.route(/site-settings\.js/,r=>r.fulfill({contentType:'text/javascript',body:scopedSiteStub}));
    await page.route(/private-media\.js/,r=>r.fulfill({contentType:'text/javascript',body:'window.B3PrivateMedia={setSource:async()=>{}}'}));
    await page.route(/cloudfunctions\.net\/studentRewardsAutoAward/,r=>{
      const body=JSON.parse(r.request().postData()||'{}');
      if(body.action==='get-chazara-event'){
        pendingEventCalls.push(body.studentId+'/'+body.eventId);
        const event=scopedTree.posukPractice.chazara.events[body.studentId]?.[body.eventId]||null;
        return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,event})});
      }
      if(body.action==='list-chazara-history'){
        historyCalls.push(body.studentId);
        const events=Object.fromEntries(Object.entries(scopedTree.posukPractice.chazara.events[body.studentId]||{}).filter(([,e])=>e.workspaceClassId==='et'));
        return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,events})});
      }
      if(body.action==='list-chazara-pending')return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,requests:[
        {id:'et-pending',status:'pending',source:'chazara-recording',amount:1,recorded:true,practiceStudentId:'simcha_cohen',eventId:'etrec',studentName:'Simcha',classId:'et',createdAt:8},
        {id:'wt-foreign',status:'pending',source:'chazara-recording',amount:1,recorded:true,practiceStudentId:'leib_wolf',eventId:'rec1',studentName:'Leib',classId:'wt',createdAt:9}
      ]})});
      return r.fulfill({contentType:'application/json',body:'{"ok":true}'});
    });
    await page.goto('http://127.0.0.1:'+port+'/chazara/teacher.html');
    await page.waitForFunction(()=>document.querySelectorAll('#recordingsList .recording-row').length===1,null,{timeout:15000});
    const startup=await page.evaluate(()=>({
      approvals:[...document.querySelectorAll('#approvalList .request-row')].map(r=>r.dataset.request),
      reads:window.__reads.filter(p=>p.startsWith('posukPractice/chazara/events/')),
      rows:[...document.querySelectorAll('#recordingsList .recording-row')].map(r=>r.dataset.eventKey),
      classOptions:[...document.querySelectorAll('#f option')].map(o=>o.value)
    }));
    assert.deepEqual(startup.approvals,['et-pending'],'foreign-class pending approvals must not appear');
    assert.deepEqual(startup.reads,[],'pending audio never bypasses scoped API');
    assert.deepEqual(pendingEventCalls,['simcha_cohen/etrec'],'only the assigned class pending event is fetched');
    assert.deepEqual(startup.rows,['simcha_cohen__etrec'],'only ET recording is displayed');
    assert.deepEqual(startup.classOptions,['','et'],'teacher has no WT class option');
    await page.selectOption('#recordingReviewFilter','checked');
    await page.waitForFunction(()=>document.querySelector('#recordingsList .recording-row [data-review-status]')?.textContent==='✓ Fully checked');
    const histories=await page.evaluate(()=>window.__reads.filter(p=>/^posukPractice\/chazara\/events\/[^/]+$/.test(p)));
    assert.deepEqual(histories,[],'explicit history must never download a raw mixed-class student subtree');
    assert.deepEqual(historyCalls,['simcha_cohen'],'history API queried only the assigned student');
    assert.equal(await page.locator('#recordingsList .recording-row').count(),1,'only the ET checked event is displayed');
    assert.equal(await page.locator('#recordingsList .recording-row').getAttribute('data-event-key'),'simcha_cohen__etold');
  }finally{await browser?.close();server.close()}
});
