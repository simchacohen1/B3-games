'use strict';
// Owner Admin bulk CSV upload: runs the real script block from
// owner-admin.html against an in-memory database and a fake
// funTorahManageStudents endpoint. Synthetic data only.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('owner-admin.html','utf8');
const block=html.slice(html.indexOf('// ---- Bulk upload '),html.indexOf('// ---- End bulk upload '));

function harness(initial={}){
 const data=JSON.parse(JSON.stringify(initial));
 const parts=p=>p.split('/').filter(Boolean);
 const read=p=>parts(p).reduce((o,k)=>o==null?undefined:o[k],data);
 const write=(p,v)=>{
  const ks=parts(p);assert.ok(ks.length>3,'refusing suspiciously shallow write: '+p);
  let o=data;for(const k of ks.slice(0,-1))o=o[k]??={};o[ks.at(-1)]=v;
 };
 const writes=[];
 const db={ref:p=>({
  once:async()=>({val:()=>{const v=read(p);return v==null?null:JSON.parse(JSON.stringify(v));},exists:()=>read(p)!=null}),
  set:async v=>{writes.push(p);write(p,JSON.parse(JSON.stringify(v)));}
 })};
 const els={};
 const el=id=>els[id]??={id,style:{},value:'',textContent:'',innerHTML:'',disabled:false,files:[],scrollTop:0,scrollHeight:0};
 const studentCalls=[];
 const fetch=async(url,opts)=>{
  const body=JSON.parse(opts.body);studentCalls.push({url,body,auth:opts.headers.Authorization});
  if(body.name==='Fail Student')return {ok:false,json:async()=>({error:'Enter a student name and individual passcode.'})};
  const id='student_'+studentCalls.length;
  write('b3Games/workspaces/b3-2026/classes/'+body.classId+'/members/'+id,{studentId:id,name:body.name,active:true});
  return {ok:true,json:async()=>({ok:true,studentId:id})};
 };
 let loads=0;
 const ctx={
  q:el,db,fetch,WS:'b3-2026',classData:read('b3Games/workspaces/b3-2026/classes')||{},
  auth:{currentUser:{getIdToken:async()=>'owner-token'}},
  firebase:{database:{ServerValue:{TIMESTAMP:{'.sv':'timestamp'}}}},
  key:s=>String(s||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,''),
  safe:s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
  load:async()=>{loads++;},
  AbortSignal:{timeout:()=>undefined},
  FileReader:class{readAsText(f){this.onload({target:{result:f.text}});}},
  console,setTimeout,Date,URL,Blob
 };
 vm.createContext(ctx);
 vm.runInContext(block+';this.parseBulkCSV=parseBulkCSV;this.bulkValidate=bulkValidate;',ctx);
 const preview=csv=>{el('bulkFile').files=[{text:csv}];el('bulkPreview').onclick();};
 const importAll=()=>el('bulkImport').onclick();
 return {ctx,data,read,el,writes,studentCalls,preview,importAll,loads:()=>loads};
}

test('owner-admin inline scripts parse (the bulk upload block once broke the whole page)',()=>{
 for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(m[1].trim())new vm.Script(m[1]);
 assert.ok(block.length>1000,'bulk upload block must exist');
});

test('CSV parsing handles quotes, escaped quotes, BOM, CRLF and the old password column',()=>{
 const {ctx}=harness();
 const rows=ctx.parseBulkCSV('﻿Type,Name,Email,Password,Class\r\nstudent,"Levi, Moshe",,"a""b",Grade 5\r\n\r\nteacher,T,T@Example.com,,\r\n');
 assert.equal(rows.length,2);
 assert.deepEqual({...rows[0]},{row:2,type:'student',name:'Levi, Moshe',email:'',passcode:'a"b',cls:'Grade 5'});
 assert.equal(rows[1].email,'t@example.com');
});

test('validation blocks unknown types, bad emails, and students without class, passcode or a real class',()=>{
 const {ctx}=harness({b3Games:{workspaces:{'b3-2026':{classes:{existing:{name:'Existing',active:true}}}}}});
 const errors=ctx.bulkValidate(ctx.parseBulkCSV([
  'type,name,email,passcode,class',
  'robot,R2,,,',
  'teacher,T,not-an-email,,',
  'student,No Class,,p1,',
  'student,No Code,,,Existing',
  'student,Ghost,,p2,Nowhere',
  'class,New One,,,',
  'student,Fine,,p3,new one',
  'student,Fine Too,,p4,Existing'
 ].join('\n')));
 assert.deepEqual([...errors],[
  'Row 2: unknown type "robot"',
  'Row 3: teacher needs a valid email',
  'Row 4: student needs a class',
  'Row 5: student needs a passcode',
  'Row 6: class "Nowhere" does not exist and is not in this file'
 ]);
});

