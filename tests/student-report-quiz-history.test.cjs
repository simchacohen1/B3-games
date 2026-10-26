'use strict';
// Synthetic data only: made-up students and quizzes.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const H=require('../student-report/quiz-history.js');

const DAY=86400000,NOW=Date.UTC(2026,9,26);
const q3=[{q:'Q one?',choices:['A','B'],correctIndex:0},{q:'Q two?',choices:['A','B'],correctIndex:1},{q:'Q three?',choices:['A','B'],correctIndex:0}];
const launch=(extra)=>({quizSnapshot:{title:'Synthetic Quiz',questions:q3},createdAt:NOW-10*DAY,startedAt:NOW-10*DAY,started:true,...extra});
const right=(i,t=NOW-9*DAY)=>({choiceIndex:q3[i].correctIndex,correct:true,submittedAt:t});
const wrong=(i,t=NOW-9*DAY)=>({choiceIndex:1-q3[i].correctIndex,correct:false,submittedAt:t});

function legacyRoot(){
 return {
  launches:{
   done_et:launch({classId:'et',deliveryType:'live',endedAt:NOW-9*DAY,attemptGroupId:'done_et',quizSnapshot:{title:'Completed Quiz',questions:q3}}),
   partial_et:launch({classId:'et',deliveryType:'anytime',targetStudents:{s_a:true,s_b:true},attemptGroupId:'partial_et',quizSnapshot:{title:'Half Done Quiz',questions:q3}}),
   none_et:launch({classId:'et',deliveryType:'live',endedAt:NOW-5*DAY,createdAt:NOW-6*DAY,startedAt:NOW-6*DAY,attemptGroupId:'none_et',quizSnapshot:{title:'Missed Quiz',questions:q3}}),
   base_et:launch({classId:'et',deliveryType:'live',endedAt:NOW-20*DAY,createdAt:NOW-21*DAY,startedAt:NOW-21*DAY,attemptGroupId:'base_et',quizSnapshot:{title:'Retaken Quiz',questions:q3}}),
   retake_et:launch({classId:'et',deliveryType:'anytime',targetStudents:{s_a:true},createdAt:NOW-19*DAY,startedAt:NOW-19*DAY,attemptGroupId:'base_et',attemptNumber:2,retakeOf:'base_et',quizSnapshot:{title:'Retaken Quiz',questions:q3}}),
   other_student_et:launch({classId:'et',deliveryType:'anytime',targetStudents:{s_b:true},attemptGroupId:'other_student_et',quizSnapshot:{title:'Only For B',questions:q3}}),
   wt_only:launch({classId:'wt',deliveryType:'live',attemptGroupId:'wt_only',quizSnapshot:{title:'West Track Quiz',questions:q3}}),
   closed_all_answered:launch({classId:'et',deliveryType:'live',endedAt:NOW-3*DAY,createdAt:NOW-4*DAY,startedAt:NOW-4*DAY,attemptGroupId:'closed_all_answered',quizSnapshot:{title:'Closed Quiz',questions:q3}})
  },
  responses:{
   done_et:{s_a:{0:right(0),1:right(1),2:wrong(2)},s_b:{0:right(0),1:right(1),2:right(2)}},
   partial_et:{s_a:{0:right(0)}},
   base_et:{s_a:{0:wrong(0),1:wrong(1),2:wrong(2)}},
   retake_et:{s_a:{0:right(0),1:right(1),2:right(2)}},
   other_student_et:{s_b:{0:right(0)}},
   wt_only:{s_c:{0:right(0)}},
   closed_all_answered:{s_a:{0:right(0),1:{...wrong(1),correct:true,adjusted:true},2:wrong(2)}},
   removed_launch:{s_a:{0:right(0)}}
  },
  completions:{
   done_et:{s_a:{completedAt:NOW-9*DAY,correct:2,total:3,pct:67},s_b:{completedAt:NOW-9*DAY,correct:3,total:3,pct:100}},
   base_et:{s_a:{completedAt:NOW-20*DAY,correct:0,total:3,pct:0}},
   retake_et:{s_a:{completedAt:NOW-19*DAY,correct:3,total:3,pct:100}}
  }
 };
}
const byTitle=(h,t)=>h.quizzes.find(q=>q.title===t);

test('completed quiz shows points, percent and question-by-question results',()=>{
 const h=H.buildHistory({root:legacyRoot(),studentId:'s_a',classId:'et'});
 const q=byTitle(h,'Completed Quiz');
 assert.equal(q.status,'completed');assert.equal(q.correct,2);assert.equal(q.total,3);assert.equal(q.pct,67);
 const a=q.attempts[0];assert.deepEqual(a.questions.map(x=>x.result),['correct','correct','incorrect']);
 assert.equal(a.questions[2].answer,'B');assert.equal(a.questions[2].key,'A');
});

