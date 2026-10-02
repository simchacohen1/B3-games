const {test}=require('node:test');const assert=require('node:assert/strict');const {resolveStudent}=require('../backend/functions/student-login-core.cjs');
const base={
 'b3Games/students':{student_unique:{profile:{name:'Moshe',passcode:'1234',active:true}},other:{profile:{name:'Moshe',passcode:'9999',active:true}}},
 'b3Games/students/student_unique/profile':{name:'Moshe',passcode:'1234',active:true},
 'b3Games/students/student_unique/memberships':{a:{workspaceId:'b3-2026',classId:'new_class',active:true}},
 'b3Games/workspaces/b3-2026/classes/new_class':{name:'New class',active:true,members:{student_unique:{active:true}}}
};
const get=data=>async path=>data[path]??null;
test('direct sign-in finds unique student IDs by name and individual PIN',async()=>{assert.equal((await resolveStudent(get(base),{name:'Moshe',pin:'1234'})).id,'student_unique')});
test('shared sign-in retains the unique ID',async()=>{assert.equal((await resolveStudent(get(base),{name:'Moshe',pin:'1234',b3StudentId:'student_unique'})).classId,'new_class')});
test('wrong individual PIN is rejected even with the correct ID',async()=>{await assert.rejects(resolveStudent(get(base),{name:'Moshe',pin:'5770',b3StudentId:'student_unique'}),{code:401})});
test('blocked membership cannot be restored by a saved class',async()=>{const d=structuredClone(base);d['b3Games/students/student_unique/memberships'].a.active=false;await assert.rejects(resolveStudent(get(d),{name:'Moshe',pin:'1234',b3StudentId:'student_unique',classId:'new_class'}),{code:403})});
test('duplicate name and PIN require main-site account selection',async()=>{const d=structuredClone(base);d['b3Games/students'].other.profile.passcode='1234';await assert.rejects(resolveStudent(get(d),{name:'Moshe',pin:'1234'}),{code:409})});
test('multiple classes retain the selected class and reject no selection',async()=>{const d=structuredClone(base);d['b3Games/students/student_unique/memberships'].b={workspaceId:'b3-2026',classId:'second',active:true};d['b3Games/workspaces/b3-2026/classes/second']=structuredClone(d['b3Games/workspaces/b3-2026/classes/new_class']);assert.equal((await resolveStudent(get(d),{name:'Moshe',pin:'1234',b3StudentId:'student_unique',classId:'second'})).classId,'second');await assert.rejects(resolveStudent(get(d),{name:'Moshe',pin:'1234',b3StudentId:'student_unique'}),{code:403})});
