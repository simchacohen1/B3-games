const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {resolveAnswerWordSets}=require('../backend/functions/question-answer-spans.cjs');
const html=fs.readFileSync('record_pesukim/student.html','utf8');
const source=html.slice(html.indexOf('function matchesAnyAnswerWordSet('),html.indexOf('function renderQuestionWordChoices('));
const verse='וַיָּבֹאוּ שְׁנֵי הַמַּלְאָכִים סְדֹמָה בָּעֶרֶב וְלוֹט יֹשֵׁב בְּשַׁעַר־סְדֹם';
function matches(text,phrase,selection){
 const c={currentSelectionParts:[{posukNum:1,text}],currentPosukNum:1,currentPosukText:text};
 vm.runInNewContext(source,c);
 return c.matchesAnyAnswerWordSet(selection,{posukNum:1,answerWordSets:resolveAnswerWordSets(text,[phrase])});
}
test('all answers in a verse use positions resolved from Hebrew evidence',()=>{
 for(const [phrase,indices] of [['שני המלאכים',[1,2]],['סדמה',[3]],['בערב',[4]],['ולוט',[5]],['בשער סדם',[7]]]){
  assert.equal(matches(verse,phrase,indices),true,phrase);
  assert.equal(matches(verse,phrase,indices.map(i=>i+1)),false,phrase+' must not accept shifted indexes');
 }
});
test('other verses and repeated phrases resolve without special cases',()=>{
 assert.deepEqual(resolveAnswerWordSets('ויאמר משה אל אהרן ויאמר משה',['משה']),[[1],[5]]);
 assert.deepEqual(resolveAnswerWordSets('ויאמר משה אל אהרן',['אל אהרן']),[[2,3]]);
 assert.deepEqual(resolveAnswerWordSets('ויאמר משה אל אהרן',['not Hebrew']),[]);
 assert.deepEqual(resolveAnswerWordSets(verse,['המלאכים סדמה בערב ויאמר']),[]);
 assert.deepEqual(resolveAnswerWordSets(verse,['שער']),[]);
 assert.equal(matches(verse,'שני המלאכים',[1]),false);
 assert.equal(matches(verse,'שני המלאכים',[1,2,3]),false);
});
test('old unverified question caches are not reused',()=>{
 const c={normalizeDivineNames:x=>x};
 const start=html.indexOf('function normalizeGeneratedItems(');
 vm.runInNewContext(html.slice(start,html.indexOf('function readLocalGeneratedQuestions(',start)),c);
 const old={question:'Who came?',answerWordSets:[[2,3]]};
 assert.equal(c.normalizeGeneratedItems([old],1).length,0);
 assert.equal(c.normalizeGeneratedItems([{...old,answerHebrewPhrases:['שני המלאכים'],answerWordSets:[[1,2]]}],1).length,1);
 assert.ok(!html.includes('verifiedQuestionAnswerWordSets'));
 assert.ok(html.includes('_phrases_v7'));
});
