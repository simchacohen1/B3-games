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
  const checks=new Map();
  const tray=document.createElement('aside');
  tray.id='activityScreenTray';tray.dataset.stageUi='true';tray.hidden=true;
  tray.style.cssText='position:absolute;right:12px;bottom:52px;z-index:8;display:flex;gap:10px;flex-wrap:wrap;max-width:min(90%,700px);max-height:55%;overflow:auto;pointer-events:auto';
  stage.appendChild(tray);
  function close(call){try{call.close()}catch{}}
  function clear(call){
    clearInterval(checks.get(call));checks.delete(call);
    const node=screens.get(call);
    if(node){node.remove();screens.delete(call)}
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
      if(!response.ok||!verified.ok)throw Error('Sharing permission denied');
      if(document.getElementById('endClass').disabled)throw Error('Lesson ended');
      const card=document.createElement('div');
      card.style.cssText='background:#172033;color:white;padding:8px;border-radius:12px;width:min(320px,75vw);box-shadow:0 8px 28px #0006';
      const heading=document.createElement('strong');heading.textContent=verified.studentName+' · Waiting for video';
      const video=document.createElement('video');video.autoplay=true;video.playsInline=true;video.muted=true;
      video.style.cssText='position:static;width:100%;height:180px;object-fit:contain;background:#050a16;margin-top:5px;pointer-events:auto';
      const dismiss=document.createElement('button');dismiss.textContent='Close view';dismiss.type='button';
      dismiss.onclick=()=>{close(call);clear(call)};
      card.append(heading,video,dismiss);tray.appendChild(card);tray.hidden=false;screens.set(call,card);
      call.on('stream',stream=>{if(screens.has(call)){video.srcObject=stream;
        video.addEventListener('playing',()=>{heading.textContent=verified.studentName+' · Live activity screen'});
        video.play().catch(()=>{heading.textContent=verified.studentName+' · Click video to play';video.controls=true});
      }});
      let checking=false;
      checks.set(call,setInterval(async()=>{
        if(checking||!screens.has(call))return;checking=true;
        try{
          const current=firebase.auth().currentUser;if(!current||document.getElementById('endClass').disabled)throw Error('Lesson ended');
          const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+await current.getIdToken()},body:JSON.stringify({action:'check',room:peerRoom,classId,studentId:verified.studentId})});
          if(!response.ok||!(await response.json()).ok)throw Error('Sharing permission changed');
        }catch{close(call);clear(call)}finally{checking=false}
      },15000));
      call.on('close',()=>clear(call));call.on('error',()=>clear(call));
      const videoTimer=setTimeout(()=>{if(screens.has(call)&&video.readyState<2){heading.textContent=verified.studentName+' · No video received';close(call);clear(call)}},20000);
      call.on('close',()=>clearTimeout(videoTimer));
      video.addEventListener('loadeddata',()=>clearTimeout(videoTimer),{once:true});
      call.answer();
    }catch(e){close(call)}
    return true;
  }
  window.ClassPointerActivityShares={incomingCall,closeAll(){
    for(const call of Array.from(screens.keys())){close(call);clear(call)}
  }};
})();
