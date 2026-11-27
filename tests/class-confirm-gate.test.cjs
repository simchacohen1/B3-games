const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const gate=require('../class-confirm-gate.js');
test('a class named in the link is accepted as an explicit choice',()=>{
  assert.deepEqual(gate.plan(['et','wt'],'wt','et'),{mode:'explicit',id:'wt'});
});
test('with no link class and a saved site-wide class, use it without asking',()=>{
  assert.deepEqual(gate.plan(['et','wt'],'','wt'),{mode:'saved',id:'wt'});
});
test('with no saved class and several classes, ask once',()=>{
  assert.deepEqual(gate.plan(['et','wt'],'',''),{mode:'choose'});
});
test('a link or saved class the teacher no longer has is ignored, never opened',()=>{
  assert.deepEqual(gate.plan(['wt','x'],'et','et'),{mode:'choose'});
  assert.deepEqual(gate.plan(['wt','x'],'','et'),{mode:'choose'});
});
test('a teacher with exactly one class is never asked',()=>{
  assert.deepEqual(gate.plan(['wt'],'','et'),{mode:'only',id:'wt'});
});
test('the site-wide choice may be All classes; one-class pages use the latest single class',()=>{
  assert.deepEqual(gate.plan(['et','wt'],'','all',true,'wt'),{mode:'saved',id:'all'});
  assert.deepEqual(gate.plan(['et','wt'],'','all',false,'wt'),{mode:'saved',id:'wt'});
  assert.deepEqual(gate.plan(['et','wt'],'','all',false,''),{mode:'choose'});
  assert.deepEqual(gate.plan(['et','wt'],'et','wt'),{mode:'explicit',id:'et'});
});
test('classes are spelled the same everywhere: B3 ET and B3 WT',()=>{
  assert.equal(gate.label('et','East Track'),'B3 ET');
  assert.equal(gate.label('wt'),'B3 WT');
  assert.equal(gate.label('all'),'All classes');
  assert.equal(gate.label('abc','Grade 4'),'Grade 4');
});
test('the site-wide class is saved per account and shared by every page',()=>{
  const store={};
  global.localStorage={getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v)}};
  gate.setSite('wt');
  assert.equal(gate.getSite(),'wt');
  gate.setSite('all');
  assert.equal(gate.getSite(),'all');
  assert.equal(gate.getLast(),'wt');
  delete global.localStorage;
});
test('the teacher toolbar has the class button, and Teacher Home follows the saved class',()=>{
  const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
  assert.match(read('teacher-global-controls.js'),/fttTeacherClassBtn/);
  assert.match(read('teacher-home.html'),/B3ClassGate/);
  assert.match(read('teacher-home.html'),/b3-class-changed/);
  assert.match(read('sync-to-nigri/index.html'),/B3ClassGate/);
  assert.match(read('activity-history/index.html'),/B3ClassGate/);
});
test('no classes at all is reported, not defaulted',()=>{
  assert.deepEqual(gate.plan([],'et','et'),{mode:'none'});
});
test('invalid class ids are dropped',()=>{
  assert.deepEqual(gate.plan(['../x'],'../x',''),{mode:'none'});
});
test('every teacher class page uses the gate and no longer defaults to the first class',()=>{
  const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
  for(const f of ['assignment-center/teacher.html','student-report/index.html','follow-teacher/teacher.js','student-rewards/teacher.js','teacher-class-rosters.js','gematria/teacher.html','chayus-meter/teacher.html','class-pointer-prototype/dashboard.js','chazara/teacher.html','rashi-letters/teacher.html','shorashim/teacher.js','record_pesukim/teacher.html','weekly-quiz/teacher.html'])
    assert.match(read(f),/B3ClassGate/,f+' must use the confirm-class gate');
  assert.doesNotMatch(read('teacher-global-controls.js'),/ids\[0\]/,'quick bar must not default to the first class');
});
test('"All my classes" works only where a page asks for it (Chazara)',()=>{
  assert.deepEqual(gate.plan(['et','wt'],'all','et',true),{mode:'explicit',id:'all'});
  assert.deepEqual(gate.plan(['et','wt'],'all','',false),{mode:'choose'});
  assert.deepEqual(gate.plan(['et','wt'],'all','et'),{mode:'saved',id:'et'});
  const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
  assert.match(read('chazara/teacher.html'),/'b3-2026',true\)/);
  for(const f of ['assignment-center/teacher.html','student-report/index.html','follow-teacher/teacher.js','student-rewards/teacher.js','teacher-class-rosters.js','gematria/teacher.html','chayus-meter/teacher.html','class-pointer-prototype/dashboard.js','rashi-letters/teacher.html','shorashim/teacher.js','record_pesukim/teacher.html','weekly-quiz/teacher.html'])
    assert.doesNotMatch(read(f),/B3ClassGate[^\n]*allowAll|requireInUrl\([^\n]*,\s*true\s*\)/,f+' must require one class');
});
test('the owner\'s class pickers list only B3 ET and B3 WT; teachers see all their classes',()=>{
  const ids=['et','wt','kriah','x'];
  global.B3SiteSettings={getCurrentAccess:()=>({role:'admin'})};
  assert.deepEqual(gate.pickable(ids),['et','wt']);
  assert.deepEqual(gate.pickable(['a','b']),['a','b']);
  global.B3SiteSettings={getCurrentAccess:()=>({role:'teacher'})};
  assert.deepEqual(gate.pickable(ids),ids);
  delete global.B3SiteSettings;
});
test('owner dropdowns inside tools are limited to B3 ET and B3 WT; admin pages are not',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','class-confirm-gate.js'),'utf8');
  assert.match(src,/limitOwnerDropdowns/);
  assert.match(src,/admin\|owner-admin/);
});
test('Class Pointer and the quick-panel class lists use the owner filter',()=>{
  const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
  assert.match(read('class-pointer-prototype/dashboard-session.js'),/B3ClassGate\?\.pickable/);
  assert.match(read('class-pointer-prototype/dashboard.js'),/B3ClassGate\?\.pickable/);
  assert.match(read('class-pointer-prototype/classroom.html'),/class-confirm-gate\.js/);
  assert.match(read('teacher-global-controls.js'),/pickableClasses\(\)\.forEach/);
  assert.match(read('class-confirm-gate.js'),/pointerClassChoice/);
});
