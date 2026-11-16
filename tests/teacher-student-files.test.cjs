'use strict';
// HIGH RISK feature: a teacher sees saved whiteboards of students in their own classes (read only), through a
// server function. These tests check who is allowed and, mostly, who is refused.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const core=require('../backend/functions/teacher-student-files-core.cjs');
const root=path.join(__dirname,'..');
const WS='b3Games/workspaces/b3-2026/';

function db(extra={}){
  const data={
    [WS+'teachers/tA']:{active:true,classIds:{c1:true}},
    [WS+'teachers/tOff']:{active:false,classIds:{c1:true}},
    [WS+'teachers/tB']:{active:true,classIds:{c2:true}},
    [WS+'classes/c1/active']:true,
    [WS+'classes/c1/members']:{s1:{name:'Student One'},s2:{name:'Student Two',active:false},s3:{}},
    [WS+'classes/c1/members/s1']:{name:'Student One'},
    [WS+'classes/c1/members/s2']:{name:'Student Two',active:false},
    [WS+'classes/c2/active']:true,
    [WS+'classes/c2/members/s9']:{name:'Other class'},
    [WS+'classes/c3/active']:false,
    [WS+'classes/c3/members/s1']:{name:'Student One'},
    'b3Games/students/s1/profile':{name:'Student One'},
    'b3Games/students/s3/profile':{name:'Aaron'},
    'b3Games/admins/adm/active':true,
    ...extra
  };
  return async p=>(p in data?data[p]:null);
}
const teacher=(uid,more={})=>({uid,firebase:{sign_in_provider:'google.com'},...more});
function file(name,custom,updated){return{name,metadata:{metadata:custom,updated}}}
const bucket={
  files:[
    file('studentFiles/c1/s1/aaa.json',{displayName:'Chumash notes',kind:'whiteboard',savedAt:'200'}),
    file('studentFiles/c1/s1/aaa.png',{}),
    file('studentFiles/c1/s1/bbb.json',{displayName:'From your teacher 11/16/2026 10:29 AM',kind:'whiteboard',savedAt:'300'}),
    file('studentFiles/c1/s1/ccc.pdf',{displayName:'A PDF',kind:'pdf',savedAt:'400'}),
    file('studentFiles/c1/s1/not a file.txt',{}),
    file('studentFiles/c1/s1/nested/zzz.json',{displayName:'x',kind:'whiteboard'})
  ],
  async getFiles({prefix}){return[this.files.filter(f=>f.name.startsWith(prefix))]},
  file(name){return{async exists(){return[bucket.files.some(f=>f.name===name)]},async getSignedUrl(opt){return['https://signed.example/'+name+'?exp='+opt.expires]}}}
};
const run=(body,identity,extra={})=>core.handle({body,identity,get:db(extra),bucket,ownerEmail:'owner@example.test',stagingPassword:false});
const refused=async(body,identity,code,extra)=>{
  await assert.rejects(()=>run(body,identity,extra),error=>{assert.equal(error.code,code,error.message);return true});
};

test('a teacher assigned to the class sees its roster, one student\'s boards and a picture link',async()=>{
  const students=(await run({action:'students',classId:'c1'},teacher('tA'))).students;
  assert.deepEqual(students.map(s=>s.id),['s3','s1'].sort((a,b)=>({s3:'Aaron',s1:'Student One'}[a]).localeCompare({s3:'Aaron',s1:'Student One'}[b])));
  assert.equal(students.some(s=>s.id==='s2'),false,'an inactive member is not listed');
  const files=(await run({action:'files',classId:'c1',studentId:'s1'},teacher('tA'))).files;
  assert.deepEqual(files.map(f=>[f.id,f.fromTeacher,f.hasPicture]),[['bbb',true,false],['aaa',false,true]]);
  assert.equal(JSON.stringify(files).includes('"data"'),false,'board contents are never returned');
  const picture=await run({action:'picture',classId:'c1',studentId:'s1',fileId:'aaa'},teacher('tA'));
  assert.match(picture.url,/studentFiles\/c1\/s1\/aaa\.png/);assert.equal(picture.expiresInSeconds,300);
  await refused({action:'picture',classId:'c1',studentId:'s1',fileId:'bbb'},teacher('tA'),404);
});

test('students are refused, including a student of the same class asking for a classmate or themselves',async()=>{
  const student={uid:'u1',b3StudentRole:'student',b3StudentId:'s1',b3ClassId:'c1',firebase:{sign_in_provider:'custom'}};
  for(const body of [{action:'students',classId:'c1'},{action:'files',classId:'c1',studentId:'s3'},{action:'files',classId:'c1',studentId:'s1'},{action:'picture',classId:'c1',studentId:'s1',fileId:'aaa'}])
    await refused(body,student,403);
  // Even a student token that also claims to be a Google sign-in.
  await refused({action:'files',classId:'c1',studentId:'s1'},{...student,firebase:{sign_in_provider:'google.com'}},403);
});

