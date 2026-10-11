'use strict';
/**
 * Proposed Stripe yearly-subscription integration. DISABLED BY DEFAULT.
 * Firebase secrets must be configured and FTT_BILLING_ENABLED=true must
 * be explicitly set only after staging tests, grant isolation, final prices,
 * privacy/tax review and owner approval.
 */
const {onRequest}=require('firebase-functions/v2/https');
const {defineSecret}=require('firebase-functions/params');
const {randomUUID}=require('node:crypto');
const admin=require('firebase-admin');
const {normalizeOrder,stripeLineItems}=require('./billing-catalog.cjs');
const {PRIVATE,activationUpdates}=require('./billing-fulfillment.cjs');
const {subscriptionPlan,planMatchesOrder,reconcilePaidAccess}=require('./billing-entitlements.cjs');
const {portalSessionForTeacher}=require('./billing-portal-core.cjs');
const {configuredPrices,previewUpgrade,confirmUpgrade}=require('./billing-upgrade-core.cjs');
if(!admin.apps.length)admin.initializeApp();
const secretKey=defineSecret('FTT_STRIPE_SECRET_KEY');
const webhookKey=defineSecret('FTT_STRIPE_WEBHOOK_SECRET');
const ORIGINS=['https://funtorahtools.com','https://www.funtorahtools.com',
 'https://simchacohen1.github.io'];
const BASE_URL='https://funtorahtools.com';
const ON=()=>process.env.FTT_BILLING_ENABLED==='true';
const stripeClient=()=>require('./billing-stripe-client.cjs').stripeClient(secretKey.value());
const error=(res,code,message)=>res.status(code).json({error:message});
exports.funTorahCreateCheckout=onRequest({
 region:'us-central1',cors:ORIGINS,secrets:[secretKey],maxInstances:4,
 timeoutSeconds:40
},async(req,res)=>{
 res.set('Cache-Control','no-store');
 if(req.method!=='POST')return error(res,405,'Use POST.');
 if(!ON())return error(res,503,'Paid registration is not open yet.');
 if(Buffer.byteLength(JSON.stringify(req.body||{}),'utf8')>6000)
  return error(res,413,'Request too large.');
 let order;
 try{
  if(req.body.acknowledge!==true)return error(res,400,'Accept the annual subscription terms first.');
  order=normalizeOrder(req.body);
  if(order.quote.toolIds.some(id=>id==='gallery'||id==='tag'))
   return error(res,400,'Gallery and Tag are not available for separate purchase yet.');
 }catch(err){return error(res,err.status||400,err.message);}
 const id=randomUUID();
 const db=admin.database();
 const payload={
  id,teacherName:order.teacherName,teacherEmail:order.teacherEmail,
  school:order.school,className:order.className,
  seats:order.quote.seats,tools:order.quote.toolIds,
  amountCents:order.quote.amountCents,
  status:'creating_checkout',createdAt:Date.now()
 };
 try{
  await db.ref(PRIVATE+'/orders/'+id).set(payload);
  const stripe=stripeClient();
  const session=await stripe.checkout.sessions.create({
   mode:'subscription',
   payment_method_types:['card'],
   line_items:stripeLineItems(order.quote),
   success_url:BASE_URL+'/teacher-registration.html?checkout=success&session_id={CHECKOUT_SESSION_ID}',
   cancel_url:BASE_URL+'/teacher-registration.html?checkout=canceled',
   client_reference_id:id,
   subscription_data:{metadata:{fttOrderId:id}},
   metadata:{fttOrderId:id},
   billing_address_collection:'required'
  },{idempotencyKey:'ftt_checkout_'+id});
  await db.ref(PRIVATE+'/orders/'+id).update({
   sessionId:session.id,status:'checkout_pending',updatedAt:Date.now()
  });
  return res.json({ok:true,url:session.url});
 }catch(err){
  console.error('Stripe checkout initialization failed',err.type||err.code||'unknown');
  // A failed attempt is never an entitlement grant. Keep the private order
  // for investigation; Stripe may have succeeded if the database write failed.
  return error(res,503,'Secure checkout is temporarily unavailable.');
 }
});

