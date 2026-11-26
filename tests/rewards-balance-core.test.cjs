'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const core=require('../backend/functions/rewards-balance-core.cjs');

// A fake balance whose FIRST transaction pass sees null (a cold database), like the real SDK, then retries
// with the real value if the function returns null on that first pass.
function coldRef(value){
  const box={value};
  return {box,
    get:async()=>({val:()=>box.value===undefined?null:box.value}),
    transaction:async fn=>{
      let next=fn(null);
      if(next===undefined)return {committed:false,snapshot:{val:()=>box.value}};
      if(box.value!==undefined&&box.value!==null){ // server disagrees with the cold guess: retry with the real value
        next=fn(box.value);
        if(next===undefined)return {committed:false,snapshot:{val:()=>box.value}};
      }
      box.value=next;return {committed:true,snapshot:{val:()=>box.value}};
    }};
}
test('a cold (not yet loaded) balance is never treated as 0: 122 - 5 = 117, not -5',async()=>{
  const ref=coldRef(122),r=await core.change(ref,-5);
  assert.equal(r.committed,true);assert.equal(ref.box.value,117);assert.equal(r.before,122);assert.equal(r.applied,-5);assert.equal(r.balanceAfter,117);assert.equal(r.anomaly,false);
});
test('the old formula would have produced -5 from the same cold read',()=>{
  let next=null;const fn=cur=>Number(cur||0)-5;next=fn(null);assert.equal(next,-5);
});
test('a student with no balance yet starts from 0',async()=>{
  const ref=coldRef(undefined),r=await core.change(ref,3);assert.equal(ref.box.value,3);assert.equal(r.before,0);
});
test('clamp: a negative change never takes a positive balance below 0',async()=>{
  const ref=coldRef(2),r=await core.change(ref,-5,{clamp:true});assert.equal(ref.box.value,0);assert.equal(r.applied,-2);
});
test('clamp never RAISES a negative balance (the old bug gave free points: -15 + 3 became 0)',async()=>{
  const plus=coldRef(-15),a=await core.change(plus,3,{clamp:true});assert.equal(plus.box.value,-12);assert.equal(a.applied,3);
  const minus=coldRef(-5),b=await core.change(minus,-2,{clamp:true});assert.equal(minus.box.value,-5);assert.equal(b.applied,0);
});
test('without clamp a charge may go below zero (the owner wants the -5 submit charge to)',async()=>{
  const ref=coldRef(3),r=await core.change(ref,-5);assert.equal(ref.box.value,-2);
});
test('guard refuses and writes nothing',async()=>{
  const ref=coldRef(3),r=await core.change(ref,-5,{guard:b=>b>=5});assert.equal(r.committed,false);assert.equal(r.refused,true);assert.equal(ref.box.value,3);
});
test('a drop to zero from a real balance is flagged as an anomaly',async()=>{
  const ref={get:async()=>({val:()=>122}),transaction:async fn=>({committed:true,snapshot:{val:()=>{return fn(0)}}})};
  const logs=[],orig=console.error;console.error=(...a)=>logs.push(a.join(' '));
  try{
    const r=await core.change(ref,-5);
    assert.equal(r.anomaly,true);assert.ok(logs.some(l=>l.includes('BALANCE_ANOMALY')));
  }finally{console.error=orig}
});
test('the adapter form works for code that wraps the database',async()=>{
  const box={v:10};
  const r=await core.changeWith({get:async()=>box.v,tx:async fn=>{const n=fn(box.v);if(n===undefined)return {committed:false};box.v=n;return {committed:true,snapshot:{val:()=>box.v}}}},5);
  assert.equal(box.v,15);assert.equal(r.balanceAfter,15);
});
test('every balance write in the backend goes through the safe helper',()=>{
  const fs=require('node:fs');
  for(const dir of ['functions','functions-staging'])for(const f of fs.readdirSync('backend/'+dir)){
    if(!/\.(js|cjs)$/.test(f)||f==='rewards-balance-core.cjs'||f==='rewards-purchase-core.cjs')continue;
    const s=fs.readFileSync(`backend/${dir}/${f}`,'utf8');
    assert.doesNotMatch(s,/rewardBalance`?\)?\.transaction\(cur=>\s*Number\(cur\s*\|\|\s*0\)/,`${dir}/${f} still adds to a possibly-unloaded balance`);
    assert.doesNotMatch(s,/Math\.max\(0,\s*old\s*\+\s*(amount|requested)\)/,`${dir}/${f} still clamps with Math.max(0, old + ...)`);
  }
});
