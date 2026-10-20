const test=require('node:test'),assert=require('node:assert/strict');
const {gradePosukAnswer}=require('../backend/functions/posuk-answer-grading.cjs');
const base={question:'Who came to Sedom?',posukText:'ויבאו שני המלאכים סדמה בערב ולוט ישב',posukTranslation:'The two angels came to Sedom in the evening. Lot was sitting.',expectedAnswer:'The two angels'};
// Contract tests use a stub provider; real model quality still requires live evaluation.
for(const answer of ['The two angels','Two messengers','the angels'])test('passes acceptable wording to semantic provider: '+answer,async()=>{
 const result=await gradePosukAnswer({...base,answerText:answer},async request=>{
  assert.equal(JSON.parse(request.messages[0].content).studentAnswer,answer);
  assert.match(request.system,/by MEANING/);
  return {verdict:'correct',feedback:'Well done!',answerHebrewPhrases:['שני המלאכים']};
 });
 assert.equal(result.verdict,'correct');assert.deepEqual(result.answerWordSets,[[1,2]]);
});
test('shorter valid selection is judged by AI rather than cached index equality',async()=>{
 const result=await gradePosukAnswer({...base,selectionIndices:[2]},async request=>{
  assert.equal(JSON.parse(request.messages[0].content).studentAnswer,'המלאכים');
  return {verdict:'correct',answerHebrewPhrases:['המלאכים']};
 });assert.deepEqual(result.answerWordSets,[[2]]);
});
test('wrong answer remains incorrect and has no accepted evidence',async()=>{
 const result=await gradePosukAnswer({...base,answerText:'Lot'},async()=>({verdict:'incorrect',answerHebrewPhrases:['ולוט']}));
 assert.equal(result.verdict,'incorrect');assert.deepEqual(result.answerWordSets,[]);
});
test('service failures and hallucinated Hebrew never become a grade',async()=>{
 await assert.rejects(gradePosukAnswer({...base,answerText:'angels'},async()=>{throw Error('offline')}),/offline/);
 await assert.rejects(gradePosukAnswer({...base,answerText:'angels'},async()=>({verdict:'correct',answerHebrewPhrases:['משה']})),/evidence/);
 await assert.rejects(gradePosukAnswer({...base,selectionIndices:[99]},async()=>{}),/selection/);
});
const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('record_pesukim/student.html','utf8');
function browser(fetch){
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{disabled:false,textContent:'',classList:{add(){},toggle(){}}});return nodes.get(id);};
 const c={comprehensionQIndex:0,comprehensionQuestions:[{question:base.question,posukNum:1}],questionSelectionDrafts:{0:[2]},currentSelectionParts:[{posukNum:1,translation:base.posukTranslation}],currentPosukTranslation:'',comprehensionQResults:{},questionTryCounts:{},getQuestionPosukWords:()=>base.posukText.split(' '),document:{getElementById:node},B3PaidApi:{fetch},GRADE_QUESTION_ANSWER_URL:'test',renderQuestionResult(){},renderQuestionWordChoices(){},renderAnsweredQuestionHistory(){},renderQuestionFinalScore(){},speakText(){},setTimeout(){},autosaveComprehensionQuestions:async()=>{c.saved=true;}};
 vm.runInNewContext(html.slice(html.indexOf('async function gradeCurrentQuestionAnswer(){'),html.indexOf('function matchesAnyAnswerWordSet(')),c);return c;
}
test('browser uses AI verdict for alternative selections and saves existing record format',async()=>{
 const c=browser(async()=>({ok:true,json:async()=>({verdict:'correct',feedback:'Great!',answerWordSets:[[2]],gradingVersion:'semantic-v1'})}));
 await c.gradeCurrentQuestionAnswer();assert.equal(c.comprehensionQResults[0].verdict,'correct');assert.equal(c.saved,true);
});
test('browser does not save or count failed requests or older backend responses',async()=>{
 for(const response of [{ok:false},{ok:true,json:async()=>({verdict:'incorrect'})}]){
  const c=browser(async()=>response);await c.gradeCurrentQuestionAnswer();assert.equal(c.saved,undefined);assert.equal(Object.keys(c.comprehensionQResults).length,0);assert.equal(Object.keys(c.questionTryCounts).length,0);
 }
});
