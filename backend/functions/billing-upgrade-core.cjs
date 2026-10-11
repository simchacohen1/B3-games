'use strict';
/**
 * Secure add-on quote + confirmation for paid teachers.
 * DISABLED until staging tests and customer-facing pricing approval.
 * Charges are calculated and previewed by Stripe; never by browser code.
 */
const {randomUUID}=require('node:crypto');
const {getPurchaserOrder}=require('./billing-portal-core.cjs');
const {PRIVATE}=require('./billing-fulfillment.cjs');
const {PRODUCTS}=require('./billing-catalog.cjs');
const {subscriptionPlan,planMatchesOrder,latestInvoicePaid,reconcilePaidAccess}=require('./billing-entitlements.cjs');
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const SAFE=/^price_[a-zA-Z0-9]{8,}$/;
function configuredPrices(json){
 let data;
 try{data=JSON.parse(json||'{}')}catch{fail(503,'Upgrade catalog not configured.')}
 if(!data||typeof data!=='object'||Array.isArray(data))fail(503,'Upgrade catalog not configured.');
 return data;
}
function fingerprint(sub){
 if(!Array.isArray(sub?.items?.data))fail(503,'Stripe subscription lines unavailable.');
 return JSON.stringify(sub.items.data.map(x=>[x.id,x.price?.id,x.quantity]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
}
function checkPrice(price,id){
 const p=price?.product;
 if(!price?.active||!p||typeof p!=='object'||!p.active||
  p.metadata?.fttKind!=='tool'||p.metadata?.fttToolId!==id||
  price.currency!=='usd'||price.unit_amount!==PRODUCTS[id].price||
  price.recurring?.interval!=='year'||(price.recurring?.interval_count||1)!==1)
  fail(503,'The annual tool price has not been configured correctly.');
}
async function collectContext(store,identity,classId,toolId,stripe,priceIds){
 const order=await getPurchaserOrder(store,identity,classId);
 if(!Object.hasOwn(PRODUCTS,toolId)||['gallery','tag'].includes(toolId))
  fail(400,'This tool is not available for purchase yet.');
 const priceId=priceIds?.[toolId];
 if(typeof priceId!=='string'||!SAFE.test(priceId))
  fail(503,'This tool is not available for paid upgrades yet.');
 const subscription=await stripe.subscriptions.retrieve(order.subscriptionId,
  {expand:['latest_invoice','items.data.price.product']});
 const access=reconcilePaidAccess(order,subscription);
 if(!access.paid||subscription.status!=='active'||subscription.cancel_at_period_end||
    subscription.pending_update||!latestInvoicePaid(subscription))
  fail(409,'Your current subscription must be paid and active before adding tools.');
 const plan=subscriptionPlan(subscription);
 if(!order.paidPlan||!planMatchesOrder(plan,order.paidPlan))
  fail(409,'Subscription access is still being updated; try again shortly.');
 if(plan.tools.includes(toolId))fail(409,'This tool is already included.');
 const price=await stripe.prices.retrieve(priceId,{expand:['product']});
 checkPrice(price,toolId);
 return {order,subscription,plan,priceId};
}
function previewParams(sub,priceId,prorationDate){
 return {subscription:sub.id,subscription_details:{
  billing_cycle_anchor:{type:'unchanged'},proration_behavior:'always_invoice',
  proration_date:prorationDate,
  items:[...sub.items.data.map(x=>({id:x.id})),{price:priceId,quantity:1}]
 }};
}
async function previewUpgrade(store,identity,body,stripe,priceIds,now=Date.now()){
 const {order,subscription,plan,priceId}=await collectContext(
  store,identity,body.classId,body.toolId,stripe,priceIds);
 const prorationDate=Math.floor(now/1000);
 const inv=await stripe.invoices.createPreview(previewParams(subscription,priceId,prorationDate));
 if(inv?.currency!=='usd'||!Number.isSafeInteger(inv.amount_due)||
  inv.amount_due<0||inv.amount_due>10000000)
  fail(503,'Stripe could not calculate the prorated amount.');
 const quoteId=randomUUID();
 const quote={quoteId,uid:identity.uid,orderId:order.id,classId:body.classId,
  toolId:body.toolId,priceId,subscriptionId:subscription.id,
  fingerprint:fingerprint(subscription),prorationDate,amountDue:inv.amount_due,
  currency:'usd',createdAt:now,expiresAt:now+5*60*1000,status:'previewed'};
 await store.set(PRIVATE+'/upgradeQuotes/'+quoteId,quote);
 return {ok:true,quoteId,toolName:PRODUCTS[body.toolId].name,
  chargeNowCents:inv.amount_due,annualRenewalPriceCents:PRODUCTS[body.toolId].price,
  currency:'usd',expiresAt:quote.expiresAt,renewalDate:plan.paidThrough||order.paidPlan.paidThrough};
}
async function confirmUpgrade(store,identity,body,stripe,priceIds,now=Date.now()){
 if(body.acknowledge!==true||!Number.isSafeInteger(body.confirmedAmountCents))
  fail(400,'Confirm the displayed prorated charge.');
 if(typeof body.quoteId!=='string'||!/^[a-f0-9-]{36}$/.test(body.quoteId))
  fail(400,'An upgrade quote is required.');
 const quote=await store.get(PRIVATE+'/upgradeQuotes/'+body.quoteId);
 if(!quote||quote.uid!==identity.uid||quote.expiresAt<=now||
    quote.status!=='previewed'||quote.amountDue!==body.confirmedAmountCents)
  fail(409,'Your upgrade quote expired or changed. Please preview again.');
 const {order,subscription,priceId}=await collectContext(
  store,identity,quote.classId,quote.toolId,stripe,priceIds);
 if(order.id!==quote.orderId||subscription.id!==quote.subscriptionId||
   priceId!==quote.priceId||fingerprint(subscription)!==quote.fingerprint)
  fail(409,'Your subscription changed. Please preview a new price.');
 // Re-preview with exactly the timestamp shown on the customer quote.
 const again=await stripe.invoices.createPreview(
  previewParams(subscription,priceId,quote.prorationDate));
 if(again?.currency!=='usd'||again.amount_due!==quote.amountDue)
  fail(409,'The Stripe charge has changed. Please preview again.');
 if(typeof store.transaction!=='function')fail(503,'Upgrade reservation is unavailable.');
 let lockMessage='Another subscription change is in progress.';
 const lockPath=PRIVATE+'/upgradeLocks/'+quote.classId;
 const lock=await store.transaction(lockPath,old=>{
  if(old?.expiresAt>now)return;
  return {quoteId:quote.quoteId,expiresAt:now+180000};
 });
 if(!lock?.committed)fail(409,lockMessage);
 // Set an immutable idempotency key *before* charging Stripe. On uncertain
 // network failures, support can reconcile rather than double-charge.
 await store.set(PRIVATE+'/upgradeQuotes/'+quote.quoteId,{...quote,status:'submitting'});
 try{
  const updated=await stripe.subscriptions.update(subscription.id,{
   items:[{price:priceId,quantity:1}],
   billing_cycle_anchor:'unchanged',proration_behavior:'always_invoice',
   proration_date:quote.prorationDate,payment_behavior:'pending_if_incomplete'
  },{idempotencyKey:'ftt_add_tool_'+quote.quoteId});
  await store.set(PRIVATE+'/upgradeQuotes/'+quote.quoteId,{...quote,status:'submitted'});
  return {ok:true,status:updated.pending_update?'payment_pending':'processing',
   message:'Your new tool will unlock only after Stripe confirms payment.'};
 }catch(err){
  // Do not mark "previewed" again: Stripe might have accepted the update.
  throw err;
 }finally{
  await store.transaction(lockPath,old=>
   old?.quoteId===quote.quoteId?null:undefined).catch(()=>{});
 }
}
module.exports={configuredPrices,checkPrice,fingerprint,previewParams,
 previewUpgrade,confirmUpgrade};
