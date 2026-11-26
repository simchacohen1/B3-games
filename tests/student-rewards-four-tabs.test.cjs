'use strict';
// Student Rewards teacher page: four tabs. Runs the page's real functions on sample data.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('student-rewards/teacher.js','utf8').replace(/\r\n/g,'\n');
const slice=(a,b)=>{const i=src.indexOf(a),j=src.indexOf(b,i);assert.ok(i>=0&&j>i,a);return src.slice(i,j)};
const same=(a,b)=>assert.equal(JSON.stringify(a),JSON.stringify(b));

test('exactly four tabs, and every old tab name still opens the place its content moved to',()=>{
  const ctx=vm.createContext({});
  vm.runInContext(slice('const OWNER_NAV=','const TEACHER_API=')+';this.api={OWNER_NAV,TEACHER_NAV,TAB_ALIASES}',ctx);
  same(ctx.api.OWNER_NAV,['Today','Students','Prize Store','Settings']);same(ctx.api.TEACHER_NAV,['Today','Students','Prize Store','Settings']);
  const A=ctx.api.TAB_ALIASES;
  same(A['Daily Points'],['Today']);same(A['Overview'],['Today']);same(A['Approvals'],['Today']);
  same(A['Points Dashboard'],['Students']);same(A['Reports'],['Students','reports']);
  same(A['Rewards'],['Prize Store']);
  same(A['Categories'],['Settings','categories']);same(A['Comments'],['Settings','comments']);same(A['People & Classes'],['Settings','classes']);
  for(const [name,[tab]] of Object.entries(A))assert.ok(ctx.api.OWNER_NAV.includes(tab),name+' maps to a real tab');
});

function classCtx(root,db){
  const C={activeClasses:r=>Object.values(r.classes||{}).filter(c=>c.active).sort((a,b)=>a.name.localeCompare(b.name)),
    classRoster:(r,id)=>Object.keys((r.enrollments||{})[id]||{}).filter(s=>r.enrollments[id][s]===true&&r.students?.[s]?.active).map(s=>r.students[s])};
  const ctx=vm.createContext({C,state:{root},vals:o=>o&&typeof o==='object'?Object.values(o):[],ROOT:'studentRewards',db:db||null});
  vm.runInContext(slice('function normalizeClassNames(root){','function roster(){')+';this.api={normalizeClassNames,allActiveClasses,activeClasses,changeBalance}',ctx);
  return ctx;
}
test('one clear name per class; an empty duplicate class is hidden instead of shown twice',()=>{
  const root={classes:{old:{id:'old',name:'ET',active:true,b3ClassId:'et'},big:{id:'big',name:'B3 ET',active:true},wt:{id:'wt',name:'B3 WT',active:true,b3ClassId:'wt'},cb3:{id:'cb3',name:'Class B3',active:true},b4:{id:'b4',name:'B4 WT · Afternoon',active:true,b3ClassId:'b4_wt_afternoon'}},
    students:{a:{active:true,name:'A'},b:{active:true,name:'B'},c:{active:true,name:'C'}},enrollments:{big:{a:true,b:true},wt:{c:true}}};
  const ctx=classCtx(root);
  ctx.api.normalizeClassNames(root);
  assert.equal(root.classes.old.name,'B3 ET');assert.equal(root.classes.wt.name,'B3 WT');assert.equal(root.classes.cb3.name,'B3');assert.equal(root.classes.b4.name,'B4 WT · Afternoon');
  assert.deepEqual([...ctx.api.activeClasses().map(c=>c.id)].sort(),['big','wt'],'old (empty), cb3 (empty) and b4 (empty) are hidden');
  assert.equal(ctx.api.allActiveClasses().length,5,'Settings still lists every class');
});

