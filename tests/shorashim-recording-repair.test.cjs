'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const teacher=fs.readFileSync('shorashim/teacher.js','utf8');
const student=fs.readFileSync('shorashim/app.js','utf8');
const page=fs.readFileSync('shorashim/teacher.html','utf8');

test('teacher and student scripts parse as JavaScript',()=>{
 new vm.Script(teacher);
 new vm.Script(student);
});
test('Shorashim teacher can reconnect missing point requests',()=>{
 assert.ok(teacher.includes("action:'repair-shorashim-recording'"));
 assert.ok(teacher.includes('repairShorashimRecordingRequests'));
 assert.ok(teacher.includes('missingShorashimRequest'));
 assert.ok(page.includes('id="repairShorashimRecordingRequests"'));
});
test('recording length is formatted from milliseconds',()=>{
 assert.ok(teacher.includes('Number(record.durationMs)'));
 assert.ok(teacher.includes("String(sec%60).padStart(2,'0')"));
});
test('teacher approvals reuse current Google session, with no second login button',()=>{
 assert.ok(teacher.includes('teacherRewardsToken=async function()'));
 assert.ok(teacher.includes('const user=firebase.auth().currentUser'));
 assert.ok(!teacher.includes('const paidTeacherSignIn = document.createElement'));
 assert.ok(!page.includes('id="recordingsGoogleSignIn"'));
});
test('saved audio and daily submission survive Rewards outage',()=>{
 assert.ok(student.includes('Never destroy an already uploaded recording'));
 assert.ok(student.includes('if(oldData.audioURL&&oldData.storagePath)'));
 assert.ok(student.includes("status:'recorded'"));
 assert.ok(student.includes('Ask your teacher to connect its points request.'));
});