test('a file with errors cannot be imported',()=>{
 const h=harness();
 h.preview('type,name,email,passcode,class\nstudent,Kid,,,');
 assert.equal(h.el('bulkImport').disabled,true);
 assert.equal(h.el('bulkFile')._parsedRows,null);
});

test('import creates classes, invites and students through the trusted backend without exposing passcodes',async()=>{
 const h=harness({b3Games:{workspaces:{'b3-2026':{
  classes:{grade_4:{name:'Grade 4',active:true,members:{s_old:{name:'Existing Kid',active:true}}}},
  teacherInvites:{old_example_com:{email:'old@example.com',role:'teacher',active:true}}
 }}}});
 h.preview([
  'type,name,email,passcode,class',
  'student,New Kid,,secret-1,Grade 5',
  'student,Existing Kid,,secret-2,grade 4',
  'student,Fail Student,,secret-3,Grade 4',
  'teacher,Rabbi Synthetic,Rabbi@Example.com,,Grade 5',
  'teacher,Unassigned Teacher,free@example.com,,',
  'teacher,Old Teacher,old@example.com,,',
  'principal,Mrs Synthetic,principal@example.com,,',
  'class,Grade 5,,,',
  'class,grade 4,,,'
 ].join('\n'));
 assert.equal(h.el('bulkImport').disabled,false);
 assert.doesNotMatch(h.el('bulkTable').innerHTML,/secret-/,'preview must not print passcodes');
 await h.importAll();

 const ws=h.read('b3Games/workspaces/b3-2026');
 assert.deepEqual(ws.classes.grade_5,{name:'Grade 5',active:true,members:{student_1:{studentId:'student_1',name:'New Kid',active:true}}});
 assert.equal(Object.keys(ws.classes).length,2,'existing class name (any case) is not duplicated');

 assert.deepEqual(ws.teacherInvites.rabbi_example_com,{email:'rabbi@example.com',name:'Rabbi Synthetic',role:'teacher',active:true,classIds:{grade_5:true},updatedAt:{'.sv':'timestamp'}});
 assert.equal(ws.teacherInvites.free_example_com.active,false);
 assert.equal(ws.teacherInvites.free_example_com.classIds,undefined);
 assert.deepEqual(ws.teacherInvites.old_example_com,{email:'old@example.com',role:'teacher',active:true},'existing invite untouched');
 assert.equal(ws.teacherInvites.principal_example_com.accountType,'principal');
 assert.equal(ws.teacherInvites.principal_example_com.active,false);
 assert.equal(ws.classes.grade_5.teacherIds,undefined,'teacherIds is keyed by claimed UID, never by invite key');

 // Students only go through funTorahManageStudents; nothing is written to b3Games/students directly.
 assert.equal(h.writes.some(p=>p.includes('b3Games/students')),false);
 assert.deepEqual(h.studentCalls.map(c=>c.body),[
  {action:'create',classId:'grade_5',name:'New Kid',passcode:'secret-1'},
  {action:'create',classId:'grade_4',name:'Fail Student',passcode:'secret-3'}
 ]);
 assert.ok(h.studentCalls.every(c=>c.url.endsWith('/funTorahManageStudents')&&c.auth==='Bearer owner-token'));
 assert.doesNotMatch(JSON.stringify(h.data),/secret-/,'no passcode is stored by the page itself');

 const log=h.el('bulkLog').innerHTML;
 assert.match(log,/Existing Kid is already in grade 4 \(skipped\)/);
 assert.match(log,/Fail Student: Enter a student name and individual passcode\./);
 assert.match(log,/^&#x/,'status icons render as icons, not escaped text');
 assert.match(h.el('bulkProgress').textContent,/Done! 9 row\(s\) processed, 1 need attention/);
 assert.equal(h.loads(),1);
 assert.equal(h.el('bulkFile')._parsedRows,undefined,'the same file cannot be imported twice by accident');
});

test('class names without Latin letters never write to the classes root',async()=>{
 const h=harness();
 h.preview('type,name,email,passcode,class\nclass,כיתה ה,,,');
 await h.importAll();
 const classes=h.read('b3Games/workspaces/b3-2026/classes');
 assert.deepEqual(Object.values(classes),[{name:'כיתה ה',active:true}]);
 assert.match(Object.keys(classes)[0],/^class/);
});
