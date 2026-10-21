const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('record_pesukim/student.html', 'utf8');
const source = html.slice(html.indexOf('function gradeSingleTranslationSegment('), html.indexOf('function jumpToChunk('));
function setup(fetch) {
  const c = {translationLoadToken:1, translationSegments:{0:{blob:{},ext:'webm'}},
    translationGradedResults:{},translationGradingPromises:{},currentPerekNum:18,currentPosukNum:1,
    GRADE_TRANSLATION_CHUNK_URL:'test', FormData:class {append(){}},
    B3PaidApi:{fetch},fetchKehotChapterTranslation:async()=>[],console:{error(){}},
    document:{getElementById:()=>({textContent:''})},
    saveTranslationChunkEvidence:async()=>{c.saves=(c.saves||0)+1;},
    showTranslationSummary(){c.rendered=true;},renderCurrentChunk(){}};
  vm.runInNewContext(source,c);return c;
}
const level={chunks:[{hebrew:'וירא',english:['appeared']}]};
for(const verdict of ['correct','incorrect']) test('translation preserves provider '+verdict+' and saves evidence',async()=>{
  const c=setup(async()=>({ok:true,json:async()=>({verdict,transcript:'appeared'})}));
  await c.gradeSingleTranslationSegment(0,level);
  assert.equal(c.translationGradedResults[0].verdict,verdict);assert.equal(c.saves,1);
});
test('offline and malformed grading responses never become incorrect grades',async()=>{
  for(const response of [{ok:false},{ok:true,json:async()=>({verdict:'unexpected'})}]){
    const c=setup(async()=>response);await c.gradeSingleTranslationSegment(0,level);
    assert.deepEqual(Object.keys(c.translationGradedResults),[]);assert.equal(c.saves,undefined);
    assert.ok(c.translationSegments[0].blob);
  }
});
for(const change of ['verse','recording']) test('late translation result cannot grade another '+change,async()=>{
  let resolve, started;
  const ready=new Promise(r=>{started=r;});
  const c=setup(()=>new Promise(r=>{resolve=r;started();}));
  const pending=c.gradeSingleTranslationSegment(0,level);
  await ready;
  if(change==='verse')c.translationLoadToken++;else c.translationSegments[0]={blob:{}};
  resolve({ok:true,json:async()=>({verdict:'correct'})});await pending;
  assert.deepEqual(Object.keys(c.translationGradedResults),[]);assert.equal(c.saves,undefined);assert.equal(c.rendered,undefined);
});
