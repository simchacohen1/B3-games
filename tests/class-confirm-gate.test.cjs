const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const gate=require('../class-confirm-gate.js');
test('a class named in the link is accepted as an explicit choice',()=>{
  assert.deepEqual(gate.plan(['et','wt'],'wt','et'),{mode:'explicit',id:'wt'});
});
test('with no link class and a last class, offer Continue with that class',()=>{
  assert.deepEqual(gate.plan(['et','wt'],'','wt'),{mode:'continue',id:'wt'});
});
test('with no last class, start blank on Choose a class',()=>{
  assert.deepEqual(gate.plan(['et','wt'],'',''),{mode:'choose'});
});
test('a link or last class the teacher no longer has is ignored, never opened',()=>{
  assert.deepEqual(gate.plan(['wt'],'et','et'),{mode:'choose'});
  assert.deepEqual(gate.plan(['wt'],'','et'),{mode:'choose'});
});
test('no classes at all is reported, not defaulted',()=>{
  assert.deepEqual(gate.plan([],'et','et'),{mode:'none'});
});
test('invalid class ids are dropped',()=>{
  assert.deepEqual(gate.plan(['../x'],'../x',''),{mode:'none'});
});
test('every teacher class page uses the gate and no longer defaults to the first class',()=>{
  const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
  for(const f of ['assignment-center/teacher.html','student-report/index.html','follow-teacher/teacher.js','student-rewards/teacher.js','teacher-class-rosters.js','gematria/teacher.html','class-pointer-prototype/dashboard.js','chazara/teacher.html','rashi-letters/teacher.html','shorashim/teacher.js','record_pesukim/teacher.html','weekly-quiz/teacher.html'])
    assert.match(read(f),/B3ClassGate/,f+' must use the confirm-class gate');
  assert.doesNotMatch(read('teacher-global-controls.js'),/ids\[0\]/,'quick bar must not default to the first class');
});
