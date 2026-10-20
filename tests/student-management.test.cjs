const test=require('node:test'),assert=require('node:assert/strict');
const {manageStudents}=require('../backend/functions/student-management-core.cjs');
function fixture(){
 const identity={uid:'teacher',email:'teacher@test',email_verified:true,firebase:{sign_in_provider:'google.com'}};
 const data={'b3Games/workspaces/b3-2026/teachers/teacher':{active:true,classIds:{mine:true}},'b3Games/workspaces/b3-2026/classes/mine':{active:true,members:{child:{name:'Child',active:true}}},'b3Games/workspaces/b3-2026/classes/other':{active:true,members:{other_child:{active:true}}},'b3Games/students/child/profile':{name:'Child',passcode:'1234',active:true},'b3Games/students/other_child/profile':{name:'Other',passcode:'2345'},'b3Games/students/child/memberships':{mine:{workspaceId:'b3-2026',classId:'mine',active:true}},'b3Games/students/other_child/memberships':{other:{workspaceId:'b3-2026',classId:'other',active:true}}};
 const writes=[];return {identity,data,writes,store:{get:async p=>data[p]??null,update:async v=>writes.push(v)}};
}
test('teacher management rejects another teacher class',async()=>{const f=fixture();await assert.rejects(manageStudents(f.store,f.identity,{action:'passcode',classId:'other',studentId:'other_child',passcode:'9999'}),/not assigned/);assert.equal(f.writes.length,0)});
test('teacher cannot change a student outside selected class',async()=>{const f=fixture();await assert.rejects(manageStudents(f.store,f.identity,{action:'passcode',classId:'mine',studentId:'other_child',passcode:'9999'}),/not a member/);assert.equal(f.writes.length,0)});
test('blocking changes only class membership and never another teacher student profile',async()=>{const f=fixture();await manageStudents(f.store,f.identity,{action:'active',classId:'mine',studentId:'child',active:false});assert.equal(f.writes[0]['b3Games/workspaces/b3-2026/classes/mine/members/child/active'],false);assert.equal(f.writes[0]['b3Games/students/child/profile/active'],undefined)});
test('same-name students receive different stable IDs',async()=>{const f=fixture(),body={action:'create',classId:'mine',name:'Same Name',passcode:'1234'};const a=await manageStudents(f.store,f.identity,body),b=await manageStudents(f.store,f.identity,body);assert.notEqual(a.studentId,b.studentId);assert.match(a.studentId,/^student_[a-f0-9]{32}$/)});
test('teacher cannot import an unrelated student by guessed ID',async()=>{const f=fixture();await assert.rejects(manageStudents(f.store,f.identity,{action:'add',classId:'mine',studentId:'other_child'}),/not assigned/);assert.equal(f.writes.length,0)});
test('passcode changes are audited without writing passcodes into the audit',async()=>{const f=fixture();await manageStudents(f.store,f.identity,{action:'passcode',classId:'mine',studentId:'child',passcode:'9999'});assert.equal(f.writes[0]['b3Private/passcodes/child'].passcode,'9999');assert.equal(f.writes[0]['b3Games/students/child/profile/passcode'],null);const audit=Object.entries(f.writes[0]).find(([p])=>p.includes('/managementAudit/'))[1];assert.equal(audit.passcode,undefined);assert.equal(audit.teacherUid,'teacher')});

