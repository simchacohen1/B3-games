'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('shorashim/app.js','utf8');

function extract(name){
  const start=source.indexOf('function '+name+'(');
  assert.notEqual(start,-1,name+' missing');
  const rest=source.slice(start+1);
  const next=/\n(?:async )?function [A-Za-z_$]/.exec(rest);
  assert.ok(next,name+' missing following function');
  return source.slice(start,start+1+next.index);
}
function fixture(write){
  let nextTimer=0;
  const timers=new Map(),writes=[],statuses=[];
  const context={
    cloudSaveTimer:null,cloudSavePending:null,cloudSaveChain:Promise.resolve(),cloudSaveOutstanding:0,
    cloudEnabled:true,cloudStudentId:'fictional_a',cloudStudentName:'Fictional A',
    CLOUD_ROOT:'posukPractice/shorashimLearning/classes/alpha',currentStudent:'Fictional A',
    db:{students:{'Fictional A':{cards:{first:{learnedAt:1}}},'Fictional B':{cards:{second:{learnedAt:2}}}}},
    clone:value=>JSON.parse(JSON.stringify(value)),saveRaw:()=>{},
    setCloudStatus:(label,kind)=>statuses.push([label,kind]),
    cloudDb:{ref:path=>({set:async payload=>{
      writes.push({path,payload:JSON.parse(JSON.stringify(payload))});
      if(write)await write(path,payload,writes.length);
    }})},
    setTimeout:fn=>{const id=++nextTimer;timers.set(id,fn);return id;},
    clearTimeout:id=>timers.delete(id),console:{error(){}}
  };
  const f=vm.runInNewContext(['flushCloudStudentSave','scheduleCloudStudentSave','saveDB'].map(extract).join('\n')+
    '\n({flushCloudStudentSave,scheduleCloudStudentSave,saveDB})',context);
  return {context,f,writes,statuses,timers,flushTimers(){
    const callbacks=[...timers.values()];timers.clear();callbacks.forEach(fn=>fn());
  }};
}
test('rapid progress edits coalesce and both callers receive the cloud acknowledgment',async()=>{
  const h=fixture();
  const first=h.f.saveDB();
  h.context.db.students['Fictional A'].cards.next={learnedAt:3};
  const second=h.f.saveDB();
  assert.equal(h.timers.size,1);
  assert.equal(h.writes.length,0);
  h.flushTimers();
  assert.deepEqual(await Promise.all([first,second]),[true,true]);
  assert.equal(h.writes.length,1);
  assert.equal(h.writes[0].payload.cards.next.learnedAt,3);
  assert.equal(h.statuses.at(-1)[0],'☁️ Saved');
});
test('slow older full-record write completes before newer snapshot is sent',async()=>{
  let finishFirst;
  const h=fixture((path,payload,n)=>n===1?new Promise(resolve=>{finishFirst=resolve;}):undefined);
  const first=h.f.saveDB(true);
  await Promise.resolve();await Promise.resolve();
  assert.equal(h.writes.length,1);
  h.context.db.students['Fictional A'].cards.second={learnedAt:4};
  const second=h.f.saveDB(true);
  assert.equal(h.writes.length,1,'second set must wait for first set');
  finishFirst();
  assert.equal(await first,true);
  assert.equal(await second,true);
  assert.equal(h.writes.length,2);
  assert.equal(h.writes[1].payload.cards.second.learnedAt,4);
  assert.equal(h.context.cloudSaveOutstanding,0);
});
test('failed write reports false, retains the local card, and permits explicit retry',async()=>{
  const h=fixture((path,payload,n)=>{if(n===1)throw Error('synthetic network failure');});
  assert.equal(await h.f.saveDB(true),false);
  assert.equal(h.context.db.students['Fictional A'].cards.first.learnedAt,1);
  assert.equal(h.statuses.at(-1)[1],'error');
  assert.equal(await h.f.saveDB(true),true);
  assert.equal(h.writes.length,2);
  assert.equal(h.statuses.at(-1)[0],'☁️ Saved');
});
test('student/class switch preserves each queued write destination and payload',async()=>{
  const h=fixture();
  const first=h.f.saveDB();
  h.context.cloudStudentId='fictional_b';
  h.context.cloudStudentName='Fictional B';
  h.context.CLOUD_ROOT='posukPractice/shorashimLearning/classes/beta';
  h.context.currentStudent='Fictional B';
  const second=h.f.saveDB();
  h.flushTimers();
  assert.deepEqual(await Promise.all([first,second]),[true,true]);
  assert.equal(h.writes.length,2);
  assert.match(h.writes[0].path,/classes\/alpha\/students\/fictional_a$/);
  assert.match(h.writes[1].path,/classes\/beta\/students\/fictional_b$/);
  assert.equal(h.writes[0].payload.cards.first.learnedAt,1);
  assert.equal(h.writes[1].payload.cards.second.learnedAt,2);
});
test('card UI only advances after acknowledged cloud save and warns on failure',()=>{
  assert.match(extract('saveCurrentCard'),/const cloudSaved=await saveDB\(true\)/);
  assert.match(extract('saveCurrentCard'),/if\(!cloudSaved\)/);
  assert.match(extract('saveCurrentCard'),/window\.__shorashimEditorDirty=true/);
  assert.match(source,/addEventListener\('beforeunload'/);
  assert.match(source,/visibilitychange/);
});
