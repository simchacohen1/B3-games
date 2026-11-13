'use strict';
// Issue #51 (Firebase cost): pages that read a path once and then listen to the same
// path used to download it twice, and the Student Rewards owner view re-downloaded 18
// whole collections every 30 seconds. These tests keep the fixes in place.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(p,'utf8');
function sourceOf(source,name){
  const start=source.search(new RegExp('(?:async )?function '+name+'\\('));
  assert.notEqual(start,-1,name+' must exist');
  const rest=source.slice(start+1),next=/\n(?:async )?function [A-Za-z_$]/.exec(rest);
  return next?source.slice(start,start+1+next.index):source.slice(start);
}
const before=(text,first,second,why)=>{
  const a=text.indexOf(first),b=text.indexOf(second);
  assert.ok(a>=0,'missing: '+first);assert.ok(b>=0,'missing: '+second);assert.ok(a<b,why);
};

test('Shorashim student holds catalog and settings open before the sign-in reads',()=>{
  const f=sourceOf(read('shorashim/app.js'),'enterCloudStudent');
  before(f,'holdCloudPaths([`${CLOUD_ROOT}/catalog`,`${CLOUD_ROOT}/settings`])',"cloudDb.ref(`${CLOUD_ROOT}/catalog`).once('value')",'hold must come before the one-time reads');
  before(f,'startCloudListeners();','releaseCloudHold();renderGamesLock','hold is released only after the live listeners exist');
});

test('Shorashim hold helper opens a listener on each path and its release closes exactly those',()=>{
  const log=[];
  const ctx={cloudDb:{ref:path=>({on:(e,cb)=>log.push(['on',path,e,cb]),off:(e,cb)=>log.push(['off',path,e,cb])})}};
  const source=read('shorashim/app.js');
  const helper=source.slice(source.indexOf('const noCloudSync='),source.indexOf('function startCloudListeners('));
  const release=vm.runInNewContext(helper+';holdCloudPaths',ctx)(['a/catalog','a/settings']);
  assert.deepEqual(log.map(x=>x.slice(0,3)),[['on','a/catalog','value'],['on','a/settings','value']]);
  release();
  assert.deepEqual(log.slice(2).map(x=>x.slice(0,3)),[['off','a/catalog','value'],['off','a/settings','value']]);
  assert.equal(log[0][3],log[2][3],'release must remove the same handler it added, not every listener on the path');
});

test('Shorashim teacher holds its startup paths open before reading them',()=>{
  const f=sourceOf(read('shorashim/teacher.js'),'loadAll');
  before(f,'holdPaths([`${SPACE}/catalog`,`${SPACE}/settings`,`${SPACE}/students`,`${SPACE}/leaderboards`])',"db.ref(`${SPACE}/catalog`).once('value')",'class view: hold before reads');
  before(f,'releaseStartupHold=holdPaths([`${ROOT}/catalog`',"db.ref(`${ROOT}/catalog`).once('value')",'ET/WT view: hold before reads');
  before(f,'bindLegacyScopedListeners(','releaseStartupHold();releaseStartupHold=noSync;','ET/WT hold is released only after the live listeners exist');
});

test('Chazara student holds attempts and events open before reading them',()=>{
  const page=read('chazara/index.html');
  before(page,"for(const path of ['posukPractice/attempts/'+sid,EVENTS+sid])db.ref(path).on('value',noSync,noSync);","db.ref('posukPractice/attempts/'+sid).once('value')",'hold before reads');
});

test('Student Rewards student page holds the paths it both reads and listens to',()=>{
  const f=sourceOf(read('student-rewards/student.js'),'load');
  before(f,"ref.on('value',noSync,noSync)","db.ref(`${ROOT}/students/${state.studentId}`).once('value')",'hold before reads');
  const held=f.slice(0,f.indexOf('const [studentSnap'));
  for(const path of ["own('redemptionsByStudent')","own('classRewardContributionsByStudent')","own('refundRequests')",'db.ref(`${ROOT}/rewards`)','db.ref(`${ROOT}/settings/rewardStoreEnabled`)'])
    assert.ok(held.includes(path),path+' must be held');
});

test('Student Rewards owner view keeps its collections live instead of re-downloading them',async()=>{
  const source=read('student-rewards/teacher.js');
  const listeners=[],reads=[];
  const ctx={ROOT:'studentRewards',state:{teacherMode:false,classId:'c1'},setTimeout:()=>{},
    db:{ref:path=>({
      on:(e,cb,err)=>{assert.equal(typeof err,'function','a refused path must not throw');listeners.push(path);},
      once:async()=>{reads.push(path);return {val:()=>path.endsWith('/classes')?{c1:{active:true}}:null};}
    })},
    prepareDraft(){},renderClassSelect(){},setHeader(){},buildNav(){},sweepAutomaticPosukPoints(){},activeClasses:()=>[],requestedClassId:()=>'',B3ClassGate:{choose:async()=>'c1'}};
  const loadRoot=vm.runInNewContext(source.slice(source.indexOf('const OWNER_ROOT_PATHS='),source.indexOf('async function ensureRewardModelV2('))+';loadRoot',ctx);
  await loadRoot();await loadRoot();await loadRoot();
  assert.equal(listeners.length,18,'each collection is held open once, however many refreshes run');
  assert.equal(reads.length,54,'every refresh still reads all 18 collections, so the screen shows the same data');
  assert.deepEqual([...new Set(reads)].sort(),[...listeners].sort(),'the held paths are exactly the paths that are read');
  assert.equal(Object.keys(ctx.state.root).length,18);
});

test('Parent Dashboard API reads only the quiz data it summarizes',()=>{
  const api=read('backend/functions/parent-dashboard-api.js');
  assert.doesNotMatch(api,/db\.ref\("b3Quiz"\)\.get\(\)/,'the whole quiz tree (saved quizzes, audit, settings) must not be downloaded');
  assert.match(api,/const QUIZ_SUMMARY_PATHS = \["launches", "responses", "completions"\];/);
  const used=[...sourceOf(api,'summarizeQuizzes').matchAll(/root\.([A-Za-z]+)/g)].map(m=>m[1]);
  assert.deepEqual([...new Set(used)].sort(),['completions','launches','responses'],'if the summary starts using another part of b3Quiz, add it to QUIZ_SUMMARY_PATHS');
});

// Real wire bytes, local emulator only. Start the emulator on 127.0.0.1:9123 and set
// B3_RUN_RTDB_EMULATOR_TESTS=1 (see scripts/firebase-cost/measure.cjs).
test('measured on the local emulator: every workflow downloads less, owner Rewards far less',{skip:process.env.B3_RUN_RTDB_EMULATOR_TESTS!=='1'},async()=>{
  const rows=await require('../scripts/firebase-cost/measure.cjs').main();
  for(const r of rows)assert.ok(r.afterBytes<r.beforeBytes,r.workflow+' must download less than before');
  const by=Object.fromEntries(rows.map(r=>[r.id,r]));
  assert.ok(by['rewards-owner-10min'].savedPercent>=80);
  assert.ok(by['shorashim-teacher-open'].savedPercent>=40);
  assert.ok(by['chazara-student-open'].savedPercent>=40);
});
