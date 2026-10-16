'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function loadCleanup(rows){
  let scheduled,query={},updates=null;
  const tickets={
    orderByChild(field){query.orderByChild=field;return this},
    endAt(value){query.endAt=value;return this},
    limitToFirst(value){query.limitToFirst=value;return this},
    once:async()=>({val:()=>Object.fromEntries(Object.entries(rows).filter(([,row])=>row.expiresAt<=query.endAt).slice(0,query.limitToFirst))}),
    update:async value=>{updates=value;for(const [key,next] of Object.entries(value))if(next===null)delete rows[key]}
  };
  const db={ref:ref=>{assert.equal(ref,'b3Private/classPointerShareTickets');return tickets}};
  const admin={apps:[{}],initializeApp(){},database:()=>db};
  const file=path.join(__dirname,'../backend/functions/class-pointer-share-ticket-cleanup.js');
  const source=fs.readFileSync(file,'utf8');
  const sandbox={module:{exports:{}},exports:{},Date,Number,Object,console,require:name=>{
    if(name==='firebase-functions/v2/scheduler')return{onSchedule:(_options,handler)=>{scheduled=handler;return handler}};
    if(name==='firebase-admin')return admin;
    throw Error('Unexpected import '+name);
  }};
  vm.runInNewContext(source,sandbox);
  return{scheduled,query,get updates(){return updates},rows};
}

test('scheduled cleanup deletes expired tickets and preserves unexpired tickets',async()=>{
  const now=Date.now(),rows={
    ['a'.repeat(64)]:{expiresAt:now-1},
    ['b'.repeat(64)]:{expiresAt:now+60000}
  };
  const f=loadCleanup(rows);
  await f.scheduled();
  assert.equal(Object.keys(f.updates).length,1);
  assert.equal(f.rows['a'.repeat(64)],undefined);
  assert.equal(f.rows['b'.repeat(64)].expiresAt,now+60000);
  assert.equal(f.query.orderByChild,'expiresAt');
  assert.ok(f.query.endAt>=now);
});

test('cleanup is bounded to one indexed batch of at most 500 expired tickets',async()=>{
  const now=Date.now(),rows={};
  for(let i=0;i<501;i++)rows[i.toString(16).padStart(64,'0')]={expiresAt:now-1};
  const f=loadCleanup(rows);
  await f.scheduled();
  assert.equal(f.query.limitToFirst,500);
  assert.equal(Object.keys(f.updates).length,500);
  assert.equal(Object.keys(f.rows).length,1);
});

test('database rules keep ticket data private and index expiry for cleanup',()=>{
  const rules=JSON.parse(fs.readFileSync(path.join(__dirname,'../firebase-rules.json'),'utf8')).rules;
  assert.equal(rules.b3Private['.read'],false);
  assert.equal(rules.b3Private['.write'],false);
  assert.deepEqual(Array.from(rules.b3Private.classPointerShareTickets['.indexOn']),['expiresAt']);
});
