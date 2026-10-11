const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const effort=require('../backend/functions/effort-points-core.cjs');
const {recordEvent,dayKey,POINT_INTERVAL_MS,MAX_DAILY_POINTS}=effort;
const id=n=>'effort-test-event-'+String(n).padStart(5,'0');
const act=(old,time,i,tool='gematria',classId='testing',breakBefore=false)=>recordEvent(old,time,tool,classId,id(i),breakBefore);

test('open tab without learning events earns no active time or points',()=>{
  assert.equal(act(null,1000000,0).state.activeMs,0);
});
test('meaningful attempts accumulate thinking time regardless of correctness',()=>{
  let a=act(null,1000000,0).state;
  a=act(a,1060000,1).state;
  a=act(a,1120000,2).state;
  assert.equal(a.activeMs,120000);
  assert.equal(Math.floor(a.activeMs/POINT_INTERVAL_MS),0);
});
test('more than two minutes idle earns zero for the intervening period',()=>{
  let a=act(null,1000000,0).state;
  a=act(a,1000000+20*60000,1).state;
  assert.equal(a.activeMs,0);
  a=act(a,1000000+21*60000,2).state;
  assert.equal(a.activeMs,60000);
});
test('a hidden tab or new page resets its timing',()=>{
  let a=act(null,1000000,0).state;
  a=act(a,1060000,1,'gematria','testing',true).state;
  assert.equal(a.activeMs,0);
});
test('repeated event ID never earns twice',()=>{
  let a=act(null,1000000,0).state;
  let result=act(a,1060000,0);
  assert.equal(result.changed,false);
  assert.equal(result.state.activeMs,0);
});
test('switching between classes does not carry minutes across classrooms',()=>{
  let a=act(null,1000000,0,'gematria','testing').state;
  a=act(a,1060000,1,'rashi-letters','family_and_friends').state;
  assert.equal(a.activeMs,0);
  a=act(a,1120000,2,'rashi-letters','family_and_friends').state;
  assert.equal(a.activeMs,60000);
});
test('five active minutes reaches one award milestone; thirty is the daily limit',()=>{
  let state=act(null,1000000,0).state;
  for(let i=1;i<=45;i++)state=act(state,1000000+i*60000,i).state;
  assert.equal(state.activeMs,MAX_DAILY_POINTS*POINT_INTERVAL_MS);
  assert.equal(Math.floor(state.activeMs/POINT_INTERVAL_MS),MAX_DAILY_POINTS);
});
test('effort totals distinguish tools without duplicating the daily balance',()=>{
  let state=act(null,1000000,0,'yiddish').state;
  state=act(state,1060000,1,'yiddish').state;
  state=act(state,1120000,2,'rashi-letters').state;
  assert.equal(state.activeMs,120000);
  assert.equal(state.perTool.yiddish,60000);
  assert.equal(state.perTool['rashi-letters'],60000);
});
test('only approved learning tools and valid events are accepted',()=>{
  assert.equal(recordEvent(null,1000000,'tag','testing',id(0)).changed,false);
  assert.equal(recordEvent(null,1000000,'gematria','testing','x').changed,false);
});
test('points day boundary uses the owner school timezone',()=>{
  assert.notEqual(dayKey(Date.parse('2026-10-11T03:58:00Z')),dayKey(Date.parse('2026-10-11T04:02:00Z')));
});
test('learning events are explicit; no generic page-time rewards',()=>{
 const client=fs.readFileSync('effort-points.js','utf8');
 assert.match(client,/VALID\.has\(tool\)/);
 assert.match(client,/document\.hidden/);
 assert.match(client,/breakBefore:first/);
 const rashi=fs.readFileSync('rashi-letters/student.html','utf8');
 const gematria=fs.readFileSync('gematria/index.html','utf8');
 assert.match(rashi,/FunTorahEffort\?\.note\('rashi-letters'/);
 assert.match(gematria,/FunTorahEffort\?\.note\("gematria"/);
});
