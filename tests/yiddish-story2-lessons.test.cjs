const test=require('node:test'),assert=require('node:assert/strict');
const {makeService}=require('../backend/functions/yiddish-service/core.cjs');
function setup(){
 const classId='alpha',data={
  'b3Games/students/student1/profile':{name:'Student',passcode:'1234',active:true},
  'b3Games/students/student1/memberships':{a:{workspaceId:'b3-2026',classId,active:true}},
  'b3Games/workspaces/b3-2026/classes/alpha':{active:true,members:{student1:{name:'Student',active:true}},toolGrants:{yiddish:true}},
  'b3Games/workspaces/b3-2026/contentGrants/alpha/yiddishWineMerchant':true,
  'b3Games/workspaces/b3-2026/teachers/teacher1':{active:true,classIds:{alpha:true}}
 };
 const store={get:async p=>data[p]??null,set:async(p,v)=>{data[p]=v},tx:async(p,f)=>{const v=f(structuredClone(data[p]??null));if(v!==undefined)data[p]=v}};
 const service=makeService(store,async token=>token==='owner'?{uid:'owner',email:'simcha5770@gmail.com',email_verified:true}:{uid:'teacher1',email:'teacher@example.org',email_verified:true});
 return {data,service};
}
const vocab=Array.from({length:8},()=>[]);vocab[0]=[{yi:'הויז',en:'house'},{yi:'בוים',en:'tree'}];vocab[1]=[{yi:'וואַסער',en:'water'},{yi:'ברויט',en:'bread'}];
test('Story 2 starts locked and teacher saves independent settings',async()=>{
 const x=setup();
 const before=await x.service({action:'teacherStory2Load',idToken:'teacher',classId:'alpha'});
 assert.equal(before.settings.openParts,0);
 const saved=await x.service({action:'teacherStory2Save',idToken:'teacher',classId:'alpha',settings:{version:0,openParts:1,vocabulary:vocab}});
 assert.equal(saved.settings.openParts,1);
 assert.equal(x.data['yiddishPrivate/classes/b3-2026/alpha/config'],undefined);
 await assert.rejects(x.service({action:'teacherStory2Save',idToken:'teacher',classId:'alpha',settings:{version:0,openParts:2,vocabulary:vocab}}),/changed elsewhere/);
});
test('Student can practice only unlocked parts and progress is separate',async()=>{
 const x=setup();
 await x.service({action:'teacherStory2Save',idToken:'teacher',classId:'alpha',settings:{version:0,openParts:1,vocabulary:vocab}});
 const {token}=await x.service({action:'login',studentId:'student1',classId:'alpha',pin:'1234'});
 const status=await x.service({action:'story2Status',token});
 assert.equal(status.openParts,1);assert.equal(status.parts[1].words.length,0);
 await assert.rejects(x.service({action:'story2Practice',token,part:1,position:0}),/not open/);
 const q=await x.service({action:'story2Practice',token,part:0,position:0});
 assert.equal(q.question,'הויז');
 const r=await x.service({action:'story2Practice',token,part:0,position:0,answer:'house'});
 assert.equal(r.correct,true);
 const after=await x.service({action:'story2Status',token});
 assert.equal(after.progress.completed[0][0],true);
 assert.equal(x.data['yiddishPrivate/classes/b3-2026/alpha/students/student1'],undefined);
});
test('Teacher cannot change another class Story 2',async()=>{
 const x=setup();
 await assert.rejects(x.service({action:'teacherStory2Load',idToken:'teacher',classId:'beta'}),/not assigned/);
});
