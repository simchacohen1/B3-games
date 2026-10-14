'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../backend/functions/class-pointer-share-auth.js'),'utf8');
const room = suffix => 'class-pointer-12345678-1234-1234-1234-123456789'+suffix;
const rooms = {et:room('abc'),wt:room('def')};
function setup() {
  const workspace = {classes:{},teachers:{'teacher-et':{active:true,classIds:{et:true}},'teacher-wt':{active:true,classIds:{wt:true}}}};
  for (const id of ['et','wt']) workspace.classes[id] = {active:true,members:{['student-'+id]:{active:true}},
    classPointerSessions:{[rooms[id]]:{roomId:rooms[id],teacherUid:'teacher-'+id,createdAt:Date.now(),studentScreenSharing:true}}};
  const tree={b3Games:{workspaces:{'b3-2026':workspace},students:{'student-et':{profile:{active:true,name:'ET test student'}},'student-wt':{profile:{active:true,name:'WT test student'}}}},
    b3Private:{passcodes:{'student-et':{passcode:'test-only-pin'},'student-wt':{passcode:'test-only-pin'}}}};
  const parts=p=>p.split('/'), get=p=>parts(p).reduce((row,k)=>row?.[k],tree)??null;
  const set=(p,v)=>{const keys=parts(p),last=keys.pop();let row=tree;for(const k of keys)row=row[k]??={};if(v===null)delete row[last];else row[last]=v;};
  const db={ref:p=>({once:async()=>({val:()=>get(p)}),set:async v=>set(p,v),transaction:async fn=>{
    const value=fn(get(p));if(value===undefined)return {committed:false};set(p,value);return {committed:true};
  }})};
  const exports={};
  const context={exports,Buffer,console,require:name=>{
    if(name==='firebase-functions/v2/https')return {onRequest:(_,handler)=>handler};
    if(name==='firebase-admin')return {apps:[{}],database:()=>db,auth:()=>({verifyIdToken:async uid=>({uid,email:uid==='owner'?'simcha5770@gmail.com':'test-teacher@example.test',email_verified:true})})};
    if(name==='./student-passcodes.cjs')return require('../backend/functions/student-passcodes.cjs');
    return require(name);
  }};
  vm.runInNewContext(source,context);
  const call=async(body,uid)=>{
    const result={status:200};const res={set(){return res},status(n){result.status=n;return res},json(body){result.body=body;return res}};
    await exports.classPointerShareAuth({method:'POST',body,ip:'127.0.0.1',headers:uid?{authorization:'Bearer '+uid}:{}},res);return result;
  };
  const issue=(id='et')=>call({action:'issue',classId:id,room:rooms[id],studentId:'student-'+id,pin:'test-only-pin'});
  const verify=(token,id='et',uid='teacher-'+id)=>call({action:'verify',classId:id,room:rooms[id],token},uid);
  return {tree,workspace,call,issue,verify};
}
for(const id of ['et','wt'])test(`${id.toUpperCase()} sharing ticket is accepted by that class's teacher`,async()=>{
  const s=setup(),issued=await s.issue(id);assert.equal(issued.status,200);assert.equal(issued.body.ok,true);
  const accepted=await s.verify(issued.body.token,id);assert.equal(accepted.status,200);assert.equal(accepted.body.studentId,'student-'+id);
});
test('ET student cannot issue a WT ticket',async()=>{
  const s=setup(),r=await s.call({action:'issue',classId:'wt',room:rooms.wt,studentId:'student-et',pin:'test-only-pin'});assert.equal(r.status,403);
});
test('a different teacher cannot consume the ET ticket',async()=>{
  const s=setup(),r=await s.issue();assert.equal((await s.verify(r.body.token,'et','teacher-wt')).status,403);
  assert.equal((await s.verify(r.body.token)).status,200);
});
test('disabled or reassigned teachers cannot accept a previously opened class share',async()=>{
  for(const change of [row=>{row.active=false},row=>{row.classIds={wt:true}}]){
    const s=setup(),r=await s.issue();change(s.workspace.teachers['teacher-et']);assert.equal((await s.verify(r.body.token)).status,403);
  }
});
test('an active administrator and the verified owner retain their own lesson access',async()=>{
  const owner=setup();owner.workspace.classes.et.classPointerSessions[rooms.et].teacherUid='owner';
  assert.equal((await owner.verify((await owner.issue()).body.token,'et','owner')).status,200);
  const admin=setup();admin.tree.b3Games.admins={'teacher-et':{active:true}};delete admin.workspace.teachers['teacher-et'];
  assert.equal((await admin.verify((await admin.issue()).body.token)).status,200);
});
test('tickets cannot be reused or transferred to another class',async()=>{
  const s=setup(),r=await s.issue();assert.equal((await s.verify(r.body.token,'wt')).status,403);
  assert.equal((await s.verify(r.body.token)).status,200);assert.equal((await s.verify(r.body.token)).status,403);
});
test('a ticket with a missing expiry cannot bypass the expiry check',async()=>{
  const s=setup(),r=await s.issue();const ticket=Object.values(s.tree.b3Private.classPointerShareTickets)[0];delete ticket.expiresAt;
  assert.equal((await s.verify(r.body.token)).status,403);
});
test('revoked lesson sharing prevents acceptance of an outstanding ticket',async()=>{
  const s=setup(),r=await s.issue();s.workspace.classes.et.classPointerSessions[rooms.et].studentScreenSharing=false;
  assert.equal((await s.verify(r.body.token)).status,403);
});
test('removed class members cannot complete an outstanding share',async()=>{
  const s=setup(),r=await s.issue();s.workspace.classes.et.members['student-et'].active=false;
  assert.equal((await s.verify(r.body.token)).status,403);
});
test('inactive students and expired lessons cannot issue tickets',async()=>{
  let s=setup();s.tree.b3Games.students['student-et'].profile.active=false;assert.equal((await s.issue()).status,403);
  s=setup();s.workspace.classes.et.classPointerSessions[rooms.et].createdAt=Date.now()-14400001;assert.equal((await s.issue()).status,403);
});
test('an explicitly disabled class grant blocks both B3 ET and B3 WT sharing',async()=>{
  for(const id of ['et','wt']){
    const s=setup();s.workspace.classes[id].toolGrants={'class-pointer':false};assert.equal((await s.issue(id)).status,403);
  }
});
test('a session without a valid timestamp cannot bypass lesson expiry',async()=>{
  for(const timestamp of [undefined,'not-a-timestamp',null]){
    const s=setup();s.workspace.classes.et.classPointerSessions[rooms.et].createdAt=timestamp;assert.equal((await s.issue()).status,403);
  }
});
test('an ongoing share check revalidates class, student and teacher access without a new ticket',async()=>{
  const s=setup();const body={action:'check',classId:'et',room:rooms.et,studentId:'student-et'};
  assert.equal((await s.call(body,'teacher-et')).status,200);
  assert.equal((await s.call(body,'teacher-wt')).status,403);
  assert.equal((await s.call({...body,studentId:'student-wt'},'teacher-et')).status,403);
  s.workspace.teachers['teacher-et'].active=false;assert.equal((await s.call(body,'teacher-et')).status,403);
});
test('an ongoing share is denied after membership, class grant or lesson revocation',async()=>{
  for(const revoke of [s=>s.workspace.classes.et.members['student-et'].active=false,s=>s.workspace.classes.et.toolGrants={'class-pointer':false},s=>s.workspace.classes.et.classPointerSessions[rooms.et].studentScreenSharing=false]){
    const s=setup();const body={action:'check',classId:'et',room:rooms.et,studentId:'student-et'};assert.equal((await s.call(body,'teacher-et')).status,200);revoke(s);assert.equal((await s.call(body,'teacher-et')).status,403);
  }
});
