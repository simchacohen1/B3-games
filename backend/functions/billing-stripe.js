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
if(!admin.apps.length)admin.initializeApp();
const secretKey=defineSecret('FTT_STRIPE_SECRET_KEY');
const webhookKey=defineSecret('FTT_STRIPE_WEBHOOK_SECRET');
const ORIGINS=['https://funtorahtools.com','https://www.funtorahtools.com',
 'https://simchacohen1.github.io'];
const BASE_URL='https://funtorahtools.com';
const ON=()=>process.env.FTT_BILLING_ENABLED==='true';
const stripeClient=()=>require('stripe')(secretKey.value());
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
   customer_creation:'always',
   line_items:stripeLineItems(order.quote),
   success_url:BASE_URL+'/teacher-registration-preview.html?checkout=success&session_id={CHECKOUT_SESSION_ID}',
   cancel_url:BASE_URL+'/teacher-registration-preview.html?checkout=canceled',
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
 return typeof invoice.subscription==='string'?invoice.subscription:
   invoice.parent?.subscription_details?.subscription||null;
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
  const subscription=await stripe.subscriptions.retrieve(subId,{expand:['latest_invoice']});
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
  const inv=subscription.latest_invoice;
  const latestPaid=!!(inv&&typeof inv==='object'&&inv.paid===true);
  const paid=subscription.status==='active'&&
   (isFirstCheckout||latestPaid)&&event.type!=='invoice.payment_failed';
  const now=Date.now();
  const change=activationUpdates(order,subscription,paid,now);
  if(isFirstCheckout)change.updates[path+'/activatedAt']=now;
  await db.ref().update(change.updates);
  res.json({received:true});
 }catch(err){
  console.error('Stripe webhook processing failed',event.id,event.type,err.code||err.message);
  // Non-2xx makes Stripe retry instead of silently losing an entitlement update.
  res.status(500).send('Could not reconcile subscription');
 }
});
