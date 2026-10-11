'use strict';
// All paid-class seat changes are serialized through one Firebase transaction
// on the billing node. Allocations are retained across renewals.
const ROOT='b3Games/workspaces/b3-2026/classes/';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
function slots(billing){
 return Object.values(billing?.seatAllocations||{}).filter(Boolean).length;
}
async function reserveSeat(store,classId,studentId){
 if(typeof store.transaction!=='function')fail(503,'Seat reservation service unavailable.');
 let reason='All purchased student accounts are in use.';
 const path=ROOT+classId+'/billing';
 const result=await store.transaction(path,state=>{
  if(!state||state.managed!==true||state.active!==true){
   reason='This subscription is inactive.';return;
  }
  if(!Number.isSafeInteger(state.seatLimit)||state.seatLimit<1){
   reason='Invalid paid class seat limit.';return;
  }
  if(state.seatAllocations?.[studentId]===true)return state;
  if(slots(state)>=state.seatLimit)return;
  return {...state,seatAllocations:{...(state.seatAllocations||{}),[studentId]:true}};
 });
 if(!result?.committed)fail(reason.includes('in use')?409:403,reason);
 return true;
}
async function releaseSeat(store,classId,studentId){
 if(typeof store.transaction!=='function')fail(503,'Seat reservation service unavailable.');
 const path=ROOT+classId+'/billing';
 const result=await store.transaction(path,state=>{
  if(!state||state.managed!==true)return; // Never modify legacy B3 quota.
  if(!state.seatAllocations?.[studentId])return state;
  const allocations={...state.seatAllocations};
  delete allocations[studentId];
  return {...state,seatAllocations:allocations};
 });
 return !!result?.committed;
}
module.exports={slots,reserveSeat,releaseSeat};
