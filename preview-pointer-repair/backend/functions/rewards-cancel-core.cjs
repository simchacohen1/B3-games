'use strict';
// Lets a student cancel his own Prize Store request while it is still pending.
// The status is claimed with a transaction first so a cancel can never race a
// teacher's approve/decline into a double refund.
const SR='studentRewards';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const key=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(s);

async function cancelRedemption(store,studentId,requestId,nowMs=Date.now()){
 if(!key(studentId))fail(403,'Student sign-in required.');
 if(!key(requestId))fail(400,'Choose a request to cancel.');
 const path=`${SR}/redemptionsByStudent/${studentId}/${requestId}`;
 const now=new Date(nowMs).toISOString();
 let found=false,status='';
 const claim=await store.tx(path,current=>{
  if(!current)return;
  found=true;status=String(current.status||'pending');
  if(status!=='pending')return;
  return {...current,status:'canceled',canceledAt:now,reviewedAt:now,reviewedBy:'student'};
 });
 if(!claim?.committed){
  if(!found)fail(404,'That request no longer exists.');
  fail(409,status==='canceled'?'That request was already canceled.':'Your teacher already handled that request, so it can no longer be canceled.');
 }
 const item=claim.snapshot.val()||{},cost=Math.max(0,Number(item.cost||0));
 let balance=0;
 if(cost){
  const r=await store.tx(`${SR}/students/${studentId}/rewardBalance`,cur=>Number(cur||0)+cost);
  balance=Number(r?.snapshot?.val?.()??0);
 }
 // Give back the reserved stock and clear the cooldown this purchase started.
 const rewardPath=`${SR}/rewards/${item.rewardId}`;
 const reward=item.rewardId&&key(String(item.rewardId))?await store.get(rewardPath):null;
 if(reward){
  const reservedStock=item.quantityReserved===true||(item.quantityReserved===undefined&&Number.isFinite(Number(reward.quantity))&&Number(reward.quantity)>=0);
  if(reservedStock)await store.tx(`${rewardPath}/quantity`,cur=>{const n=Number(cur);return Number.isFinite(n)&&n>=0?n+1:undefined});
  const t=v=>typeof v==='number'?v:(Date.parse(v||'')||Number(v)||0);
  const requestMs=t(item.requestedAt),lastMs=t(reward.lastRedeemedAt);
  if(requestMs&&lastMs&&Math.abs(requestMs-lastMs)<5000)await store.update({[`${rewardPath}/lastRedeemedAt`]:null,[`${rewardPath}/cooldownUntil`]:null});
 }
 return {ok:true,status:'canceled',refunded:cost,balance};
}
module.exports={cancelRedemption};
