const test=require('node:test'),assert=require('node:assert/strict');
const {cancelRedemption}=require('../backend/functions/rewards-cancel-core.cjs');
function db(tree){
 const parts=p=>p.split('/').filter(Boolean);
 const get=async p=>{const v=parts(p).reduce((o,k)=>o?.[k],tree);return v===undefined?null:structuredClone(v)};
 const set=(p,v)=>{const k=parts(p),last=k.pop();let o=tree;for(const x of k)o=o[x]??=({});if(v===null)delete o[last];else o[last]=structuredClone(v)};
 return {tree,get,update:async u=>{for(const [p,v] of Object.entries(u))set(p,v)},tx:async(p,f)=>{const v=f(await get(p));if(v!==undefined)set(p,v);return {committed:v!==undefined,snapshot:{val:()=>v}}}};
}
const T='2026-10-08T15:00:00.000Z';
const seed=(status='pending',extra={})=>db({studentRewards:{
 students:{s1:{rewardBalance:10}},
 rewards:{r1:{name:'Candy',cost:25,quantity:4,lastRedeemedAt:Date.parse(T),cooldownUntil:Date.parse(T)+86400000}},
 redemptionsByStudent:{s1:{q1:{id:'q1',studentId:'s1',rewardId:'r1',cost:25,status,requestedAt:T,quantityReserved:true,...extra}},s2:{q2:{id:'q2',rewardId:'r1',cost:25,status:'pending',requestedAt:T}}}}});

test('a pending request is canceled, refunded, restocked and its cooldown cleared',async()=>{const d=seed();
 const r=await cancelRedemption(d,'s1','q1');
 assert.deepEqual([r.status,r.refunded,r.balance],['canceled',25,35]);
 const sr=d.tree.studentRewards;assert.equal(sr.redemptionsByStudent.s1.q1.status,'canceled');assert.equal(sr.students.s1.rewardBalance,35);
 assert.equal(sr.rewards.r1.quantity,5);assert.equal(sr.rewards.r1.cooldownUntil,undefined)});
test('canceling twice never refunds twice',async()=>{const d=seed();await cancelRedemption(d,'s1','q1');
 await assert.rejects(cancelRedemption(d,'s1','q1'),{code:409});assert.equal(d.tree.studentRewards.students.s1.rewardBalance,35)});
for(const st of ['ready','collected','declined'])test(`a ${st} request cannot be canceled`,async()=>{const d=seed(st);
 await assert.rejects(cancelRedemption(d,'s1','q1'),{code:409});assert.equal(d.tree.studentRewards.students.s1.rewardBalance,10)});
test('a student cannot cancel another student\'s request',async()=>{const d=seed();
 await assert.rejects(cancelRedemption(d,'s1','q2'),{code:404});assert.equal(d.tree.studentRewards.redemptionsByStudent.s2.q2.status,'pending')});
test('unlimited rewards are not restocked',async()=>{const d=seed('pending',{quantityReserved:false});d.tree.studentRewards.rewards.r1.quantity=-1;
 await cancelRedemption(d,'s1','q1');assert.equal(d.tree.studentRewards.rewards.r1.quantity,-1)});
test('bad request ids are refused',async()=>{await assert.rejects(cancelRedemption(seed(),'s1','../x'),{code:400})});
