'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const core=require('../backend/functions/rashi-recording-core.cjs');
const catalog=require('../backend/functions/vayeira-rashi.json');
const publicCatalog=require('../rashi-letters/data/vayeira-rashi.json');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('the exact 36 owner-reviewed Rashis appear identically in server and public catalog',()=>{
  assert.deepEqual(catalog,publicCatalog);
  assert.equal(catalog.ownerReviewed,true);
  assert.equal(catalog.passages.length,36);
  assert.equal(new Set(catalog.passages.map(p=>p.id)).size,36);
  assert.equal(new Set(catalog.passages.map(p=>p.sourcePage)).size,35);
  assert.ok(catalog.passages.every(p=>/^vayeira-(18|19|20|21|22)-\d+$/.test(p.id)&&p.text.trim().length>0));
});
test('server recognizes the 36 Rashis and all legacy reading IDs, rejects arbitrary IDs',()=>{
  for(const p of catalog.passages){
    assert.equal(core.isSection(p.id),true);
    assert.equal(core.sectionText(p.id),p.text);
    assert.deepEqual(core.readingWords(p.id,'UNTRUSTED'),[p.text]);
    assert.equal(core.sectionLabel(p.id),`Vayeira ${p.perek}:${p.pasuk}`);
  }
  for(const id of Object.keys(core.SECTIONS))assert.equal(core.isSection(id),true);
  for(const id of ['vayeira-999-1','vayeira-18-100','__proto__','not-in-catalog'])assert.equal(core.isSection(id),false);
});
test('legacy words still sanitise; Vayeira text is never truncated to twelve words',()=>{
  assert.deepEqual(core.readingWords('alef',['אָב','בֵּן']),['אָב','בֵּן']);
  const longest=catalog.passages.reduce((a,b)=>a.text.length>b.text.length?a:b);
  assert.ok(longest.text.length>180);
  assert.equal(core.readingWords(longest.id,[])[0],longest.text);
});
test('each Vayeira reading maintains a distinct pending/approved/rejected attempt',()=>{
  const ids=catalog.passages.map(p=>core.requestIdFor('student-test',p.id,'attempt-1'));
  assert.equal(new Set(ids).size,36);
  const seed={sectionId:catalog.passages[0].id,status:'pending',attempt:1,attemptId:'try1'};
  assert.equal(core.claim(null,seed).write.attempt,1);
  assert.equal(core.claim(seed,seed).block,'pending');
  assert.equal(core.claim({...seed,status:'approved'},seed).block,'approved');
  const retry=core.claim({...seed,status:'rejected'}, {...seed,attemptId:'try2'}).write;
  assert.equal(retry.attempt,2);
  assert.equal(retry.previousAttemptId,'try1');
});
test('student tile, passage browser and teacher scoring are wired',()=>{
  const student=read('rashi-letters/student.html'),mic=read('rashi-letters/recordings.js'),teacher=read('rashi-letters/teacher.html'),backend=read('backend/functions/student-rewards-auto-award.js');
  assert.match(student,/openVayeiraHub\(\)/);
  assert.match(mic,/fetch\('data\/vayeira-rashi\.json'\)/);
  assert.match(mic,/sectionId\.startsWith\('vayeira-'\)/);
  assert.match(mic,/dailyFull\(\)/);
  assert.match(teacher,/class="rashi-grade"/);
  assert.match(teacher,/class="rashi-feedback"/);
  assert.match(teacher,/approveLegacyAllBtn/);
  assert.match(teacher,/pendingLegacyIds=rows\.filter\(r=>!String\(r\.sectionId/);
  assert.match(backend,/rashiCore\.readingWords\(sectionId,req\.query\.words\)/);
  assert.match(backend,/rashiReserveDaily\(studentId,dailyDate\)/);
  assert.match(backend,/rashiReleaseDaily\(studentId,dailyDate\)/);
  assert.match(backend,/rashiCore\.sectionText\(request\.sectionId\)/);
  assert.match(backend,/rashiRecordRef\(request\.practiceStudentId,request\.sectionId\)\.transaction/);
});
test('student receives grades only with status, without mutating the original record',()=>{
  const row={status:'approved',grade:94,feedback:'Very good!',attempt:1};
  assert.equal(core.publicStatus(row,'approved').grade,94);
  assert.equal(core.publicStatus(row,'approved').feedback,'Very good!');
  assert.equal(row.status,'approved');
});


test('staging keeps the same canonical passages and explicitly rejects production Firebase',()=>{
  assert.deepEqual(require('../backend/functions-staging/vayeira-rashi.json'),catalog);
  const stagingCore=require('../backend/functions-staging/rashi-recording-core.cjs');
  assert.equal(stagingCore.isSection(catalog.passages[0].id),true);
  assert.deepEqual(stagingCore.readingWords(catalog.passages[0].id,'client input'),[catalog.passages[0].text]);
  const staging=read('backend/functions-staging/student-rewards-auto-award.js');
  assert.match(staging,/assertNoProductionFirebaseTarget\(admin\.apps\[0\]\)/);
  assert.match(staging,/const rashiBucket=\(\)=>admin\.storage\(\)\.bucket\(\)/);
  assert.doesNotMatch(staging,/const RASHI_BUCKET='b3-games/);
  assert.match(staging,/rashiReserveDaily\(studentId,dailyDate\)/);
  assert.match(staging,/rashiCore\.readingWords\(sectionId,req\.query\.words\)/);
  const client=read('rashi-letters/recordings.js');
  assert.match(client,/if\(STAGING\(\)\)throw new Error\('Recording rewards are disabled on staging\.'\)/);
});
