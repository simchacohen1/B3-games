'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {claimTeacher}=require('../backend/functions/teacher-claim-core.cjs');
const {manageStudents}=require('../backend/functions/student-management-core.cjs');

const root='b3Games/workspaces/b3-2026';
const teacher={uid:'synthetic-teacher',email:'teacher@example.test',email_verified:true,name:'Fictional Teacher',firebase:{sign_in_provider:'google.com'}};
const second={uid:'synthetic-teacher-two',email:'second@example.test',email_verified:true,name:'Second Teacher',firebase:{sign_in_provider:'google.com'}};
function store(seed={}){
 const tree=structuredClone(seed);
 const get=async p=>p.split('/').reduce((v,k)=>v&&v[k],tree)??null;
 const update=async changes=>{for(const [p,value] of Object.entries(changes)){const parts=p.split('/');let o=tree;for(const k of parts.slice(0,-1))o=o[k]??={};if(value===null)delete o[parts.at(-1)];else o[parts.at(-1)]=value;}};
 return {tree,get,update};
}

test('owner-admin class and invite controls, verified teacher claim, enrollment, and class isolation',async()=>{
 const ownerPage=fs.readFileSync('owner-admin.html','utf8');
 assert.match(ownerPage,/q\("addTeacher"\)\.onclick=async/);
 assert.match(ownerPage,/q\("addClass"\)\.onclick=async/);
 assert.match(ownerPage,/q\("assign"\)\.onclick=async/);
 // Synthetic records follow the exact class, invite and assignment paths written by those handlers.
 const s=store();
 await s.update({[root+'/classes/fictional_class']:{name:'Fictional Class',active:true},[root+'/classes/second_class']:{name:'Second Class',active:true}});
 await s.update({[root+'/teacherInvites/teacher_example_test']:{email:teacher.email,name:teacher.name,role:'teacher',active:false},[root+'/teacherInvites/second_example_test']:{email:second.email,name:second.name,role:'teacher',active:false}});
 await s.update({[root+'/teacherInvites/teacher_example_test/classIds/fictional_class']:true,[root+'/teacherInvites/teacher_example_test/active']:true,[root+'/teacherInvites/second_example_test/classIds/second_class']:true,[root+'/teacherInvites/second_example_test/active']:true});
 const claimed=await claimTeacher(s,teacher,'b3-2026',100);
 const claimedSecond=await claimTeacher(s,second,'b3-2026',101);
 assert.deepEqual(claimed.classIds,['fictional_class']);
 assert.deepEqual(claimedSecond.classIds,['second_class']);
 await assert.rejects(claimTeacher(s,{...teacher,uid:'wrong-uid',email:'intruder@example.test'},'b3-2026',102),/No active teacher invitation/);
 const studentIds=[];
 for(const [name,pin] of [['Ari Example','fake-pin-a'],['Bina Example','fake-pin-b'],['Carmi Example','fake-pin-c']]){
  const result=await manageStudents(s,teacher,{action:'create',classId:'fictional_class',name,passcode:pin},200+studentIds.length);
  studentIds.push(result.studentId);
 }
 assert.equal(Object.keys((await s.get(root+'/classes/fictional_class')).members).length,3);
 await assert.rejects(manageStudents(s,second,{action:'create',classId:'fictional_class',name:'Should Not Exist',passcode:'fake'},300),{code:403});
 await assert.rejects(manageStudents(s,teacher,{action:'create',classId:'second_class',name:'Should Not Exist',passcode:'fake'},301),{code:403});
 assert.ok(studentIds.every(id=>s.tree.b3Private?.passcodes?.[id]?.passcode));
});

test('teacher roster page rejects another class before reading Firebase',async()=>{
 const source=fs.readFileSync('teacher-class-rosters.js','utf8');
 const reads=[];
 const db={ref:p=>({once:async()=>{reads.push(p);return{val:()=>null}}})};
 const B3SiteSettings={workspaceId:'b3-2026',onAuthStateChanged(fn){fn({uid:teacher.uid},true,{authorized:true,role:'teacher',classIds:['fictional_class']})}};
 const context={window:{B3SiteSettings,firebase:{database:()=>db}},B3SiteSettings,firebase:{database:()=>db},URLSearchParams,location:{search:'?class=second_class'}};
 vm.runInNewContext(source,context);
 await assert.rejects(context.window.B3TeacherClassRosters.load(),/not assigned/);
 assert.deepEqual(reads,[]);
});
