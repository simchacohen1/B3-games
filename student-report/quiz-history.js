/* Weekly Quiz history for ONE student, built only from data the Student Report
   already loads (launches, responses, completions) plus that student's own
   practice attempts. Read-only: nothing here writes to the database.
   Used by student-report/index.html (window.B3QuizHistory) and by the node tests. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.B3QuizHistory=api;
})(typeof self!=='undefined'?self:this,function(){
'use strict';
const obj=v=>v&&typeof v==='object'?v:{};
const list=v=>Array.isArray(v)?v:Object.keys(obj(v)).sort((a,b)=>Number(a)-Number(b)).map(k=>v[k]);
const num=v=>{const n=Number(v);return isFinite(n)&&n>0?n:0};
const pctOf=(c,t)=>t?Math.round(c/t*100):null;
const answerAt=(r,i)=>{r=obj(r);return r[i]||r[String(i)]||null};

/* Same rule the Weekly Quiz server uses (weekly-quiz-student-core.cjs assignedTo). */
function assignedTo(launch,studentId,classId){
 return !!launch&&launch.classId===classId&&(!launch.targetStudents||launch.targetStudents[studentId]===true);
}
function kindOf(l){
 if(l.retakeOf)return 'Retake '+(Number(l.attemptNumber)||2);
 if(l.makeupOf||l.deliveryType==='makeup')return 'Make-up';
 if(l.deliveryType==='live')return 'Live class test';
 if(l.deliveryType==='anytime')return 'Take anytime';
 return 'Quiz';
}

/* One launch, for one student. Score comes from the saved answers (they carry any
   teacher adjustments, like the Weekly Quiz Results screen); the completion record
   is only used when no answers were kept. */
function attemptFor(id,l,responses,completion,joinedAt){
 const qs=list(l.quizSnapshot&&l.quizSnapshot.questions).filter(q=>q&&typeof q==='object');
 const sr=obj(responses),comp=completion&&typeof completion==='object'?completion:null;
 let answered=0,correct=0,lastAnswerAt=0;
 const questions=qs.map((q,i)=>{
  const r=answerAt(sr,i),choices=list(q.choices).map(String);
  if(r){answered++;if(r.correct===true)correct++;if(num(r.submittedAt)>lastAnswerAt)lastAnswerAt=num(r.submittedAt)}
  return {n:i+1,q:String(q.q||''),answer:r?(r.noAnswer?'(no answer — teacher graded)':(choices[Number(r.choiceIndex)]??'(unknown choice)')):'',
   key:choices[Number(q.correctIndex)]??'',result:r?(r.correct===true?'correct':'incorrect'):'unanswered',adjusted:!!(r&&r.adjusted)};
 });
 let total=qs.length,source='answers';
 if(!answered&&comp&&num(comp.total)){total=num(comp.total);correct=Number(comp.correct)||0;answered=Number(comp.answered)||total;source='completion'}
 const closed=!!l.endedAt,date=num(l.startedAt)||num(l.createdAt);
 let status='not_started',completedHow='';
 if(comp){status='completed';completedHow='submitted'}
 else if(closed&&total&&answered>=total){status='completed';completedHow='all answered, quiz closed'}
 else if(answered)status='in_progress';
 const title=String((l.quizSnapshot&&l.quizSnapshot.title)||'Untitled quiz');
 return {
  launchId:id,title,date,kind:kindOf(l),quizId:String(l.quizId||''),
  sameQuiz:(title.trim().toLowerCase()+'|'+qs.map(q=>String(q.q||'').trim().toLowerCase()).join('|')),
  attemptNumber:Number(l.attemptNumber)||1,status,completedHow,closed,answered,correct,total,
  pct:status==='completed'?pctOf(correct,total):null,
  partialPct:status==='in_progress'?pctOf(correct,answered):null,
  completedAt:comp?num(comp.completedAt):0,lastAnswerAt,questions:source==='answers'?questions:[],
  questionsAvailable:source==='answers'&&questions.length>0,
  wholeClass:!l.targetStudents,beforeJoined:!!(joinedAt&&date&&date<joinedAt&&!l.targetStudents)
 };
}

