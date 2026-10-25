'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('shorashim/app.js','utf8');

function sourceOf(name){
  const start=source.indexOf('function '+name+'(');
  assert.notEqual(start,-1,name+' must exist');
  const rest=source.slice(start+1);
  const next=/\n(?:async )?function [A-Za-z_$]/.exec(rest);
  assert.ok(next,name+' must be followed by another function');
  return source.slice(start,start+1+next.index);
}

test('Match opens one pair-size listener and closes it on exit or restart',()=>{
  const listeners=new Map(),started=[],stopped=[],panel={innerHTML:''};
  const ctx={
    cloudEnabled:true,cloudStudentId:'fictionalStudent',
    CLOUD_ROOT:'shorashimLearning/classes/fictionalClass',
    matchLeaderboardRef:null,matchLeaderboardHandler:null,classMatchLeaderboard:{},
    activeScreenId:'gamesScreen',matchState:{pairCount:8},
    matchLeaderboardHTML:pairs=>'Leaderboard '+pairs,
    document:{getElementById:id=>id==='matchLeaderboard'?panel:null},
    console,
    cloudDb:{ref:path=>({
      on:(event,handler)=>{assert.equal(event,'value');started.push(path);listeners.set(path,handler);},
      off:(event,handler)=>{assert.equal(event,'value');assert.equal(listeners.get(path),handler);stopped.push(path);listeners.delete(path);}
    })}
  };
  const f=vm.runInNewContext(sourceOf('stopMatchLeaderboard')+'\n'+sourceOf('startMatchLeaderboard')+'\n({startMatchLeaderboard,stopMatchLeaderboard})',ctx);
  assert.equal(started.length,0,'no downloads before opening Match');
  f.startMatchLeaderboard(8);
  const p8='shorashimLearning/classes/fictionalClass/leaderboards/match/8';
  assert.deepEqual(started,[p8]);
  listeners.get(p8)({val:()=>({fake:{time:2000}})});
  assert.equal(ctx.classMatchLeaderboard['8'].fake.time,2000);
  assert.equal(panel.innerHTML,'Leaderboard 8');
  ctx.matchState={pairCount:4};
  f.startMatchLeaderboard(4);
  const p4='shorashimLearning/classes/fictionalClass/leaderboards/match/4';
  assert.deepEqual(stopped,[p8]);
  assert.deepEqual(started,[p8,p4]);
  f.stopMatchLeaderboard();
  assert.deepEqual(stopped,[p8,p4]);
  assert.equal(listeners.size,0,'no leftover Firebase listeners');
});

test('normal Shorashim sign-in avoids leaderboard downloads and full progress rewrites',()=>{
  const entry=sourceOf('enterCloudStudent');
  assert.doesNotMatch(entry,/loadClassLeaderboard\s*\(/);
  assert.doesNotMatch(entry,/scheduleCloudStudentSave\s*\(/);
  assert.match(entry,/\.update\(\{name:s\.name,lastActive:s\.lastActive\}\)/);
  assert.match(entry,/if\(studentSnap\.exists\(\)\)await studentRef\.update/);
  assert.match(entry,/else await studentRef\.set\(s\)/);
  assert.doesNotMatch(sourceOf('startCloudListeners'),/leaderboards\/match/);
  assert.match(sourceOf('startMatchGame'),/startMatchLeaderboard\(pairCount\)/);
  assert.match(sourceOf('cleanupGameRuntime'),/stopMatchLeaderboard\(\)/);
});

test('normal learning still saves student progress',()=>{
  assert.match(sourceOf('scheduleCloudStudentSave'),/\.set\(payload\)/);
  assert.match(sourceOf('saveDB'),/scheduleCloudStudentSave\(\)/);
});
