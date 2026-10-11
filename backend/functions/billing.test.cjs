'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHmac}=require('node:crypto');
const {quote,normalizeOrder,stripeLineItems}=require('./billing-catalog.cjs');
const {paths,activationUpdates}=require('./billing-fulfillment.cjs');
const {form,verifyWebhook}=require('./billing-stripe-client.cjs');
const {slots,reserveSeat,releaseSeat}=require('./billing-seats.cjs');
const {subscriptionPlan,planMatchesOrder,latestInvoicePaid}=require('./billing-entitlements.cjs');
const {portalSessionForTeacher}=require('./billing-portal-core.cjs');
const {previewUpgrade,confirmUpgrade}=require('./billing-upgrade-core.cjs');
const {reconcilePaidAccess}=require('./billing-entitlements.cjs');

test('Annual base covers five seats, Shorashim $39',()=>{
 assert.equal(quote({seats:5,tools:['shorashim']}).amountCents,13900);
 assert.equal(quote({seats:6,tools:['shorashim']}).amountCents,14900);
 assert.equal(quote({seats:20,tools:['posuk','shorashim']}).amountCents,36800);
});
test('Prices and quantities are controlled exclusively by server catalog',()=>{
 const q=quote({seats:5,tools:['shorashim'],total:1,price:1,grants:{posuk:true}});
 assert.equal(q.amountCents,13900);
 assert.deepEqual(q.grants,{shorashim:true});
 const items=stripeLineItems(q);
 assert.deepEqual(items[1],{
  price_data:{currency:'usd',unit_amount:3900,product_data:{name:'Shorashim Lab',metadata:{fttKind:'tool',fttToolId:'shorashim'}},recurring:{interval:'year'}},
  quantity:1
 });
});
test('Reject missing, duplicate, invalid and oversized selections',()=>{
 assert.throws(()=>quote({seats:301,tools:['shorashim']}),/Student count/);
 assert.throws(()=>quote({seats:5,tools:['shorashim','shorashim']}),/distinct/);
 assert.throws(()=>quote({seats:5,tools:['unknown']}),/valid/);
 assert.throws(()=>quote({seats:5,tools:[]}),/valid/);
 assert.throws(()=>quote({seats:5.5,tools:['shorashim']}),/Student count/);
});
test('Validate registration, accept school payer separately',()=>{
 const r=normalizeOrder({teacherName:'Rabbi  Levy',teacherEmail:' TEACHER@EXAMPLE.COM ',
   school:'Sample School',className:'Grade 3',seats:10,tools:['shorashim']});
 assert.equal(r.teacherEmail,'teacher@example.com');
 assert.equal(r.teacherName,'Rabbi Levy');
 assert.throws(()=>normalizeOrder({teacherName:'X',teacherEmail:'bad',school:'X',className:'Y',
  seats:2,tools:['shorashim']}),/valid|Enter/);
});
test('Form encoder supports nested Stripe recurring price items',()=>{
 const encoded=form({line_items:[{quantity:2,price_data:{unit_amount:1000,
  recurring:{interval:'year'},product_data:{name:'Extra seat'}}}]}).toString();
 assert.ok(encoded.includes('line_items%5B0%5D%5Bprice_data%5D%5Brecurring%5D%5Binterval%5D=year'));
 assert.ok(encoded.includes('line_items%5B0%5D%5Bquantity%5D=2'));
});
test('Reject tampered and expired webhooks',()=>{
 const secret='whsec_test_abc',ts=Math.floor(Date.now()/1000);
 const body=Buffer.from(JSON.stringify({id:'evt_test',type:'invoice.paid',data:{object:{id:'in_123'}}}));
 const signature=createHmac('sha256',secret).update(String(ts)+'.').update(body).digest('hex');
 assert.equal(verifyWebhook(body,'t='+ts+',v1='+signature,secret).id,'evt_test');
 assert.throws(()=>verifyWebhook(Buffer.from(body.toString()+' '),'t='+ts+',v1='+signature,secret),/signature/);
 assert.throws(()=>verifyWebhook(body,'t='+(ts-5000)+',v1='+signature,secret),/stale/);
});
test('Grant class access only after verified paid active subscription',()=>{
 const order={id:'53ff5477-a71b-4cf4-a7c8-81c2af782894',className:'Grade 3',
   teacherEmail:'teacher@example.com',teacherName:'Rabbi Levy',seats:5,tools:['shorashim']};
 const sub={id:'sub_123',status:'active'};
 const p=paths(order);
 assert.ok(p.classId.startsWith('paid_'));
 const active=activationUpdates(order,sub,true,1000);
 assert.equal(active.updates[p.classPath+'/toolGrants/shorashim'],true);
 assert.equal(active.updates[p.invitePath+'/active'],true);
 assert.equal(active.updates[p.classPath+'/billing/seatLimit'],5);
 assert.equal(active.updates[p.classPath+'/billing/active'],true);
 assert.equal(active.updates[p.classPath+'/billing/seatAllocations'],undefined);
 const canceled=activationUpdates(order,{id:'sub_123',status:'canceled'},false,2000);
 assert.equal(canceled.updates[p.classPath+'/active'],false);
 assert.equal(canceled.updates[p.invitePath+'/active'],false);
 assert.equal(canceled.updates[p.classPath+'/toolGrants/shorashim'],false);
});

