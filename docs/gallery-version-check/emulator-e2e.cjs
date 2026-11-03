// Runs INSIDE firebase emulators:exec (started by emulator-check.cjs) against local emulators only (demo project). Never touches production.
const assert=require('node:assert/strict');
if(!process.env.FIREBASE_DATABASE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST){console.error('Refusing to run: emulator env vars missing');process.exit(2);}
const admin=require('./functions/node_modules/firebase-admin');
admin.initializeApp({projectId:'demo-gallery',databaseURL:'http://127.0.0.1:9000/?ns=demo-gallery'});
const db=admin.database();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ver=async cls=>(await db.ref(`classGalleryMeta/${cls}/version`).get()).val()||0;
async function waitBump(cls,before,label,ms=20000){
  const t=Date.now();
  while(Date.now()-t<ms){const v=await ver(cls);if(v>before){console.log(`  ok  ${label}: ${cls} version ${before} -> ${v} in ${Date.now()-t}ms`);return v;}await sleep(250);}
  throw new Error(`NO BUMP for ${label} (${cls}) within ${ms}ms`);
}
async function noBump(cls,before,label,wait=4000){await sleep(wait);const v=await ver(cls);assert.equal(v,before,`${label} must not bump ${cls}`);console.log(`  ok  ${label}: ${cls} unchanged at ${v}`);}
(async()=>{
  const WS='b3Games/workspaces/b3-2026';
  await db.ref(`${WS}/classes/et`).set({active:true,members:{one:{active:true}}});
  await db.ref(`${WS}/classes/sc`).set({active:true,members:{one:{active:true}}});
  console.log('1. Real trigger behaviour (legacy ET list)');
  // first write may have to wait for the functions emulator to finish loading
  await db.ref('classGallery/posts/p1').set({classId:'et',studentId:'one',status:'pending',title:'A'});
  let v=await waitBump('et',0,'submit (first write, waits for emulator warm-up)',60000);
  await db.ref('classGallery/posts/p1').update({status:'approved'});v=await waitBump('et',v,'approve');
  await db.ref('classGallery/posts/p1/title').set('B');v=await waitBump('et',v,'edit title');
  await db.ref('classGallery/posts').update({'p1/status':'removed','p2':{className:'B3 ET',status:'pending'}});v=await waitBump('et',v,'bulk multi-path update');
  await db.ref('classGallery/posts/p2').remove();v=await waitBump('et',v,'delete');
  await db.ref('classGallery/posts/w1').set({className:'B3 WT',status:'approved'});await waitBump('wt',0,'old-style WT post');
  assert.equal(await ver('et'),v);console.log('  ok  WT write did not bump ET');
  console.log('2. Per-class list (sc)');
  const P=`${WS}/classes/sc/resources/gallery/posts`;
  await db.ref(`${P}/a`).set({classId:'sc',studentId:'one',status:'pending'});let sv=await waitBump('sc',0,'class submit');
  await db.ref(`${P}/a`).update({status:'approved'});sv=await waitBump('sc',sv,'class approve');
  await db.ref(`${P}/a`).remove();sv=await waitBump('sc',sv,'class delete');
  console.log('3. Unrelated writes do not bump');await sleep(3000);v=await ver('et');
  await db.ref('b3Games/classGalleryPresence/et/s1').set({x:1});await db.ref('b3Games/siteSettings/x').set(true);
  await noBump('et',v,'presence + settings writes');
  console.log('4. classGalleryRead over HTTP with a real (emulator) sign-in');
  const custom=await admin.auth().createCustomToken('stu1',{b3StudentRole:'student',b3ClassId:'et',b3StudentId:'one'});
  const signIn=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:custom,returnSecureToken:true})});
  const idToken=(await signIn.json()).idToken;assert.ok(idToken,'sign-in failed');
  const call=async(query,token=idToken)=>{const r=await fetch(`http://127.0.0.1:5001/demo-gallery/us-central1/classGalleryRead?${query}`,{headers:token?{Authorization:'Bearer '+token}:{}});return {status:r.status,body:await r.json()};};
  const first=await call('classId=et');assert.equal(first.status,200);assert.ok(first.body.posts&&first.body.version>0);console.log('  ok  first load full, version',first.body.version);
  const same=await call('classId=et&v='+first.body.version);assert.deepEqual(same.body,{unchanged:true,version:first.body.version});console.log('  ok  same version -> unchanged, no posts');
  await db.ref('classGallery/posts/p1').update({status:'approved',title:'C'});await waitBump('et',first.body.version,'approve before re-poll');
  const changed=await call('classId=et&v='+first.body.version);assert.ok(changed.body.posts&&changed.body.version>first.body.version);assert.equal(changed.body.posts.p1.title,'C');console.log('  ok  stale version -> full reply with the new title');
  assert.equal((await call('classId=et',null)).status,401);console.log('  ok  no token -> 401');
  assert.equal((await call('classId=wt&v='+changed.body.version)).status,403);console.log('  ok  other class -> 403 even with a version');
  await db.ref(`${WS}/classes/et/members/one`).update({active:false});
  assert.equal((await call('classId=et&v='+changed.body.version)).status,403);console.log('  ok  removed student -> 403 even with the current version');
  console.log('ALL EMULATOR CHECKS PASSED');
  process.exit(0);
})().catch(e=>{console.error('FAILED:',e.message);process.exit(1);});
