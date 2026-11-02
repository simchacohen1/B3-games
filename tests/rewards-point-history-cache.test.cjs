'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const source=fs.readFileSync('student-rewards/student.js','utf8');

test('student point history requests are coalesced and cached for one minute',()=>{
  const start=source.indexOf('async function loadActivityPointHistory(){');
  assert.notEqual(start,-1);
  const end=source.indexOf('\nasync function classRewardsApi',start);
  const loader=source.slice(start,end);
  assert.match(loader,/if\(state\.activityPointHistoryRequest\)return state\.activityPointHistoryRequest/);
  assert.match(loader,/Date\.now\(\)-loadedAt<60000/);
  assert.match(loader,/finally\(\(\)=>\{state\.activityPointHistoryRequest=null;\}\)/);
});

test('balance changes invalidate history cache without immediately refetching it',()=>{
  const start=source.indexOf('function subscribe(){');
  const end=source.indexOf('\nfunction allRatingRows',start);
  const subscription=source.slice(start,end);
  assert.match(subscription,/if\(balanceChanged\)\{\s*state\.activityPointHistoryLoadedAt=0;/);
  assert.doesNotMatch(subscription,/loadActivityPointHistory\(\)/);
});

test('returning to Progress lazily refreshes expired point history',()=>{
  const start=source.indexOf('function nav(){'),end=source.indexOf('\n\nasync function signInB3',start);
  const nav=source.slice(start,end);
  assert.match(nav,/state\.tab==='Progress'[\s\S]*?loadActivityPointHistory\(\)/);
});

