const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('yiddish/app.js','utf8');
const startup=source.slice(source.lastIndexOf('(async()=>{try{'));
async function run(saved={},failure){
 const values=new Map(Object.entries(saved)),calls=[],messages=[];
 const loginPanel={hidden:false};
 await vm.runInNewContext(startup,{
 sessionStorage:{getItem:k=>values.get(k)||null,removeItem:k=>values.delete(k)},
 refresh:async()=>{calls.push('refresh');if(failure)throw failure;},
 login:async(id,pin)=>{calls.push([id,pin]);if(failure)throw failure;},
 message:s=>messages.push(s),block:s=>messages.push(s),
 $:id=>{assert.equal(id,'login');return loginPanel;},
 noStory:false,setInterval:()=>{},
 });
 return {calls,messages,values};
}
test('Yiddish connects using the existing main sign-in',async()=>{
 const r=await run({b3Games_studentId:'alice',b3Games_classPin:'1234'});
 assert.deepEqual(r.calls,[['alice','1234']]);
});
test('Yiddish reuses a current lesson session',async()=>{
 const r=await run({yiddishSession:'token',yiddishSessionClass:'et',b3Games_studentClass:'et'});
 assert.deepEqual(r.calls,['refresh']);
});
test('missing saved PIN directs students to the main sign-in without a credential form',async()=>{
 const r=await run({b3Games_studentId:'alice'});
 assert.equal(r.calls.length,0);assert.match(r.messages[0],/Fun Torah Tools and sign in/);
});
test('connection failures do not request credentials inside Yiddish',async()=>{
 const r=await run({b3Games_studentId:'alice',b3Games_classPin:'1234'},Error('Connection timed out.'));
 assert.deepEqual(r.messages,['Connection timed out.']);
});
test('Yiddish contains no secondary name or PIN form',()=>{
 const html=fs.readFileSync('yiddish/index.html','utf8');
 assert.doesNotMatch(html,/<input\b|loginForm/);
 assert.doesNotMatch(source,/loginForm|Type your name and passcode/);
});
