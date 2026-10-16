'use strict';
/* Join tickets for Classroom Pointer.
   The class room id is published so classmates can find it, so it is NOT a secret. A connection is
   accepted only if it carries a short-lived ticket that the server issued to a verified class member
   (own passcode) for this class, this session and this exact connection, and that the signed-in
   teacher's page verifies with the server before admitting anyone. Identity (student id and name)
   comes from the server's answer, never from the connection's own message.
   Student side:  ClassPointerJoinAuth.issue({room,classId,studentId,peerId})  -> {ticket,studentName}
   Teacher side:  ClassPointerJoinGate.required / verify(ticket,peerId) / watch(getMembers,onRevoked) */
(function(root){
  const endpoint='https://us-central1-b3-games.cloudfunctions.net/classPointerShareAuth';
  const query=new URLSearchParams(root.location?root.location.search:'');
  const TICKET=/^[a-f0-9]{64}$/;
  const readSession=k=>{try{return root.sessionStorage.getItem(k)||''}catch{return ''}};
  async function post(body,idToken){
    const headers={'Content-Type':'application/json'};if(idToken)headers.Authorization='Bearer '+idToken;
    let response;
    try{response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(body)})}
    catch{throw Object.assign(new Error('Could not reach the school server. Check your internet and try again.'),{status:0})}
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok)throw Object.assign(new Error(data.error||('Request failed ('+response.status+').')),{status:response.status});
    return data;
  }

  // ---- student ----
  async function issue({room,classId,studentId,peerId}){
    const pin=readSession('b3Games_classPin');
    if(!studentId||!classId||!pin)throw Object.assign(new Error('Please sign in to Fun Torah Tools first, then open Class Pointer from your home page.'),{status:401});
    const data=await post({action:'joinIssue',room,classId,studentId,pin,peerId});
    return {ticket:data.token,studentName:data.studentName};
  }

  // ---- teacher ----
  const dashboardTeacher=query.get('dashboard')==='teacher'&&/^[A-Za-z0-9_-]{1,100}$/.test(query.get('class')||'');
  const classId=query.get('class');
  let recent=[];                                   // timestamps of verify calls in the last minute
  const tooMany=()=>{const now=Date.now();recent=recent.filter(t=>now-t<60000);if(recent.length>=30)return true;recent.push(now);return false};
  const currentRoom=()=>{try{return new URL(document.getElementById('joinLink').value).searchParams.get('room')}catch{return null}};
  async function teacherToken(){const user=root.firebase&&firebase.auth().currentUser;if(!user)throw Error('Teacher sign-in missing');return user.getIdToken()}
  async function verify(ticket,peerId){
    if(typeof ticket!=='string'||!TICKET.test(ticket)||typeof peerId!=='string'||tooMany())return null;
    const room=currentRoom();if(!room)return null;
    try{
      const data=await post({action:'joinVerify',room,classId,token:ticket,peerId},await teacherToken());
      return {studentId:data.studentId,studentName:data.studentName};
    }catch{return null}
  }
  // Every minute, check that connected students are still allowed (removed from the class, blocked,
  // class switched off). Anyone no longer allowed is disconnected.
  let timer=null;
  function watch(getMembers,onRevoked){
    clearInterval(timer);
    timer=setInterval(async()=>{
      try{
        const ended=document.getElementById('endClass');if(ended&&ended.disabled){clearInterval(timer);return}
        const members=getMembers().filter(m=>m.studentId);if(!members.length)return;
        const room=currentRoom();if(!room)return;
        const data=await post({action:'joinRecheck',room,classId,studentIds:members.map(m=>m.studentId)},await teacherToken());
        const ok=new Set(data.allowed);members.forEach(m=>{if(!ok.has(m.studentId))onRevoked(m)});
      }catch{/* a network blip must not disconnect the class */}
    },60000);
  }
  root.ClassPointerJoinAuth={issue};
  root.ClassPointerJoinGate={required:dashboardTeacher,verify,watch,_ticketPattern:TICKET};
  if(typeof module==='object'&&module.exports)module.exports=root.ClassPointerJoinGate;
})(typeof window!=='undefined'?window:globalThis);
