const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const start=html.indexOf('  async function restoreStudent(){'),end=html.indexOf('  function switchStudent(){',start);
assert.ok(start>=0&&end>start);
function fixture({acting=true,pinChange=true,expired=false,missingPin=false,inactive=false,missingClass=false}={}){
 const saved=new Map([['b3Games_studentId','family_boy'],['b3Games_classPin','test-only-pin']]);if(missingPin)saved.delete('b3Games_classPin');
 let opened=0,login=0,calls=[];
 const ctx={isAuthorizedTeacher:false,isStudentPreview:false,previewStudentId:'',settingsApi:{getActingStudent:()=>acting?{id:'family_boy',classId:'family_friends'}:null},
  sessionStorage:{getItem:k=>saved.get(k)||null,removeItem:k=>saved.delete(k)},db:{ref:()=>({once:async()=>({exists:()=>true,val:()=>({name:'Family Boy',active:!inactive})})})},
  studentAuthCall:async body=>{calls.push(body);if(expired)throw {status:401};return {ok:true,requiresPinChange:pinChange}},
  el:()=>({value:''}),showChecking(){},showLogin(){login++;},setLoginMsg(){},isGuest:()=>false,resolvedStudentClass:async()=>missingClass?'':'family_friends',enterStudent:async()=>opened++,console};
 vm.runInNewContext(html.slice(start,end)+';globalThis.restore=restoreStudent;',ctx);
 return {run:()=>ctx.restore(),saved,get opened(){return opened},get login(){return login},calls};
}
test('teacher-assigned student passcodes restore without a second PIN setup prompt',async()=>{
 const f=fixture();await f.run();assert.equal(f.opened,1);assert.equal(f.saved.get('b3Games_classPin'),'test-only-pin');
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[{action:'verify',studentId:'family_boy',pin:'test-only-pin'}]);
});
test('ordinary students also reuse a verified teacher-assigned passcode',async()=>{const f=fixture({acting:false});await f.run();assert.equal(f.opened,1);assert.equal(f.calls.length,1)});
test('an acting flag cannot revive a server-rejected student passcode',async()=>{const f=fixture({expired:true});await f.run();assert.equal(f.opened,0);assert.equal(f.login,1);assert.equal(f.saved.has('b3Games_classPin'),false)});
test('missing passcodes, inactive profiles and unresolved classes stay closed',async()=>{
 for(const options of [{missingPin:true},{inactive:true},{missingClass:true}]){const f=fixture(options);await f.run();assert.equal(f.opened,0);assert.equal(f.login,1)}
});
test('completed PIN setup still uses the same server verification flow',async()=>{const f=fixture({pinChange:false});await f.run();assert.equal(f.opened,1);assert.equal(f.calls.length,1)});
