const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {resolveAnswerWordSets}=require('../backend/functions/question-answer-spans.cjs');
const text=fs.readFileSync('backend/functions/index.js','utf8');
const start=text.indexOf('exports.generateComprehensionQuestions =');
const end=text.indexOf('exports.gradeQuestionAnswer =',start);
async function generate(items){
 const ctx={exports:{},onRequest:(_,handler)=>handler,paidHandler:(_,__,handler)=>handler,
 ANTHROPIC_API_KEY:{value:()=> 'test'},PAID_ORIGINS:[],setCors(){},resolveAnswerWordSets,
 applyFrumBiblicalNames:x=>x,console,
 fetch:async(_,opts)=>{
  const body=JSON.parse(opts.body);
  // Match the provider's supported structured-output subset.
  assert.ok(!JSON.stringify(body.output_config.format.schema).includes('maxItems'));
  const value=body.max_tokens===1200?{approvedIndices:items.map((_,i)=>i)}:{items};
  return {ok:true,json:async()=>({content:[{type:'text',text:JSON.stringify(value)}]})};
 }};
 vm.runInNewContext(text.slice(start,end),ctx);
 const res={statusCode:200,status(n){this.statusCode=n;return this;},json(value){this.value=value;return this;}};
 await ctx.exports.generateComprehensionQuestions({method:'POST',body:{posukText:'ויבאו שני המלאכים סדמה בערב',posukTranslation:'The two angels came to Sedom in the evening.'}},res);
 return res;
}
test('question generation returns phrases mapped to actual button positions after review',async()=>{
 const res=await generate([{question:'Who came to Sedom?',sourceFact:'The two angels came.',expectedAnswer:'The two angels',answerHebrewPhrases:['שני המלאכים']}]);
 assert.equal(res.statusCode,200);
 assert.equal(JSON.stringify(res.value.items[0].answerWordSets),'[[1,2]]');
});
test('no verified questions is a retryable failure rather than a cacheable success',async()=>{
 const res=await generate([]);assert.equal(res.statusCode,422);assert.ok(res.value.error);
});
