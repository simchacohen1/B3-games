'use strict';
/* Accept separate activity-screen PeerJS calls only after server verifies a
   short-lived, class-scoped ticket for the authenticated session owner. */
(function(){
  const query=new URLSearchParams(location.search);
  if(query.get('dashboard')!=='teacher')return;
  const classId=query.get('class');
  const endpoint='https://us-central1-b3-games.cloudfunctions.net/classPointerShareAuth';
  const stage=document.getElementById('stage');
  const screens=new Map();
  const tray=document.createElement('aside');
  tray.id='activityScreenTray';tray.dataset.stageUi='true';tray.hidden=true;
  tray.style.cssText='position:absolute;right:12px;bottom:52px;z-index:8;display:flex;gap:10px;flex-wrap:wrap;max-width:min(90%,700px);max-height:55%;overflow:auto;pointer-events:auto';
  stage.appendChild(tray);
  const help=document.createElement('div');
  help.id='activityScreenHelp';help.dataset.stageUi='true';
  help.style.cssText='position:absolute;right:12px;bottom:52px;z-index:7;max-width:320px;padding:10px 14px;background:#eaf3ff;color:#15345b;border-radius:10px;font:600 13px system-ui;pointer-events:none';
  help.textContent='Students sharing from Shorashim or another activity appear here after they accept the request. They do not need to join Pointer.';
  help.hidden=true;stage.appendChild(help);
  const observer=new MutationObserver(()=>{help.hidden=!tray.hidden||document.getElementById('endClass')?.disabled!==false});
  observer.observe(tray,{attributes:true,attributeFilter:['hidden']});
  const lessonButton=document.getElementById('endClass');if(lessonButton)observer.observe(lessonButton,{attributes:true,attributeFilter:['disabled']});

  function reportFailure(message){
    let notice=document.getElementById('activityScreenFailure');
    if(!notice){notice=document.createElement('div');notice.id='activityScreenFailure';notice.dataset.stageUi='true';notice.style.cssText='position:absolute;right:12px;bottom:52px;z-index:9;max-width:370px;padding:12px;background:#fff2ef;color:#8a2119;border:1px solid #e4a69e;border-radius:10px;font:600 13px system-ui';stage.appendChild(notice)}
    notice.textContent='Student screen connection failed: '+message;
    notice.hidden=false;
  }
  function close(call){try{call.close()}catch{}}
  function clear(call){
    const screen=screens.get(call);
    if(screen){screen.card.remove();screens.delete(call)}
    tray.hidden=!screens.size;
  }
  async function incomingCall(call){
    if(call.metadata?.kind!=='activity-screen')return false;
    const token=call.metadata?.token;
    if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)){close(call);return true}
    try{
      const user=firebase.auth().currentUser;
      if(!user)throw Error('Teacher sign-in missing');
      const idToken=await user.getIdToken();
      const room=document.getElementById('joinLink')?.value;
      const peerRoom=room?new URL(room).searchParams.get('room'):null;
      if(!peerRoom||document.getElementById('endClass').disabled)throw Error('Lesson is closed');
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+idToken},body:JSON.stringify({action:'verify',room:peerRoom,classId,token})});
      const verified=await response.json();
      if(!response.ok||!verified.ok)throw Error(response.status===403?'Authorization rejected the student sharing ticket (403). Check class and session; the ticket may be expired or already used.':'Sharing authorization failed (HTTP '+response.status+').');
      if(document.getElementById('endClass').disabled)throw Error('Lesson ended');
      const card=document.createElement('div');
      card.style.cssText='background:#172033;color:white;padding:8px;border-radius:12px;width:min(320px,75vw);box-shadow:0 8px 28px #0006';
      const heading=document.createElement('strong');heading.textContent=verified.studentName+' · Live activity screen';
      const video=document.createElement('video');video.autoplay=true;video.playsInline=true;video.muted=true;
      video.style.cssText='position:static;width:100%;height:180px;object-fit:contain;background:#050a16;margin-top:5px';
      const dismiss=document.createElement('button');dismiss.textContent='Close view';dismiss.type='button';
      dismiss.onclick=()=>{close(call);clear(call)};
      const priorFailure=document.getElementById('activityScreenFailure');if(priorFailure)priorFailure.hidden=true;
      card.append(heading,video,dismiss);tray.appendChild(card);tray.hidden=false;screens.set(call,{card,video,studentId:verified.studentId});
      call.on('stream',stream=>{const screen=screens.get(call);if(screen){screen.video.srcObject=stream;screen.video.play().catch(()=>{})}});
      call.on('close',()=>clear(call));call.on('error',()=>clear(call));
      call.answer();
    }catch(e){console.warn('Class Pointer activity screen rejected:',e?.message||e);reportFailure(e?.message||'Unknown connection error');close(call)}
    return true;
  }
  window.ClassPointerActivityShares={incomingCall,revokeStudents(studentIds){
    const denied=new Set(Array.isArray(studentIds)?studentIds:[]);
    for(const [call,screen] of screens){
      if(denied.has(screen.studentId)){close(call);clear(call)}
    }
  },closeAll(){
    for(const call of Array.from(screens.keys())){close(call);clear(call)}
  }};
})();