test('teacher can restrict and restore only administrator-granted tools for a member',async()=>{
 const f=fixture();f.data['b3Games/workspaces/b3-2026/classes/mine'].toolGrants={yiddish:true,gallery:true};
 await manageStudents(f.store,f.identity,{action:'studentTools',classId:'mine',studentId:'child',toolAccess:{yiddish:false,gallery:true}});
 const writes=f.writes[0],base='b3Games/workspaces/b3-2026/classes/mine/members/child/toolAccess/';
 assert.equal(writes[base+'yiddish'],false);
 for(const alias of ['gallery','tag','class-gallery'])assert.equal(writes[base+alias],null);
 assert.ok(!Object.keys(writes).some(p=>p.includes('/toolGrants/')));
});
test('student tool requests reject ungranted tools, non-members, inactive students and other classes without writing',async()=>{
 for(const change of [{toolAccess:{shorashim:true}},{studentId:'other_child',toolAccess:{yiddish:false}},{classId:'other',studentId:'other_child',toolAccess:{yiddish:false}},{toolAccess:{yiddish:'false'}},{toolAccess:[]}]){
  const f=fixture();f.data['b3Games/workspaces/b3-2026/classes/mine'].toolGrants={yiddish:true};
  await assert.rejects(manageStudents(f.store,f.identity,{action:'studentTools',classId:'mine',studentId:'child',...change}));assert.equal(f.writes.length,0);
 }
 const f=fixture();f.data['b3Games/workspaces/b3-2026/classes/mine'].members.child.active=false;
 await assert.rejects(manageStudents(f.store,f.identity,{action:'studentTools',classId:'mine',studentId:'child',toolAccess:{yiddish:false}}),/inactive/);assert.equal(f.writes.length,0);
});

test('owner can restrict existing ET tools while assigned teachers still need administrator grants',async()=>{
 const f=fixture(),root='b3Games/workspaces/b3-2026/';f.data[root+'classes/et']=f.data[root+'classes/mine'];f.data[root+'teachers/teacher'].classIds.et=true;
 const body={action:'studentTools',classId:'et',studentId:'child',toolAccess:{yiddish:false}};
 await assert.rejects(manageStudents(f.store,f.identity,body),/administrator/);
 await manageStudents(f.store,{...f.identity,email:'simcha5770@gmail.com'},body);
 assert.equal(f.writes[0][root+'classes/et/members/child/toolAccess/yiddish'],false);
});

test('demo student is a real, teacher-owned account that is stable across classes',async()=>{
 const f=fixture(),root='b3Games/workspaces/b3-2026/';
 f.data[root+'teachers/teacher'].classIds.second=true;f.data[root+'classes/second']={active:true,members:{}};
 const ident={...f.identity,name:'Rabbi Test'};
 const a=await manageStudents(f.store,ident,{action:'demoStudent',classId:'mine'});
 assert.match(a.studentId,/^demo_[a-f0-9]{32}$/);assert.equal(a.name,'Rabbi Test (demo)');
 const w=f.writes[0];
 assert.equal(w['b3Games/students/'+a.studentId+'/profile'].demoOwner,'teacher');
 assert.ok(w['b3Private/passcodes/'+a.studentId].passcode.length>=12);
 assert.equal(w[root+'classes/mine/members/'+a.studentId].active,true);
 assert.equal(w['b3Games/students/'+a.studentId+'/memberships/b3-2026_mine'].active,true);
 for(const [p,v] of Object.entries(w))if(p.startsWith('b3Games/'))f.data[p]=v;
 const b=await manageStudents(f.store,ident,{action:'demoStudent',classId:'second'});
 assert.equal(b.studentId,a.studentId);
 assert.equal(f.writes[1]['b3Private/passcodes/'+a.studentId],undefined,'passcode is not replaced');
 assert.equal(f.writes[1][root+'classes/second/members/'+a.studentId].demo,true);
});
test('demo student cannot be created in another teacher class or hijack a foreign profile',async()=>{
 const f=fixture();
 await assert.rejects(manageStudents(f.store,f.identity,{action:'demoStudent',classId:'other'}),/not assigned/);
 const id='demo_'+require('node:crypto').createHash('sha256').update('b3-demo-student:teacher').digest('hex').slice(0,32);
 f.data['b3Games/students/'+id+'/profile']={name:'x',demoOwner:'someone_else'};
 await assert.rejects(manageStudents(f.store,f.identity,{action:'demoStudent',classId:'mine'}),/could not be created/);
 assert.equal(f.writes.length,0);
});
