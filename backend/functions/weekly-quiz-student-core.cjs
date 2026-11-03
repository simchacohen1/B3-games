'use strict';

const validKey=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const rootFor=classId=>['et','wt'].includes(classId)?'b3Quiz':`b3Quiz/classes/${classId}`;

function safeLaunch(id,launch){
  if(!launch||typeof launch!=='object')return null;
  const snapshot=launch.quizSnapshot||{};
  const questionStates={};
  for(const [index,state] of Object.entries(launch.questionStates||{}))questionStates[index]={open:state?.open===true,reveal:state?.reveal===true};
  const questions=Array.isArray(snapshot.questions)?snapshot.questions.map((question,index)=>{
    const safe={q:String(question?.q||''),choices:Array.isArray(question?.choices)?question.choices.map(String):[],skillType:String(question?.skillType||'')};
    const state=launch.questionStates?.[index]||launch.questionStates?.[String(index)]||{};
    if(launch.showScore===true||state.reveal===true)safe.correctIndex=Number(question?.correctIndex);
    return safe;
  }):[];
  return {
    id,
    quizId:String(launch.quizId||''),
    classId:String(launch.classId||''),
    note:String(launch.note||''),
    deliveryType:String(launch.deliveryType||''),
    showScore:launch.showScore===true,
    createdAt:launch.createdAt||null,
    startedAt:launch.startedAt||null,
    endedAt:launch.endedAt||null,
    started:launch.started===true,
    mode:String(launch.mode||'paced'),
    activeQuestion:Number(launch.activeQuestion)||0,
    questionStates,
    attemptGroupId:String(launch.attemptGroupId||''),
    attemptNumber:Number(launch.attemptNumber)||1,
    retakeOf:String(launch.retakeOf||''),
    quizSnapshot:{title:String(snapshot.title||''),skillType:String(snapshot.skillType||''),questions}
  };
}

async function authorizeStudent({decoded,get}){
  const studentId=String(decoded?.b3StudentId||''),classId=String(decoded?.b3ClassId||'');
  if(decoded?.b3StudentRole!=='student'||!validKey(studentId)||!validKey(classId))fail(401,'Student sign-in required.');
  const [profile,memberships,cls]=await Promise.all([
    get(`b3Games/students/${studentId}/profile`),
    get(`b3Games/students/${studentId}/memberships`),
    get(`b3Games/workspaces/b3-2026/classes/${classId}`)
  ]);
  const member=cls?.members?.[studentId],rows=memberships||{};
  const enrolled=Object.values(rows).some(m=>m&&m.active!==false&&m.workspaceId==='b3-2026'&&m.classId===classId)
    ||(!Object.keys(rows).length&&profile?.classId===classId);
  if(!enrolled||profile?.active===false||!cls||cls.active===false||!member||member.active===false)
    fail(403,'Student access to this class is no longer active.');
  if(!['et','wt'].includes(classId)&&cls.toolGrants?.['weekly-quiz']!==true)
    fail(403,'Weekly Quiz is not available for this class.');
  if(cls.members?.[studentId]?.toolAccess?.['weekly-quiz']===false)
    fail(403,'Weekly Quiz is turned off for this student.');
  return {studentId,classId,name:String(profile.name||member.name||'Student'),root:rootFor(classId)};
}

// A teacher can revoke one student's unfinished assignment
// (launches/<id>/revokedStudents/<studentId>) without touching anyone's history.
function assignedTo(launch,studentId,classId,{allowRevoked=false}={}){
  return !!launch&&launch.classId===classId&&(!launch.targetStudents||launch.targetStudents[studentId]===true)
    &&(allowRevoked||!launch.revokedStudents?.[studentId]);
}

