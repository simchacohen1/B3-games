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
