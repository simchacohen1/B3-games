'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(__dirname + '/../backend/functions-staging/class-pointer-share-auth.js', 'utf8');

function fixture() {
  const room = 'class-pointer-12345678-1234-1234-1234-123456789abc';
  const classId = 'TEST-ALEF', studentId = 'test_student_alef', teacherUid = 'teacher-alef';
  const base = 'b3Games/workspaces/b3-2026/classes/' + classId;
  const rows = new Map([
    [base, {active:true,toolGrants:{'class-pointer':true},members:{[studentId]:{active:true}}}],
    [base + '/members/' + studentId, {active:true}],
    [base + '/classPointerSessions/' + room, {roomId:room,teacherUid,createdAt:Date.now(),studentScreenSharing:true}],
    ['b3Games/workspaces/b3-2026/teachers/' + teacherUid,{active:true,classIds:{[classId]:true}}],
    ['b3Games/students/' + studentId + '/profile',{name:'Test Student A1',active:true}]
  ]);
  const ref = path => ({
    once: async () => ({val:()=>rows.get(path)??null}),
    set: async value => {if(value===null)rows.delete(path);else rows.set(path,value);},
    transaction: async callback => {
      const before=rows.get(path)??null,after=callback(before);
      if(after===undefined)return {committed:false,snapshot:{val:()=>before}};
      if(after===null)rows.delete(path);else rows.set(path,after);
      return {committed:true,snapshot:{val:()=>after}};
    }
  });
  let handler;
  const claims = {
    [teacherUid]:{uid:teacherUid,email:'teacher.alef@funtorahtools-staging.test',email_verified:true,b3StagingAccount:true},
    outsider:{uid:'outsider',email:'outsider@example.com',email_verified:true,b3StagingAccount:false},
    owner:{uid:'owner',email:'owner@funtorahtools-staging.test',email_verified:true,b3StagingAccount:true}
  };
  const admin = {
    apps:[{}], app:()=>({options:{projectId:'fun-torah-tools-staging',databaseURL:'https://fun-torah-tools-staging-default-rtdb.firebaseio.com'}}),
    database:()=>({ref}), auth:()=>({verifyIdToken:async token=>claims[token]||{uid:token,email_verified:false}})
  };
  const env={GCLOUD_PROJECT:'fun-torah-tools-staging',B3_STAGING_DEPLOYMENT:'true'};
  const sandbox={module:{exports:{}},exports:{},process:{env},require:name=>{
    if(name==='firebase-functions/v2/https')return{onRequest:(_options,fn)=>{handler=fn;return fn;}};
    if(name==='firebase-admin')return admin;
    if(name==='node:crypto')return crypto;
    if(name==='./staging-cors.cjs')return {STAGING_ORIGIN:'https://fun-torah-tools-staging.web.app'};
    if(name==='./student-passcodes.cjs')return {readPasscode:async()=>({passcode:'123456'}),key:s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(s),equal:(a,b)=>a===b};
    throw Error('Unexpected module: '+name);
  },Buffer,Date,console};
  vm.runInNewContext(source,sandbox,{filename:'class-pointer-share-auth.js'});
  async function post(body,identity) {
    const result={statusCode:200,body:null};
    const response={set(){return this;},status(code){result.statusCode=code;return this;},json(data){result.body=data;return this;}};
    await handler({method:'POST',body,ip:'127.0.0.1',headers:identity?{authorization:'Bearer '+identity}:{}},response);
    return result;
  }
  return {room,classId,studentId,teacherUid,base,rows,env,post};
}
const params = f => ({studentId:f.studentId,pin:'123456',classId:f.classId,room:f.room});

