'use strict';
const {PRODUCTS}=require('./billing-catalog.cjs');
const ROOT='b3Games/workspaces/b3-2026';
const PRIVATE='b3Private/billing';
function paths(order){
 const classId='paid_'+order.id.replace(/-/g,'');
 const inviteId='paid_'+order.id.replace(/-/g,'');
 return {classId,inviteId,classPath:ROOT+'/classes/'+classId,invitePath:ROOT+'/teacherInvites/'+inviteId};
}
function activationUpdates(order,subscription,paid,now=Date.now()){
 const p=paths(order),updates={};
 const active=paid && subscription.status==='active';
 // Only billing-created class IDs are modified; existing B3 classes are untouched.
 updates[p.classPath+'/name']=order.className;
 updates[p.classPath+'/active']=active;
 // Update individual paths. Never overwrite seatAllocations on renewals.
 updates[p.classPath+'/billing/managed']=true;
 updates[p.classPath+'/billing/seatLimit']=order.seats;
 updates[p.classPath+'/billing/active']=active;
 updates[p.classPath+'/billing/updatedAt']=now;
 for(const id of order.tools){
  const product=PRODUCTS[id];
  if(!product)throw Error('Unrecognized stored product: '+id);
  updates[p.classPath+'/toolGrants/'+product.grant]=active;
 }
 // Class Gallery and Tag Game currently share a tool-policy alias.
 // Do not offer real checkout until their grants are isolated.
 updates[p.invitePath+'/email']=order.teacherEmail;
 updates[p.invitePath+'/name']=order.teacherName;
 updates[p.invitePath+'/role']='teacher';
 updates[p.invitePath+'/active']=active;
 updates[p.invitePath+'/classIds/'+p.classId]=true;
 updates[p.invitePath+'/updatedAt']=now;
 updates[PRIVATE+'/orders/'+order.id+'/status']=active?'active':'suspended';
 updates[PRIVATE+'/orders/'+order.id+'/updatedAt']=now;
 updates[PRIVATE+'/orders/'+order.id+'/subscriptionId']=subscription.id;
 updates[PRIVATE+'/subscriptions/'+subscription.id]={
  orderId:order.id,status:subscription.status,active,updatedAt:now
 };
 return {updates,classId:p.classId,active};
}
module.exports={ROOT,PRIVATE,paths,activationUpdates};