// A fake database whose balance transaction starts from null (a cold cache), like the real SDK.
function fakeDb(balance){
  const box={v:balance};
  const ref=path=>({once:async()=>({val:()=>path.endsWith('/rewardBalance')?box.v:null}),
    transaction:async fn=>{let n=fn(null);if(n===undefined)return {committed:false,snapshot:{val:()=>box.v}};if(box.v!==null&&box.v!==undefined){n=fn(box.v);if(n===undefined)return {committed:false,snapshot:{val:()=>box.v}}}box.v=n;return {committed:true,snapshot:{val:()=>box.v}}}});
  return {box,db:{ref}};
}
test('owner page: a balance that has not loaded is never treated as 0 (122 - 5 = 117, not -5)',async()=>{
  const {box,db}=fakeDb(122),ctx=classCtx({},db);
  const r=await ctx.api.changeBalance('s1',-5);
  assert.equal(box.v,117);assert.equal(r.before,122);assert.equal(r.applied,-5);assert.equal(r.balanceAfter,117);
});
test('owner page: clamp never raises a negative balance, and never takes a positive one below 0',async()=>{
  let f=fakeDb(-15),ctx=classCtx({},f.db);let r=await ctx.api.changeBalance('s1',3,{clamp:true});assert.equal(f.box.v,-12);assert.equal(r.applied,3);
  f=fakeDb(-5);ctx=classCtx({},f.db);r=await ctx.api.changeBalance('s1',-2,{clamp:true});assert.equal(f.box.v,-5);assert.equal(r.applied,0);
  f=fakeDb(2);ctx=classCtx({},f.db);r=await ctx.api.changeBalance('s1',-5,{clamp:true});assert.equal(f.box.v,0);assert.equal(r.applied,-2);
});
test('no balance write on the teacher page uses the old Number(cur||0) pattern',()=>{
  assert.doesNotMatch(src,/rewardBalance`\)\.transaction\(/,'every balance change goes through changeBalance');
});
test('history: contributions get a real Refund button for the owner, prizes show waiting / given / refunded',()=>{
  assert.match(src,/data-refund-contribution=/);
  assert.match(src,/function givePrize\(sid,key\)/);
  assert.match(src,/function prizeState\(status\)/);
  const ctx=vm.createContext({});vm.runInContext(slice('function prizeState(status){','function prizePill(kind)')+';this.api={prizeState}',ctx);
  for(const [st,want] of [['pending','waiting'],['ready','waiting'],['collected','given'],['declined','refunded'],['canceled','refunded'],['refunded','refunded'],[undefined,'waiting']])assert.equal(ctx.api.prizeState(st),want,String(st));
});

// Owner refund of a class contribution straight from the boy's history.
function treeDb(tree){
  const parts=p=>p.split('/').filter(Boolean),get=p=>parts(p).reduce((o,k)=>o==null?undefined:o[k],tree);
  const set=(p,v)=>{const k=parts(p);let o=tree;for(const x of k.slice(0,-1))o=o[x]??={};if(v==null)delete o[k.at(-1)];else o[k.at(-1)]=v};
  const clone=v=>v===undefined?null:JSON.parse(JSON.stringify(v));
  return {tree,db:{ref:p=>({once:async()=>({val:()=>clone(get(p))}),update:async v=>{for(const [k,x] of Object.entries(v))set(p+'/'+k,x)},set:async v=>set(p,v),
    transaction:async fn=>{const cur=clone(get(p));const n=fn(cur);if(n===undefined)return {committed:false,snapshot:{val:()=>clone(get(p))}};set(p,n);return {committed:true,snapshot:{val:()=>clone(get(p))}}}})}};
}
test('owner refunds a class contribution: points back, bar reduced, history marked, nothing done twice',async()=>{
  const now=Date.now();
  const {tree,db}=treeDb({studentRewards:{students:{s1:{rewardBalance:10}},
    classRewardRounds:{c1:{gimkit:{byStudent:{s1:30},totalContributed:30,goalPoints:400,startedAt:now-1e6,modeVoting:true,modeTotals:{m1:30},modeVoters:{m1:{s1:true}}}}},
    classRewardContributionsByStudent:{s1:{k1:{amount:30,classId:'c1',rewardId:'gimkit',rewardName:'Gimkit',createdAt:now-5e5,modeAllocations:{m1:30},modeNames:['M1']}}}}});
  const state={teacherMode:false,user:{email:'owner@x'},root:{students:{s1:{name:'Boy'}},classRewardContributionsByStudent:tree.studentRewards.classRewardContributionsByStudent,classes:{c1:{name:'B3 ET'}},rewards:{}}};
  const toasts=[];
  const ctx=vm.createContext({state,db,ROOT:'studentRewards',toast:(m,t)=>toasts.push([m,t]),confirm:()=>true,now:()=>new Date().toISOString(),timeMs:v=>Number(v)||Date.parse(v)||0,
    pointClassName:id=>state.root.classes[id]?.name||id,Math,Object,Number,String,Date,Array,console,loadRoot:async()=>{},render:()=>{}});
  const code=slice('function refundItemInfo(sid,key,kind){','function refundRequestRow(x){')+slice('async function removeContributionFromRound(','async function decideRefund(')+slice('async function changeBalance(','function roster(){')+slice('async function refundContributionNow(sid,key){','// "Give" on a prize waiting');
  vm.runInContext(code+';this.api={refundContributionNow}',ctx);
  await ctx.api.refundContributionNow('s1','k1');
  const sr=tree.studentRewards;
  assert.equal(sr.students.s1.rewardBalance,40,'30 points returned');
  assert.equal(sr.classRewardRounds.c1.gimkit.byStudent.s1,0,'taken off the class bar');
  assert.equal(sr.classRewardRounds.c1.gimkit.modeTotals.m1,0);
  assert.ok(sr.classRewardContributionsByStudent.s1.k1.refundedAt,'marked refunded');
  assert.equal(sr.classRewardContributionsByStudent.s1.k1.refundedBy,'owner@x');
  assert.equal(sr.refundRequests.s1.k1.status,'approved');
  await ctx.api.refundContributionNow('s1','k1');
  assert.equal(sr.students.s1.rewardBalance,40,'a second press never refunds twice');
  assert.ok(toasts.some(t=>/already refunded/.test(t[0])));
  state.teacherMode=true;await ctx.api.refundContributionNow('s1','k1');
  assert.ok(toasts.some(t=>/Only the administrator/.test(t[0])),'teachers cannot do it');
});