/* root = {launches,responses,completions} for the class's quiz space.
   joinedAt (optional) = when the student's account was created; a whole-class quiz
   given before that is still listed, but marked, never hidden. */
function buildHistory({root,studentId,classId,joinedAt=0,since=0}){
 root=obj(root);const launches=obj(root.launches),responses=obj(root.responses),completions=obj(root.completions);
 const mine=lid=>obj(responses[lid])[studentId],myComp=lid=>obj(completions[lid])[studentId];
 const attempts=[],unavailable=[];
 Object.entries(launches).forEach(([id,l])=>{
  if(!l||typeof l!=='object')return;
  const has=!!(mine(id)||myComp(id));
  // An old launch with no class saved can't confirm who was assigned: list it only if he answered.
  if(assignedTo(l,studentId,classId)||(!l.classId&&has))attempts.push(attemptFor(id,l,mine(id),myComp(id),joinedAt));
 });
 // Answers kept for a quiz whose record is gone: say so instead of guessing a score.
 new Set([...Object.keys(responses),...Object.keys(completions)]).forEach(id=>{
  if(launches[id]||!(mine(id)||myComp(id)))return;
  const c=myComp(id);
  unavailable.push({launchId:id,date:num(c&&c.completedAt)||Math.max(0,...Object.values(obj(mine(id))).map(r=>num(r&&r.submittedAt))),answered:Object.keys(obj(mine(id))).length});
 });
 // Group retakes and make-ups with the quiz they repeat.
 const groupOf=(id,seen=new Set())=>{const l=launches[id]||{};if(l.makeupOf&&launches[l.makeupOf]&&!seen.has(id)){seen.add(id);return groupOf(l.makeupOf,seen)}return String(l.attemptGroupId||id)};
 // The same quiz given again (same saved quiz, or same name and same questions) is one
 // quiz with several attempts, not a new quiz he "missed".
 const link={},find=k=>link[k]&&link[k]!==k?(link[k]=find(link[k])):k,join=(a,b)=>{a=find(a);b=find(b);if(a!==b)link[b]=a};
 const firstBy={};
 attempts.forEach(a=>{const g=groupOf(a.launchId);link[g]=link[g]||g;a.group=g;
  [a.quizId&&'id:'+a.quizId,'qs:'+a.sameQuiz].filter(Boolean).forEach(k=>{if(firstBy[k])join(firstBy[k],g);else firstBy[k]=g})});
 const groups={};
 attempts.forEach(a=>{const g=find(a.group);(groups[g]||(groups[g]={key:g,attempts:[]})).attempts.push(a)});
 let quizzes=Object.values(groups).map(g=>{
  const at=g.attempts.sort((a,b)=>(a.date-b.date)||(a.attemptNumber-b.attemptNumber));
  const done=at.filter(a=>a.status==='completed'),started=at.filter(a=>a.status==='in_progress');
  const best=done.length?done[done.length-1]:null; // newest finished attempt counts, like the Weekly Quiz Results screen
  const latest=at[at.length-1];
  return {key:g.key,title:at[0].title,date:at[0].date,lastDate:latest.date,attempts:at,
   status:best?'completed':started.length?'in_progress':'not_started',
   counted:best,closed:at.every(a=>a.closed),beforeJoined:at.every(a=>a.beforeJoined),
   correct:best?best.correct:null,total:best?best.total:(latest.total||null),pct:best?best.pct:null,
   partial:!best&&started.length?started[started.length-1]:null};
 });
 if(since)quizzes=quizzes.filter(q=>q.attempts.some(a=>a.date>=since)||(!q.date));
 quizzes.sort((a,b)=>b.date-a.date);
 const names={};quizzes.forEach(q=>{const n=q.title.trim().toLowerCase();names[n]=(names[n]||0)+1});
 quizzes.forEach(q=>{q.sameNameOther=names[q.title.trim().toLowerCase()]>1});
 const unav=since?unavailable.filter(u=>!u.date||u.date>=since):unavailable;
 return {quizzes,unavailable:unav,summary:summarize(quizzes)};
}
function summarize(quizzes){
 const done=quizzes.filter(q=>q.status==='completed'),prog=quizzes.filter(q=>q.status==='in_progress');
 const sum=(xs,f)=>xs.reduce((a,x)=>a+f(x),0);
 return {
  assigned:quizzes.length,completed:done.length,inProgress:prog.length,notStarted:quizzes.length-done.length-prog.length,
  // Average of finished quizzes only: unfinished or never-started quizzes are NOT counted as zero.
  avg:done.length?Math.round(sum(done,q=>q.pct||0)/done.length):null,
  pointsEarned:sum(done,q=>q.correct||0),pointsPossible:sum(done,q=>q.total||0),
  attempts:sum(quizzes,q=>q.attempts.filter(a=>a.status!=='not_started').length),
  last:Math.max(0,...quizzes.flatMap(q=>q.attempts.filter(a=>a.status!=='not_started').map(a=>a.completedAt||a.lastAnswerAt||a.date)))
 };
}
/* b3Quiz/practiceAttempts/<studentId>: self-chosen practice, saved only when finished. */
function practiceRows(raw,since=0){
 return Object.entries(obj(raw)).map(([id,p])=>{p=obj(p);const total=Number(p.questionCount)||list(p.results).length,correct=Number(p.correct)||0;
  return {id,date:num(p.createdAt),title:'Practice quiz'+(p.quizType?' — '+p.quizType:'')+(p.perek?' (Perek '+p.perek+(list(p.pesukim).length?': '+list(p.pesukim).join(', '):'')+')':''),
   correct,total,pct:p.percent!=null&&isFinite(Number(p.percent))?Number(p.percent):pctOf(correct,total),
   questions:list(p.results).filter(r=>r&&typeof r==='object').map((r,i)=>({n:i+1,q:String(r.question||''),result:r.correct===true?'correct':'incorrect'}))};
 }).filter(p=>!since||p.date>=since).sort((a,b)=>b.date-a.date);
}

