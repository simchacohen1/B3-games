'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync('game-gate.js','utf8');
const normalized=source.replace(/\r\n/g,'\n');

test('Firebase REST gate reads attach the active Firebase ID token',()=>{
  assert.match(source,/user\.getIdToken\(\)/);
  assert.match(source,/params\.set\("auth"/);
});

test('protected gate reads wait for Firebase auth initialization instead of falling back anonymously',()=>{
  assert.match(source,/await authReadyPromise;/);
  assert.match(source,/await auth\.authStateReady\(\)/);
  assert.match(source,/await waitForFirebaseAuthState\(window\.firebase\.auth\(\)\)/);
  assert.match(source,/auth\.onAuthStateChanged\(function\(\)\s*\{\s*finish\(\);\s*\},\s*finish\)/);
  assert.doesNotMatch(source,/Promise\.race\([\s\S]{0,220}authReadyPromise/);
});

test('all eight strict-rule affected student activities retain the shared access gate',()=>{
  const pages={
    'rashi-letters/student.html':'rashi-letters','chazara/index.html':'chazara',
    'gematria/index.html':'gematria','shorashim/index.html':'shorashim',
    'weekly-quiz/index.html':'weekly-quiz','halacha/index.html':'halacha',
    'yiddish/index.html':'yiddish','sefer-hamitzvos/index.html':'sefer-hamitzvos'
  };
  for(const [file,id] of Object.entries(pages)){
    const html=fs.readFileSync(path.join(process.cwd(),file),'utf8');
    assert.match(html,/game-gate\.js[\s\S]{0,180}data-game-id=["']?\s*[^\s"']+/i,`${file} must load the gate`);
    assert.ok(html.includes(`data-game-id="${id}"`),`${file} must declare its own activity id`);
  }
});

test('Firebase v8 auth startup waits for persisted state before the gate releases reads',async()=>{
  const match=normalized.match(/function waitForFirebaseAuthState\(auth\) \{[\s\S]*?\n  \}\n  async function watchTeacherAccess/);
  assert.ok(match,'shared auth readiness helper exists');
  const helper=match[0].replace(/\n  async function watchTeacherAccess[\s\S]*$/,'');
  const vm=require('node:vm');
  const context={Promise};
  vm.runInNewContext(helper+';globalThis.waitForFirebaseAuthState=waitForFirebaseAuthState;',context);
  let restore;
  const auth={onAuthStateChanged(callback){restore=callback;return()=>{};}};
  let finished=false;
  const waiting=context.waitForFirebaseAuthState(auth).then(()=>{finished=true;});
  await Promise.resolve();
  assert.equal(finished,false,'observer registration is not treated as auth restoration');
  restore(null); // Firebase v8 signals a restored signed-out state with null.
  await waiting;
  assert.equal(finished,true);
});

test('student gate resolves only the selected class fields and own member record',()=>{
  assert.match(source,/classPath\+"\/toolGrants\.json"/);
  assert.match(source,/classPath\+"\/members\/"\+encodeURIComponent\(studentId\)\+"\.json"/);
  assert.doesNotMatch(source,/classes\/"\+encodeURIComponent\(studentClassId\)\+"\.json/);
});

test('teacher gate resolves only the selected class access fields',()=>{
  assert.match(source,/teacherClassPath\+"\/toolGrants\.json"/);
  assert.doesNotMatch(source,/classes\/"\+encodeURIComponent\(selected\)\+"\.json/);
});

test('all affected student activities load the corrected authenticated gate version',()=>{
  for(const path of [
    'rashi-letters/student.html',
    'chazara/index.html',
    'gematria/index.html',
    'shorashim/index.html',
    'weekly-quiz/index.html',
    'halacha/index.html',
    'yiddish/index.html',
    'sefer-hamitzvos/index.html'
  ]){
    const html=fs.readFileSync(path,'utf8');
    assert.match(html,/game-gate\.js\?v=20261020-pointer-lifecycle5/,path+' must not use the stale access gate');
  }
});
