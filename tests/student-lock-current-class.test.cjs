const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const core=require('../student-lock-core.js');
const now=Date.parse('2026-11-25T17:00:00Z'),parts=core.nyParts(now);
const lockedAll=()=>({features:Object.fromEntries(core.FEATURES.map(f=>[f.id,{locked:true}]))});
// A schedule line that covers right now (all days, all day) and one that never does.
const coversNow={name:'T',rules:{a:{days:core.DAYS.slice(),start:'00:00',end:'23:59',targets:['*']}}};
const never={name:'T',rules:{a:{days:core.DAYS.filter(d=>d!==parts.day&&d!==String(parts.weekday||'').slice(0,3).toLowerCase()).slice(0,1),start:'03:00',end:'03:01',targets:['*']}}};
const open={opened:{u:1}};
const stateOf=(locksByClass,live,feature='shorashim')=>{
  const ctx=core.contextClass(locksByClass,live,now);
  const list=ctx?[locksByClass[ctx]]:Object.keys(locksByClass).map(k=>locksByClass[k]);
  return {ctx,state:core.evaluateStudent(list,now)[feature]};
};

test('1. a boy following a live lesson gets the locks of that lesson’s class, not another class’s',()=>{
  const classes={morning:open,afternoon:lockedAll()};
  const r=stateOf(classes,'morning');
  assert.equal(r.ctx,'morning');assert.equal(r.state.locked,false,'afternoon’s locks no longer lock the morning');
  const pointer=stateOf(classes,'morning','class-pointer');assert.equal(pointer.state.locked,false,'Class Pointer (and so Share My Screen) is not locked');
  // and the live class’s own lock still applies
  const locked=stateOf({morning:lockedAll(),afternoon:open},'morning');assert.equal(locked.state.locked,true);
});

test('2. with no live lesson, the one class whose schedule covers now decides',()=>{
  const inSession={schedules:{u:coversNow}},classes={morning:{opened:{u:1}},afternoon:{...lockedAll(),schedules:{}}};
  // morning in session (but its schedule locks everything while it runs? use a schedule with no targets of its own) -> only morning counts
  const only={morning:{schedules:{u:{name:'T',rules:{a:{days:core.DAYS.slice(),start:'00:00',end:'23:59',targets:['gematria']}}}}},afternoon:lockedAll()};
  const r=stateOf(only,'');assert.equal(r.ctx,'morning');assert.equal(r.state.locked,false,'shorashim is not on morning’s schedule and afternoon’s locks are ignored');
  assert.equal(stateOf(only,'','gematria').state.locked,true,'what morning’s own schedule locks is locked');
});

test('3. with neither a live lesson nor exactly one class in session, the old rule applies (locked if any class locks it)',()=>{
  const classes={morning:open,afternoon:lockedAll()};
  const r=stateOf(classes,'');assert.equal(r.ctx,null);assert.equal(r.state.locked,true);
  // two classes both in session: still the old rule
  const both={a:{schedules:{u:coversNow}},b:{schedules:{u:coversNow}}};assert.equal(core.contextClass(both,'',now),null);
  // a live lesson whose class locks are not loaded yet falls back instead of guessing
  assert.equal(core.contextClass({afternoon:lockedAll()},'morning',now),null);
  assert.equal(core.contextClass({},'',now),null);
});

test('the browser copy and the server copy of the lock rules are identical, and the pages are wired to the live class',()=>{
  const norm=f=>fs.readFileSync(__dirname+'/../'+f,'utf8').replace(/\r\n/g,'\n');
  assert.equal(norm('student-lock-core.js'),norm('backend/functions/student-lock-core.js'));
  assert.match(norm('student-lock.js'),/core\.contextClass\(locksByClass, live, now\)/);
  assert.match(norm('class-pointer-prototype/activity-share.js'),/window\.ClassPointerLiveClass=liveClass/);
});
