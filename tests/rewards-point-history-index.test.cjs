'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('backend/functions/student-rewards-auto-award.js','utf8');

function backend(seed,studentId='student_a',options={}){
 const tree=structuredClone(seed),reads=[],writes=[];
 const parts=p=>String(p||'').split('/').filter(Boolean);
 const get=p=>parts(p).reduce((o,k)=>o?.[k],tree);
 const set=(p,v)=>{const keys=parts(p),last=keys.pop();let o=tree;for(const k of keys)o=o[k]??={};if(v===null)delete o[last];else o[last]=structuredClone(v)};
 const snap=v=>({val:()=>structuredClone(v??null),exists:()=>v!==undefined&&v!==null,child:key=>snap(v?.[key]),forEach:fn=>{for(const [key,value] of Object.entries(v||{})){if(fn({key,val:()=>structuredClone(value)})===true)return true}return false}});
 const db={ref(path=''){const query={after:null,end:null,limit:null,last:false,ordered:false};const build=q=>({get:async()=>{reads.push({path,limit:q.limit,ordered:q.ordered});if(!q.ordered)return snap(get(path));let selected=Object.entries(get(path)||{}).sort(([a],[b])=>a.localeCompare(b)).filter(([key])=>(!q.after||key>=q.after)&&(!q.end||key<=q.end));if(q.last&&q.limit!==null)selected=selected.slice(-q.limit);else if(q.limit!==null)selected=selected.slice(0,q.limit);return snap(Object.fromEntries(selected))},update:async updates=>{writes.push(updates);for(const [p,v] of Object.entries(updates))set(p,v)},set:async value=>{if(path.endsWith('pointHistoryMigration')&&options.failCheckpoint){options.failCheckpoint=false;throw new Error('simulated checkpoint interruption')}set(path,value)},transaction:async fn=>{const current=get(path);let next;if(options.transactionCacheMiss){next=fn(null);if(next!==undefined&&current!=null)next=fn(current)}else next=fn(current);if(next!==undefined)set(path,next);return {committed:next!==undefined,snapshot:snap(get(path))}},orderByKey:()=>build({...q,ordered:true}),startAt:key=>build({...q,after:key}),endAt:key=>build({...q,end:key}),limitToFirst:n=>build({...q,last:false,limit:n}),limitToLast:n=>build({...q,last:true,limit:n})});return build(query)}};
 const admin={apps:[{}],database:()=>db,auth:()=>({verifyIdToken:async()=>options.claims||{studentRewardsStudentId:studentId,studentRewardsRole:'student'}})};
 const ctx={exports:{},require:n=>n==='firebase-admin'?admin:n==='firebase-functions/v2/https'?{onRequest:(o,fn)=>fn}:n.startsWith('./')?require('../backend/functions/'+n.slice(2)):require(n),console,Buffer,Intl,Date};
 vm.runInNewContext(source,ctx);
 return {tree,reads,writes,ctx,run:async(body)=>{const res={set(){},status(code){this.code=code;return this},json(value){this.body=value;return this},send(){}};await ctx.exports.studentRewardsAutoAward({method:'POST',headers:{authorization:'Bearer test',origin:'https://fun-torah-tools-staging.web.app'},body},res);return res}};
}

test('indexed point history reads only the authenticated student rows and preserves amounts',async()=>{
 const x=backend({studentRewards:{pointHistoryMigration:{complete:true},pointHistoryIndex:{student_a:{backfillComplete:true,requests:{own:true},adjustments:{adj:true}},student_b:{requests:{peer:true}}},pointRequests:{own:{rewardStudentId:'student_a',status:'approved',amount:4,actualAmount:3,reviewedAt:10},peer:{rewardStudentId:'student_b',status:'approved',amount:99}},pointAdjustments:{adj:{studentId:'student_a',amount:-2,createdAt:9}},classRewardContributionsByStudent:{student_a:{gift:{amount:1,createdAt:8}}}}});
 const {history:rows}=await x.ctx.studentPointHistory('student_a');
 assert.deepEqual(Array.from(rows,r=>r.actualAmount).sort((a,b)=>a-b),[-2,-1,3]);
 assert.ok(x.reads.some(r=>r.path==='studentRewards/pointHistoryIndex/student_a'));
 assert.ok(!x.reads.some(r=>r.path==='studentRewards/pointRequests'));
 assert.ok(!x.reads.some(r=>r.path==='studentRewards/pointAdjustments'));
 assert.ok(!x.reads.some(r=>r.path.endsWith('/peer')));
});

