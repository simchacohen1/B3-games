const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('yiddish/teacher-preview.js','utf8');
async function preview({authorized=true,acting=false,granted=true}={}){
 const calls=[],words=Array.from({length:8},(_,i)=>({id:'word'+i,group:Math.floor(i/4)}));
 const config={unlocked:{mine:0},unlockedSteps:{mine:0},sections:[0,1,2,3].map(i=>({verified:false,words:words.slice(i*2,i*2+2).map(w=>w.id)}))};
 const api={call:async(action,data)=>{calls.push({action,data});return {config,storyGranted:granted};}};
 const context={window:{YiddishAPI:api,YIDDISH_CONTENT:{words},B3TeacherAccountReady:Promise.resolve({user:{getIdToken:async()=>'teacher-token'},authorized,access:{classIds:['mine']}})},B3SiteSettings:{getActingStudent:()=>acting},URLSearchParams,location:{search:'?class=mine'},structuredClone,Date,Math,Set};
 vm.runInNewContext(source,context);await api.ready;return {api,calls,config};
}
test('teacher demonstrations use authorized content and never write student results',async()=>{
 const {api,calls,config}=await preview();
 const status=await api.call('status');assert.equal(status.student.id,'teacher_preview');assert.equal(status.config.unlocked.mine,4);assert.equal(config.unlocked.mine,0);
 let round=(await api.call('start',{group:0,part:0})).round;
 const wrong=round.question.choices.find(id=>id!==round.question.wordId);
 assert.equal((await api.call('answer',{roundId:round.id,index:0,answer:wrong})).correct,false);
 while(!round.finished){const result=await api.call('answer',{roundId:round.id,index:round.index,answer:round.question.wordId});round=result.round;}
 await api.call('storyAnswer',{correct:true});
 assert.equal(calls.length,1);assert.equal(calls[0].action,'teacherLoad');assert.equal(calls[0].data.classId,'mine');
 assert.ok(Object.keys((await api.call('status')).progress).length>0);
});
test('ordinary students retain the live API',async()=>{const {api,calls}=await preview({authorized:false});assert.equal(api.preview,undefined);await api.call('status');assert.equal(calls[0].action,'status');});
test('explicit impersonation retains the real student flow',async()=>{const {api,calls}=await preview({acting:true});assert.equal(api.preview,undefined);assert.equal(calls.length,0);});
test('demonstrations preserve class story grants',async()=>{const {api}=await preview({granted:false});assert.equal((await api.call('status')).noStory,true);await assert.rejects(api.call('start',{group:0}),/does not have/);});
