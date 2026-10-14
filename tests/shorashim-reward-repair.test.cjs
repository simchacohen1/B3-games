'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../backend/functions/student-rewards-auto-award.js'),'utf8');
function fixture({noHints=false,durationMs=8000,audioURL='https://example.test/sample.webm'}={}){
 const event={studentId:'test-boy',durationMs,audioURL,storagePath:'test-only/sample.webm',noHints,mode:noHints?'no-hints':'hints',date:'2026-10-13',status:'pending',pictures:['preserved'],progress:{done:true}};
 const tree={posukPractice:{shorashimLearning:{recordingEvents:{'test-boy':{'test-event':event}},catalog:{preserved:true}}},studentRewards:{students:{'test-boy':{name:'Sample student',classId:'et',rewardBalance:20}},pointRequests:{}}};
 const parts=p=>p.split('/').filter(Boolean),get=p=>parts(p).reduce((row,key)=>row?.[key],tree)??null;
 const set=(p,value)=>{const keys=parts(p),last=keys.pop();let row=tree;for(const k of keys)row=row[k]??={};if(value===null)delete row[last];else row[last]=structuredClone(value)};
 const snapshot=(value,key)=>({key,val:()=>structuredClone(value),exists:()=>value!==null,forEach:callback=>Object.entries(value||{}).forEach(([k,v])=>callback(snapshot(v,k)))});
 const db={ref:p=>({get:async()=>snapshot(get(p)),set:async value=>set(p,value),update:async values=>{for(const [key,value]of Object.entries(values))set(p+'/'+key,value)},transaction:async updater=>{
   const next=updater(structuredClone(get(p)));if(next===undefined)return {committed:false,snapshot:snapshot(get(p))};set(p,next);return {committed:true,snapshot:snapshot(next)};
 }})};
 const context={exports:{},console,Buffer,Date,Intl,require:name=>{
   if(name==='firebase-functions/v2/https')return {onRequest:(_,handler)=>handler};
   if(name==='firebase-admin')return {apps:[{}],database:()=>db,auth:()=>({verifyIdToken:async()=>({uid:'owner-test',email:'simcha5770@gmail.com',email_verified:true})})};
   return name.startsWith('./')?require('../backend/functions/'+name.slice(2)):require(name);
 }};
 vm.runInNewContext(source,context);
 const call=async body=>{
   const result={};const res={set(){return res},status(code){result.status=code;return res},json(value){result.body=value;return res}};
   await context.exports.studentRewardsAutoAward({method:'POST',headers:{authorization:'Bearer test-only-token'},body},res);return result;
 };
 const repair=()=>call({action:'repair-shorashim-recording',studentId:'test-boy',eventId:'test-event'});
 return {tree,event,call,repair};
}
test('reconnecting twice preserves the recording and creates one pending request without adding points',async()=>{
 const f=fixture(),a=await f.repair(),b=await f.repair();assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(a.body.requestId,b.body.requestId);
 assert.equal(Object.keys(f.tree.studentRewards.pointRequests).length,1);assert.equal(f.tree.studentRewards.students['test-boy'].rewardBalance,20);
 assert.equal(f.event.audioURL,'https://example.test/sample.webm');assert.equal(f.event.durationMs,8000);assert.deepEqual(f.event.pictures,['preserved']);assert.deepEqual(f.event.progress,{done:true});assert.equal(f.tree.posukPractice.shorashimLearning.catalog.preserved,true);
});
test('approving a repaired request twice credits the points exactly once',async()=>{
 const f=fixture(),r=await f.repair(),body={action:'approve-point-request',requestId:r.body.requestId};
 assert.equal((await f.call(body)).status,200);assert.equal((await f.call(body)).body.alreadyHandled,true);
 assert.equal(f.tree.studentRewards.students['test-boy'].rewardBalance,22);assert.equal(f.event.pointRequestStatus,'approved');
});
test('no-hints repairs retain the existing three-point award',async()=>{
 const f=fixture({noHints:true}),r=await f.repair();const request=f.tree.studentRewards.pointRequests[r.body.requestId];assert.equal(request.amount,3);assert.equal(request.source,'shorashim-no-hints');
 await f.call({action:'approve-point-request',requestId:r.body.requestId});assert.equal(f.tree.studentRewards.students['test-boy'].rewardBalance,23);
});
test('short or missing-audio recordings cannot create a reward request',async()=>{
 for(const options of [{durationMs:1000},{audioURL:''}]){const f=fixture(options);assert.equal((await f.repair()).status,409);assert.equal(Object.keys(f.tree.studentRewards.pointRequests).length,0);assert.equal(f.tree.studentRewards.students['test-boy'].rewardBalance,20)}
});
test('reconnecting an already approved request does not reset its approval or add points',async()=>{
 const f=fixture(),r=await f.repair();await f.call({action:'approve-point-request',requestId:r.body.requestId});
 delete f.event.pointRequestId;const repaired=await f.repair();assert.equal(repaired.body.status,'approved');assert.equal(f.event.pointRequestStatus,'approved');assert.equal(f.tree.studentRewards.students['test-boy'].rewardBalance,22);
});
