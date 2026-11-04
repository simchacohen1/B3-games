// Teacher approval system (2026-10-21): Posuk Practice milestones are automatic,
// every teacher screen uses one queue rule, and Approve All stays available.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Q=require('../approval-queue.js');

const requests={
  c1:{status:'pending',source:'chazara',classId:'et',createdAt:3},
  c2:{status:'pending',source:'chazara-recording',classId:'wt',createdAt:4},
  m1:{status:'pending',source:'reading100',classId:'et',createdAt:5},
  m2:{status:'pending',source:'translation100',classId:'wt',createdAt:6},
  m3:{status:'approved',source:'understand100',classId:'et'},
  s1:{status:'pending',source:'shorashim-recording',classId:'et',createdAt:2},
  old:{status:'approved',source:'chazara',classId:'et'},
  rej:{status:'rejected',source:'chazara-recording',classId:'wt'},
};

test('Posuk Practice milestones never count as manual approvals',()=>{
  for(const s of ['reading100','translation100','understand100']){
    assert.equal(Q.isAutomaticPosukMilestone({source:s}),true);
    assert.equal(Q.needsManualApproval({status:'pending',source:s}),false);
  }
  assert.deepEqual(Q.automaticQueue(requests).map(x=>x.id).sort(),['m1','m2']);
});

test('recordings and Chazara still require approval',()=>{
  assert.equal(Q.needsManualApproval(requests.c1),true);
  assert.equal(Q.needsManualApproval(requests.c2),true);
  assert.equal(Q.needsManualApproval(requests.s1),true);
  assert.equal(Q.needsManualApproval(requests.old),false,'already approved stays approved');
  assert.equal(Q.needsManualApproval(requests.rej),false,'rejected stays rejected');
});

test('Chazara queue is identical for every screen and keeps ET and WT separate',()=>{
  const chazara=Q.manualQueue(requests,Q.isChazaraApproval);
  assert.deepEqual(chazara.map(x=>x.id),['c2','c1'],'newest first, Chazara only');
  assert.deepEqual(Q.countByClass(chazara.map(x=>x.item)),{et:1,wt:1});
  assert.deepEqual(Q.manualQueue(requests).map(x=>x.id),['c2','c1','s1']);
  assert.deepEqual(Q.countByClass([{className:'B3 WT'}],x=>({'B3 WT':'wt'})[x.className]),{wt:1});
});