test('incomplete quiz is In Progress with a partial (not final) score',()=>{
 const h=H.buildHistory({root:legacyRoot(),studentId:'s_a',classId:'et'});
 const q=byTitle(h,'Half Done Quiz');
 assert.equal(q.status,'in_progress');assert.equal(q.pct,null);
 assert.equal(q.partial.answered,1);assert.equal(q.partial.correct,1);assert.equal(q.partial.total,3);
 assert.deepEqual(q.attempts[0].questions.map(x=>x.result),['correct','unanswered','unanswered']);
});

test('assigned but unattempted quiz is Not Started, including closed whole-class quizzes',()=>{
 const h=H.buildHistory({root:legacyRoot(),studentId:'s_a',classId:'et'});
 const q=byTitle(h,'Missed Quiz');
 assert.equal(q.status,'not_started');assert.equal(q.closed,true);assert.equal(q.pct,null);
});

test('multiple attempts are grouped and the newest completed attempt counts',()=>{
 const h=H.buildHistory({root:legacyRoot(),studentId:'s_a',classId:'et'});
 const q=byTitle(h,'Retaken Quiz');
 assert.equal(q.attempts.length,2);
 assert.deepEqual(q.attempts.map(a=>a.kind),['Live class test','Retake 2']);
 assert.equal(q.pct,100);assert.equal(q.counted.launchId,'retake_et');
});

test('a closed quiz with every question answered counts as completed and keeps teacher adjustments',()=>{
 const h=H.buildHistory({root:legacyRoot(),studentId:'s_a',classId:'et'});
 const q=byTitle(h,'Closed Quiz');
 assert.equal(q.status,'completed');assert.equal(q.attempts[0].completedHow,'all answered, quiz closed');
 assert.equal(q.correct,2);assert.equal(q.attempts[0].questions[1].adjusted,true);
});

test('average counts completed quizzes only, never unfinished ones as zero',()=>{
 const h=H.buildHistory({root:legacyRoot(),studentId:'s_a',classId:'et'});
 const s=h.summary;
 assert.equal(s.assigned,5);assert.equal(s.completed,3);assert.equal(s.inProgress,1);assert.equal(s.notStarted,1);
 assert.equal(s.avg,Math.round((67+100+67)/3));
 assert.equal(s.pointsEarned,2+3+2);assert.equal(s.pointsPossible,9);
});

test('class and student isolation: ET vs WT in the shared space, and quizzes aimed at another student',()=>{
 const a=H.buildHistory({root:legacyRoot(),studentId:'s_a',classId:'et'});
 assert.equal(byTitle(a,'West Track Quiz'),undefined);
 assert.equal(byTitle(a,'Only For B'),undefined);
 const c=H.buildHistory({root:legacyRoot(),studentId:'s_c',classId:'wt'});
 assert.deepEqual(c.quizzes.map(q=>q.title),['West Track Quiz']);
 const b=H.buildHistory({root:legacyRoot(),studentId:'s_b',classId:'et'});
 assert.equal(byTitle(b,'Retaken Quiz').attempts.length,1,'another student\'s retake is not his');
});

test('third class uses its own space and shows nothing from ET/WT',()=>{
 const root={launches:{sc1:launch({classId:'sc',deliveryType:'live',attemptGroupId:'sc1',quizSnapshot:{title:'SC Quiz',questions:q3}}),
  sc2:launch({classId:'sc',deliveryType:'makeup',targetStudents:{s_d:true},makeupOf:'sc1',attemptGroupId:'sc2',createdAt:NOW-2*DAY,startedAt:NOW-2*DAY,quizSnapshot:{title:'SC Quiz',questions:q3}})},
  responses:{sc2:{s_d:{0:right(0),1:right(1),2:right(2)}}},completions:{sc2:{s_d:{completedAt:NOW-2*DAY,correct:3,total:3,pct:100}}}};
 const h=H.buildHistory({root,studentId:'s_d',classId:'sc'});
 assert.equal(h.quizzes.length,1,'make-up is grouped with the quiz it repeats');
 assert.deepEqual(h.quizzes[0].attempts.map(a=>a.kind),['Live class test','Make-up']);
 assert.equal(h.quizzes[0].status,'completed');assert.equal(h.quizzes[0].pct,100);
 assert.equal(H.buildHistory({root,studentId:'s_d',classId:'et'}).quizzes.length,0);
});

test('answers for a removed quiz are reported as unavailable, not scored',()=>{
 const h=H.buildHistory({root:legacyRoot(),studentId:'s_a',classId:'et'});
 assert.equal(h.unavailable.length,1);assert.equal(h.unavailable[0].launchId,'removed_launch');
});

test('time period filters quizzes; all time includes everything',()=>{
 const week=H.buildHistory({root:legacyRoot(),studentId:'s_a',classId:'et',since:NOW-7*DAY});
 assert.deepEqual(week.quizzes.map(q=>q.title).sort(),['Closed Quiz','Missed Quiz']);
 assert.equal(H.buildHistory({root:legacyRoot(),studentId:'s_a',classId:'et',since:0}).quizzes.length,5);
});

