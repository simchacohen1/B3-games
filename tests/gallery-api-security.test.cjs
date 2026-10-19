'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {visibleGalleryPosts}=require('../backend/functions/class-gallery-read.js');

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