function invoiceSubscriptionId(invoice){
 const sub=invoice.subscription||invoice.parent?.subscription_details?.subscription;
 return typeof sub==='string'?sub:
   (sub&&typeof sub.id==='string'?sub.id:null);
}
exports.funTorahStripeWebhook=onRequest({
 region:'us-central1',cors:false,secrets:[secretKey,webhookKey],
 maxInstances:5,timeoutSeconds:60
},async(req,res)=>{
 res.set('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).send('Method not allowed');
 if(!ON())return res.status(503).send('Billing not enabled');
 const signature=req.headers['stripe-signature'];
 let stripe,event;
 try{
  stripe=stripeClient();
  event=stripe.webhooks.constructEvent(req.rawBody,signature,webhookKey.value());
 }catch(err){return res.status(400).send('Invalid Stripe signature');}
 const allowed=new Set([
  'checkout.session.completed','invoice.paid','invoice.payment_failed',
  'customer.subscription.updated','customer.subscription.deleted'
 ]);
 if(!allowed.has(event.type))return res.json({received:true});
 const db=admin.database(),data=event.data.object;
 try{
  let orderId=null,subId=null,isFirstCheckout=false;
  if(event.type==='checkout.session.completed'){
   if(data.mode!=='subscription'||data.payment_status!=='paid')
    return res.json({received:true,pending:true});
   orderId=data.client_reference_id||data.metadata?.fttOrderId;
   subId=typeof data.subscription==='string'?data.subscription:data.subscription?.id;
   isFirstCheckout=true;
  }else if(event.type.startsWith('invoice.')){
   subId=invoiceSubscriptionId(data);
  }else subId=data.id;
  if(!subId)return res.json({received:true});
  const subscription=await stripe.subscriptions.retrieve(subId,{expand:['latest_invoice','items.data.price.product']});
  if(!orderId)orderId=subscription.metadata?.fttOrderId||
    (await db.ref(PRIVATE+'/subscriptions/'+subId).once('value')).val()?.orderId;
  if(!/^[0-9a-f-]{36}$/.test(String(orderId||'')))
   return res.json({received:true,unlinked:true});
  const path=PRIVATE+'/orders/'+orderId;
  const snap=await db.ref(path).once('value');
  const order=snap.val();
  if(!order)return res.status(503).send('Order record not ready');
  if(order.id!==orderId)return res.status(400).send('Invalid stored order');
  if(isFirstCheckout){
   if(!order.sessionId||order.sessionId!==data.id)
    return res.status(503).send('Checkout registration not ready');
   if(order.activatedAt){
    return res.json({received:true,alreadyActivated:true});
   }
  }else if(!order.activatedAt){
   // Invoice or subscription events can arrive before checkout completes.
   // They must not create a free account before verified first payment.
   return res.json({received:true,awaitingCheckout:true});
  }
  // Never revoke already paid tools just because a mid-cycle upgrade's
  // proration payment is pending. Also never extend access on an unpaid renewal.
  const now=Date.now();
  const settled=reconcilePaidAccess(order,subscription,now);
  if(isFirstCheckout&&(!settled.paid||!settled.verifiedNow||
     !planMatchesOrder(settled.plan,order)))
   return res.status(503).send('Subscription payment or plan not verified');
  if(!settled.plan)return res.json({received:true,awaitingFirstPayment:true});
  const plan=settled.plan;
  const actual={...order,seats:plan.seats,tools:plan.tools};
  const change=activationUpdates(actual,subscription,settled.paid,now);
  if(isFirstCheckout)change.updates[path+'/activatedAt']=now;
  if(settled.verifiedNow)change.updates[path+'/paidPlan']=plan;
  change.updates[path+'/seats']=plan.seats;
  change.updates[path+'/tools']=plan.tools;
  await db.ref().update(change.updates);
  res.json({received:true});
 }catch(err){
  console.error('Stripe webhook processing failed',event.id,event.type,err.code||err.message);
  // Non-2xx makes Stripe retry instead of silently losing an entitlement update.
  res.status(500).send('Could not reconcile subscription');
 }
});


// Billing Portal is for invoices, payment-method changes and cancellation.
// Tool-addition UI needs separately reviewed product configuration.
exports.funTorahBillingPortal=onRequest({
 region:'us-central1',cors:ORIGINS,secrets:[secretKey],
 maxInstances:3,timeoutSeconds:35
},async(req,res)=>{
 res.set('Cache-Control','no-store');
 if(req.method!=='POST')return error(res,405,'Use POST.');
 if(!ON())return error(res,503,'Billing management is not available yet.');
 if(Buffer.byteLength(JSON.stringify(req.body||{}),'utf8')>1000)
  return error(res,413,'Request too large.');
 try{
  const bearer=String(req.headers.authorization||'');
  if(!/^Bearer [^\s]+$/.test(bearer))return error(res,403,'Teacher sign-in required.');
  const identity=await admin.auth().verifyIdToken(bearer.slice(7),true);
  const db=admin.database();
  const store={get:async path=>(await db.ref(path).once('value')).val()};
  const result=await portalSessionForTeacher(store,identity,req.body?.classId,
   stripeClient(),BASE_URL+'/teacher-home.html');
  res.json(result);
 }catch(err){
  console.error('Stripe billing portal request denied',err.status||err.code||'unexpected');
  return error(res,Number.isInteger(err.status)?err.status:503,
   Number.isInteger(err.status)?err.message:'Unable to open billing management.');
 }
});


// Preview, then explicitly confirm a prorated add-on. No charge or grant from
// the preview. Any successful update waits for a verified Stripe invoice.
exports.funTorahUpgradeTool=onRequest({
 region:'us-central1',cors:ORIGINS,secrets:[secretKey],
 maxInstances:3,timeoutSeconds:40
},async(req,res)=>{
 res.set('Cache-Control','no-store');
 if(req.method!=='POST')return error(res,405,'Use POST.');
 if(!ON())return error(res,503,'Paid upgrades are not available yet.');
 if(Buffer.byteLength(JSON.stringify(req.body||{}),'utf8')>1500)
  return error(res,413,'Request too large.');
 try{
  const bearer=String(req.headers.authorization||'');
  if(!/^Bearer [^\s]+$/.test(bearer))return error(res,403,'Teacher sign-in required.');
  const identity=await admin.auth().verifyIdToken(bearer.slice(7),true);
  const db=admin.database(),store={
   get:async path=>(await db.ref(path).once('value')).val(),
   set:(path,value)=>db.ref(path).set(value),
   transaction:(path,fn)=>db.ref(path).transaction(fn,undefined,false)
  };
  const prices=configuredPrices(process.env.FTT_STRIPE_UPGRADE_PRICES_JSON);
  const action=req.body?.action;
  const outcome=action==='preview'
   ?await previewUpgrade(store,identity,req.body,stripeClient(),prices)
   :action==='confirm'
    ?await confirmUpgrade(store,identity,req.body,stripeClient(),prices)
    :null;
  if(!outcome)return error(res,400,'Choose preview or confirm.');
  res.json(outcome);
 }catch(err){
  console.error('Stripe tool upgrade denied',err.status||err.code||'unexpected');
  return error(res,Number.isInteger(err.status)?err.status:503,
   Number.isInteger(err.status)?err.message:'Secure upgrade is temporarily unavailable.');
 }
});
