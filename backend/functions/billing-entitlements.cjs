'use strict';
// Reconstruct granted access from Stripe's current PAID subscription line items.
// Never grant tools based on browser parameters or unverified webhook metadata.
const {PRODUCTS}=require('./billing-catalog.cjs');
const BAD=new Set(['gallery','tag']); // Gallery+Tag share a route; isolate before individual sale.
function invalid(message){throw Object.assign(new Error(message),{code:'invalid_subscription_plan'});}
function subscriptionPlan(subscription,{allowSharedGallery=false}={}){
 const items=subscription?.items?.data;
 if(!Array.isArray(items)||items.length<2||items.length>25)invalid('Missing Stripe subscription items.');
 let base=0,extra=0;const tools=new Set();
 for(const item of items){
  const price=item?.price,product=price?.product;
  const units=item?.quantity,rate=price?.unit_amount,kind=product?.metadata?.fttKind;
  if(!product||typeof product!=='object'||!Number.isSafeInteger(units)||units<1||
     price.currency!=='usd'||price.recurring?.interval!=='year'||
     (price.recurring?.interval_count||1)!==1)invalid('Unknown Stripe item.');
  if(kind==='base'){
   if(++base!==1||units!==1||rate!==10000)invalid('Invalid base subscription.');
  }else if(kind==='extra'){
   if(extra||units>295||rate!==1000)invalid('Invalid extra students.');
   extra=units;
  }else if(kind==='tool'){
   const id=product.metadata?.fttToolId;
   if(typeof id!=='string'||!Object.hasOwn(PRODUCTS,id)||units!==1||
      rate!==PRODUCTS[id].price||tools.has(id))invalid('Invalid purchased tool.');
   if(!allowSharedGallery&&BAD.has(id))
    invalid('Gallery and Tag require separate tool access enforcement.');
   tools.add(id);
  }else invalid('Unknown subscription item kind.');
 }
 if(base!==1||tools.size<1)invalid('Missing annual subscription items.');
 const seats=5+extra;
 if(seats>300)invalid('Too many student accounts.');
 return {seats,tools:[...tools].sort()};
}
function planMatchesOrder(plan,order){
 return plan.seats===order.seats &&
   Array.isArray(order.tools) &&
   plan.tools.join(',')===order.tools.slice().sort().join(',');
}
function latestInvoicePaid(subscription){
 const invoice=subscription?.latest_invoice;
 return !!(invoice&&typeof invoice==='object'&&
  invoice.paid===true&&invoice.status==='paid');
}
module.exports={subscriptionPlan,planMatchesOrder,latestInvoicePaid};
