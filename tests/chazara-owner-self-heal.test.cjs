const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('backend/functions/student-rewards-auto-award.js','utf8');
const slice=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b));
const code=slice('async function repairMissingChazaraPointRequests','async function approvePendingRequest')+slice('async function resolveRewardStudentId','async function verifyMilestone');
function setup(){
 const tree={posukPractice:{chazara:{events:{simcha_cohen:{e1:{reviewApplied:true,recorded:true,perek:1,posuk:2,workspaceClassId:'et'},e2:{reviewApplied:true,pointRequestStatus:'approved'}}}},allowedStudents:{}},studentRewards:{students:{rw1:{name:'Simcha',b3StudentId:'simcha_cohen'}},pointRequests:{}}};
 const at=p=>p.split('/').reduce((o,k)=>o?.[k],tree),created=[],updates=[];
 const snap=v=>({val:()=>v??null,exists:()=>v!=null,forEach(f){Object.entries(v||{}).forEach(([key,x])=>f({key,val:()=>x}))}});
 const rtdb={ref:p=>({get:async()=>snap(at(p)),update:async v=>{updates.push([p,v])},orderByChild(){throw new Error('Index not defined')}})};
 const ctx={rtdb,SR_ROOT:'studentRewards',POINTS:{chazara:1,'chazara-recording':2},safeKey:v=>String(v).replace(/[^A-Za-z0-9_-]/g,'-'),reasonFor:()=>'r',normalizeName:v=>String(v||'').toLowerCase().replace(/[^a-z0-9]/g,''),
  teacherClassScope:{recordAllowed:(s,id,r)=>s.owner&&!s.selected?!!s.students[id]:s.students[id]&&(r.workspaceClassId||'et')===s.students[id].classId},verifyChazara:async()=>({ok:true}),
  createPendingRequest:async r=>{created.push(r);tree.studentRewards.pointRequests[r.requestId]={status:'pending',practiceStudentId:r.studentId,source:r.source};return {status:'pending'}},
  isChazaraRequest:item=>['chazara','chazara-recording'].includes(String(item?.source||'')),
  isShorashimRequest:item=>['shorashim-recording','shorashim-no-hints'].includes(String(item?.source||'')),
  isMilestoneRequest:item=>['reading100','translation100','understand100'].includes(String(item?.source||'')),
  isReviewableRequest:item=>['chazara','chazara-recording','shorashim-recording','shorashim-no-hints','reading100','translation100','understand100'].includes(String(item?.source||'')),
  console:{error(...a){throw a[1]}},Object,Number,Date,String};
 vm.createContext(ctx);vm.runInContext(code,ctx);return {ctx,created,updates};
}
test('owner All-classes pending view never scans histories or silently repairs saved Chazaras',async()=>{
 const x=setup();const rows=await x.ctx.listPendingChazaraRequests(null);
 assert.equal(rows.length,0);assert.equal(x.created.length,0);assert.equal(x.updates.length,0);
});
test('class pending view never repairs saved Chazaras during ordinary startup',async()=>{
 const x=setup();const rows=await x.ctx.listPendingChazaraRequests({owner:false,selected:'et',students:{simcha_cohen:{classId:'et'}}});
 assert.equal(rows.length,0);assert.equal(x.created.length,0);assert.equal(x.updates.length,0);
});
test('explicit selected-class recovery restores a missing request without an index and is idempotent',async()=>{
 const x=setup(),scope={owner:false,selected:'et',students:{simcha_cohen:{classId:'et'}}};
 await x.ctx.repairMissingChazaraPointRequests(scope);
 assert.equal(x.created.length,1);assert.equal(x.created[0].rewardStudentId,'rw1');assert.equal(x.created[0].amount,2);
 assert.ok(x.updates.some(([p,v])=>p.endsWith('/e1')&&v.pointRequestStatus==='pending'));
 await x.ctx.repairMissingChazaraPointRequests(scope);
 assert.equal(x.created.length,1,'a second recovery must not create duplicate requests');
});
test('reward student lookup links by b3StudentId without a query index',async()=>{const x=setup();assert.equal(await x.ctx.resolveRewardStudentId('simcha_cohen'),'rw1')});
test('database-saved recordings with a codec in the audio type pass verification',async()=>{
 const code=slice('async function verifyChazara','async function studentInfo');
 const audio='data:audio/webm;codecs=opus;base64,'+'A'.repeat(2000);
 const ev={reviewApplied:true,recorded:true,durationMs:6688,soundDetected:true,sizeBytes:107739,audioDataURL:audio};
 const ctx={rtdb:{ref:()=>({get:async()=>({exists:()=>true,val:()=>ev})})},admin:{},console,Number,String};vm.createContext(ctx);vm.runInContext(code,ctx);
 assert.equal((await ctx.verifyChazara('s','chazara-recording','e')).ok,true);
 ev.audioDataURL='data:text/html;base64,'+'A'.repeat(2000);assert.equal((await ctx.verifyChazara('s','chazara-recording','e')).ok,false);
});