test('legacy records remain untouched until the bounded migration indexes them',async()=>{
 const x=backend({studentRewards:{pointHistoryMigration:{complete:true},pointHistoryIndex:{student_a:{requests:{old:true},adjustments:{a:true}}},pointRequests:{old:{rewardStudentId:'student_a',status:'approved',amount:5},peer:{rewardStudentId:'student_b',status:'approved',amount:90}},pointAdjustments:{a:{studentId:'student_a',amount:2},b:{studentId:'student_b',amount:7}}}});
 const result=await x.ctx.studentPointHistory('student_a');
 assert.equal(result.history.length,2);
 assert.deepEqual(Object.keys(x.tree.studentRewards.pointHistoryIndex.student_a.requests),['old']);
 assert.ok(x.tree.studentRewards.pointRequests.old);
 assert.ok(!x.tree.studentRewards.pointHistoryIndex.student_a.requests.peer);
});

test('new request creation maintains the private per-student index',()=>{
 assert.match(source,/pointHistoryIndex\/\$\{studentId\}\/\$\{kind\}\/\$\{id\}/);
 assert.match(source,/studentPointHistoryIndexUpdates\("requests",requestId,String\(finalValue\.rewardStudentId\)\)/);
});

test('request transaction creates the record and separate index write cannot overwrite it',async()=>{
 const x=backend({studentRewards:{students:{student_a:{name:'Fictional Student',classId:'class_a'}},pointRequests:{}}});
 const start=source.indexOf('async function studentInfo('),end=source.indexOf('\n\nfunction dateKeyInNewYork',start);
 vm.runInContext(source.slice(start,end)+';globalThis.createPendingRequest=createPendingRequest;',x.ctx);
 const args={requestId:'fictional_request',rewardStudentId:'student_a',studentId:'practice_a',source:'chazara',amount:1,reason:'Synthetic'};
 await x.ctx.createPendingRequest(args);
 const requestPath='studentRewards/pointRequests/fictional_request';
 const indexPath='studentRewards/pointHistoryIndex/student_a/requests/fictional_request';
 const write=x.writes.find(update=>Object.hasOwn(update,indexPath));
 assert.ok(write);
 assert.equal(write[indexPath],true);
 assert.ok(!Object.hasOwn(write,requestPath),'index update must not write a stale request snapshot');
 assert.equal(x.tree.studentRewards.pointRequests.fictional_request.status,'pending');
 // Simulate an index update lost after the request transaction committed.
 delete x.tree.studentRewards.pointHistoryIndex.student_a.requests.fictional_request;
 x.tree.studentRewards.pointRequests.fictional_request.status='approved';
 const retry=await x.ctx.createPendingRequest(args);
 assert.equal(retry.created,false);
 assert.equal(retry.status,'approved');
 assert.equal(x.tree.studentRewards.pointHistoryIndex.student_a.requests.fictional_request,true,'retry repairs missing index');
 assert.equal(x.tree.studentRewards.pointRequests.fictional_request.status,'approved','retry preserves teacher decision');
});

test('migration advances in small resumable batches and is safe to retry',async()=>{
 const seed={studentRewards:{pointRequests:Object.fromEntries(Array.from({length:205},(_,i)=>[`r${String(i).padStart(3,'0')}`,{rewardStudentId:i%2?'student_b':'student_a'}])),pointAdjustments:{a:{studentId:'student_a'}}}};
 const options={failCheckpoint:true},x=backend(seed,'student_a',options);
 await assert.rejects(x.ctx.migratePointHistoryBatch(),/simulated checkpoint interruption/);
 assert.equal(x.tree.studentRewards.pointHistoryMigration,undefined);
 assert.equal(Object.keys(x.tree.studentRewards.pointHistoryIndex.student_a.requests).length,50,'index writes finish before a failed checkpoint');
 let first=await x.ctx.migratePointHistoryBatch();
 assert.equal(first.processed,100);assert.equal(first.phase,'requests');assert.equal(first.cursor,'r099');
 const state=x.tree.studentRewards.pointHistoryMigration;
 assert.equal(state.cursor,'r099');assert.equal(Object.keys(x.tree.studentRewards.pointHistoryIndex.student_a.requests).length,50);
 assert.equal(Object.keys(x.tree.studentRewards.pointHistoryIndex.student_a.requests).length,50,'retrying the interrupted first batch adds no duplicate keys');
 const second=await x.ctx.migratePointHistoryBatch();
 assert.equal(second.cursor,'r199');
 const third=await x.ctx.migratePointHistoryBatch();
 assert.equal(third.phase,'adjustments');
 const fourth=await x.ctx.migratePointHistoryBatch();
 assert.equal(fourth.complete,true);assert.equal(x.tree.studentRewards.pointHistoryMigration.complete,true);
 assert.equal(Object.keys(x.tree.studentRewards.pointHistoryIndex.student_a.requests).length,103);
 const indexed=Object.keys(x.tree.studentRewards.pointHistoryIndex.student_a.requests).sort();
 assert.deepEqual(indexed,Array.from({length:205},(_,i)=>`r${String(i).padStart(3,'0')}`).filter((_,i)=>i%2===0));
 assert.ok(x.reads.filter(r=>['studentRewards/pointRequests','studentRewards/pointAdjustments'].includes(r.path)).every(r=>r.ordered&&r.limit!==null&&r.limit<=102),'every global ledger read is bounded to one migration page');
});

