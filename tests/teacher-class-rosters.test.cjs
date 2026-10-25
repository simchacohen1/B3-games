'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function fixture({requested='alpha',access={authorized:true,role:'teacher',classIds:['alpha']},extraRows={}}={}){
  const reads=[];
  const tree={
    'b3Games/workspaces/b3-2026/classes/alpha':{active:true,name:'Alpha',members:{synthetic_one:{active:true},inactive_child:{active:false}}},
    'b3Games/students/synthetic_one/profile':{name:'Synthetic One',active:true,classId:'alpha'},
    'b3Games/students/synthetic_one/memberships/b3-2026_alpha':{workspaceId:'b3-2026',classId:'alpha',active:true},
    ...extraRows
  };
  const db={ref:path=>({once:async()=>{reads.push(path);return{val:()=>tree[path]??null}}})};
  const listeners=[];
  const B3SiteSettings={workspaceId:'b3-2026',onAuthStateChanged(fn){listeners.push(fn);fn({uid:'teacher_alpha'},true,access)}};
  const firebase={database:()=>db};
  const window={B3SiteSettings,firebase};
  const context={window,B3SiteSettings,firebase,URLSearchParams,location:{search:requested?'?class='+requested:''}};
  vm.runInNewContext(fs.readFileSync('teacher-class-rosters.js','utf8'),context);
  return{load:context.window.B3TeacherClassRosters.load,reads};
}

test('teacher roster reads only the assigned class, profile, and that class membership',async()=>{
  const f=fixture(),result=await f.load();
  assert.deepEqual(Array.from(result.classes, x=>x.id),['alpha']);
  assert.deepEqual(Array.from(result.classes[0].students),['Synthetic One']);
  assert.deepEqual(Array.from(result.classes[0].studentIds),['synthetic_one']);
  assert.deepEqual(f.reads,[
    'b3Games/workspaces/b3-2026/classes/alpha',
    'b3Games/students/synthetic_one/profile',
    'b3Games/students/synthetic_one/memberships/b3-2026_alpha'
  ]);
  assert.ok(!f.reads.includes('b3Games/students/synthetic_one'));
});

test('teacher roster cannot select an unassigned class',async()=>{
  const f=fixture({requested:'beta'});
  await assert.rejects(f.load(),/not assigned/);
  assert.deepEqual(f.reads,[]);
});

test('administrator sees all active classes sorted by display name, not ET/WT priority',async()=>{
 const root='b3Games/workspaces/b3-2026/classes';
 const f=fixture({requested:'',access:{authorized:true,role:'admin',classIds:['*']},extraRows:{
  [root]:{et:{active:true,name:'Zeta'},alpha:{active:true,name:'Alpha'},inactive:{active:false,name:'Inactive'}},
  [root+'/et']:{active:true,name:'Zeta',members:{}}
 }});
 const result=await f.load();
 assert.deepEqual(Array.from(result.classes,c=>c.id),['alpha','et']);
 assert.equal(result.selectedId,'alpha');
 assert.ok(!f.reads.includes(root+'/inactive'));
});
