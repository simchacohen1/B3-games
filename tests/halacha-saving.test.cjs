'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('halacha/index.html','utf8');
const server=fs.readFileSync('backend/functions/student-auth.js','utf8');

test('Halacha embedded scripts parse',()=>{
 const scripts=[...html.matchAll(/<script(?![^>]*\bsrc)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(m=>m[1]).filter(s=>s.trim());
 assert.ok(scripts.length>=2);
 for(const script of scripts)new vm.Script(script);
});
test('student uses a separately authenticated Firebase app',()=>{
 assert.match(html,/firebase\.initializeApp\(window\.B3_FIREBASE_CONFIG,"HalachaStudent"\)/);
 assert.match(html,/halachaAuth\.signInWithCustomToken\(body\.customToken\)/);
 assert.match(html,/t\.claims\.b3StudentId!==HALACHA_STUDENT_ID/);
});
test('cloud restore is not skipped by stale session flag or loaded before authentication',()=>{
 assert.doesNotMatch(html,/halachaCloudLoaded:/);
 assert.match(html,/halachaAuthReady\(\)\.then\(loadCloudHalacha\)/);
 assert.equal((html.match(/^loadCloudHalacha\(\);$/gm)||[]).length,0);
});
test('device changes remain pending until an account save succeeds',()=>{
 assert.match(html,/localStorage\.setItem\(HALACHA_PENDING_KEY,"1"\)/);
 assert.match(html,/localStorage\.removeItem\(HALACHA_PENDING_KEY\)/);
 assert.match(html,/halachaPreviousDeviceCopy:/);
});
test('student token endpoint validates passcode, requested student and active class before issuing token',()=>{
 assert.match(server,/action==='halachaToken'/);
 assert.match(server,/await studentAuth\(store,\{action:'login',name:body\.name,pin:body\.pin\},req\.ip\)/);
 assert.match(server,/student\.id!==studentId/);
 assert.match(server,/!enrolled\|\|!cls\|\|cls\.active===false/);
 assert.match(server,/studentTools\.allowed\(cls,studentId,'halacha'\)/);
 assert.match(server,/createCustomToken\(uid,\{b3StudentId:studentId,b3ClassId:classId\}\)/);
});