test('a teacher is refused for another teacher\'s class, an inactive account, or a non-Google sign-in',async()=>{
  await refused({action:'files',classId:'c1',studentId:'s1'},teacher('tB'),403);
  await refused({action:'students',classId:'c1'},teacher('tB'),403);
  await refused({action:'files',classId:'c1',studentId:'s1'},teacher('tOff'),403);
  await refused({action:'files',classId:'c1',studentId:'s1'},teacher('nobody'),403);
  await refused({action:'files',classId:'c1',studentId:'s1'},{uid:'tA',firebase:{sign_in_provider:'password'},b3StagingAccount:true},403);
  await refused({action:'files',classId:'c1',studentId:'s1'},null,403);
});

test('the student must be an active member of that very class; the class must be active',async()=>{
  await refused({action:'files',classId:'c1',studentId:'s9'},teacher('tA'),403); // a student of another class
  await refused({action:'files',classId:'c1',studentId:'s2'},teacher('tA'),403); // inactive member
  await refused({action:'files',classId:'c2',studentId:'s1'},teacher('tB'),403); // member of c1, not c2
  await refused({action:'files',classId:'c3',studentId:'s1'},teacher('tA',{}),403,{[WS+'teachers/tA']:{active:true,classIds:{c3:true}}}); // inactive class
});

test('bad ids and paths are refused before anything is read',async()=>{
  for(const classId of ['../c1','c1/x','','a'.repeat(101),null,5])await refused({action:'students',classId},teacher('tA'),classId===''||classId==null||typeof classId!=='string'||/[^A-Za-z0-9_-]/.test(classId)||classId.length>100?400:403);
  for(const studentId of ['../s1','s1/../s3','s 1',''])await refused({action:'files',classId:'c1',studentId},teacher('tA'),400);
  for(const fileId of ['../aaa','aaa.png','a/b','','x'.repeat(65)])await refused({action:'picture',classId:'c1',studentId:'s1',fileId},teacher('tA'),400);
  await refused({action:'delete',classId:'c1'},teacher('tA'),400);
});

test('the site owner or an admin may look; a plain Google account may not',async()=>{
  assert.ok((await run({action:'files',classId:'c1',studentId:'s1'},{uid:'adm',firebase:{sign_in_provider:'google.com'}})).files.length);
  assert.ok((await run({action:'files',classId:'c1',studentId:'s1'},{uid:'own',email:'Owner@Example.test',email_verified:true,firebase:{sign_in_provider:'google.com'}})).files.length);
  await refused({action:'files',classId:'c1',studentId:'s1'},{uid:'own',email:'owner@example.test',email_verified:false,firebase:{sign_in_provider:'google.com'}},403);
});

test('only the approved staging test teacher password sign-in works, and only where staging allows it',async()=>{
  const id={uid:'tA',firebase:{sign_in_provider:'password'},b3StagingAccount:true};
  await refused({action:'files',classId:'c1',studentId:'s1'},id,403); // live never allows it
  const ok=await core.handle({body:{action:'files',classId:'c1',studentId:'s1'},identity:id,get:db(),bucket,ownerEmail:'',stagingPassword:true});
  assert.equal(ok.files.length,2);
});

test('storage rules and the database are untouched; the function only reads; live and staging share one core',()=>{
  const core1=fs.readFileSync(path.join(root,'backend/functions/teacher-student-files-core.cjs'),'utf8');
  assert.equal(core1,fs.readFileSync(path.join(root,'backend/functions-staging/teacher-student-files-core.cjs'),'utf8'));
  // Only reads: the database is read through get(path), and the bucket only lists, checks and signs read links.
  assert.doesNotMatch(core1,/\.(set|update|remove|delete|save|setMetadata|makePublic)\(|transaction\(|\.ref\(/);
  assert.match(core1,/action:'read'/);
  for(const rules of ['staging/storage.rules','storage-rules.hardened.rules','security/pointer-pdf-library-merged-storage.rules']){
    const text=fs.readFileSync(path.join(root,rules),'utf8'),block=text.slice(text.indexOf('match /studentFiles/'));
    assert.match(block.slice(0,block.indexOf('match /pointerWhiteboards/')>0?block.indexOf('match /pointerWhiteboards/'):1500),/allow get, list, delete: if ownsStudentPath\(\);/,rules);
  }
  assert.match(fs.readFileSync(path.join(root,'backend/functions/index.js'),'utf8'),/exports\.teacherStudentFiles=require\('\.\/teacher-student-files'\)\.teacherStudentFiles/);
  assert.match(fs.readFileSync(path.join(root,'backend/functions-staging/index.js'),'utf8'),/exports\.teacherStudentFiles = require\('\.\/teacher-student-files'\)\.teacherStudentFiles/);
});

test('the teacher page only asks, and only on the teacher page; students get no such tab',()=>{
  const ui=fs.readFileSync(path.join(root,'class-pointer-prototype/saved-work.js'),'utf8');
  assert.match(ui,/if\(!me\.teacher\)throw Core\.plain\('Only a teacher can look at student files\.'\)/);
  assert.match(ui,/tab\('Student files',studentsPanel/);
  // Inside the teacher's student view nothing is written: no save, rename, delete or patch calls.
  const start=ui.indexOf('function studentFileRow'),end=ui.indexOf('// Teacher: make the folders students save into');
  assert.ok(start>0&&end>start);
  assert.doesNotMatch(ui.slice(start,end),/store\.(saveBoard|remove|rename|savePdf)|patch\(|\.put\(|\.delete\(/);
});
