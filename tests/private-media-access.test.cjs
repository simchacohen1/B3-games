'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
function loadMediaModule(){
  const mod={exports:{}};
  const mockRequire=name=>{
    if(name==='firebase-functions/v2/https')return {onRequest:()=>({})};
    if(name==='firebase-admin')return {apps:[],initializeApp(){}};
    throw Error('Unexpected dependency in media test: '+name);
  };
  new Function('require','module','exports',fs.readFileSync(path.join(__dirname,'../backend/functions/private-media-url.js'),'utf8'))(mockRequire,mod,mod.exports);
  return mod.exports;
}
const {canReadMedia}=loadMediaModule();

function database(rows){return{ref:path=>({get:async()=>{
  let value=rows[path];
  if(value===undefined){const parent=Object.keys(rows).filter(key=>path.startsWith(key+'/')).sort((a,b)=>b.length-a.length)[0];if(parent)value=path.slice(parent.length+1).split('/').reduce((v,k)=>v?.[k],rows[parent]);}
  const snap=v=>({val:()=>v??null,exists:()=>v!==undefined&&v!==null,child:key=>snap(key.split('/').reduce((row,k)=>row?.[k],v))});
  return snap(value);
}})}}

test('private media requires an active own class member for Posuk recordings',async()=>{
  const rows={'b3Games/workspaces/b3-2026/classes/et':{active:true,members:{student_a:{active:true}}}};
  const db=database(rows),student={uid:'student-uid',b3StudentRole:'student',b3StudentId:'student_a',b3ClassId:'et'};
  assert.equal(await canReadMedia(db,student,'posukPractice/student_a/audio.webm'),true);
  assert.equal(await canReadMedia(db,student,'posukPractice/student_b/audio.webm'),false);
  rows['b3Games/workspaces/b3-2026/classes/et'].members.student_a.active=false;
  assert.equal(await canReadMedia(db,student,'posukPractice/student_a/audio.webm'),false);
});

test('Gallery classmate media is available only after approval and only within its active class',async()=>{
  const rows={
    'b3Games/workspaces/b3-2026/classes/et':{active:true,members:{student_a:{active:true}}},
    'b3Games/workspaces/b3-2026/classes/et/resources/gallery/posts/post_one':{classId:'et',studentId:'student_b',status:'approved'},
    'classGallery/posts/post_legacy':{classId:'et',studentId:'student_b',status:'approved'}
  };
  const db=database(rows),student={uid:'student-uid',b3StudentRole:'student',b3StudentId:'student_a',b3ClassId:'et'};
  assert.equal(await canReadMedia(db,student,'classGallery/et/student_b/post_one/video.mp4'),true);
  rows['b3Games/workspaces/b3-2026/classes/et/resources/gallery/posts/post_one'].status='pending';
  assert.equal(await canReadMedia(db,student,'classGallery/et/student_b/post_one/video.mp4'),false);
  assert.equal(await canReadMedia(db,student,'classGallery/wt/student_b/post_one/video.mp4'),false);
  assert.equal(await canReadMedia(db,student,'classGallery/et/student_b/post_legacy/audio.webm'),true);
});

test('assigned active teachers can read class media while unassigned teachers cannot',async()=>{
  const rows={
    'b3Games/admins/teacher-a/active':false,
    'b3Games/workspaces/b3-2026/teachers/teacher-a':{active:true,classIds:{et:true}},
    'b3Games/workspaces/b3-2026/classes/et':{active:true,members:{student_a:{active:true}}},
    'b3Games/students/student_a/profile':{classId:'et'}
  };
  const db=database(rows),teacher={uid:'teacher-a',email:'a@school.test',email_verified:true,firebase:{sign_in_provider:'google.com'}};
  assert.equal(await canReadMedia(db,teacher,'posukPractice/student_a/audio.webm'),true);
  assert.equal(await canReadMedia(db,{...teacher,uid:'teacher-b'},'posukPractice/student_a/audio.webm'),false);
});
