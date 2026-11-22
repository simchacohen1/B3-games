'use strict';
// Prize Store purchases that can never take points without a prize record.
//
// Before: the function deducted the balance first and wrote the purchase
// record last. If it died in between (timeout, crash, network), the points
// were gone and no request existed anywhere.
//
// Now the deduction and a durable marker are ONE atomic write on the student
// node (rewardBalance + pendingCharges/<purchaseId>). The purchase record is
// written next and the marker is cleared last. At every step the money is
// accounted for:
//   - crash after the charge, before the record  -> marker without a record:
//     repair() gives the points back (and the reserved stock);
//   - crash after the record, before clearing    -> marker with a record:
//     repair() just clears the marker (the prize request stands);
//   - refund happens inside the same atomic write that removes the marker, so
//     a charge can only ever be returned once.
//
// store.get(path)            -> value
// store.tx(path, fn)         -> RTDB-style transaction ({committed, snapshot})
const SR='studentRewards';
const STALE_MS=5*60*1000;
const key=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(s);
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0;};
const studentPath=id=>`${SR}/students/${id}`;

// Deduct `cost` and record the marker in one atomic step.
async function charge(store,studentId,purchaseId,{rewardId,cost,quantityReserved=false},nowMs=Date.now()){
  if(!key(studentId)||!key(purchaseId))throw Object.assign(new Error('Invalid purchase.'),{code:400});
  cost=Math.max(0,num(cost));
  let insufficient=false;
  const tx=await store.tx(studentPath(studentId),cur=>{
    // A cold transaction may start with null; returning null makes Firebase retry with the real value.
    if(cur===null)return null;
    const balance=num(cur.rewardBalance);
    if(balance<cost){insufficient=true;return;}
    return {...cur,rewardBalance:balance-cost,pendingCharges:{...(cur.pendingCharges||{}),[purchaseId]:{rewardId:String(rewardId||''),cost,quantityReserved:quantityReserved===true,at:nowMs}}};
  });
  if(!tx||!tx.committed||tx.snapshot.val()===null)return {ok:false,insufficient};
  return {ok:true,balance:num(tx.snapshot.val().rewardBalance)};
}

// Give the charge back, once. Atomic with removing the marker.
async function refund(store,studentId,purchaseId){
  let refunded=0,removed=false;
  const tx=await store.tx(studentPath(studentId),cur=>{
    if(cur===null)return null;
    const m=cur.pendingCharges&&cur.pendingCharges[purchaseId];
    if(!m){refunded=0;removed=false;return;}
    removed=true;
    refunded=Math.max(0,num(m.cost));
    const left={...cur.pendingCharges};delete left[purchaseId];
    const next={...cur,rewardBalance:num(cur.rewardBalance)+refunded};
    if(Object.keys(left).length)next.pendingCharges=left;else delete next.pendingCharges;
    return next;
  });
  const done=!!(tx&&tx.committed&&removed);
  return {removed:done,refunded:done?refunded:0,balance:tx&&tx.committed&&tx.snapshot.val()?num(tx.snapshot.val().rewardBalance):null};
}

// The purchase record is safely saved: the charge is final.
async function confirm(store,studentId,purchaseId){
  await store.tx(studentPath(studentId),cur=>{
    if(cur===null)return null;
    if(!cur.pendingCharges||!cur.pendingCharges[purchaseId])return;
    const left={...cur.pendingCharges};delete left[purchaseId];
    const next={...cur};
    if(Object.keys(left).length)next.pendingCharges=left;else delete next.pendingCharges;
    return next;
  });
}

// Finish or undo charges left behind by an interrupted purchase.
async function repair(store,studentId,nowMs=Date.now()){
  if(!key(studentId))return {cleared:0,refunded:0};
  const pending=await store.get(`${studentPath(studentId)}/pendingCharges`)||{};
  let cleared=0,refundedTotal=0;
  for(const [purchaseId,m] of Object.entries(pending)){
    if(!key(purchaseId)||nowMs-num(m&&m.at)<STALE_MS)continue; // may still be running
    const record=await store.get(`${SR}/redemptionsByStudent/${studentId}/${purchaseId}`);
    if(record){await confirm(store,studentId,purchaseId);cleared++;continue;}
    const r=await refund(store,studentId,purchaseId);
    if(r.removed){
      refundedTotal+=r.refunded;
      // Put back the stock reserved for the lost purchase (limited rewards only).
      if(m&&m.quantityReserved===true&&key(String(m.rewardId||''))){
        await store.tx(`${SR}/rewards/${m.rewardId}/quantity`,cur=>{const n=Number(cur);return Number.isFinite(n)&&n>=0?n+1:undefined;});
      }
      cleared++;
    }
  }
  return {cleared,refunded:refundedTotal};
}

module.exports={charge,refund,confirm,repair,STALE_MS};
