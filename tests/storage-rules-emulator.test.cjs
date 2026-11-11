'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const {ref,uploadBytes,getBytes,deleteObject,listAll}=require('firebase/storage');

const projectId='demo-b3-security';
const enabled=process.env.B3_RUN_STORAGE_EMULATOR_TESTS==='1';
const emulatorPort=Number(process.env.FIREBASE_STORAGE_EMULATOR_PORT||19199);
const testStorage=enabled?test:test.skip;
let env;
test.before(async()=>{
  if(!enabled)return;
  env=await initializeTestEnvironment({projectId,storage:{host:'127.0.0.1',port:emulatorPort,rules:fs.readFileSync('storage-rules.hardened.rules','utf8')}});
});
test.after(async()=>{await env?.cleanup()});
const storage=(uid,claims)=>env.authenticatedContext(uid,claims).storage();
async function rejected(promise){await assert.rejects(promise)}

testStorage('students can access only their own Posuk and Chazara recordings',async()=>{
  const one=storage('one',{b3StudentRole:'student',b3StudentId:'synthetic_one',b3ClassId:'alpha'});
  const two=storage('two',{b3StudentRole:'student',b3StudentId:'synthetic_two',b3ClassId:'beta'});
  const own=ref(one,'posukPractice/synthetic_one/attempt.webm');
  await uploadBytes(own,new Blob(['synthetic audio']),{contentType:'audio/webm'});
  assert.ok((await getBytes(own)).byteLength>0);
  await rejected(getBytes(ref(two,'posukPractice/synthetic_one/attempt.webm')));
  await rejected(uploadBytes(ref(one,'posukPractice/synthetic_two/attempt.webm'),new Blob(['no']),{contentType:'audio/webm'}));
  await rejected(getBytes(ref(env.unauthenticatedContext().storage(),'posukPractice/synthetic_one/attempt.webm')));
  await deleteObject(own);
});

testStorage('Gallery media is writable and readable only by the owning student in the matching class',async()=>{
  const one=storage('one',{b3StudentRole:'student',b3StudentId:'synthetic_one',b3ClassId:'alpha'});
  const beta=storage('beta',{b3StudentRole:'student',b3StudentId:'synthetic_two',b3ClassId:'beta'});
  const path='classGallery/alpha/synthetic_one/post_1/audio.webm';
  await uploadBytes(ref(one,path),new Blob(['synthetic gallery audio']),{contentType:'audio/webm'});
  await rejected(getBytes(ref(beta,path)));
  await rejected(uploadBytes(ref(one,'classGallery/beta/synthetic_one/post_1/audio.webm'),new Blob(['no']),{contentType:'audio/webm'}));
  await deleteObject(ref(one,path));
});

testStorage('saved student files are private to the matching student and class and enforce file types and sizes',async()=>{
  const one=storage('one',{b3StudentRole:'student',b3StudentId:'synthetic_one',b3ClassId:'alpha'});
  const sameClassPeer=storage('peer',{b3StudentRole:'student',b3StudentId:'synthetic_peer',b3ClassId:'alpha'});
  const otherClass=storage('other',{b3StudentRole:'student',b3StudentId:'synthetic_one',b3ClassId:'beta'});
  const teacher=storage('teacher_alpha',{});
  const anonymous=env.unauthenticatedContext().storage();
  const own=ref(one,'studentFiles/alpha/synthetic_one/board_1.json');
  await uploadBytes(own,new Blob(['{"version":1}']),{contentType:'application/json'});
  assert.ok((await getBytes(own)).byteLength>0);
  for(const outsider of [sameClassPeer,otherClass,teacher,anonymous]){
    await rejected(getBytes(ref(outsider,'studentFiles/alpha/synthetic_one/board_1.json')));
    await rejected(listAll(ref(outsider,'studentFiles/alpha/synthetic_one')));
  }
  await rejected(uploadBytes(ref(sameClassPeer,'studentFiles/alpha/synthetic_one/forged.json'),new Blob(['{}']),{contentType:'application/json'}));
  await rejected(uploadBytes(ref(one,'studentFiles/alpha/synthetic_one/not-an-image.png'),new Blob(['not an image']),{contentType:'application/json'}));
  await rejected(uploadBytes(ref(one,'studentFiles/alpha/synthetic_one/too-large.json'),new Blob([new Uint8Array(3*1024*1024+1)]),{contentType:'application/json'}));
  await deleteObject(own);
});

testStorage('saved teacher whiteboards are private to their Firebase UID and reject student identities',async()=>{
  const teacherA=storage('teacher_a',{});
  const teacherB=storage('teacher_b',{});
  const studentWithSameUid=storage('teacher_a',{b3StudentRole:'student',b3StudentId:'teacher_a',b3ClassId:'alpha'});
  const anonymous=env.unauthenticatedContext().storage();
  const own=ref(teacherA,'pointerWhiteboards/teacher_a/lesson_1.json');
  await uploadBytes(own,new Blob(['{"kind":"whiteboard"}']),{contentType:'application/json'});
  assert.ok((await getBytes(own)).byteLength>0);
  for(const outsider of [teacherB,studentWithSameUid,anonymous]){
    await rejected(getBytes(ref(outsider,'pointerWhiteboards/teacher_a/lesson_1.json')));
    await rejected(listAll(ref(outsider,'pointerWhiteboards/teacher_a')));
  }
  await rejected(uploadBytes(ref(teacherA,'pointerWhiteboards/teacher_a/not-an-image.png'),new Blob(['no']),{contentType:'application/json'}));
  await deleteObject(own);
});