test('every teacher approval screen loads the shared queue rule',()=>{
  const home=fs.readFileSync('index.html','utf8'),chazara=fs.readFileSync('chazara/teacher.html','utf8');
  const rewardsHtml=fs.readFileSync('student-rewards/teacher.html','utf8'),rewardsJs=fs.readFileSync('student-rewards/teacher.js','utf8');
  assert.match(home,/<script src="approval-queue\.js/);
  assert.match(chazara,/<script src="\.\.\/approval-queue\.js/);
  assert.match(rewardsHtml,/<script src="\.\.\/approval-queue\.js[^>]*><\/script>\s*<script src="teacher\.js/);
  assert.doesNotMatch(home,/key:"posukPoints"/,'no Posuk Practice points line in the popup');
  assert.match(home,/Q\.manualQueue\(data\.pointRequests,Q\.isChazaraApproval\)/);
  assert.match(chazara,/Q\.needsManualApproval\(item\)&&Q\.isChazaraApproval\(item\)/);
  assert.match(rewardsJs,/Q\.needsManualApproval\(x\.item\)/);
});

test('Approve All is wired for pending items on Chazara and Student Rewards',()=>{
  const chazara=fs.readFileSync('chazara/teacher.html','utf8'),rewards=fs.readFileSync('student-rewards/teacher.js','utf8');
  assert.match(chazara,/id="approveAllBtn"/);
  assert.match(chazara,/id="recordingsApproveAllBtn"/);
  assert.match(chazara,/\$\("approveAllBtn"\)\.onclick=/);
  assert.doesNotMatch(chazara,/#teacherApp\.review-only>#approvalPanel/,'pending approvals are visible in the default review view');
  assert.match(chazara,/refreshScopedViews\(\);await loadApprovals\(\);/,'pending approvals load without opening the full dashboard');
  assert.match(rewards,/id="approveAllActivity">Approve all/);
  assert.match(rewards,/\$\("#approveAllActivity"\)\.onclick=approveAllActivityPoints/);
});

test('pending-only Chazara uses scoped API; history needs an explicit filter or dashboard request',()=>{
  const chazara=fs.readFileSync('chazara/teacher.html','utf8');
  assert.match(chazara,/fullDashboardLoaded\?\[\['posukPractice\/chazara\/students',D\],\['posukPractice\/attempts',P\]\]:\[\]/,
    'default teacher sign-in must not subscribe to complete recording histories');
  assert.match(chazara,/teacherApi\('list-chazara-pending'\)/,
    'pending requests are read through the authorized API');
  assert.match(chazara,/teacherApi\('get-chazara-event',\{studentId,eventId\}\)/,
    'startup loads only the exact pending event through the scoped API');
  assert.match(chazara,/teacherApi\('list-chazara-history',\{studentId:id\}\)/,
    'historical recordings are fetched only on explicit request');
  assert.doesNotMatch(chazara,/db\.ref\('posukPractice\/chazara\/events\//,
    'teacher UI never reads complete student recording subtrees directly');
  assert.match(chazara,/if\(recordingFilters\(\)\.review==='pending'\)\{historyGeneration\+\+;historyLoading=false;renderRecordings\(\);return\}/,
    'returning to pending cancels in-flight history work');
  assert.match(chazara,/<option value="pending" selected>Awaiting point approval<\/option>/);
});

// ---- Backend: automatic milestone approval (idempotent, preserves history) ----
const src=fs.readFileSync('backend/functions/student-rewards-auto-award.js','utf8');
const slice=(a,b)=>{const i=src.indexOf(a),j=src.indexOf(b,i);assert.ok(i>=0&&j>i,a);return src.slice(i,j)};
function backend(tree){
  const parts=p=>p.split('/').filter(Boolean);
  const get=p=>parts(p).reduce((o,k)=>o==null?undefined:o[k],tree);
  const set=(p,v)=>{const k=parts(p);let o=tree;for(const x of k.slice(0,-1))o=o[x]??=({});if(v===null||v===undefined)delete o[k.at(-1)];else o[k.at(-1)]=v};
  const snap=v=>({val:()=>v===undefined?null:JSON.parse(JSON.stringify(v)),exists:()=>v!=null,forEach(f){Object.entries(v||{}).forEach(([key,x])=>f({key,val:()=>x}))}});
  const rtdb={ref:p=>({get:async()=>snap(get(p)),update:async v=>{for(const [k,x] of Object.entries(v)){if(x===null)set(p+'/'+k,null);else set(p+'/'+k,x)}},set:async v=>set(p,v),
    transaction:async fn=>{const cur=get(p);const next=fn(cur===undefined?null:JSON.parse(JSON.stringify(cur)));if(next===undefined)return{committed:false,snapshot:snap(get(p))};set(p,next);return{committed:true,snapshot:snap(next)}}})};
  const code=slice('const AUTOMATIC_MILESTONE_REVIEWER','async function rejectPendingRequest')+slice('async function mirrorChazaraPointStatus','async function repairMissingChazaraPointRequests');
  const ctx={rtdb,SR_ROOT:'studentRewards',console,Object,Number,String,Date,
    isMilestoneRequest:i=>['reading100','translation100','understand100'].includes(String(i?.source||'')),
    isShorashimRequest:i=>['shorashim-recording','shorashim-no-hints'].includes(String(i?.source||'')),
    isRashiRequest:i=>String(i?.source||'')==='rashi-recording',rashiCore:{RASHI_POINTS:2},
    isReviewableRequest:i=>['chazara','chazara-recording','shorashim-recording','shorashim-no-hints','reading100','translation100','understand100'].includes(String(i?.source||''))};
  vm.createContext(ctx);vm.runInContext(code,ctx);return ctx;
}
function tree(){return {studentRewards:{students:{rw1:{rewardBalance:10}},pointRequests:{
  m1:{id:'m1',status:'pending',source:'reading100',amount:3,rewardStudentId:'rw1',practiceStudentId:'s1'},
  m2:{id:'m2',status:'approved',source:'translation100',amount:5,actualAmount:5,rewardStudentId:'rw1',reviewedBy:'teacher@x'},
  m3:{id:'m3',status:'rejected',source:'understand100',amount:3,rewardStudentId:'rw1'},
  c1:{id:'c1',status:'pending',source:'chazara',amount:1,rewardStudentId:'rw1'}}}}}

test('backend pays a verified milestone once, automatically',async()=>{
  const t=tree(),ctx=backend(t);
  const r=await ctx.approveAutomaticMilestone('m1');
  assert.equal(r.status,'approved');assert.equal(t.studentRewards.students.rw1.rewardBalance,13);
  assert.equal(t.studentRewards.pointRequests.m1.reviewedBy,'Automatic: Posuk Practice milestone');
  assert.equal(t.studentRewards.pointRequests.m1.approvedAutomatically,true);
  const again=await ctx.approveAutomaticMilestone('m1');
  assert.equal(again.alreadyHandled,true);assert.equal(t.studentRewards.students.rw1.rewardBalance,13,'never paid twice');
});

test('backend sweep leaves existing approvals, rejections and Chazara untouched',async()=>{
  const t=tree(),ctx=backend(t),before=JSON.parse(JSON.stringify(t.studentRewards.pointRequests));
  const rows=Object.entries(t.studentRewards.pointRequests).filter(([,x])=>x.status==='pending').map(([id,x])=>({id,...x}));
  const manual=await ctx.sweepPendingMilestones(rows);
  assert.deepEqual([...manual].map(x=>x.id),['c1'],'only the Chazara request is returned for teacher review');
  assert.deepEqual(t.studentRewards.pointRequests.m2,before.m2);
  assert.deepEqual(t.studentRewards.pointRequests.m3,before.m3);
  assert.deepEqual(t.studentRewards.pointRequests.c1,before.c1);
  assert.equal(t.studentRewards.pointRequests.m1.status,'approved');
  assert.equal(t.studentRewards.students.rw1.rewardBalance,13);
});

test('backend milestone route returns approved points to the student page',()=>{
  const route=slice('const result=await createPendingRequest({requestId,rewardStudentId,studentId,source,amount,reason,record});','if(shorashimVerification?.eventRef)');
  assert.match(route,/isMilestoneRequest\(\{source\}\)&&result\.status==="pending"/);
  assert.match(route,/approveAutomaticMilestone\(requestId\)/);
  assert.match(route,/status:"approved"/);
  const student=fs.readFileSync('record_pesukim/student.html','utf8');
  assert.match(student,/data\.awarded && data\.status === 'approved' \? Number\(data\.amount \|\| 0\) : 0/);
});

test('owner can reach the Student Rewards Approvals tab (activity points, Approve All, refunds)',()=>{
  const js=fs.readFileSync('student-rewards/teacher.js','utf8');
  const owner=js.match(/OWNER_NAV=(\[[^\]]*\])/);assert.ok(owner);
  assert.ok(JSON.parse(owner[1]).includes('Approvals'),'owner navigation lists Approvals');
  const approvals=js.slice(js.indexOf('if(state.tab==="Approvals"){'),js.indexOf('if(state.tab==="Approvals"){')+900);
  assert.match(approvals,/approveAllActivityPoints/);
  assert.match(approvals,/\[data-refund-approve\]/,'refund buttons work on the Approvals tab');
  assert.match(js,/data-go="Approvals"/);
});

test('homepage shows class names (ET / WT), not internal class ids',()=>{
  const home=fs.readFileSync('index.html','utf8');
  assert.match(home,/\["rewardClasses",db\.ref\("studentRewards\/classes"\)\.once\("value"\)\]/);
  const fn=home.slice(home.indexOf('function approvalClassSplitText'),home.indexOf('function approvalClassFallback'));
  const ctx={approvalClassNames:{'class-34056e86':'B3 ET','class-b3-wt':'B3 WT'}};
  const f=vm.runInNewContext('('+fn.replace('function approvalClassSplitText','function')+')',ctx);
  assert.equal(f({'class-b3-wt':2,'class-34056e86':1}),'(ET 1 · WT 2)');
});
