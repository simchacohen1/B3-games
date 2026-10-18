'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {activeClassStudents}=require('../teacher-preview-roster.js');

function fixture(){
  const reads=[];
  const tree={
    'b3Games/workspaces/b3-2026/classes/alpha':{active:true,members:{
      current:{active:true,name:'Stale Current Name'},moved:{active:true,name:'Moved from another class'},
      missing:{active:true,name:'Missing Profile'},disabled:{active:true,name:'Disabled Profile'},
      inactiveMember:{active:false,name:'Inactive Member'},'bad/id':{active:true,name:'Invalid ID'}
    }},
    'b3Games/students/current/profile':{active:true,name:'Current Student'},
    'b3Games/students/current/memberships/b3-2026_alpha':{workspaceId:'b3-2026',classId:'alpha',active:true},
    'b3Games/students/moved/profile':{active:true,name:'Moved Student'},
    'b3Games/students/moved/memberships/b3-2026_alpha':{workspaceId:'b3-2026',classId:'beta',active:true},
    'b3Games/students/disabled/profile':{active:false,name:'Disabled Student'},
    'b3Games/students/disabled/memberships/b3-2026_alpha':{workspaceId:'b3-2026',classId:'alpha',active:true}
  };
  const db={ref(path){reads.push(path);return{once:async()=>({val:()=>tree[path]??null})}}};
  return{db,reads};
}
test('preview includes only students with an active profile and matching active membership',async()=>{
  const f=fixture(),students=await activeClassStudents(f.db,'b3-2026','alpha');
  assert.deepEqual(students,[{id:'current',name:'Current Student'}]);
  assert.ok(f.reads.includes('b3Games/students/current/memberships/b3-2026_alpha'));
  assert.ok(!f.reads.includes('b3Games/students'));
  assert.ok(!students.some(student => student.id === 'missing'));
});
test('preview rejects missing or inactive classes',async()=>{
  const db={ref(){return{once:async()=>({val:()=>({active:false})})}}};
  await assert.rejects(activeClassStudents(db,'b3-2026','alpha'),/unavailable/);
});
test('preview rejects unsafe class IDs before reading data',async()=>{
  let reads=0;const db={ref(){reads++;throw Error('unexpected read')}};
  await assert.rejects(activeClassStudents(db,'b3-2026','../alpha'),/Invalid class/);
  assert.equal(reads,0);
});
