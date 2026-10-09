const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function page(){
 const nodes=new Map(),saved=new Map(),entered=[],messages=[],calls=[];
 const el=id=>{if(!nodes.has(id)){const classes=new Set();nodes.set(id,{value:'',disabled:false,classes,classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},focus(){},addEventListener(){}});}return nodes.get(id);};
 const result={ok:true,id:'boy',name:'Test Boy',classId:'et',requiresPinChange:true};
 const ctx=vm.createContext({el,console,showLogin(){},setLoginMsg:m=>messages.push(m),sessionStorage:{setItem:(k,v)=>saved.set(k,v)},checkStudentAccess:async()=>result,enterStudent:async r=>entered.push(r),studentAuthCall:async body=>{calls.push(body);return {...result,requiresPinChange:false};}});
 const form=html.slice(html.indexOf('  let pendingPinLogin=null;'),html.indexOf('  let studentClassWatch='));
 const signIn=html.slice(html.indexOf('  async function studentSignIn(){'),html.indexOf('  async function restoreStudent(){'));
 vm.runInContext(form+'\n'+signIn,ctx);el('studentNameInput').value='Test Boy';el('classPinInput').value='1111';
 return {ctx,el,saved,entered,messages,calls,run:s=>vm.runInContext(s,ctx)};
}
test('required change shows PIN form before games or session credentials are saved',async()=>{
 const p=page();await p.run('studentSignIn()');assert.equal(p.entered.length,0);assert.equal(p.saved.size,0);
 assert.equal(p.el('studentNameInput').disabled,true);assert.equal(p.el('studentSignInBtn').classes.has('hidden'),true);
 await p.run('studentSignIn()');assert.equal(p.entered.length,0);
});
test('mismatched PINs and server conflicts keep boy on required change form',async()=>{
 const p=page();await p.run('studentSignIn()');p.el('newStudentPin').value='4567';p.el('confirmStudentPin').value='4568';
 await p.run('chooseStudentPin()');assert.equal(p.calls.length,0);assert.match(p.messages.at(-1),/do not match/);
 p.el('confirmStudentPin').value='4567';p.ctx.studentAuthCall=async()=>{throw new Error('That PIN is already in use.');};
 await p.run('chooseStudentPin()');assert.equal(p.saved.size,0);assert.equal(p.entered.length,0);assert.equal(p.el('chooseStudentPinBtn').disabled,false);
 assert.equal(p.el('studentSignInBtn').classes.has('hidden'),true);
});
test('successful required change saves only the new session PIN and opens games',async()=>{
 const p=page();await p.run('studentSignIn()');p.el('newStudentPin').value='4567';p.el('confirmStudentPin').value='4567';
 await p.run('chooseStudentPin()');assert.equal(p.saved.get('b3Games_classPin'),'4567');assert.equal(p.entered[0].classId,'et');
 assert.equal(p.el('newStudentPin').value,'');assert.equal(p.el('classPinInput').value,'');assert.equal(p.el('studentNameInput').disabled,false);
 assert.equal(p.el('choosePinForm').classes.has('hidden'),true);
});
