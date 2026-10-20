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
test('pieces persist across visits and simultaneous requests share one read',async()=>{
 const storage=new Map();let reads=0;
 const levels=[{chunks:[{hebrew:'שלום'}]}];
 const make=()=>{
  const ctx={currentSefer:'Bereishis',promiseWithTimeout:p=>p,GENERATE_TRANSLATION_CHUNKS_URL:'',console,
   localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
   db:{ref:()=>({once:async()=>{reads++;return {exists:()=>true,val:()=>({levels})};}})}};
  vm.runInNewContext(section('const translationPieceCache = new Map();','function combineTranslationLevelsForRange'),ctx);
  return ctx;
 };
 const part={key:'Vayeira_18_1',text:'שלום',translation:'peace'};
 const first=make();
 await Promise.all([first.fetchOrGenerateTranslationLevelsForPart(part),first.fetchOrGenerateTranslationLevelsForPart(part)]);
 assert.equal(reads,1);
 const revisit=make();
 assert.equal(JSON.stringify(revisit.cachedTranslationPieces(part)),JSON.stringify(levels));
 await revisit.fetchOrGenerateTranslationLevelsForPart(part);
 assert.equal(reads,1);
 await revisit.fetchOrGenerateTranslationLevelsForPart({...part,text:'changed text'});
 assert.equal(reads,2);
});
