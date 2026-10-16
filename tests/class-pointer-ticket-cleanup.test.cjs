'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const crypto=require('node:crypto');

function loadCleanup(shareRows={},joinRows={},indexRows={}){
  let scheduled,queries={};
  const makeCollection=(refPath,rows)=>({
    orderByChild(field){(queries[refPath]??={}).orderByChild=field;return this},
    endAt(value){queries[refPath].endAt=value;return this},
    limitToFirst(value){queries[refPath].limitToFirst=value;return this},
    once:async()=>({val:()=>Object.fromEntries(Object.entries(rows).filter(([,row])=>row.expiresAt<=queries[refPath].endAt).slice(0,queries[refPath].limitToFirst))}),
    update:async updates=>{for(const [key,next] of Object.entries(updates))if(next===null)delete rows[key]}
  });
  const refs={
    'b3Private/classPointerShareTickets':makeCollection('b3Private/classPointerShareTickets',shareRows),
    'b3Private/classPointerJoinTickets':makeCollection('b3Private/classPointerJoinTickets',joinRows)
  };
  const db={ref:refPath=>{
    if(refs[refPath])return refs[refPath];
    const prefix='b3Private/classPointerJoinTicketIndex/';
    if(refPath.startsWith(prefix)){
      const key=refPath.slice(prefix.length);
      return{transaction:async callback=>{
        const before=indexRows[key]??null,after=callback(before);
        if(after===undefined)return{committed:false,snapshot:{val:()=>before}};
        if(after===null)delete indexRows[key];else indexRows[key]=after;
        return{committed:true,snapshot:{val:()=>after}};
      }};
    }
    throw Error('Unexpected database ref '+refPath);
  }};
  const admin={apps:[{}],initializeApp(){},database:()=>db};
  const file=path.join(__dirname,'../backend/functions/class-pointer-share-ticket-cleanup.js');
  const source=fs.readFileSync(file,'utf8');
  const sandbox={module:{exports:{}},exports:{},Date,Number,Object,console,require:name=>{
    if(name==='firebase-functions/v2/scheduler')return{onSchedule:(_options,handler)=>{scheduled=handler;return handler}};
    if(name==='firebase-admin')return admin;
    if(name==='node:crypto')return crypto;
    throw Error('Unexpected import '+name);
  }};
  vm.runInNewContext(source,sandbox);
  return{scheduled,queries,shareRows,joinRows,indexRows,db,cleanup:sandbox.module.exports._cleanupExpiredTickets};
}

test('scheduled cleanup deletes expired sharing and join tickets, but preserves unexpired tickets and indexes',async()=>{
  const now=Date.now(),expiredShare='a'.repeat(64),expiredJoin='b'.repeat(64),activeJoin='c'.repeat(64);
  const studentId='student-synthetic',studentKey=crypto.createHash('sha256').update(studentId).digest('hex').slice(0,32);
  const f=loadCleanup(
    {[expiredShare]:{expiresAt:now-1},['d'.repeat(64)]:{expiresAt:now+60000}},
    {[expiredJoin]:{studentId,expiresAt:now-1},[activeJoin]:{studentId,expiresAt:now+60000}},
    {[studentKey]:activeJoin}
  );
  f.indexRows[studentKey]=expiredJoin;
  await f.scheduled();
  assert.equal(f.shareRows[expiredShare],undefined);
  assert.equal(f.shareRows['d'.repeat(64)].expiresAt,now+60000);
  assert.equal(f.joinRows[expiredJoin],undefined);
  assert.equal(f.joinRows[activeJoin].expiresAt,now+60000);
  assert.equal(f.indexRows[studentKey],activeJoin,'cleanup must preserve a newer ticket index');
  for(const collection of ['b3Private/classPointerShareTickets','b3Private/classPointerJoinTickets']){
    assert.equal(f.queries[collection].orderByChild,'expiresAt');
    assert.ok(f.queries[collection].endAt>=now);
    assert.equal(f.queries[collection].limitToFirst,500);
  }
});

test('cleanup removes only an index that still references the expired join ticket',async()=>{
  const studentId='student-race',studentKey=crypto.createHash('sha256').update(studentId).digest('hex').slice(0,32);
  const oldTicket='e'.repeat(64),newTicket='f'.repeat(64);
  const f=loadCleanup({}, {[oldTicket]:{studentId,expiresAt:Date.now()-1}}, {[studentKey]:newTicket});
  assert.equal(await f.cleanup(f.db),1);
  assert.equal(f.joinRows[oldTicket],undefined);
  assert.equal(f.indexRows[studentKey],newTicket);
});

test('cleanup is bounded to one indexed batch of at most 500 expired tickets per collection',async()=>{
  const now=Date.now(),shareRows={},joinRows={};
  for(let i=0;i<501;i++){shareRows[i.toString(16).padStart(64,'0')]={expiresAt:now-1};joinRows[(i+1000).toString(16).padStart(64,'0')]={expiresAt:now-1};}
  const f=loadCleanup(shareRows,joinRows);
  await f.scheduled();
  assert.equal(f.queries['b3Private/classPointerShareTickets'].limitToFirst,500);
  assert.equal(f.queries['b3Private/classPointerJoinTickets'].limitToFirst,500);
  assert.equal(Object.keys(f.shareRows).length,1);
  assert.equal(Object.keys(f.joinRows).length,1);
});

test('database rules keep Pointer ticket data private and index expiry for cleanup',()=>{
  const rules=JSON.parse(fs.readFileSync(path.join(__dirname,'../firebase-rules.json'),'utf8')).rules;
  assert.equal(rules.b3Private['.read'],false);
  assert.equal(rules.b3Private['.write'],false);
  assert.deepEqual(Array.from(rules.b3Private.classPointerShareTickets['.indexOn']),['expiresAt']);
  assert.deepEqual(Array.from(rules.b3Private.classPointerJoinTickets['.indexOn']),['expiresAt']);
});
