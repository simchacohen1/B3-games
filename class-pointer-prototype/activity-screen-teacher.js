'use strict';
/* Accept separate activity-screen PeerJS calls only after server verifies a
   short-lived, class-scoped ticket for the authenticated session owner. */
(function(){
  const query=new URLSearchParams(location.search);
  if(query.get('dashboard')!=='teacher')return;
  const classId=query.get('class');
  const endpoint='https://us-central1-b3-games.cloudfunctions.net/classPointerShareAuth';
  const stage=document.getElementById('stage');
  // Track pending authorization as well as answered calls. End/Restart must
  // invalidate both, even when an old network response arrives in a new lesson.
  const screens=new Map();
  let generation=0;
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
    const entry=screens.get(call);
    if(entry){
      if(entry.video)entry.video.srcObject=null;
      entry.card?.remove();screens.delete(call);
    }
    tray.hidden=!Array.from(screens.values()).some(entry=>entry.card);
  }
  function room(){
    try{return new URL(document.getElementById('joinLink')?.value).searchParams.get('room')}catch{return null}
  }
  function current(entry){
    return screens.get(entry.call)===entry&&entry.generation===generation&&entry.room===room()
      &&document.getElementById('endClass')?.disabled===false
      &&firebase.auth().currentUser?.uid===entry.user.uid;
  }
  function permitted(entry){
    return current(entry)&&window.ClassPointerBoards?.canReceiveActivityScreen(entry.studentId)===true;
  }
  document.addEventListener('classpointer:sharing-state',()=>{
    for(const [call,entry] of Array.from(screens)){
      // A pending call has no verified identity yet; cancel it on policy changes.
      if(!entry.studentId||!permitted(entry)){clear(call);close(call)}
    }
  });
  async function incomingCall(call){
    if(call.metadata?.kind!=='activity-screen')return false;
    const token=call.metadata?.token;
    if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)){close(call);return true}
    let entry;
    try{
      const user=firebase.auth().currentUser;
      if(!user)throw Error('Teacher sign-in missing');
      const peerRoom=room();
      if(!peerRoom||document.getElementById('endClass').disabled)throw Error('Lesson is closed');
      entry={call,user,room:peerRoom,generation,studentId:null};screens.set(call,entry);
      call.on('close',()=>clear(call));call.on('error',()=>{clear(call);close(call)});
      const idToken=await user.getIdToken();
      if(!current(entry)){clear(call);close(call);return true}
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+idToken},body:JSON.stringify({action:'verify',room:peerRoom,classId,token}),signal:AbortSignal.timeout(15000)});
      const verified=await response.json();
      if(!current(entry)){clear(call);close(call);return true}
      if(!response.ok||!verified.ok)throw Error(response.status===403?'Authorization rejected the student sharing ticket (403). Check class and session; the ticket may be expired or already used.':'Sharing authorization failed (HTTP '+response.status+').');
      entry.studentId=verified.studentId;
      if(typeof entry.studentId!=='string'||!permitted(entry))throw Error('Student screen sharing is no longer allowed.');
      const card=document.createElement('div');
      card.style.cssText='background:#172033;color:white;padding:8px;border-radius:12px;width:min(320px,75vw);box-shadow:0 8px 28px #0006';
      const heading=document.createElement('strong');heading.textContent=verified.studentName+' · Live activity screen';
      const video=document.createElement('video');video.autoplay=true;video.playsInline=true;video.muted=true;
      video.style.cssText='position:static;width:100%;height:180px;object-fit:contain;background:#050a16;margin-top:5px';
      const dismiss=document.createElement('button');dismiss.textContent='Close view';dismiss.type='button';
      dismiss.onclick=()=>{close(call);clear(call)};
      const priorFailure=document.getElementById('activityScreenFailure');if(priorFailure)priorFailure.hidden=true;
      entry.card=card;entry.video=video;
      card.append(heading,video,dismiss);tray.appendChild(card);tray.hidden=false;
      call.on('stream',stream=>{if(permitted(entry)){video.srcObject=stream;video.play().catch(()=>{})}else{clear(call);close(call)}});
      call.answer();
    }catch(e){
      // Canceled calls must not display stale errors in the next lesson.
      if(!entry||current(entry)){console.warn('Class Pointer activity screen rejected:',e?.message||e);reportFailure(e?.message||'Unknown connection error')}
      clear(call);close(call);
    }
    return true;
  }
  window.ClassPointerActivityShares={incomingCall,closeAll(){
    generation++;
    for(const call of Array.from(screens.keys())){clear(call);close(call)}
    const notice=document.getElementById('activityScreenFailure');if(notice)notice.hidden=true;
  }};
})();