test('whole-class quizzes from before the account existed stay listed but are marked',()=>{
 const h=H.buildHistory({root:legacyRoot(),studentId:'s_a',classId:'et',joinedAt:NOW-7*DAY});
 assert.equal(byTitle(h,'Missed Quiz').beforeJoined,false);
 assert.equal(byTitle(h,'Completed Quiz').attempts[0].beforeJoined,true);
 assert.equal(h.quizzes.length,5);
});

test('student CSV holds only that student and labels statuses',()=>{
 const h=H.buildHistory({root:legacyRoot(),studentId:'s_a',classId:'et'});
 const practice=H.practiceRows({p1:{createdAt:NOW-1*DAY,quizType:'translation',perek:18,pesukim:[1,2],questionCount:2,correct:1,percent:50,results:[{question:'P?',correct:true},{question:'P2?',correct:false}]}});
 const rows=H.studentCsvRows({name:'Synthetic Student A',className:'East Track',periodLabel:'All time',history:h,practice});
 const csv=H.toCsv(rows);
 assert.ok(!/s_b|s_c|Only For B|West Track Quiz/.test(csv));
 const body=rows.slice(1).filter(r=>r.length);
 assert.ok(body.every(r=>r[0]==='Synthetic Student A'));
 const attempts=body.filter(r=>r[3]==='Attempt');
 assert.ok(attempts.some(r=>r[4]==='Missed Quiz'&&r[6]==='Not Started'));
 assert.ok(attempts.some(r=>r[4]==='Half Done Quiz'&&r[6]==='In Progress'&&/1 of 3 answered/.test(r[11])));
 assert.equal(attempts.filter(r=>r[4]==='Retaken Quiz').length,2);
 assert.ok(body.some(r=>r[3]==='Question'&&r[18]==='Unanswered'));
 assert.ok(body.some(r=>r[3]==='Practice'&&r[12]==='No (practice)'));
 assert.ok(attempts.some(r=>r[4]==='Quiz record no longer available'&&r[6]==='Data unavailable'));
 const summary=body.find(r=>r[3]==='Summary');assert.equal(summary[11],'78%');
});

test('student report page loads the history module and keeps the class CSV',()=>{
 const html=fs.readFileSync(path.join(__dirname,'..','student-report','index.html'),'utf8');
 assert.match(html,/<script src="quiz-history\.js\?v=[^"]+"><\/script>/);
 assert.match(html,/Download This Student CSV/);
 assert.match(html,/id="csv"[^>]*>⬇ Class CSV \(whole class\)/);
 assert.doesNotMatch(html,/function quizRows/);
});

test('the same quiz given more than once is one row with several attempts, not extra missed quizzes',()=>{
 const other=[{q:'Different?',choices:['A','B'],correctIndex:0}];
 const root={launches:{
  first:launch({classId:'et',deliveryType:'live',quizId:'quiz_7',endedAt:NOW-9*DAY,attemptGroupId:'first',quizSnapshot:{title:'Shorashim Perek 18',questions:q3}}),
  again:launch({classId:'et',deliveryType:'anytime',quizId:'quiz_7',createdAt:NOW-6*DAY,startedAt:NOW-6*DAY,attemptGroupId:'again',quizSnapshot:{title:'Shorashim Perek 18',questions:q3}}),
  copyA:launch({classId:'et',deliveryType:'live',endedAt:NOW-15*DAY,createdAt:NOW-15*DAY,startedAt:NOW-15*DAY,attemptGroupId:'copyA',quizSnapshot:{title:'Cheshvan Quiz',questions:q3}}),
  copyB:launch({classId:'et',deliveryType:'live',createdAt:NOW-15*DAY+60000,startedAt:NOW-15*DAY+60000,attemptGroupId:'copyB',quizSnapshot:{title:' cheshvan quiz',questions:q3}}),
  newQs:launch({classId:'et',deliveryType:'live',createdAt:NOW-2*DAY,startedAt:NOW-2*DAY,attemptGroupId:'newQs',quizSnapshot:{title:'Cheshvan Quiz',questions:other}})
 },responses:{again:{s_a:{0:right(0),1:right(1),2:wrong(2)}}},completions:{again:{s_a:{completedAt:NOW-6*DAY,correct:2,total:3,pct:67}}}};
 const h=H.buildHistory({root,studentId:'s_a',classId:'et'});
 assert.equal(h.quizzes.length,3);
 const shor=byTitle(h,'Shorashim Perek 18');
 assert.equal(shor.attempts.length,2);assert.equal(shor.status,'completed');assert.equal(shor.pct,67);
 const cheshvan=h.quizzes.filter(q=>q.title.trim().toLowerCase()==='cheshvan quiz');
 assert.equal(cheshvan.length,2,'same name with different questions stays separate');
 assert.ok(cheshvan.some(q=>q.attempts.length===2),'same name and same questions are joined');
 assert.ok(cheshvan.every(q=>q.sameNameOther));
 assert.equal(h.summary.notStarted,2);assert.equal(h.summary.completed,1);
});