test('recording approval refreshes the list and awards points once through the real handler',async()=>{
 const scopeApi=require('../backend/functions/teacher-class-scope');
 const root={
  posukPractice:{shorashimLearning:{recordingEvents:{'synthetic-et-student':{
   'recording-1':{studentId:'synthetic-et-student',studentName:'Synthetic ET Student',classId:'et',audioURL:'https://audio.invalid/synthetic.webm',storagePath:'synthetic/recording-1',durationMs:8000,mode:'recording',createdAt:1700000000000}
  }}}},
  b3Games:{workspaces:{'b3-2026':{classes:{et:{active:true,name:'Synthetic ET',members:{'synthetic-et-student':{name:'Synthetic ET Student',active:true}}}}}},students:{'synthetic-et-student':{profile:{name:'Synthetic ET Student',classId:'et',active:true},memberships:{synthetic:{active:true,workspaceId:'b3-2026',classId:'et'}}}}},
  studentRewards:{students:{rewardStudent:{name:'Synthetic ET Student',b3StudentId:'synthetic-et-student',classId:'et',rewardBalance:7}}}
 };
 const parts=path=>String(path).split('/').filter(Boolean);
 const getAt=path=>parts(path).reduce((value,key)=>value&&typeof value==='object'?value[key]:undefined,root);
 const setAt=(path,value)=>{
  const keys=parts(path),last=keys.pop();let parent=root;
  for(const key of keys){if(!parent[key]||typeof parent[key]!=='object')parent[key]={};parent=parent[key];}
  if(value===null||value===undefined)delete parent[last];else parent[last]=JSON.parse(JSON.stringify(value));
 };
 const snapshot=value=>{const copy=value===undefined?null:JSON.parse(JSON.stringify(value));return{val:()=>copy,exists:()=>copy!==null,forEach:callback=>{if(copy&&typeof copy==='object')Object.keys(copy).forEach(key=>callback({key,val:()=>copy[key]}));}};};
 const ref=path=>({
  get:async()=>snapshot(getAt(path)),
  set:async value=>setAt(path,value),
  update:async values=>Object.entries(values).forEach(([key,value])=>setAt(`${path}/${key}`,value)),
  transaction:async updater=>{const current=getAt(path),next=updater(current===undefined?null:JSON.parse(JSON.stringify(current)));if(next===undefined)return{committed:false,snapshot:snapshot(current)};setAt(path,next);return{committed:true,snapshot:snapshot(getAt(path))};}
 });
 const tokens={owner:{uid:'synthetic-owner',email:'simcha5770@gmail.com',email_verified:true}};
 const admin={apps:[{}],database:()=>({ref}),auth:()=>({verifyIdToken:async token=>{if(!tokens[token])throw new Error('bad token');return tokens[token];}}),storage:()=>({bucket:()=>({file:()=>({getMetadata:async()=>[{size:5000}]})})})};
 const context={exports:{},require:name=>name==='firebase-admin'?admin:name==='firebase-functions/v2/https'?{onRequest:(options,handler)=>handler}:name==='./teacher-class-scope'?scopeApi:name.startsWith('./')?require('../backend/functions/'+name.slice(2)):require(name),console:{log(){},warn(){},error(){}},Buffer,Intl,Date,setTimeout,Promise};
 vm.runInNewContext(fs.readFileSync('backend/functions/student-rewards-auto-award.js','utf8'),context);
 const invoke=async body=>{const response={set(){},status(code){this.code=code;return this;},json(value){this.body=value;return this;}};await context.exports.studentRewardsAutoAward({method:'POST',headers:{authorization:'Bearer owner'},query:{},body},response);return response;};

 const loadFn=teacher.match(/async function loadShorashimRecordings\(\)\{[\s\S]*?\n\}/)?.[0];
 const tokenFn=teacher.slice(teacher.indexOf('teacherRewardsToken=async function(){',teacher.indexOf('keep recovered submissions'))).match(/teacherRewardsToken=async function\(\)\{[\s\S]*?\n\};/)?.[0];
 const actionFn=teacher.match(/async function shorashimTeacherPointsAction\(payload\)\{[\s\S]*?\n\}/)?.[0];
 const reviewFn=teacher.slice(teacher.indexOf('reviewShorashimRecording=async function(requestId,action){')).match(/reviewShorashimRecording=async function\(requestId,action\)\{[\s\S]*?\n\};/)?.[0];
 assert.ok(loadFn&&tokenFn&&actionFn&&reviewFn,'production list loader, action helper, and approval callback are present');
 const listed=[];
 const pageDb={ref:path=>({...ref(path),once:async()=>snapshot(getAt(path))})};
 const page={ROOT:'posukPractice/shorashimLearning',legacyScoped:()=>true,scopedStudentIds:['synthetic-et-student'],db:pageDb,$:(id)=>id==='shorashimRecordingsList'?{}:null,shorashimRecordingRows:[],renderShorashimRecordings:()=>listed.splice(0,listed.length,...page.shorashimRecordingRows.map(row=>({...row}))),firebase:{auth:()=>({currentUser:{getIdToken:async()=>'owner'}})},CLASS_ID:'et',STUDENT_REWARDS_AUTO_AWARD_URL:'http://local.test/studentRewardsAutoAward',fetch:async(_url,options)=>{const result=await invoke(JSON.parse(options.body));return{ok:result.code>=200&&result.code<300,json:async()=>result.body};},console,Promise,Date,alert:message=>assert.fail(message)};
 vm.createContext(page);vm.runInContext([loadFn,tokenFn,actionFn,reviewFn].join('\n'),page);

 const repaired=await invoke({action:'repair-shorashim-recording',studentId:'synthetic-et-student',eventId:'recording-1'});
 assert.equal(repaired.code,200,JSON.stringify(repaired.body));
 const requestId=repaired.body.requestId;
 assert.equal(root.studentRewards.pointRequests[requestId].status,'pending');
 await page.loadShorashimRecordings();
 assert.equal(listed.length,1);assert.equal(listed[0].pointRequestStatus,'pending');assert.equal(listed[0].pointRequestId,requestId);
 assert.equal(await page.teacherRewardsToken(),'owner','the production teacher session supplies its bearer token');

 await page.reviewShorashimRecording(requestId,'approve');
 assert.equal(root.studentRewards.students.rewardStudent.rewardBalance,9,'the real approval handler adds the recording points');
 assert.equal(root.studentRewards.pointRequests[requestId].status,'approved');
 assert.equal(listed.length,1);assert.equal(listed[0].pointRequestStatus,'approved','the production approval callback reloads the list after the handler succeeds');
 const repeated=await invoke({action:'approve-point-request',requestId});
 assert.equal(repeated.code,200);assert.equal(repeated.body.alreadyHandled,true);
 assert.equal(root.studentRewards.students.rewardStudent.rewardBalance,9,'repeated approval cannot award points twice');
});

