const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const save=require('../chazara/recording-save');
test('a stalled audio upload is cancelled and reports a timeout',async()=>{
 let cancelled=false,unsubscribed=false;
 const task={then(){},on(){return()=>{unsubscribed=true}},cancel(){cancelled=true}};
 await assert.rejects(save.upload({put:()=>task},new Blob(['audio']),null,5),/Audio upload timed out/);
 assert.equal(cancelled,true);assert.equal(unsubscribed,true);
});
test('upload reports progress and returns the saved audio link',async()=>{
 const task=Promise.resolve();task.on=(type,cb)=>{cb({bytesTransferred:5,totalBytes:10});return()=>{}};
 let progress;const url=await save.upload({put:()=>task,getDownloadURL:async()=> 'audio-url'},new Blob(['audio']),v=>progress=v);
 assert.equal(url,'audio-url');assert.equal(progress,50);
});
test('permission failures retain their actionable error',async()=>{
 const error=Object.assign(new Error('Permission denied'),{code:'storage/unauthorized'});
 const task=Promise.reject(error);task.on=()=>()=>{};
 await assert.rejects(save.upload({put:()=>task},new Blob(['audio'])),e=>e===error);
});
function recording(upload){
 const html=fs.readFileSync('chazara/index.html','utf8'),code=html.slice(html.indexOf('async function finishRecording(st)'),html.indexOf('\nfunction slugifyStudentName'));
 const writes=[],result={count:0,preserved:0,renders:0};
 const ref={key:'event-1',set:async v=>writes.push(v),update:async v=>writes.push(v)};
 const context={Blob,performance:{now:()=>6000},stopMediaTracks(){},canReview:()=>true,resetRecordingUI(){},recorderState:{},preserveRecording:()=>result.preserved++,render:()=>result.renders++,renderRecordings(){},showNotice(){},requestPoints:()=>new Promise(()=>{}),console:{error(){}},ChazaraRecordingSave:{upload,deadline:save.deadline},db:{ref:()=>({push:()=>ref})},storage:{ref:()=>({})},EVENTS:'events/',sid:'student-1',sname:'Student',localStorage:{getItem:()=> 'class-1'},extFor:()=> 'webm',d:{reviews:{}},unlocked:{},dayKey:()=> '2026-10-02',compactWave:()=>[],firebase:{database:{ServerValue:{TIMESTAMP:123}}},incrementReview:async()=>result.count++,chazaraEvents:{}};
 vm.createContext(context);vm.runInContext(code,context);
 return {context,result,writes,run:()=>context.finishRecording({start:0,chunks:['audio'],recorder:{mimeType:'audio/webm'},peak:.1,voiced:10,frames:20,key:'18_1',samples:[],status:{}})};
}
test('an uploaded recording finishes without waiting for points',async()=>{
 const x=recording(async()=> 'audio-url');await save.deadline(x.run(),100,'Recording test');
 assert.equal(x.result.count,1);assert.equal(x.writes[0].workspaceClassId,'class-1');assert.equal(x.context.chazaraEvents['event-1'].reviewApplied,true);assert.equal(x.context.recorderState,null);
});
test('upload failure preserves audio and never credits the review',async()=>{
 const x=recording(async()=>{throw new Error('Audio upload timed out.')});await x.run();
 assert.equal(x.result.preserved,1);assert.equal(x.result.count,0);assert.equal(x.writes.length,0);assert.equal(x.context.recorderState,null);
});