// Each student has his own queue of individual assignments
// (settings/studentAssignments/<studentId>/<launchId>), so several retakes or
// make-ups can be open at once. The single legacy pointers are still honored.
const ASSIGNMENT_LIMIT=40;
async function studentAssignments({student,get}){
  const [queue,personal,classPointer]=await Promise.all([
    get(`${student.root}/settings/studentAssignments/${student.studentId}`),
    get(`${student.root}/settings/studentActiveLaunch/${student.studentId}`),
    get(`${student.root}/settings/activeLaunchByClass/${student.classId}`)
  ]);
  const sources=new Map();
  Object.entries(queue&&typeof queue==='object'?queue:{})
    .filter(([id])=>validKey(id))
    .sort(([a,x],[b,y])=>(Number(y?.assignedAt)||0)-(Number(x?.assignedAt)||0))
    .slice(0,ASSIGNMENT_LIMIT)
    .forEach(([id])=>sources.set(id,'assigned'));
  if(validKey(personal)&&!sources.has(personal))sources.set(personal,'legacy');
  if(validKey(classPointer)&&!sources.has(classPointer))sources.set(classPointer,'class');
  const rows=await Promise.all([...sources].map(async([id,source])=>{
    const launch=await get(`${student.root}/launches/${id}`);
    if(!assignedTo(launch,student.studentId,student.classId))return null;
    const [completion,responses]=await Promise.all([
      get(`${student.root}/completions/${id}/${student.studentId}`),
      get(`${student.root}/responses/${id}/${student.studentId}`)
    ]);
    // A quiz the teacher ended is no longer outstanding unless he finished it.
    if(launch.endedAt&&!completion)return null;
    const answered=Object.values(responses||{}).filter(Boolean).length;
    return {
      id,source,
      launch:safeLaunch(id,launch),
      completion:safeCompletion(launch,completion),
      answered,
      status:completion?'completed':(answered?'in-progress':'not-started')
    };
  }));
  return {assignments:rows.filter(Boolean)};
}

function safeResponses(launch,responses){
  const safe={};
  for(const [index,response] of Object.entries(responses||{})){
    if(!response||typeof response!=='object')continue;
    const questionIndex=Number(index),state=launch.questionStates?.[questionIndex]||launch.questionStates?.[String(questionIndex)]||{};
    const row={choiceIndex:Number(response.choiceIndex),submittedAt:response.submittedAt||null};
    if(launch.showScore===true||state.reveal===true)row.correct=response.correct===true;
    safe[index]=row;
  }
  return safe;
}

function safeCompletion(launch,completion){
  if(!completion)return null;
  return launch.showScore===true
    ?(({completedAt,correct,total,pct})=>({completedAt,correct,total,pct}))(completion)
    :{completedAt:completion.completedAt||null};
}

function completedRecord(launch,answers,now){
  const questions=Array.isArray(launch?.quizSnapshot?.questions)?launch.quizSnapshot.questions:[];
  let correct=0,answered=0;
  for(let i=0;i<questions.length;i++){
    const response=answers?.[i]||answers?.[String(i)];
    if(!response)continue;
    answered++;
    if(response.correct===true)correct++;
  }
  return {completedAt:now,correct,total:questions.length,pct:questions.length?Math.round(correct/questions.length*100):0,answered};
}

