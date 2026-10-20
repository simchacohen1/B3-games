'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
// Evaluate only the gallery module with harmless Firebase stubs so pure visibility
// tests run in CI without installing or initializing the production Admin SDK.
function loadGalleryModule(){
  const file=path.join(__dirname,'../backend/functions/class-gallery-read.js');
  const mod={exports:{}};
  const mockRequire=name=>{
    if(name==='firebase-functions/v2/https')return {onRequest:()=>({})};
    if(name==='firebase-admin')return {apps:[],initializeApp(){}};
    throw Error('Unexpected dependency in gallery test: '+name);
  };
  new Function('require','module','exports',fs.readFileSync(file,'utf8'))(mockRequire,mod,mod.exports);
  return mod.exports;
}
const {visibleGalleryPosts}=loadGalleryModule();

test('Gallery student response includes approved classmates and own pending posts only',()=>{
  const rows={
    approved:{classId:'et',studentId:'student_b',status:'approved'},
    ownPending:{classId:'et',studentId:'student_a',status:'pending'},
    peerPending:{classId:'et',studentId:'student_b',status:'pending'},
    otherClass:{classId:'wt',studentId:'student_c',status:'approved'}
  };
  assert.deepEqual(visibleGalleryPosts(rows,'et','student_a',false),{approved:rows.approved,ownPending:rows.ownPending});
});

test('Gallery assigned teacher response includes its class submissions only',()=>{
  const rows={
    etApproved:{classId:'et',status:'approved'},
    etPending:{classId:'et',status:'pending'},
    wtPending:{classId:'wt',status:'pending'}
  };
  assert.deepEqual(visibleGalleryPosts(rows,'et','teacher',true),{etApproved:rows.etApproved,etPending:rows.etPending});
});

test('Class Gallery read and private media CORS permit both live branded hosts',()=>{
  const fs=require('node:fs');
  for(const file of ['class-gallery-read.js','private-media-url.js']){
    const source=fs.readFileSync(require('node:path').join(__dirname,'../backend/functions',file),'utf8');
    for(const domain of ['https://funtorahtools.com','https://www.funtorahtools.com','https://simchacohen1.github.io']){
      assert.ok(source.includes(domain),file+' must support '+domain);
    }
    assert.match(source,/verifyIdToken\(/,'All gallery reads and media access still require a Firebase token.');
  }
});

test('Gallery gives a visible error instead of silently showing an empty hallway on 404',()=>{
  const fs=require('node:fs');
  const source=fs.readFileSync(require('node:path').join(__dirname,'../class-gallery/index.html'),'utf8');
  assert.match(source,/id='galleryReadError'/);
  assert.match(source,/r\.status===404/);
  assert.match(source,/Your work may still be saved/);
  assert.match(source,/document\.getElementById\('galleryReadError'\)\?\.remove\(\)/);
});

test('Gallery new student posts are attributed to the signed-in student, not a selectable roster name',()=>{
  const fs=require('node:fs');
  const source=fs.readFileSync(require('node:path').join(__dirname,'../class-gallery/index.html'),'utf8');
  assert.match(source,/function bindStudentGalleryIdentity\(/);
  assert.match(source,/classPicker\.disabled=true;namePicker\.disabled=true/);
  assert.match(source,/studentName=isTeacher\?/);
  assert.match(source,/sessionStorage\.getItem\('b3Games_studentName'\)/);
});

 test('Legacy approved posts resolve exact B3 class labels without exposing pending work',()=>{
  const rows={oldET:{className:'B3 ET',status:'approved'},oldWT:{className:'B3 WT',status:'approved'},pending:{className:'B3 ET',status:'pending'},rejected:{className:'B3 ET',status:'rejected'},explicit:{classId:'wt',className:'B3 ET',status:'approved'},unknown:{className:'Other',status:'approved'}};
  assert.deepEqual(Object.keys(visibleGalleryPosts(rows,'et','student',false)),['oldET']);
  assert.deepEqual(Object.keys(visibleGalleryPosts(rows,'wt','student',false)),['oldWT','explicit']);
  assert.deepEqual(Object.keys(visibleGalleryPosts(rows,'et',undefined,true)),['oldET','pending','rejected']);
  assert.deepEqual(Object.keys(visibleGalleryPosts(rows,'et',undefined,false)),['oldET']);
 });
