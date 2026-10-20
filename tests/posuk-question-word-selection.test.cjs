const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('record_pesukim/student.html','utf8');
const source=html.slice(html.indexOf('function verifiedQuestionAnswerWordSets('),html.indexOf('function renderQuestionWordChoices('));
function checker(text){
 const ctx={currentSelectionParts:[{posukNum:1,text}],currentPosukNum:1,currentPosukText:text};
 vm.runInNewContext(source,ctx);return ctx;
}
test('the two angels answers who came to Sedom despite a stale cached word key',()=>{
 const c=checker('וַיָּבֹאוּ שְׁנֵי הַמַּלְאָכִים סְדֹמָה בָּעֶרֶב וְלוֹט יֹשֵׁב');
 const q={question:'Who came to Sedom?',posukNum:1,answerWordSets:[[2,3]]};
 assert.equal(c.matchesAnyAnswerWordSet([1,2],q),true);
 for(const selection of [[2],[1],[2,3],[1,2,3],[5]])assert.equal(c.matchesAnyAnswerWordSet(selection,q),false);
});
test('correction preserves other questions and other verses',()=>{
 const c=checker('ויבאו שני המלאכים סדמה בערב');
 assert.equal(c.matchesAnyAnswerWordSet([4],{question:'When did they come?',posukNum:1,answerWordSets:[[4]]}),true);
 assert.equal(c.matchesAnyAnswerWordSet([1,2],{question:'When did they come?',posukNum:1,answerWordSets:[[4]]}),false);
 const other=checker('אברהם הלך אל סדם');
 assert.equal(other.matchesAnyAnswerWordSet([0],{question:'Who came to Sedom?',posukNum:1,answerWordSets:[[0]]}),true);
});
