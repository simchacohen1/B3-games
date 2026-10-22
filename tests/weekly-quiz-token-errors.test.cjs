'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('invalid or expired quiz tokens return 401 rather than a retryable server error',async()=>{
 const exports={};let status,body;
 vm.runInNewContext(fs.readFileSync('backend/functions/weekly-quiz-student.js','utf8'),{exports,Buffer,console,require(name){
  if(name==='firebase-functions/v2/https')return {onRequest:(_,handler)=>handler};
  if(name==='firebase-admin')return {apps:[{}],auth:()=>({verifyIdToken:async()=>{throw Error('invalid token');}})};
  if(name==='./weekly-quiz-student-core.cjs')return {weeklyQuizStudentAction(){throw Error('must not read student data');}};
  throw Error('Unexpected module');
 }});
 await exports.weeklyQuizStudent({method:'POST',headers:{authorization:'Bearer invalid'},body:{action:'history'}},{set(){},status(value){status=value;return this;},json(value){body=value;}});
 assert.equal(status,401);assert.match(body.error,/sign.in/i);
});
test('Quiz client retains authentication errors and never falls back to direct database reads',async()=>{
 const html=fs.readFileSync('weekly-quiz/index.html','utf8');const start=html.indexOf('async function callStudentQuizFunction('),end=html.indexOf('function launchAssignedTo(',start);
 let reads=0;const c=vm.createContext({waitForStudentAuth:async()=>({getIdToken:async()=> 'synthetic'}),STUDENT_WEEKLY_QUIZ_URL:'http://127.0.0.1/api/weeklyQuizStudent',fetch:async()=>({status:401,ok:false,json:async()=>({error:'Expired synthetic token'})}),AbortSignal,quizError:(status,message)=>Object.assign(new Error(message),{status}),teacherPreview:false,quizBackendMode:'',directStudentQuiz:async()=>{reads++;}});
 vm.runInContext(html.slice(start,end),c);await assert.rejects(c.callStudentQuiz('history'),{status:401});assert.equal(reads,0);
});