test('staging handler refuses a production or missing project target',async()=>{
  const f=fixture();
  f.env.GCLOUD_PROJECT='b3-games';
  assert.equal((await f.post({action:'permissions',...params(f)})).statusCode,503);
  f.env.GCLOUD_PROJECT='fun-torah-tools-staging';
  f.env.B3_STAGING_DEPLOYMENT='false';
  assert.equal((await f.post({action:'permissions',...params(f)})).statusCode,503);
  f.env.B3_STAGING_DEPLOYMENT='true';
  f.env.FIREBASE_CONFIG=JSON.stringify({projectId:'b3-games'});
  assert.equal((await f.post({action:'permissions',...params(f)})).statusCode,503);
  f.env.FIREBASE_CONFIG=JSON.stringify({projectId:'fun-torah-tools-staging',databaseURL:'https://b3-games-default-rtdb.firebaseio.com'});
  assert.equal((await f.post({action:'permissions',...params(f)})).statusCode,503);
});
test('fictional class grant is required for sharing',async()=>{
  const f=fixture(),cls=f.rows.get(f.base);
  delete cls.toolGrants['class-pointer'];
  assert.equal((await f.post({action:'issue',...params(f)})).statusCode,403);
});
test('student permission and ticket issuance respect private denial',async()=>{
  const f=fixture(),path='b3Private/classPointerSharePermissions/b3-2026/'+f.classId+'/'+f.room+'/'+f.studentId;
  f.rows.set(path,{screenSharingDenied:true});
  const permission=await f.post({action:'permissions',...params(f)});
  assert.equal(permission.statusCode,200);
  assert.deepEqual({...permission.body},{ok:true,screenSharingDenied:true,whiteboardDenied:false});
  assert.equal((await f.post({action:'issue',...params(f)})).statusCode,403);
  f.rows.delete(path);
  const issue=await f.post({action:'issue',...params(f)});
  assert.equal(issue.statusCode,200);
  assert.match(issue.body.token,/^[a-f0-9]{64}$/);
  f.rows.set(path,{screenSharingDenied:true});
  assert.equal((await f.post({action:'verify',classId:f.classId,room:f.room,token:issue.body.token},f.teacherUid)).statusCode,403);
});
test('wrong PIN and other-class students cannot issue a ticket',async()=>{
  const f=fixture();
  assert.equal((await f.post({action:'issue',...params(f),pin:'wrong'})).statusCode,401);
  assert.equal((await f.post({action:'issue',...params(f),studentId:'test_student_beis'})).statusCode,403);
});
test('teacher must own the session, be active and be assigned',async()=>{
  const f=fixture(),issue=await f.post({action:'issue',...params(f)});
  const verify=()=>f.post({action:'verify',classId:f.classId,room:f.room,token:issue.body.token},f.teacherUid);
  assert.equal((await f.post({action:'verify',classId:f.classId,room:f.room,token:issue.body.token},'outsider')).statusCode,403);
  assert.equal((await verify()).statusCode,200);
  f.rows.get('b3Games/workspaces/b3-2026/teachers/'+f.teacherUid).active=false;
  assert.equal((await verify()).statusCode,403);
});
test('staging rule file permits own-student reads and keeps private ticket/limit records closed',()=>{
  const rules=JSON.parse(fs.readFileSync(__dirname+'/../staging/database.rules.json','utf8')).rules;
  const privateRules=rules.b3Private;
  assert.equal(rules['.read'],false);
  assert.equal(privateRules['.read'],false);
  assert.equal(privateRules['.write'],false);
  const room=privateRules.classPointerSharePermissions.$workspaceId.$classId.$roomId;
  assert.match(room.$studentId['.read'],/auth.token.b3StudentId == \$studentId/);
  assert.match(room.$studentId['.read'],/auth.token.b3ClassId == \$classId/);
  assert.match(room.$studentId['.read'],/classPointerSessions/);
  assert.match(room['.read'],/teachers/);
  assert.equal(privateRules.classPointerShareTickets['.read'],undefined);
  assert.equal(privateRules.classPointerJoinTickets['.read'],undefined);
  assert.equal(privateRules.classPointerJoinLimits?.['.read'],undefined);
  assert.equal(privateRules.classPointerShareLimits?.['.read'],undefined);
});
test('fictional account provisioner grants the correct Class Pointer tool',()=>{
  const provisioner=fs.readFileSync(__dirname+'/../staging/provision-fictional-accounts.ps1','utf8');
  assert.match(provisioner,/\$allTools = @\([^\n]*'class-pointer'/);
  assert.doesNotMatch(source,/simcha5770@gmail.com|us-central1-b3-games/);
});

test('persistent-sharing option is staging-only and preserves the original direct share button',()=>{
  const share=fs.readFileSync(__dirname+'/../class-pointer-prototype/activity-share.js','utf8');
  const windowPage=fs.readFileSync(__dirname+'/../class-pointer-prototype/student-share-window.html','utf8');
  assert.match(share,/window\.B3_STAGING_MODE===true&&!persistentShareWindow/);
  assert.match(share,/Keep Sharing While Navigating/);
  assert.match(share,/btn\.addEventListener\('click',beginShare\)/);
  assert.match(share,/student-share-window\.html\?pointerShare=1/);
  assert.match(windowPage,/window\.opener=null/);
  assert.match(share,/if\(persistentShareWindow\)\{/);
  assert.match(share,/firebase\.auth\(\)\.signInWithCustomToken\(identity\.customToken\)/);
  assert.match(share,/firebase\.auth\.Auth\.Persistence\.SESSION/);
  assert.doesNotMatch(share,/student-share-window\.html\?[^'\x22]*pin=/i);
});

test('regenerated staging rules retain exactly the checked-in private permission policy',()=>{
  const {prepareRules}=require('../staging/prepare-rules.cjs');
  const os=require('node:os'),path=require('node:path');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ftt-stage-pointer-'));
  try{
    const generated=prepareRules(path.join(__dirname,'../firebase-rules.hardened.json'),path.join(directory,'rules.json'));
    const checkedIn=JSON.parse(fs.readFileSync(path.join(__dirname,'../staging/database.rules.json'),'utf8')).rules;
    assert.deepEqual(generated,checkedIn);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