async function weeklyQuizStudentAction({decoded,get,set,tx,body={},now=Date.now()}){
  const student=await authorizeStudent({decoded,get});
  const action=String(body.action||''),launchId=String(body.launchId||'');
  if(action==='history'){
    const launches=await get(`${student.root}/launches`);
    const safeLaunches={},ownCompletions={};
    for(const [id,launch] of Object.entries(launches||{})){
      if(!assignedTo(launch,student.studentId,student.classId,{allowRevoked:true}))continue;
      const completion=await get(`${student.root}/completions/${id}/${student.studentId}`);
      if(!completion)continue;
      safeLaunches[id]=safeLaunch(id,launch);
      ownCompletions[id]=safeCompletion(launch,completion);
    }
    return {launches:safeLaunches,completions:ownCompletions};
  }
  if(action==='assignments')return studentAssignments({student,get});
  if(!validKey(launchId))fail(400,'Invalid quiz launch.');
  const launch=await get(`${student.root}/launches/${launchId}`);
  // A finished quiz stays reviewable even if its assignment was later revoked.
  if(!assignedTo(launch,student.studentId,student.classId,{allowRevoked:action==='review'}))fail(403,'This quiz is not assigned to your class.');
  if(action==='launch'){
    const [responses,completion]=await Promise.all([
      get(`${student.root}/responses/${launchId}/${student.studentId}`),
      get(`${student.root}/completions/${launchId}/${student.studentId}`)
    ]);
    return {launch:safeLaunch(launchId,launch),responses:safeResponses(launch,responses),completion:safeCompletion(launch,completion)};
  }
  if(action==='review'){
    const [completion,responses]=await Promise.all([
      get(`${student.root}/completions/${launchId}/${student.studentId}`),
      get(`${student.root}/responses/${launchId}/${student.studentId}`)
    ]);
    if(!completion)fail(403,'This quiz review is not available.');
    return {launch:safeLaunch(launchId,launch),responses:safeResponses(launch,responses),completion:safeCompletion(launch,completion)};
  }
  if(action==='answer'){
    if(launch.started!==true||launch.endedAt)fail(409,'This quiz is not open yet.');
    if(typeof body.questionIndex!=='number'||typeof body.choiceIndex!=='number')fail(400,'Choose a valid answer.');
    const questionIndex=Number(body.questionIndex),choiceIndex=Number(body.choiceIndex);
    const questions=Array.isArray(launch.quizSnapshot?.questions)?launch.quizSnapshot.questions:[];
    const question=questions[questionIndex];
    if(!Number.isInteger(questionIndex)||questionIndex<0||!question||!Number.isInteger(choiceIndex)||choiceIndex<0||choiceIndex>=question.choices?.length)
      fail(400,'Choose a valid answer.');
    const state=launch.questionStates?.[questionIndex]||launch.questionStates?.[String(questionIndex)]||{};
    const mode=String(launch.mode||'paced');
    const canAnswer=mode==='test'||state.open===true||questionIndex<Number(launch.activeQuestion||0);
    if(!canAnswer)fail(409,'This question is not open yet.');
    const finished=await get(`${student.root}/completions/${launchId}/${student.studentId}`);
    if(finished)fail(409,'This quiz has already been completed.');
    const answer={choiceIndex,originalCorrect:choiceIndex===Number(question.correctIndex),correct:choiceIndex===Number(question.correctIndex),adjusted:false,name:student.name,submittedAt:now};
    const result=await tx(`${student.root}/responses/${launchId}/${student.studentId}/${questionIndex}`,current=>current===null?answer:undefined);
    if(!result?.committed)fail(409,'An answer is already saved for this question.');
    return {ok:true};
  }
  if(action==='complete'){
    const answers=await get(`${student.root}/responses/${launchId}/${student.studentId}`)||{};
    const questions=Array.isArray(launch.quizSnapshot?.questions)?launch.quizSnapshot.questions:[];
    if(!questions.length||questions.some((_,index)=>!answers[index]&&!answers[String(index)]))fail(409,'Answer every question before finishing.');
    const result=completedRecord(launch,answers,now);
    const transaction=await tx(`${student.root}/completions/${launchId}/${student.studentId}`,current=>current===null?result:undefined);
    if(!transaction?.committed){
      const existing=await get(`${student.root}/completions/${launchId}/${student.studentId}`)||{};
      const completion=safeCompletion(launch,existing);
      return {ok:true,completion,alreadyCompleted:true};
    }
    return {ok:true,completion:launch.showScore===true?result:{completedAt:result.completedAt}};
  }
  fail(400,'Unknown Weekly Quiz action.');
}

module.exports={weeklyQuizStudentAction,assignedTo,safeLaunch,safeResponses,safeCompletion,authorizeStudent,completedRecord,rootFor};
