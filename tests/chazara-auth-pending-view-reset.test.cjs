'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

// Run the actual auth callback from the Chazara page with fictional accounts.
// No Firebase, real student data, or network calls are involved.
const html=fs.readFileSync(require('node:path').join(__dirname,'../chazara/teacher.html'),'utf8');
const start=html.indexOf('let lastChazaraAuthUid=null;');
const end=html.indexOf('// Re-check the teacher\'s classes',start);
assert.ok(start>=0&&end>start,'per-account Chazara auth callback must exist');
const resetStart=html.indexOf('function resetChazaraHistoryView(){');
const resetStop=html.indexOf('\n}',resetStart)+2;
assert.ok(resetStart>=0&&resetStop>resetStart,'shared pending-only reset must exist');
const source=html.slice(resetStart,resetStop)+'\n'+html.slice(start,end);

function fixture(){
 const nodes=Object.fromEntries(['teacherApp','showFullDashboard','showPendingOnly','recordingReviewFilter'].map(id=>{
  const classes=new Set(id==='teacherApp'?['review-only']:id==='showPendingOnly'?['hidden']:[]);
  return [id,{value:id==='recordingReviewFilter'?'pending':'',classes,
   classList:{add:c=>classes.add(c),remove:c=>classes.delete(c)}}];
 }));
 let callback;
 const calls=[];
 const context={fullDashboardLoaded:false,
  $:id=>nodes[id],
  window:{B3SiteSettings:{onAuthStateChanged:fn=>{callback=fn}}},
  loadClassScope:(user,access)=>{calls.push({uid:user?.uid||null,full:context.fullDashboardLoaded,review:nodes.recordingReviewFilter.value,access});return Promise.resolve()}
 };
 vm.runInNewContext(source,context);
 return {nodes,context,calls,auth:(uid,authorized=true)=>callback(uid?{uid}:null,authorized,{authorized})};
}
function openFull(x){
 x.context.fullDashboardLoaded=true;
 x.nodes.teacherApp.classes.delete('review-only');
 x.nodes.showFullDashboard.classes.add('hidden');
 x.nodes.showPendingOnly.classes.delete('hidden');
 x.nodes.recordingReviewFilter.value='checked';
}

test('a different Google account starts in pending-only mode even if the previous teacher opened full history',async()=>{
 const x=fixture();
 await x.auth('teacher_alpha');
 openFull(x);
 await x.auth('teacher_beta');
 assert.equal(x.context.fullDashboardLoaded,false);
 assert.equal(x.nodes.recordingReviewFilter.value,'pending');
 assert.ok(x.nodes.teacherApp.classes.has('review-only'));
 assert.ok(!x.nodes.showFullDashboard.classes.has('hidden'));
 assert.ok(x.nodes.showPendingOnly.classes.has('hidden'));
 assert.equal(x.calls.at(-1).uid,'teacher_beta');
 assert.equal(x.calls.at(-1).full,false,'new account must not subscribe to full histories on initial load');
});

test('an authorization refresh for the same Google UID preserves its explicit full-dashboard choice',async()=>{
 const x=fixture();
 await x.auth('teacher_alpha');
 openFull(x);
 await x.auth('teacher_alpha');
 assert.equal(x.context.fullDashboardLoaded,true);
 assert.equal(x.nodes.recordingReviewFilter.value,'checked');
 assert.equal(x.calls.at(-1).full,true);
});

test('sign-out then sign-in resets full-history mode even when the same account returns',async()=>{
 const x=fixture();
 await x.auth('teacher_alpha');
 openFull(x);
 await x.auth(null,false);
 assert.equal(x.context.fullDashboardLoaded,false);
 openFull(x);
 await x.auth('teacher_alpha');
 assert.equal(x.context.fullDashboardLoaded,false);
 assert.equal(x.calls.at(-1).full,false);
});
