const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const cap=require('../backend/functions/chazara-cap-core.cjs');

const NOW=Date.parse('2026-11-18T15:00:00Z');
const keyOf=v=>String(v).replace(/[^A-Za-z0-9_-]/g,'-');
function fakeStore(rows={},{lockHeld=false}={}){
  const tree={studentRewards:{pointRequests:rows,chazaraGate:lockHeld?{s1:{at:NOW-1000}}:{}}};
  const calls=[];
  return {calls,tree,
    get:async p=>p.split('/').reduce((o,k)=>o?.[k],tree)??null,
    tx:async(p,fn)=>{const parts=p.split('/'),last=parts.pop(),o=parts.reduce((x,k)=>x[k]??={},tree),next=fn(o[last]??null);calls.push([p,next]);if(next===undefined)return {committed:false};if(next===null)delete o[last];else o[last]=next;return {committed:true}},
    range:async prefix=>Object.fromEntries(Object.entries(tree.studentRewards.pointRequests).filter(([k])=>k.startsWith(prefix)))};
}
const req=(n,extra={})=>[`chazara_s1_e${n}`,{source:'chazara-recording',status:'approved',perek:18,posuk:4,createdAt:NOW-n*1000,practiceStudentId:'s1',...extra}];
const rows=(...l)=>Object.fromEntries(l);
const run=(store,over={})=>cap.guard({store,studentId:'s1',perek:18,posuk:4,requestId:'chazara_s1_new',keyOf,nowMs:NOW,...over});

test('the first two Chazaras of a posuk in a day are allowed, the third is refused',async()=>{
  assert.equal((await run(fakeStore(rows()))).ok,true);
  assert.equal((await run(fakeStore(rows(req(1))))).ok,true);
  const r=await run(fakeStore(rows(req(1),req(2))));
  assert.equal(r.ok,false);assert.equal(r.code,409);assert.equal(r.limit,true);assert.match(r.error,/Maximum 2/);
});
test('a student who tapped 35 recordings on one posuk is cut off at 2',async()=>{
  const many=rows(...Array.from({length:35},(_,i)=>req(i+1)));
  assert.equal((await run(fakeStore(many))).ok,false);
});
test('a different posuk, or a different day, has its own allowance',async()=>{
  const full=rows(req(1),req(2));
  assert.equal((await run(fakeStore(full),{posuk:5})).ok,true);
  assert.equal((await run(fakeStore(full),{nowMs:NOW+36*3600*1000,dayMs:NOW+36*3600*1000})).ok,true);
});
test('cancelled, rejected and teacher-entered requests do not use up a slot',async()=>{
  const free=rows(req(1,{status:'cancelled'}),req(2,{status:'rejected'}),req(3,{teacherEntered:true}),req(4,{source:'shorashim-recording'}));
  assert.equal((await run(fakeStore(free))).ok,true);
  const used=rows(req(1,{status:'pending'}),req(2,{status:'processing'}));
  assert.equal((await run(fakeStore(used))).ok,false);
});
test('other students never count against this one',async()=>{
  const other=rows(['chazara_s2_e1',{source:'chazara',status:'approved',perek:18,posuk:4,createdAt:NOW}],['chazara_s2_e2',{source:'chazara',status:'approved',perek:18,posuk:4,createdAt:NOW}]);
  assert.equal((await run(fakeStore(other))).ok,true);
});
test('a retry of a request that already exists is always allowed (idempotent)',async()=>{
  const full=rows(req(1),req(2),['chazara_s1_new',{source:'chazara',status:'approved',perek:18,posuk:4,createdAt:NOW}]);
  const r=await run(fakeStore(full));assert.equal(r.ok,true);assert.equal(r.existing,true);
});
test('two taps at the same moment cannot both pass: the second is told to wait',async()=>{
  const r=await run(fakeStore(rows(),{lockHeld:true}));
  assert.equal(r.ok,false);assert.equal(r.code,429);
});
test('the lock is released after a pass and after a refusal',async()=>{
  const s=fakeStore(rows());const ok=await run(s);assert.equal(ok.ok,true);await ok.release();assert.equal(s.tree.studentRewards.chazaraGate.s1,undefined);
  const s2=fakeStore(rows(req(1),req(2)));const no=await run(s2);assert.equal(no.ok,false);assert.equal(s2.tree.studentRewards.chazaraGate.s1,undefined);
});
test('requests keep their saved school day, so a late repair counts on the event day',async()=>{
  const saved=rows(req(1,{chazaraDay:'2026-11-17'}),req(2,{chazaraDay:'2026-11-17'}));
  assert.equal((await run(fakeStore(saved),{dayMs:Date.parse('2026-11-17T20:00:00Z')})).ok,false);
  assert.equal((await run(fakeStore(saved))).ok,true);
});
test('the server code uses the cap and a correct key-range query',()=>{
  for(const f of ['backend/functions/student-rewards-auto-award.js','backend/functions-staging/student-rewards-auto-award.js']){
    const s=fs.readFileSync(f,'utf8');
    assert.ok(s.includes("require('./chazara-cap-core.cjs')"),f);
    assert.ok(s.includes('chazaraCap.guard('),f);
    assert.ok(s.includes('.orderByKey().startAt(prefix).endAt(prefix+"\\uf8ff")'),f+' range end must be the escaped \\uf8ff');
    assert.equal(fs.readFileSync(f.replace('student-rewards-auto-award.js','chazara-cap-core.cjs'),'utf8'),fs.readFileSync('backend/functions/chazara-cap-core.cjs','utf8'),'staging copy matches');
  }
});
test('live database rules only let a student write their own Chazara records',()=>{
  const rules=JSON.parse(fs.readFileSync('firebase-rules.json','utf8')).rules.posukPractice.chazara;
  assert.equal(rules['$section'],undefined,'no open wildcard write');
  for(const k of ['students','events']){
    const w=rules[k]['$studentId']['.write'];
    assert.equal(w,'auth != null && auth.token.b3StudentId == $studentId');
  }
  assert.equal(rules['.read'],true,'reads unchanged');
});
