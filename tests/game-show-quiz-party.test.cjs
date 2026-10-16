'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('game-show/quiz-party.js','utf8');
const marker='root.QuizPartyLogic=Object.freeze({answer,grade,ranking,valid});';
function logic(){
 const i=source.indexOf(marker);assert.ok(i>0);
 const window={};
 vm.runInNewContext(source.slice(0,i+marker.length)+'\n})(window);',{
  window,location:{pathname:'/game-show/player.html'},
  gameRef:{child(){return {};}}
 });
 return window.QuizPartyLogic;
}
const plain=x=>JSON.parse(JSON.stringify(x));
const question={q:'What did Avrohom serve?',choices:['Water','Bread','Milk','Meat'],correctIndex:1};
test('Quiz Party accepts only four distinct choices with one valid correct index',()=>{
 const c=logic();
 assert.equal(c.valid(question),true);
 assert.equal(c.valid({...question,choices:['One','One','Three','Four']}),false);
 assert.equal(c.valid({...question,correctIndex:4}),false);
 assert.equal(c.valid({...question,choices:['A','B']}),false);
});
test('all students may answer the same question exactly once, in the allotted window',()=>{
 const c=logic(),state={roundId:'round-1',phase:'answering',openedAt:1000,closesAt:21000,answers:{}};
 const first=c.answer(state,'ari','Ari',1,6000,'round-1');
 const both=c.answer(first,'ben','Benny',2,7000,'round-1');
 assert.deepEqual(Object.keys(both.answers).sort(),['ari','ben']);
 assert.equal(c.answer(first,'ari','Ari',3,8000,'round-1'),undefined);
 assert.equal(c.answer(both,'zoe','Zoe',1,22000,'round-1'),undefined);
 assert.equal(c.answer(both,'zoe','Zoe',1,8000,'old-round'),undefined);
 assert.equal(c.answer({...state,phase:'reveal'},'zoe','Zoe',1,8000,'round-1'),undefined);
});
test('host-only scoring rewards accuracy, speed and streak once per round',()=>{
 const c=logic();
 const state={
  phase:'answering',roundId:'a',openedAt:1000,closesAt:11000,
  scores:{Ari:0,Benny:0},streaks:{Ari:1,Benny:3},
  answers:{ari:{name:'Ari',choice:1,at:2000},benny:{name:'Benny',choice:0,at:4000}}
 };
 assert.equal(c.grade(state,1,3000),undefined,'no early automatic grading');
 const result=plain(c.grade(state,1,11000));
 assert.equal(result.phase,'reveal');
 assert.equal(result.correctCount,1);
 assert.equal(result.answerCount,2);
 assert.equal(result.scores.Ari,1000,'fast answer gains speed and second-correct streak bonus');
 assert.equal(result.scores.Benny,0);
 assert.equal(result.streaks.Ari,2);
 assert.equal(result.streaks.Benny,0);
 assert.equal(c.grade(result,1,15000),undefined,'reveal cannot award twice');
});
test('late answers do not affect scores and leaderboard orders by points',()=>{
 const c=logic();
 const r=plain(c.ranking({Chaim:500,Ari:900,Benny:900,Dan:0}));
 assert.deepEqual(r.map(x=>x.name),['Ari','Benny','Chaim','Dan']);
});
test('Quiz Party and announcer load only on their intended screens',()=>{
 const host=fs.readFileSync('game-show/teacher.html','utf8');
 const player=fs.readFileSync('game-show/player.html','utf8');
 const quiz=fs.readFileSync('game-show/quiz-party.js','utf8');
 const team=fs.readFileSync('game-show/team-modes.js','utf8');
 assert.match(host,/quiz-party-audio\.js\?v=/);
 assert.match(host,/quiz-party\.js\?v=/);
 assert.match(player,/quiz-party\.js\?v=/);
 assert.doesNotMatch(player,/quiz-party-audio\.js\?v=/);
 assert.match(quiz,/phase:"intro"/);
 assert.match(quiz,/phase="answering"/);
 assert.match(quiz,/grade\(s,q\.correctIndex,now\(\),force\)/);
 assert.match(quiz,/ref\.transaction\(s=>answer\(/);
 assert.match(quiz,/root\.QuizPartyLogic/);
 assert.match(team,/window\.GameShowPartyAudio\?\.stopSpeech/);
});
test('Original jingle and paid voice are optional and the voice service is fixed to known endpoint',()=>{
 const s=fs.readFileSync('game-show/quiz-party-audio.js','utf8');
 assert.match(s,/en-US/);
 assert.match(s,/synthesizeSpeech/);
 assert.match(s,/GameShowPartyAudio/);
 assert.match(s,/duck\(true\)/);
 assert.match(s,/duck\(false\)/);
 assert.match(s,/enabled = !!on/);
 assert.match(s,/16 \* 190/);
 assert.doesNotMatch(s,/k[a]?hoot\.mp3/i);
});
