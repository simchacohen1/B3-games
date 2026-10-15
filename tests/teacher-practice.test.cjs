const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'teacher-practice.js'), 'utf8');
function harness(search='?class=et') {
  const window = { B3_WORKSPACE_ID:'b3-2026', B3SiteSettings:{workspaceId:'b3-2026'} };
  const module = {exports:{}};
  const context = {module,window,location:{search},URLSearchParams,FileReader,Promise,Map};
  // Fake file reader is deliberately not required for path/security tests.
  delete context.FileReader;
  vm.runInNewContext(code,context,{filename:'teacher-practice.js'});
  const writes=[];
  const db={ref(name=''){
    const value = {active:true,toolGrants:{chazara:true,'posuk-practice-scroll':true,shorashim:true,'rashi-letters':true}};
    return {
      path:name,
      once:async()=>({val:()=>value,exists:()=>true}),
      set:async item=>{writes.push({name,item});},
      update:async item=>{writes.push({name,item});},
      remove:async()=>{writes.push({name,remove:true});},
      child(child){return db.ref(name+'/'+child);},
      on(){},off(){}
    };
  }};
  return {api:module.exports,db,writes};
}
const access={authorized:true,role:'teacher',classIds:['et']};
test('each teacher owns a separate cloud profile',async()=>{
  const {api,db}=harness();
  const a=await api.open(db,{uid:'teacherA'},access,'chazara');
  const b=await api.open(db,{uid:'teacherB'},access,'chazara');
  assert.notEqual(a.root,b.root);
  assert.match(a.root,/^teacherPractice\/b3-2026\/teacherA\/et$/);
});
test('teacher student actions are mapped to their private namespace',async()=>{
  const {api,db,writes}=harness();
  const p=await api.open(db,{uid:'teacherA'},access,'chazara');
  const adapter=p.dbAdapter(db);
  await adapter.ref('posukPractice/attempts/teacher_preview/18_25/a1').set({hebrewScore:100});
  await adapter.ref('posukPractice/chazara/events/teacher_preview/e1').update({reviewApplied:true});
  assert.deepEqual(writes.map(w=>w.name),[p.path('posuk/attempts/18_25/a1'),p.path('chazara/events/e1')]);
});
test('practice cannot write student or classroom records',async()=>{
  const {api,db,writes}=harness();
  const p=await api.open(db,{uid:'teacherA'},access,'chazara');
  await assert.rejects(p.dbAdapter(db).ref('posukPractice/attempts/real-boy').set({anything:true}),/cannot edit shared/);
  await assert.rejects(p.dbAdapter(db).ref('b3Games/siteSettings').update({siteEnabled:false}),/cannot edit shared/);
  assert.equal(writes.length,0);
});
test('teacher cannot switch to an unassigned class',async()=>{
  const {api,db}=harness('?class=wt');
  await assert.rejects(api.open(db,{uid:'teacherA'},access,'chazara'),/not assigned/);
});
test('invalid or inactive teacher is rejected',async()=>{
  const {api,db}=harness();
  await assert.rejects(api.open(db,{uid:'teacherA'},{authorized:false,role:'teacher',classIds:['et']},'chazara'),/Sign in/);
});
test('private database rules exist outside publicly readable b3Games node',()=>{
  const rules=JSON.parse(fs.readFileSync(path.join(__dirname,'..','firebase-rules.json'),'utf8')).rules;
  assert.ok(rules.teacherPractice.$workspaceId.$uid.$classId['.read'].includes('auth.uid == $uid'));
  assert.ok(rules.teacherPractice.$workspaceId.$uid.$classId['.write'].includes('auth.uid == $uid'));
  assert.equal(rules.teacherPractice['.read'],undefined);
});
