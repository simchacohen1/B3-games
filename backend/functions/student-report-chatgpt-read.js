"use strict";
const {onRequest}=require("firebase-functions/v2/https");
const {defineSecret}=require("firebase-functions/params");
const admin=require("firebase-admin");
const crypto=require("crypto");
if(!admin.apps.length)admin.initializeApp();
const credential=defineSecret("STUDENT_REPORT_CHATGPT_READ_TOKEN");
const WS="b3-2026";
const classes=["et","wt"];
const asObject=v=>v&&typeof v==="object"?v:{};
function constantTimeEqual(a,b){
 const aa=Buffer.from(String(a||"")), bb=Buffer.from(String(b||""));
 return aa.length>0&&aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);
}
const number=v=>Number(v)||0;
function score(v){const n=Number(String(v??"").replace("%",""));return Number.isFinite(n)?n:null;}
function verdictPercent(collection,index,totalHint){
 const entries=Object.entries(asObject(collection));
 if(!entries.length)return null;
 const correct=entries.filter(([,v])=>String(v?.finalVerdict||v?.verdict||"").toLowerCase()==="correct").length;
 const max=Math.max(...entries.map(([key,v])=>Number.isInteger(v?.[index])?v[index]:Number(key)||0))+1;
 return Math.round(correct/Math.max(Number(totalHint)||0,max,entries.length)*100);
}
function translation(a){return verdictPercent(a.translationChunkResults,"chunkIndex",a.translationTotal)??score(a.translationScore);}
function comprehension(a){return verdictPercent(a.questionResults,"questionIndex",a.questionTotal)??score(a.comprehensionScore??a.questionScore);}
function summarizeStudent(id,name,raw,since){
 const attempts=asObject(raw.attempts), info=asObject(raw.info);
 let posukTries=0, mastered=0, translated=0, understood=0, last=number(info.lastActive);
 for(const attemptsByPosuk of Object.values(attempts)){
   let read=false,trans=false,comp=false;
   for(const a of Object.values(asObject(attemptsByPosuk))){
     if(!a||typeof a!=="object")continue;
     const timestamp=number(a.timestamp);
     last=Math.max(last,timestamp);
     if(timestamp>=since)posukTries++;
     read=read||score(a.hebrewFinalScore??a.hebrewScore)===100;
     trans=trans||translation(a)===100;
     comp=comp||comprehension(a)===100;
   }
   if(read)mastered++;if(trans)translated++;if(comp)understood++;
 }
 const chz=asObject(raw.chazara), reviews=asObject(chz.reviews);
 const ev=Object.values(asObject(raw.events)).filter(e=>e&&e.reviewApplied===true&&e.removed!==true&&e.teacherRejected!==true&&e.pointRequestStatus!=="rejected");
 const chazaraInPeriod=ev.filter(e=>number(e.createdAt)>=since).length;
 const chazaraTotal=Object.values(reviews).reduce((s,r)=>s+number(r&&r.count),0);
 for(const e of ev)last=Math.max(last,number(e.createdAt));
 const sh=asObject(raw.shorashim),cards=Object.values(asObject(sh.cards)).filter(x=>x&&x.learnedAt);
 last=Math.max(last,number(sh.lastActive));
 for(const c of cards)last=Math.max(last,number(c.learnedAt));
 const rashi=asObject(raw.rashi);
 last=Math.max(last,number(rashi.lastActive));
 const hal=asObject(raw.halacha);
 last=Math.max(last,number(hal.updatedAt));
 const quiz=asObject(raw.quiz),launches=asObject(quiz.launches),responses=asObject(quiz.responses);
 const quizzes=[];
 for(const [launchId,launch] of Object.entries(launches)){
   const answers=Object.values(asObject(asObject(responses[launchId])[id])).filter(a=>a&&typeof a==="object");
   if(!answers.length)continue;
   const t=number(launch.startedAt||launch.createdAt||launch.updatedAt);
   const qs=launch.quizSnapshot&&launch.quizSnapshot.questions;
   const total=Array.isArray(qs)?qs.length:Object.keys(asObject(qs)).length||answers.length;
   quizzes.push({title:String(launch.quizSnapshot&&launch.quizSnapshot.title||"Quiz").slice(0,150),correct:answers.filter(a=>a.correct===true).length,total,t});
   last=Math.max(last,t);
 }
 return {studentId:id,name,lastActive:last,
   posuk:{pesukimAttempted:Object.keys(attempts).length,readAt100:mastered,translatedAt100:translated,comprehensionAt100:understood,triesInPeriod:posukTries},
   chazara:{inPeriod:chazaraInPeriod,total:chazaraTotal,pesukimReviewed:Object.values(reviews).filter(r=>number(r&&r.count)>0).length},
   shorashim:{cardsLearned:cards.length,newCardsInPeriod:cards.filter(c=>number(c.learnedAt)>=since).length,studyMinutes:Math.round(number(sh.totalActiveSeconds)/60)},
   rashi:{currentUnitIndex:number(rashi.currentUnitIndex),lastActive:number(rashi.lastActive)},
   halacha:{sectionsDone:Object.entries(asObject(hal.state)).filter(([k,v])=>k.endsWith("_done")&&v===true).length},
   quizzes:quizzes.filter(q=>q.t>=since).sort((a,b)=>b.t-a.t).slice(0,20)};
}
exports.studentReportChatGPTRead=onRequest({
 region:"us-central1",memory:"256MiB",timeoutSeconds:120,
 secrets:[credential],invoker:"public"
},async(req,res)=>{
 res.set("Cache-Control","no-store");res.set("X-Content-Type-Options","nosniff");
 if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
 const header=String(req.get("Authorization")||"");
 const token=header.startsWith("Bearer ")?header.slice(7).trim():"";
 if(!constantTimeEqual(token,credential.value()))return res.status(401).json({error:"Unauthorized"});
 const cl=String(req.query.class||"et").toLowerCase();
 if(!classes.includes(cl))return res.status(400).json({error:"Class must be et or wt"});
 const days=Number(req.query.days??7);
 if(![7,14,30].includes(days))return res.status(400).json({error:"days must be 7, 14, or 30"});
 const since=Date.now()-days*86400000;
 try{
   const db=admin.database();
   const memberSnap=await db.ref("b3Games/workspaces/"+WS+"/classes/"+cl+"/members").get();
   const members=asObject(memberSnap.val());
   if(!memberSnap.exists())return res.status(404).json({error:"Class data not found"});
   const ids=Object.keys(members).filter(id=>/^[A-Za-z0-9_-]{1,100}$/.test(id)&&members[id]&&members[id].active!==false);
   const quizPath="b3Quiz";
   const q=await db.ref(quizPath).get(),quiz=asObject(q.val());
   const students=await Promise.all(ids.map(async id=>{
     const prefix="posukPractice/";
     const ps=await Promise.all([
       db.ref(prefix+"attempts/"+id).get(),db.ref(prefix+"students/"+id).get(),
       db.ref(prefix+"chazara/students/"+id).get(),db.ref(prefix+"chazara/events/"+id).get(),
       db.ref(prefix+"shorashimLearning/students/"+id).get(),
       db.ref("rashiLetters/progress/"+id).get(),
       db.ref("b3Games/students/"+id+"/halacha/siman1").get()
     ]);
     const [attempts,info,chazara,events,shorashim,rashi,halacha]=ps.map(s=>s.val());
     const name=String(members[id].name||asObject(info).name||id);
     return summarizeStudent(id,name,{attempts,info,chazara,events,shorashim,rashi,halacha,quiz},since);
   }));
   return res.json({ok:true,readOnly:true,generatedAt:new Date().toISOString(),classId:cl,periodDays:days,studentCount:students.length,students});
 }catch(err){console.error("studentReportChatGPTRead error",err);return res.status(500).json({error:"Report unavailable"});}
});