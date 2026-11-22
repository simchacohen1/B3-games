const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const purchase=require('../backend/functions/rewards-purchase-core.cjs');
const {cancelRedemption}=require('../backend/functions/rewards-cancel-core.cjs');

function db(tree,{failTxOn}={}){
 const parts=p=>p.split('/').filter(Boolean);
 const get=async p=>{const v=parts(p).reduce((o,k)=>o?.[k],tree);return v===undefined?null:structuredClone(v)};
 const set=(p,v)=>{const k=parts(p),last=k.pop();let o=tree;for(const x of k)o=o[x]??=({});if(v===null)delete o[last];else o[last]=structuredClone(v)};
 return {tree,get,update:async u=>{for(const [p,v] of Object.entries(u))set(p,v)},
  tx:async(p,f)=>{if(failTxOn&&p.endsWith(failTxOn))throw new Error('network');const v=f(await get(p));if(v!==undefined)set(p,v);return {committed:v!==undefined,snapshot:{val:()=>v===undefined?null:v}}}};
}
const NOW=1_700_000_000_000;
const world=(extra={})=>db({studentRewards:{students:{s1:{name:'A',rewardBalance:100}},rewards:{r1:{name:'Candy',cost:30,quantity:3}},redemptionsByStudent:{},...extra}});

test('charge takes the points and leaves a marker in one write',async()=>{
 const d=world();const r=await purchase.charge(d,'s1','p1',{rewardId:'r1',cost:30,quantityReserved:true},NOW);
 assert.deepEqual([r.ok,r.balance],[true,70]);
 const s=d.tree.studentRewards.students.s1;assert.equal(s.rewardBalance,70);assert.deepEqual(s.pendingCharges.p1,{rewardId:'r1',cost:30,quantityReserved:true,at:NOW});
});
test('not enough points: nothing changes, no marker',async()=>{
 const d=world();const r=await purchase.charge(d,'s1','p1',{rewardId:'r1',cost:500},NOW);
 assert.deepEqual([r.ok,r.insufficient],[false,true]);assert.equal(d.tree.studentRewards.students.s1.rewardBalance,100);assert.equal(d.tree.studentRewards.students.s1.pendingCharges,undefined);
});
test('confirm clears the marker and keeps the deduction',async()=>{
 const d=world();await purchase.charge(d,'s1','p1',{rewardId:'r1',cost:30},NOW);await purchase.confirm(d,'s1','p1');
 const s=d.tree.studentRewards.students.s1;assert.equal(s.rewardBalance,70);assert.equal(s.pendingCharges,undefined);
});
test('refund returns the points exactly once',async()=>{
 const d=world();await purchase.charge(d,'s1','p1',{rewardId:'r1',cost:30},NOW);
 const a=await purchase.refund(d,'s1','p1'),b=await purchase.refund(d,'s1','p1');
 assert.deepEqual([a.removed,a.refunded,b.removed,b.refunded],[true,30,false,0]);assert.equal(d.tree.studentRewards.students.s1.rewardBalance,100);
});
test('a purchase that died after the charge (no request saved) is refunded and restocked by repair',async()=>{
 const d=world();await purchase.charge(d,'s1','lost',{rewardId:'r1',cost:30,quantityReserved:true},NOW);d.tree.studentRewards.rewards.r1.quantity=2;
 const early=await purchase.repair(d,'s1',NOW+60_000);
 assert.deepEqual([early.cleared,early.refunded],[0,0],'still running: left alone');assert.equal(d.tree.studentRewards.students.s1.rewardBalance,70);
 const late=await purchase.repair(d,'s1',NOW+purchase.STALE_MS+1);
 assert.deepEqual([late.cleared,late.refunded],[1,30]);
 const s=d.tree.studentRewards.students.s1;assert.equal(s.rewardBalance,100);assert.equal(s.pendingCharges,undefined);assert.equal(d.tree.studentRewards.rewards.r1.quantity,3);
 const again=await purchase.repair(d,'s1',NOW+purchase.STALE_MS+2);assert.equal(again.refunded,0);assert.equal(d.tree.studentRewards.students.s1.rewardBalance,100);
});
test('a purchase whose request WAS saved only has its marker cleared (the prize stands, no refund)',async()=>{
 const d=world();await purchase.charge(d,'s1','ok',{rewardId:'r1',cost:30,quantityReserved:true},NOW);
 d.tree.studentRewards.redemptionsByStudent.s1={ok:{id:'ok',rewardId:'r1',cost:30,status:'pending'}};
 const r=await purchase.repair(d,'s1',NOW+purchase.STALE_MS+1);
 assert.deepEqual([r.cleared,r.refunded],[1,0]);const s=d.tree.studentRewards.students.s1;assert.equal(s.rewardBalance,70);assert.equal(s.pendingCharges,undefined);
});
test('a lost limited-stock purchase restocks only once even if repair runs twice',async()=>{
 const d=world();d.tree.studentRewards.rewards.r1.quantity=5;
 await purchase.charge(d,'s1','lost',{rewardId:'r1',cost:10,quantityReserved:true},NOW);
 await purchase.repair(d,'s1',NOW+purchase.STALE_MS+1);await purchase.repair(d,'s1',NOW+purchase.STALE_MS+2);
 assert.equal(d.tree.studentRewards.rewards.r1.quantity,6);
});
test('bad ids are refused',async()=>{await assert.rejects(purchase.charge(world(),'s1','../x',{cost:1}),{code:400});assert.deepEqual(await purchase.repair(world(),'../x'),{cleared:0,refunded:0})});

test('canceling: if the refund fails the request goes back to pending instead of being lost',async()=>{
 const T='2026-10-08T15:00:00.000Z';
 const d=db({studentRewards:{students:{s1:{rewardBalance:10}},rewards:{},redemptionsByStudent:{s1:{q1:{id:'q1',rewardId:'r1',cost:25,status:'pending',requestedAt:T}}}}},{failTxOn:'/rewardBalance'});
 await assert.rejects(cancelRedemption(d,'s1','q1'),/network/);
 assert.equal(d.tree.studentRewards.redemptionsByStudent.s1.q1.status,'pending');assert.equal(d.tree.studentRewards.students.s1.rewardBalance,10);
});

test('the redeem function charges first-with-marker and no longer deducts before saving',()=>{
 const s=fs.readFileSync('backend/functions/student-rewards-functions.js','utf8').replace(/\r\n/g,'\n');
 const iCharge=s.indexOf('purchase.charge('),iSet=s.indexOf('await requestRef.set('),iConfirm=s.indexOf('purchase.confirm(');
 assert.ok(iCharge>0&&iCharge<iSet&&iSet<iConfirm,'charge -> save request -> confirm');
 assert.ok(!/balanceRef/.test(s),'no raw balance deduction left in redeem');
 assert.ok(s.includes('purchase.repair('),'repair runs');
});
test('the teacher decline path puts the request back if the refund fails',()=>{
 const s=fs.readFileSync('backend/functions/rewards-teacher-core.cjs','utf8');
 assert.ok(/try\{await addToBalance[\s\S]*cur==='declined'\?'pending'/.test(s));
});

test('the stock transaction does not read a cold first pass as sold out',()=>{
 const src=require('node:fs').readFileSync('backend/functions/student-rewards-functions.js','utf8');
 const tx=src.slice(src.indexOf('/quantity`).transaction(current => {'),src.indexOf('stockReserved = true;'));
 assert.match(tx,/if \(current === null\) return 0;/);
 assert.ok(tx.indexOf('current === null')<tx.indexOf('soldOut = true'));
});