test('migration releases its lease when a transaction first sees an uncached null',async()=>{
 const x=backend({studentRewards:{pointRequests:{r:{rewardStudentId:'student_a'}},pointAdjustments:{a:{studentId:'student_a'}}}},'student_a',{transactionCacheMiss:true});
 const first=await x.ctx.migratePointHistoryBatch();
 assert.equal(first.phase,'adjustments');
 assert.equal(x.tree.studentRewards.pointHistoryMigrationLease,undefined,'the owned lease is removed after the request page');
 const second=await x.ctx.migratePointHistoryBatch();
 assert.equal(second.complete,true);
 assert.equal(x.tree.studentRewards.pointHistoryMigrationLease,undefined,'the owned lease is removed after completion');
});

test('a transaction cache miss cannot steal another active migration lease',async()=>{
 const existing={ownerToken:'another_batch',expiresAt:Date.now()+60000};
 const x=backend({studentRewards:{pointRequests:{r:{rewardStudentId:'student_a'}},pointHistoryMigrationLease:existing}},'student_a',{transactionCacheMiss:true});
 const result=await x.ctx.migratePointHistoryBatch();
 assert.equal(result.busy,true);
 assert.deepEqual(x.tree.studentRewards.pointHistoryMigrationLease,existing);
 assert.equal(x.tree.studentRewards.pointHistoryMigration,undefined);
});

test('empty request ledger advances directly to adjustments and empty final ledger completes',async()=>{
 const x=backend({studentRewards:{pointRequests:{},pointAdjustments:{}}});
 const first=await x.ctx.migratePointHistoryBatch();
 assert.equal(first.phase,'adjustments');assert.equal(first.processed,0);
 const second=await x.ctx.migratePointHistoryBatch();
 assert.equal(second.complete,true);assert.equal(second.phase,'complete');
});

test('records added after the captured high-water mark are independently indexed',async()=>{
 const x=backend({studentRewards:{pointRequests:{old:{rewardStudentId:'student_a',status:'approved',amount:2}}}});
 const first=await x.ctx.migratePointHistoryBatch();
 assert.equal(first.phase,'adjustments');
 x.tree.studentRewards.pointRequests.newer={rewardStudentId:'student_a',status:'approved',amount:3};
 x.tree.studentRewards.pointHistoryIndex.student_a??={requests:{}};
 x.tree.studentRewards.pointHistoryIndex.student_a.requests.newer=true;
 const next=await x.ctx.migratePointHistoryBatch();
 assert.equal(next.complete,true);
 assert.deepEqual(Object.keys(x.tree.studentRewards.pointHistoryIndex.student_a.requests).sort(),['newer','old']);
});

test('student history is bound to the verified token and never accepts a supplied peer ID',async()=>{
 const x=backend({studentRewards:{pointHistoryMigration:{complete:true},pointHistoryIndex:{student_a:{requests:{own:true}},student_b:{requests:{peer:true}}},pointRequests:{own:{rewardStudentId:'student_a',status:'approved',amount:2},peer:{rewardStudentId:'student_b',status:'approved',amount:90}}}});
 const result=await x.run({action:'student-point-history',studentId:'student_b'});
 assert.equal(result.code,200);
 assert.deepEqual(Array.from(result.body.history,r=>r.id),['own']);
 assert.ok(!x.reads.some(r=>r.path.endsWith('/peer')));
});

test('only the verified owner can advance the history migration',async()=>{
 const student=backend({studentRewards:{} });
 const denied=await student.run({action:'migrate-point-history-index'});
 assert.equal(denied.code,401);
 const teacher=backend({studentRewards:{}},'student_a',{claims:{uid:'teacher',email:'teacher@example.test',email_verified:true}});
 const forbidden=await teacher.run({action:'migrate-point-history-index'});
 assert.equal(forbidden.code,401);
 const owner=backend({studentRewards:{}},'student_a',{claims:{uid:'owner',email:'simcha5770@gmail.com',email_verified:true}});
 const allowed=await owner.run({action:'migrate-point-history-index'});
 assert.equal(allowed.code,200);
 assert.equal(allowed.body.phase,'adjustments');
});























