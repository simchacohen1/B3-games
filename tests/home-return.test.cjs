const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(process.env.HOME_RETURN_SOURCE||__dirname+'/../index.html','utf8');
test('all inline home page scripts parse before a release',()=>{
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];assert.ok(scripts.length);
  for(const script of scripts)new vm.Script(script[1]);
});
const block=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
function fixture({teacher=false,missing=false,verify}={}){
  const nodes=new Map(),classes=id=>{if(!nodes.has(id)){const values=new Set();nodes.set(id,{value:'',textContent:'',classList:{add:x=>values.add(x),remove:x=>values.delete(x),contains:x=>values.has(x)},querySelector:()=>({textContent:''})})}return nodes.get(id)};
  const saved=new Map([['b3Games_studentId','old-student'],['b3Games_studentName','Old student'],...(missing?[]:[['b3Games_classPin','dummy-test-value']])]);
  let resolveRead,reads=0,entered=0;
  const firstRead=new Promise(resolve=>resolveRead=resolve);
  const context=vm.createContext({isAuthorizedTeacher:teacher,isStudentPreview:false,previewStudentId:'',myStudentId:'',myStudentName:'',myClassId:'',workspaceId:'b3-2026',
    localStorage:{getItem:key=>saved.get(key)||null,removeItem:key=>saved.delete(key)},document:{querySelectorAll:()=>[]},el:classes,
    db:{ref:()=>({once:()=>{reads++;return firstRead}})},studentAuthCall:verify||(()=>Promise.resolve({ok:true})),resolvedStudentClass:async()=> 'et',
    enterStudent:async()=>entered++,console,renderStudentAccess:()=>{classes('loginCard').classList.add('hidden');classes('gamesArea').classList.remove('hidden')}
  });
  vm.runInContext(block('  function setLoginMsg(', '  function studentHasOverride(')+block('  async function restoreStudent(){','  function switchStudent(){'),context);
  return {context,nodes:classes,saved,get reads(){return reads},get entered(){return entered},restore:()=>vm.runInContext('restoreStudent()',context),teacher:()=>{context.isAuthorizedTeacher=true;context.renderStudentAccess()},resolve:()=>resolveRead({exists:()=>true,val:()=>({name:'Old student',active:true})})};
}
test('a delayed old student check cannot hide an already verified teacher',async()=>{
  const f=fixture({missing:true}),pending=f.restore();f.teacher();f.resolve();await pending;
  assert.equal(f.nodes('loginCard').classList.contains('hidden'),true);assert.equal(f.nodes('gamesArea').classList.contains('hidden'),false);assert.equal(f.entered,0);
});
test('teacher verification during passcode verification preserves the saved student passcode',async()=>{
  let release,started;const enteredVerify=new Promise(r=>started=r);
  const f=fixture({verify:()=>{started();return new Promise((resolve,reject)=>release=()=>reject({status:401}))}}),pending=f.restore();f.resolve();await enteredVerify;f.teacher();release();await pending;
  assert.equal(f.saved.has('b3Games_classPin'),true);assert.equal(f.nodes('loginCard').classList.contains('hidden'),true);assert.equal(f.entered,0);
});
test('known teachers skip restoration and late student login screens',async()=>{
  const f=fixture({teacher:true});f.teacher();const pending=f.restore();f.resolve();await pending;vm.runInContext('showLogin();showChecking()',f.context);
  assert.equal(f.reads,0);assert.equal(f.nodes('loginCard').classList.contains('hidden'),true);
});
test('a student with a missing passcode still receives the original sign-in form',async()=>{
  const f=fixture({missing:true}),pending=f.restore();f.resolve();await pending;
  assert.equal(f.nodes('loginCard').classList.contains('hidden'),false);assert.match(f.nodes('loginMsg').textContent,/Please sign in once more/);assert.equal(f.entered,0);
});
test('a valid saved student session still restores normally',async()=>{
  const f=fixture(),pending=f.restore();f.resolve();await pending;assert.equal(f.entered,1);
});
