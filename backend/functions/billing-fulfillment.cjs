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
 const active=paid && ['active','past_due'].includes(subscription.status);
 // Only billing-created class IDs are modified; existing B3 classes are untouched.
 updates[p.classPath+'/name']=order.className;
 updates[p.classPath+'/active']=active;
 // Update individual paths. Never overwrite seatAllocations on renewals.
 updates[p.classPath+'/billing/managed']=true;
 updates[p.classPath+'/billing/seatLimit']=order.seats;
 updates[p.classPath+'/billing/active']=active;
 updates[p.classPath+'/billing/updatedAt']=now;
 // Explicitly close every unpurchased tool. Downgrades never leave stale grants.
 for(const [id,product] of Object.entries(PRODUCTS)){
  updates[p.classPath+'/toolGrants/'+product.grant]=active&&order.tools.includes(id);
 }
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