const STATUS={completed:'Completed',in_progress:'In Progress',not_started:'Not Started'};
const day=t=>t?new Date(t).toLocaleDateString():'';
const when=t=>t?new Date(t).toLocaleString():'';
/* Rows for "Download This Student CSV": one row per time a quiz was given (no per-question rows). */
function studentCsvRows({name,className,periodLabel,history,practice}){
 const head=['Student','Class','Period','Row type','Quiz','Quiz date','Quiz status','Attempt','Attempt status','Points earned','Points possible','Percent','Counts toward average','Completed at'];
 const rows=[head],base=[name,className,periodLabel];
 history.quizzes.slice().sort((a,b)=>a.date-b.date).forEach(q=>{
  q.attempts.forEach(a=>{
   rows.push([...base,'Quiz',q.title,day(q.date),STATUS[q.status],a.kind+' · '+day(a.date),STATUS[a.status]+(a.completedHow&&a.completedHow!=='submitted'?' ('+a.completedHow+')':'')+(a.status!=='completed'&&a.closed?' (quiz closed)':''),
    a.status!=='not_started'?a.correct:'',a.total||'',a.status==='completed'?a.pct+'%':(a.status==='in_progress'?'In progress — '+a.answered+' of '+a.total+' answered':''),
    q.counted===a?'Yes':'No',when(a.completedAt)]);
  });
 });
 history.unavailable.forEach(u=>rows.push([...base,'Quiz','Quiz record no longer available',day(u.date),'Data unavailable','','Data unavailable','','','','No','']));
 (practice||[]).slice().reverse().forEach(p=>rows.push([...base,'Practice',p.title,day(p.date),'Completed','Practice','Completed',p.correct,p.total,p.pct==null?'':p.pct+'%','No (practice)',when(p.date)]));
 const s=history.summary;
 rows.push([...base,'Summary','Assigned quizzes: '+s.assigned,'','Completed '+s.completed+' · In progress '+s.inProgress+' · Not started '+s.notStarted,'','',s.pointsEarned,s.pointsPossible,s.avg==null?'':s.avg+'%','Average of completed quizzes only','']);
 return rows;
}
function toCsv(rows){return rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n')}

return {assignedTo,buildHistory,summarize,practiceRows,studentCsvRows,toCsv,STATUS};
});
