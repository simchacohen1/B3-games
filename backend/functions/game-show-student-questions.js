'use strict';
const {onRequest}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
if(!admin.apps.length)admin.initializeApp();

function safeQuestion(q){
  if(typeof q==='string')return q;
  if(!q||typeof q!=='object')return null;
  const out={};
  for(const key of ['q','question','choices','options','image','audio'])if(q[key]!==undefined)out[key]=q[key];
  // Students may see the prompt and choices, but never the answer or answer key.
  return out;
}

function isActiveStudentAccess(identity,classSnap,memberSnap){
  return identity?.b3StudentRole==='student'
    && Boolean(identity.b3StudentId)
    && Boolean(identity.b3ClassId)
    && classSnap?.exists?.()
    && classSnap.child('active').val()===true
    && classSnap.child('toolGrants/game-show').val()===true
    && memberSnap?.exists?.()
    && memberSnap.child('active').val()===true;
}
function canAcceptStudentBuzz(current,now){
  return Boolean(current)
    && current.roundActive===true
    && !current.buzzedBy
    && current.narrationLocked!==true
    && Number(now)>=(Number(current.buzzUnlockAt)||0);
}
exports.safeQuestion=safeQuestion;
exports.isActiveStudentAccess=isActiveStudentAccess;
exports.canAcceptStudentBuzz=canAcceptStudentBuzz;

exports.gameShowStudentQuestions=onRequest({region:'us-central1',cors:['https://simchacohen1.github.io'],maxInstances:20,memory:'256MiB'},async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:'Use GET.'});
  try{
    const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
    if(!token)return res.status(401).json({error:'Student sign-in required.'});
    const identity=await admin.auth().verifyIdToken(token,true),sid=String(identity.b3StudentId||''),classId=String(identity.b3ClassId||'');
    if(identity.b3StudentRole!=='student'||!sid||!classId)return res.status(403).json({error:'Student sign-in required.'});
    const rtdb=admin.database(),membership=await rtdb.ref(`b3Games/workspaces/b3-2026/classes/${classId}/members/${sid}`).get(),cls=await rtdb.ref(`b3Games/workspaces/b3-2026/classes/${classId}`).get();
    if(!isActiveStudentAccess(identity,cls,membership))return res.status(403).json({error:'Active Game Show class membership required.'});
    const snap=await rtdb.ref(`questionSets/classes/${classId}/set`).get(),set=snap.val();
    if(!set)return res.status(200).json({title:'Game Show',questions:[]});
    let questions=Array.isArray(set.questions)?set.questions:[];
    if(!questions.length&&Array.isArray(set.posukData))questions=set.posukData.flatMap(p=>(p.questions||[]).map(q=>({q:(q.heb?q.heb+'\n':'')+(q.en||''),ans:q.ans||''})));
    return res.status(200).json({title:String(set.title||'Game Show'),questions:questions.map(safeQuestion).filter(Boolean)});
  }catch(error){
    const code=Number.isInteger(error.code)&&error.code>=400&&error.code<600?error.code:500;
    if(code===500)console.error('gameShowStudentQuestions',error);
    return res.status(code).json({error:code===500?'Questions could not be loaded.':error.message});
  }
});

exports.gameShowStudentAction=onRequest({region:'us-central1',cors:['https://simchacohen1.github.io'],maxInstances:30,memory:'256MiB'},async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
  try{
    const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
    if(!token)return res.status(401).json({error:'Student sign-in required.'});
    const identity=await admin.auth().verifyIdToken(token,true),sid=String(identity.b3StudentId||''),classId=String(identity.b3ClassId||''),name=String(identity.b3StudentName||'').replace(/[.#$\[\]]/g,'_').slice(0,80);
    if(identity.b3StudentRole!=='student'||!sid||!classId||!name)return res.status(403).json({error:'Student sign-in required.'});
    const rtdb=admin.database(),base=`b3Games/workspaces/b3-2026/classes/${classId}`,cls=await rtdb.ref(base).get(),membership=await rtdb.ref(`${base}/members/${sid}`).get();
    if(!cls.exists()||cls.child('active').val()!==true||!membership.exists()||membership.child('active').val()!==true||cls.child('toolGrants/game-show').val()!==true)return res.status(403).json({error:'Active Game Show class membership required.'});
    if(req.body?.action!=='buzz')return res.status(400).json({error:'Unknown Game Show action.'});
    const game=rtdb.ref(`questionSets/classes/${classId}/live`),now=Date.now();let accepted=false;
    const result=await game.transaction(current=>{
      // Enforce the display/timing locks on the trusted writer as well as on
      // the read-only student client.
      if(!canAcceptStudentBuzz(current,now))return;
      if(current.revealDelayOn){current.buzzPool=current.buzzPool||{};if(current.buzzPool[name])return;current.buzzPool[name]=now;}
      else{
        const round=String(current.buzzOpenAt||0)+':'+(current.qIndex||0);
        if(current.lastWinnerRound!==round){current.lastWinnerStreak=current.lastWinner===name?(Number(current.lastWinnerStreak)||0)+1:1;current.lastWinner=name;current.lastWinnerRound=round;}
        current.buzzedBy=name;current.selectedPlayer=name;current.answeredPlayers=current.answeredPlayers||{};current.answeredPlayers[name]=true;
      }
      accepted=true;return current;
    },undefined,false);
    if(result.committed&&accepted)return res.status(200).json({ok:true});
    return res.status(409).json({error:'That round is no longer open for your buzz.'});
  }catch(error){
    const code=Number.isInteger(error.code)&&error.code>=400&&error.code<600?error.code:500;
    if(code===500)console.error('gameShowStudentAction',error);
    return res.status(code).json({error:code===500?'Game Show could not record your buzz.':error.message});
  }
});
