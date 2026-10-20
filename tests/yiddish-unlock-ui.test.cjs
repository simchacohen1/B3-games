const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('yiddish/teacher.js','utf8');
function setup(){
 const elements={};const element=id=>elements[id]||(elements[id]={value:'2',disabled:false,hidden:false,textContent:'',replaceChildren(){},append(){}});
 const calls=[];let resolve,reject;
 const context={YIDDISH_CONTENT:{paras:[],words:[]},document:{getElementById:element},YiddishAPI:{call:(action,data)=>{calls.push({action,data});return new Promise((a,b)=>{resolve=a;reject=b})}},B3SiteSettings:{onAuthStateChanged(){}},URLSearchParams,location:{search:'?class=wt'},structuredClone,window:{scrollTo(){}}};
 vm.createContext(context);vm.runInContext(source,context);
 vm.runInContext("config={version:1,unlocked:{et:1,wt:1},unlockedSteps:{et:2,wt:2},sections:[]};user={getIdToken:async()=>'test'}",context);
 return {context,elements,calls,resolve:r=>resolve(r),reject:e=>reject(e),run:s=>vm.runInContext(s,context)};
}
test('selecting WT 5 immediately saves only WT without a separate save click',async()=>{
 const x=setup();x.elements.wt.value='5';let stopped=false;x.elements.wt.onchange({stopPropagation(){stopped=true}});
 await new Promise(r=>setImmediate(r));assert.equal(stopped,true);assert.equal(x.calls.length,1);
 assert.equal(x.calls[0].action,'teacherSetUnlock');assert.equal(x.calls[0].data.track,'wt');assert.equal(x.calls[0].data.steps,5);assert.equal(x.calls[0].data.expectedSteps,2);
 assert.equal(x.elements.et.disabled,true);
 x.resolve({config:{version:2,unlocked:{et:1,wt:3},unlockedSteps:{et:2,wt:5}}});await new Promise(r=>setImmediate(r));
 assert.equal(x.elements.wt.value,5);assert.match(x.elements.notice.textContent,/WT saved: 5/);assert.equal(x.elements.et.disabled,false);
});
test('a rejected save restores saved level and clearly reports failure',async()=>{
 const x=setup();x.elements.wt.value='4';const save=x.run("saveUnlock('wt')");await new Promise(r=>setImmediate(r));x.reject(Error('Settings changed elsewhere'));await save;
 assert.equal(x.elements.wt.value,2);assert.match(x.elements.notice.textContent,/NOT saved/);
});
test('a delayed load cannot overwrite an edited page',async()=>{
 const x=setup();const loading=x.run('load()');await new Promise(r=>setImmediate(r));x.run('dirty=true');x.resolve({config:{unlockedSteps:{wt:1}}});await loading;
 assert.equal(x.run('config.unlockedSteps.wt'),2);
});
test('a delayed load cannot overwrite a new unlock save',async()=>{
 const x=setup();const loading=x.run('load()');await new Promise(r=>setImmediate(r));const finishLoad=x.resolve;
 // Complete the read after the save generation changed, without replacing config.
 x.run('++loadSequence');finishLoad({config:{unlockedSteps:{wt:1}}});await loading;
 assert.equal(x.run('config.unlockedSteps.wt'),2);
});
