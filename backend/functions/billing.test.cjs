'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHmac}=require('node:crypto');
const {quote,normalizeOrder,stripeLineItems}=require('./billing-catalog.cjs');
const {paths,activationUpdates}=require('./billing-fulfillment.cjs');
const {form,verifyWebhook}=require('./billing-stripe-client.cjs');

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
  price_data:{currency:'usd',unit_amount:3900,product_data:{name:'Shorashim Lab'},recurring:{interval:'year'}},
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
 assert.equal(active.updates[p.classPath+'/billing'].seatLimit,5);
 const canceled=activationUpdates(order,{id:'sub_123',status:'canceled'},false,2000);
 assert.equal(canceled.updates[p.classPath+'/active'],false);
 assert.equal(canceled.updates[p.invitePath+'/active'],false);
 assert.equal(canceled.updates[p.classPath+'/toolGrants/shorashim'],false);
});
