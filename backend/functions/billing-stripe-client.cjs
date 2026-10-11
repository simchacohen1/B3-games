'use strict';
// Small native Stripe adapter: uses Node 22 fetch and crypto, so no additional
// dependency or lockfile change is required. No card numbers touch our server.
const {createHmac,timingSafeEqual}=require('node:crypto');
const API='https://api.stripe.com/v1';
function flatten(value,path,into){
 if(value===undefined||value===null)return;
 if(Array.isArray(value)){value.forEach((v,i)=>flatten(v,path+'['+i+']',into));return;}
 if(typeof value==='object'){
  for(const [key,v] of Object.entries(value))flatten(v,path?path+'['+key+']':key,into);
  return;
 }
 into.append(path,String(value));
}
function form(data){
 const out=new URLSearchParams();
 for(const [k,v] of Object.entries(data||{}))flatten(v,k,out);
 return out;
}
async function request(secret,method,path,body,options={}){
 if(typeof secret!=='string'||!secret.startsWith('sk_'))throw Error('Stripe API key is not configured.');
 if(!/^\/[A-Za-z0-9_\/-]+$/.test(path))throw Error('Unexpected Stripe endpoint.');
 const args={method,headers:{Authorization:'Bearer '+secret},signal:AbortSignal.timeout(15000)};
 const encoded=form(body);
 let url=API+path;
 if(method==='GET')url+='?'+encoded.toString();
 else {
  args.headers['Content-Type']='application/x-www-form-urlencoded';
  if(options.idempotencyKey)args.headers['Idempotency-Key']=options.idempotencyKey;
  args.body=encoded.toString();
 }
 const response=await fetch(url,args);
 const result=await response.json().catch(()=>({}));
 if(!response.ok){
  const err=new Error('Stripe request failed');
  err.code=result?.error?.code||'stripe_request_failed';
  err.status=response.status;
  throw err;
 }
 return result;
}
function verifyWebhook(raw,header,secret,atMs=Date.now()){
 if(!Buffer.isBuffer(raw)||typeof secret!=='string'||!secret.startsWith('whsec_'))
  throw Error('Invalid webhook request.');
 const parts=String(header||'').split(',').map(x=>x.trim());
 const timestampValue=parts.find(s=>s.startsWith('t='))?.slice(2);
 const timestamp=Number(timestampValue);
 if(!Number.isSafeInteger(timestamp)||Math.abs(atMs/1000-timestamp)>300)
  throw Error('Webhook timestamp is missing or stale.');
 const expected=createHmac('sha256',secret)
  .update(Buffer.from(String(timestamp)+'.','utf8')).update(raw).digest();
 const valid=parts.filter(s=>s.startsWith('v1=')).some(part=>{
  const str=part.slice(3);
  if(!/^[a-f0-9]{64}$/i.test(str))return false;
  const supplied=Buffer.from(str,'hex');
  return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
 });
 if(!valid)throw Error('Invalid webhook signature.');
 const parsed=JSON.parse(raw.toString('utf8'));
 if(!parsed||typeof parsed!=='object'||typeof parsed.id!=='string'||
   typeof parsed.type!=='string'||!parsed.data?.object)throw Error('Malformed Stripe event.');
 return parsed;
}
function stripeClient(secret){
 return {
  checkout:{sessions:{create:(data,opts)=>request(secret,'POST','/checkout/sessions',data,opts)}},
  subscriptions:{retrieve:(id,query)=>request(secret,'GET','/subscriptions/'+encodeURIComponent(id),query)},
  webhooks:{constructEvent:(raw,header,whsec)=>verifyWebhook(raw,header,whsec)}
 };
}
module.exports={form,verifyWebhook,stripeClient};
