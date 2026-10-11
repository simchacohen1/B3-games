'use strict';
// Access to Stripe's Billing Portal is a financial-account capability.
// Only the verified purchaser-teacher whose invitation was claimed can open it.
const {PRIVATE,paths,ROOT}=require('./billing-fulfillment.cjs');
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const KEY=/^paid_[a-f0-9]{32}$/;
async function portalSessionForTeacher(store,identity,classId,stripe,returnUrl){
 if(!identity?.uid||identity.email_verified!==true||identity.firebase?.sign_in_provider!=='google.com')
  fail(403,'Verified Google teacher sign-in required.');
 if(!KEY.test(String(classId||'')))fail(400,'Choose a paid classroom.');
 const email=String(identity.email||'').trim().toLowerCase();
 const teacher=await store.get(ROOT+'/teachers/'+identity.uid);
 if(!teacher||teacher.active!==true||teacher.classIds?.[classId]!==true)
  fail(403,'This paid classroom is not assigned to your teacher account.');
 const orderId=[classId.slice(5,13),classId.slice(13,17),classId.slice(17,21),classId.slice(21,25),classId.slice(25)].join('-');
 const order=await store.get(PRIVATE+'/orders/'+orderId);
 if(!order||paths(order).classId!==classId||!order.activatedAt||!order.subscriptionId)
  fail(403,'The classroom does not have a paid subscription.');
 if(email!==String(order.teacherEmail||'').toLowerCase())
  fail(403,'Use the Google account that purchased this classroom.');
 if(teacher.inviteId!==paths(order).inviteId)
  fail(403,'The teacher invitation does not match this subscription.');
 const invite=await store.get(paths(order).invitePath);
 if(invite?.claimedUid!==identity.uid||invite.active!==true)
  fail(403,'The teacher billing invitation is not active.');
 const subscription=await stripe.subscriptions.retrieve(order.subscriptionId);
 const customer=typeof subscription?.customer==='string'
  ?subscription.customer:subscription?.customer?.id;
 if(!customer||!/^cus_[a-zA-Z0-9]+$/.test(customer))fail(503,'Stripe billing account unavailable.');
 const portal=await stripe.billingPortal.sessions.create({
  customer,return_url:returnUrl
 },{idempotencyKey:undefined});
 if(!/^https:\/\/billing\.stripe\.com\//.test(portal?.url||''))
  fail(503,'Unexpected billing portal link.');
 return {ok:true,url:portal.url};
}
module.exports={portalSessionForTeacher};