test('Transactionally reserve and release a limited number of seats',async()=>{
 let b={managed:true,active:true,seatLimit:2};
 const store={transaction:async(path,fn)=>{
  const candidate=fn(structuredClone(b));
  if(candidate===undefined)return {committed:false};
  b=candidate;return {committed:true};
 }};
 await reserveSeat(store,'paid_abc','one');
 await reserveSeat(store,'paid_abc','two');
 assert.equal(slots(b),2);
 await assert.rejects(reserveSeat(store,'paid_abc','three'),/in use/);
 await releaseSeat(store,'paid_abc','one');
 assert.equal(slots(b),1);
 await reserveSeat(store,'paid_abc','three');
 assert.equal(slots(b),2);
 b.active=false;
 await assert.rejects(reserveSeat(store,'paid_abc','four'),/inactive/);
 await releaseSeat(store,'paid_abc','two');
 assert.equal(slots(b),1);
});
test('Concurrent requests cannot exceed the paid seat cap',async()=>{
 let billing={managed:true,active:true,seatLimit:1};
 let queue=Promise.resolve();
 const store={transaction:(path,fn)=>{
  const next=queue.then(async()=>{
   const candidate=fn(structuredClone(billing));
   if(candidate===undefined)return {committed:false};
   billing=candidate;return {committed:true};
  });
  queue=next.then(()=>{},()=>{});
  return next;
 }};
 const results=await Promise.allSettled([
  reserveSeat(store,'paid_class','a'),reserveSeat(store,'paid_class','b')
 ]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(results.filter(x=>x.status==='rejected').length,1);
 assert.equal(slots(billing),1);
});

function stripeSub(tools=['shorashim'],seats=5,{paid=true,status='active'}={}){
 const {PRODUCTS}=require('./billing-catalog.cjs');
 const one=(id,amount,quantity,kind)=>{
  return {quantity,price:{unit_amount:amount,currency:'usd',
   recurring:{interval:'year',interval_count:1},
   product:{metadata:{fttKind:kind,...(kind==='tool'?{fttToolId:id}:{})}}}};
 };
 const items=[one('base',10000,1,'base')];
 if(seats>5)items.push(one('extra',1000,seats-5,'extra'));
 for(const id of tools)items.push(one(id,PRODUCTS[id].price,1,'tool'));
 return {id:'sub_123',status,latest_invoice:paid?{paid:true,status:'paid'}:{paid:false,status:'open'},
  items:{data:items}};
}
test('Stripe subscription items determine purchased tools and student seats',()=>{
 const sub=stripeSub(['shorashim','posuk'],9);
 const plan=subscriptionPlan(sub);
 assert.deepEqual(plan,{seats:9,tools:['posuk','shorashim']});
 assert.equal(planMatchesOrder(plan,{seats:9,tools:['shorashim','posuk']}),true);
 assert.equal(planMatchesOrder(plan,{seats:9,tools:['shorashim']}),false);
 assert.equal(latestInvoicePaid(sub),true);
 assert.equal(latestInvoicePaid(stripeSub(['posuk'],5,{paid:false})),false);
});
test('Stripe annual plan rejects forged unit prices, duplicated tools and shared gallery',()=>{
 const badPrice=stripeSub();
 badPrice.items.data[1].price.unit_amount=1;
 assert.throws(()=>subscriptionPlan(badPrice),/Invalid purchased tool/);
 const duplicated=stripeSub(['shorashim','shorashim']);
 assert.throws(()=>subscriptionPlan(duplicated),/Invalid purchased tool/);
 assert.throws(()=>subscriptionPlan(stripeSub(['gallery'])),/require separate/);
 const badBase=stripeSub();
 badBase.items.data[0].quantity=2;
 assert.throws(()=>subscriptionPlan(badBase),/Invalid base/);
});
test('Removing a tool closes its grant, without closing retained purchases',()=>{
 const order={id:'53ff5477-a71b-4cf4-a7c8-81c2af782894',className:'Grade 3',
  teacherEmail:'teacher@example.com',teacherName:'Rabbi Levy',seats:5,
  tools:['shorashim','posuk']};
 const sub=stripeSub(['shorashim'],5);
 const prior=activationUpdates(order,sub,true,100);
 const next=activationUpdates({...order,...subscriptionPlan(sub)},sub,true,200);
 const cls=paths(order).classPath;
 assert.equal(prior.updates[cls+'/toolGrants/posuk-practice-scroll'],true);
 assert.equal(next.updates[cls+'/toolGrants/posuk-practice-scroll'],false);
 assert.equal(next.updates[cls+'/toolGrants/shorashim'],true);
 assert.equal(next.updates[cls+'/toolGrants/yiddish'],false);
 // An end-of-period cancellation remains active until the Stripe status cancels.
 assert.equal(activationUpdates(order,{status:'active',id:'sub_123',cancel_at_period_end:true},true).active,true);
 assert.equal(activationUpdates(order,{status:'canceled',id:'sub_123'},false).active,false);
});
test('Stripe billing portal belongs only to verified claimed purchaser teacher',async()=>{
 const id='53ff5477-a71b-4cf4-a7c8-81c2af782894';
 const cid='paid_'+id.replaceAll('-',''),iid=cid;
 const order={id,teacherEmail:'teacher@example.com',teacherName:'Test',
  subscriptionId:'sub_123',activatedAt:100,tools:['shorashim'],seats:5};
 const ROOT='b3Games/workspaces/b3-2026',PRIVATE='b3Private/billing';
 const map={
  [ROOT+'/teachers/uid']:{active:true,inviteId:iid,classIds:{[cid]:true}},
  [PRIVATE+'/orders/'+id]:order,
  [ROOT+'/teacherInvites/'+iid]:{claimedUid:'uid'}
 };
 const store={get:async path=>map[path]};
 let calls=0;
 const stripe={subscriptions:{retrieve:async()=>({customer:'cus_ABC123'})},
  billingPortal:{sessions:{create:async()=>{calls++;return {url:'https://billing.stripe.com/p/session/test'};}}}};
 const identity={uid:'uid',email:'teacher@example.com',email_verified:true,
  firebase:{sign_in_provider:'google.com'}};
 const done=await portalSessionForTeacher(store,identity,cid,stripe,'https://funtorahtools.com/teacher-home.html');
 assert.equal(done.ok,true);assert.equal(calls,1);
 await assert.rejects(portalSessionForTeacher(store,{...identity,email:'other@example.com'},cid,stripe,'https://funtorahtools.com/teacher-home.html'),/Google account/);
 await assert.rejects(portalSessionForTeacher(store,{...identity,email_verified:false},cid,stripe,'https://funtorahtools.com/teacher-home.html'),/Verified/);
 await assert.rejects(portalSessionForTeacher(store,identity,'et',stripe,'https://funtorahtools.com/teacher-home.html'),/paid classroom/);
 assert.equal(calls,1);
});


test('Unpaid renewal never extends paid-through access; failed upgrade keeps existing tools',()=>{
 const now=Date.now(),end=Math.ceil(now/1000)+150*86400;
 let sub=stripeSub(['shorashim'],5,{paid:true});
 sub.items.data[0].current_period_end=end;
 const plan=subscriptionPlan(sub),order={paidPlan:{...plan,paidThrough:end}};
 assert.equal(reconcilePaidAccess(order,sub,now).paid,true);
 const retry=stripeSub(['shorashim'],5,{paid:false});
 retry.status='active';retry.items.data[0].current_period_end=end+365*86400;
 const safe=reconcilePaidAccess(order,retry,now);
 assert.equal(safe.paid,true);
 assert.deepEqual(safe.plan.tools,['shorashim']);
 assert.equal(safe.verifiedNow,false);
 assert.equal(reconcilePaidAccess(order,retry,end*1000+1).paid,false);
});
test('Teacher sees real Stripe proration before explicitly approving annual tool upgrade',async()=>{
 const id='53ff5477-a71b-4cf4-a7c8-81c2af782894',cid='paid_'+id.replaceAll('-',''),
  root='b3Games/workspaces/b3-2026',p='b3Private/billing';
 const identity={uid:'uid',email:'teacher@example.com',email_verified:true,firebase:{sign_in_provider:'google.com'}};
 const sub=stripeSub(['shorashim'],5);
 sub.id='sub_sample';sub.cancel_at_period_end=false;sub.pending_update=null;
 sub.items.data.forEach((x,i)=>{x.id='si_'+(i+1);x.price.id='price_current_'+i;});
 sub.items.data[0].current_period_end=Math.ceil(Date.now()/1000)+160*86400;
 const paidPlan={...subscriptionPlan(sub),paidThrough:sub.items.data[0].current_period_end};
 const order={id,teacherEmail:identity.email,teacherName:'Rabbi Sample',activatedAt:100,
  subscriptionId:sub.id,seats:5,tools:['shorashim'],paidPlan};
 const data={
  [root+'/teachers/uid']:{active:true,inviteId:cid,classIds:{[cid]:true}},
  [root+'/teacherInvites/'+cid]:{claimedUid:'uid'},
  [p+'/orders/'+id]:order
 };
 const store={
  get:async path=>data[path],
  set:async(path,value)=>{data[path]=value;},
  transaction:async(path,fn)=>{
   const updated=fn(data[path]);
   if(updated===undefined)return {committed:false};
   data[path]=updated;return {committed:true};
  }
 };
 let previewCalls=0,updateCalls=0,upgradeArgs;
 const stripe={
  subscriptions:{
   retrieve:async()=>structuredClone(sub),
   update:async(id,args,options)=>{updateCalls++;upgradeArgs={id,args,options};return {...sub,pending_update:{}};}
  },
  prices:{retrieve:async()=>({
   id:'price_new_posuk',active:true,currency:'usd',unit_amount:7900,
   recurring:{interval:'year',interval_count:1},
   product:{active:true,metadata:{fttKind:'tool',fttToolId:'posuk'}}
  })},
  invoices:{createPreview:async()=>{previewCalls++;return {currency:'usd',amount_due:3950};}}
 };
 const allowedPrices={posuk:'price_new_posuk'};
 const now=Date.now();
 const quote=await previewUpgrade(store,identity,{classId:cid,toolId:'posuk'},stripe,allowedPrices,now);
 assert.equal(quote.chargeNowCents,3950);
 assert.equal(quote.annualRenewalPriceCents,7900);
 assert.equal(updateCalls,0);
 assert.equal(previewCalls,1);
 await assert.rejects(confirmUpgrade(store,identity,{quoteId:quote.quoteId,acknowledge:true,
  confirmedAmountCents:1},stripe,allowedPrices,now),/expired or changed/);
 assert.equal(updateCalls,0);
 const result=await confirmUpgrade(store,identity,{quoteId:quote.quoteId,acknowledge:true,
  confirmedAmountCents:3950},stripe,allowedPrices,now+1000);
 assert.equal(result.status,'payment_pending');
 assert.equal(updateCalls,1);
 assert.equal(upgradeArgs.args.proration_behavior,'always_invoice');
 assert.equal(upgradeArgs.args.payment_behavior,'pending_if_incomplete');
 assert.equal(upgradeArgs.args.billing_cycle_anchor,'unchanged');
 assert.equal(upgradeArgs.args.proration_date,Math.floor(now/1000));
 assert.equal(upgradeArgs.args.items[0].price,'price_new_posuk');
 assert.ok(upgradeArgs.options.idempotencyKey.includes(quote.quoteId));
 assert.equal(data[p+'/upgradeQuotes/'+quote.quoteId+'/status'],'submitted');
 await assert.rejects(confirmUpgrade(store,identity,{quoteId:quote.quoteId,acknowledge:true,
  confirmedAmountCents:3950},stripe,allowedPrices,now+2000),/expired or changed/);
 assert.equal(updateCalls,1);
});
