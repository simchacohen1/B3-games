'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const {ref,uploadBytes,getBytes,deleteObject}=require('firebase/storage');

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
