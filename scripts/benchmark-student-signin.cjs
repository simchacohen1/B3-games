'use strict';
// Synthetic, offline benchmark: does NOT contact Firebase or real student records.
const {performance}=require('node:perf_hooks');
const {studentAuth}=require('../backend/functions/student-auth-core.cjs');
const assert=require('node:assert/strict');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function benchmark(size,latencyMs){
  const id='synthetic_target',rows={};
  for(let i=0;i<size;i++)rows['synthetic_'+i]={profile:{name:'Synthetic Child '+i,active:true}};
  rows[id]={profile:{name:'Synthetic Target',active:true,classId:'et'},memberships:{b3_2026_et:{workspaceId:'b3-2026',classId:'et',active:true}}};
  const counts={};
  const store={
    async get(path){
      counts[path]=(counts[path]||0)+1;
      await sleep(latencyMs);
      if(path==='b3Games/students')return rows;
      if(path==='posukPractice/allowedStudents')return {};
      if(path==='b3Private/passcodes/'+id)return {passcode:'839462',chosenPinVersion:1};
      return null;
    },
    async tx(){return {committed:true}},
    async update(){throw Error('Unexpected write in benchmark')}
  };
  const start=performance.now();
  const result=await studentAuth(store,{action:'login',name:'Synthetic Target',pin:'839462'},'synthetic-benchmark-ip');
  const elapsed=Math.round(performance.now()-start);
  assert.equal(result.ok,true);
  assert.equal(result.id,id);
  assert.equal(Object.keys(counts).length,3);
  assert.equal(counts['b3Games/students'],1);
  assert.equal(counts['posukPractice/allowedStudents'],1);
  assert.equal(counts['b3Private/passcodes/'+id],2);
  console.log('Synthetic students='+size+' | artificial per-read latency='+latencyMs+'ms | login core='+elapsed+'ms | directory reads=2 | passcode reads=2');
}

(async()=>{
  await benchmark(20,0);
  await benchmark(200,0);
  await benchmark(1000,0);
  await benchmark(200,75);
  console.log('NOTE: These are local synthetic simulations, not live website response times.');
})().catch(error=>{console.error(error);process.exitCode=1});
