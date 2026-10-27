'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('shorashim/teacher.js','utf8');
function sourceOf(name){
  const start=source.indexOf('function '+name+'(');
  assert.notEqual(start,-1,name+' must exist');
  const rest=source.slice(start+1),next=/\n(?:async )?function [A-Za-z_$]/.exec(rest);
  assert.ok(next,name+' must be followed by another function');
  return source.slice(start,start+1+next.index);
}

test('Shorashim teacher refreshes one changed student instead of the full school tree',t=>{
  const subscriptions=[],state={catalog:{},settings:{},students:{},leaderboards:{match:{}}};
  const ctx={
    SPACE:'posukPractice/shorashimLearning',state,legacyScoped:()=>false,
    fullScopeListenerBound:false,withAllTracks:value=>value,
    $:()=>({classList:{contains:()=>false}}),renderAll(){},renderLeaderboard(){},renderStudentSiteControl(){},
    db:{ref:path=>({on:(event,handler)=>subscriptions.push({path,event,handler})})}
  };
  vm.runInNewContext(sourceOf('bindFullScopeListener')+';bindFullScopeListener',ctx)();

  assert.ok(!subscriptions.some(x=>x.path===ctx.SPACE&&x.event==='value'),'no listener may read the complete school tree');
  const student= subscriptions.find(x=>x.path===ctx.SPACE+'/students'&&x.event==='child_changed');
  const leaderboard=subscriptions.find(x=>x.path===ctx.SPACE+'/leaderboards/match'&&x.event==='child_changed');
  assert.ok(student,'student changes should use a child event');
  assert.ok(leaderboard,'live match scores should use a class-size child event');

  const makeStudents=count=>Object.fromEntries(Array.from({length:count},(_,i)=>[
    `student-${i}`,{name:`Student ${i}`,cards:Object.fromEntries(Array.from({length:250},(__,j)=>[`card-${j}`,{learnedAt:j,design:{drawing:'x'.repeat(80)}}]))}
  ]));
  for(const count of [10,20,50,100]){
    const sample=makeStudents(count),fullBytes=Buffer.byteLength(JSON.stringify(sample));
    const changedBytes=Buffer.byteLength(JSON.stringify(sample['student-0']));
    t.diagnostic(`${count} students: synthetic full-tree payload ${fullBytes} bytes; one changed-student payload ${changedBytes} bytes (${(100*(1-changedBytes/fullBytes)).toFixed(2)}% smaller)`);
  }
  const largeSchool=makeStudents(100);
  const changed=largeSchool['student-42'];
  student.handler({key:'student-42',val:()=>changed});
  assert.equal(state.students['student-42'],changed);
  assert.ok(Buffer.byteLength(JSON.stringify(changed))<Buffer.byteLength(JSON.stringify(largeSchool))/50,
    'the event payload for one student should stay far below the full school payload');
});
