const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('record_pesukim/student.html','utf8');
function section(start,end){return html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));}
test('repeated effective practice limits preserve the open translation and recording',async()=>{
 const limit={endPerek:18,endPosuk:30};
 const ctx={classPracticeLimit:limit,practiceScopeReady:true,effectiveRawLimit:()=>({...limit}),normalizedPracticeWindow:x=>x,document:{getElementById(){throw Error('must not reset UI');}}};
 vm.runInNewContext(section('async function applyPracticeLimitChange(){','const selectionModeSelect'),ctx);
 await ctx.applyPracticeLimitChange();await ctx.applyPracticeLimitChange();
});
test('changed practice limits still refresh access',async()=>{
 let rebuilds=0;
 const ctx={classPracticeLimit:null,practiceScopeReady:true,effectiveRawLimit:()=>({closed:true}),normalizedPracticeWindow:x=>x,selectedSefer:'Bereishis',perekSelect:{value:''},posukSelect:{value:''},rebuildPerekOptionsForClassLimit:()=>rebuilds++,updateNavArrows(){},document:{getElementById:()=>({textContent:''})}};
 vm.runInNewContext(section('async function applyPracticeLimitChange(){','const selectionModeSelect'),ctx);
 await ctx.applyPracticeLimitChange();assert.equal(rebuilds,1);assert.equal(ctx.classPracticeLimit.closed,true);
});
test('revisiting translation pieces reuses successful loads and retries failures',async()=>{
 let reads=0,available=true;const levels=[{chunks:[{hebrew:'שלום'}]}];
 const ctx={currentSefer:'Bereishis',translationLoadToken:1,promiseWithTimeout:p=>p,GENERATE_TRANSLATION_CHUNKS_URL:'',console:{error(){}},db:{ref:()=>({once:async()=>{reads++;return {exists:()=>available,val:()=>({levels})};}})}};
 vm.runInNewContext(section('const translationPieceCache = new Map();','function combineTranslationLevelsForRange'),ctx);
 const part={key:'Vayeira_18_1',text:'שלום',translation:'peace'};
 assert.equal(await ctx.fetchOrGenerateTranslationLevelsForPart(part,1),levels);
 assert.equal(await ctx.fetchOrGenerateTranslationLevelsForPart(part,1),levels);assert.equal(reads,1);
 const other={...part,key:'Vayeira_18_2'};available=false;
 assert.equal(await ctx.fetchOrGenerateTranslationLevelsForPart(other,1),null);available=true;
 assert.equal(await ctx.fetchOrGenerateTranslationLevelsForPart(other,1),levels);assert.equal(reads,3);
});
test('student inline scripts parse',()=>{for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(m[1]);});
