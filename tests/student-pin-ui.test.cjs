const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function page(result={ok:true,id:'boy',name:'Test Boy',classId:'et',requiresPinChange:true}){
 const nodes=new Map(),saved=new Map(),entered=[],messages=[];
 const el=id=>{if(!nodes.has(id)){const classes=new Set();nodes.set(id,{value:'',disabled:false,classes,classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},focus(){},addEventListener(){}});}return nodes.get(id);};
 const ctx=vm.createContext({el,console,clearWrongPasscodeAttempts(){},recordWrongPasscodeAttempt:()=>1,setLoginMsg:m=>messages.push(m),sessionStorage:{setItem:(k,v)=>saved.set(k,v)},checkStudentAccess:async()=>result,enterStudent:async r=>entered.push(r)});
 const start=html.indexOf('  async function studentSignIn(){');
 const end=html.indexOf('  async function restoreStudent(){',start);
 vm.runInContext(html.slice(start,end),ctx);
 el('studentNameInput').value='Test Boy';el('classPinInput').value='1111';
 return {el,saved,entered,messages,run:s=>vm.runInContext(s,ctx)};
}
test('a teacher-assigned passcode opens the account without asking the student to set a new PIN',async()=>{
 const p=page();await p.run('studentSignIn()');
 assert.equal(p.saved.get('b3Games_classPin'),'1111');assert.equal(p.entered.length,1);assert.equal(p.entered[0].classId,'et');
 assert.equal(p.el('studentNameInput').disabled,false);assert.equal(p.el('studentSignInBtn').disabled,false);
 assert.doesNotMatch(html,/Choose your own PIN|Save my PIN and open Fun Torah Tools/);
});
test('an invalid sign-in does not save the passcode or enter the student account',async()=>{
 const p=page({ok:false,reason:'Passcode not recognized.'});await p.run('studentSignIn()');
 assert.equal(p.saved.size,0);assert.equal(p.entered.length,0);assert.equal(p.messages.at(-1),'Passcode not recognized.');
});
