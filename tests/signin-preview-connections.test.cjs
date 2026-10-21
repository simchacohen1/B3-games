'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const rewards=fs.readFileSync('student-rewards/student.js','utf8');
const preview=rewards.slice(rewards.indexOf('async function openTeacherPreview()'),rewards.indexOf('\nlet state='));
test('Rewards preview reads through teacher app without copying teacher auth into student app',async()=>{
 const reads=[];const c=vm.createContext({window:{B3SiteSettings:{getActingStudent:()=>null}},teacherAccountReady:Promise.resolve({user:{uid:'teacher'},authorized:true}),teacherPreview:false,ROOT:'studentRewards',state:{},render(){},
  db:{ref(){throw Error('student app must not read teacher preview');}},C:{ensureFirebase:()=>({db:{ref:p=>({once:async()=>{reads.push(p);return {val:()=>({})};}})}}),toast(){}}});
 vm.runInContext(preview,c);assert.equal(await c.openTeacherPreview(),true);assert.deepEqual(reads,['studentRewards/rewards','studentRewards/categories']);assert.equal(c.state.studentId,'teacher_preview');
});
test('unauthorized visitor never receives Rewards teacher preview data',async()=>{
 const c=vm.createContext({window:{B3SiteSettings:{getActingStudent:()=>null}},teacherAccountReady:Promise.resolve({authorized:false}),teacherPreview:false,C:{ensureFirebase(){throw Error('must not read');}}});
 vm.runInContext(preview,c);assert.equal(await c.openTeacherPreview(),false);
});
test('Halacha read-only preview saves neither student nor teacher state',()=>{
 const html=fs.readFileSync('halacha/index.html','utf8');const start=html.indexOf('function save(){'),end=html.indexOf('\nasync function loadCloudHalacha()',start);let message='';
 const c=vm.createContext({HALACHA_READ_ONLY_PREVIEW:true,setSaveStatus:s=>message=s});vm.runInContext(html.slice(start,end),c);c.save();assert.match(message,/nothing is saved/);
});
