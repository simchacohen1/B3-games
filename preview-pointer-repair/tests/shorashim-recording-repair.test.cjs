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
