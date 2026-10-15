'use strict';
/* Class-scoped activity sharing: keep a student on his learning page for
   screen requests; whiteboard commands still enter the classroom.
   Browser screen capture always requires an explicit student click. */
(async function(){
  if(window.__classPointerActivityShareLoaded)return;
  window.__classPointerActivityShareLoaded=true;
  // The student classroom already has its working central share control in Screens mode.
  // Do not cover it with a second floating share prompt.
  if(/\/class-pointer-prototype\/classroom\.html$/.test(location.pathname))return;
  const loadedAt=Date.now();
  const src=document.currentScript?.src||'';
  const root=new URL('../',src);
  const endpoint='https://us-central1-b3-games.cloudfunctions.net/classPointerShareAuth';
  const studentAuth='https://us-central1-b3-games.cloudfunctions.net/funTorahStudentAuth';
  const ws='b3-2026';
  const load=(url)=>new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=url;script.onload=resolve;script.onerror=reject;
    document.head.appendChild(script);
  });
  try{
    // The homepage may load before a boy signs in. Start listening as soon as
    // the confirmed sign-in completes, without requiring a page refresh.
    let id=sessionStorage.getItem('b3Games_studentId');
    let pin=sessionStorage.getItem('b3Games_classPin');
    if(!id||!pin){
      await new Promise(resolve=>window.addEventListener('fttStudentSignedIn',resolve,{once:true}));
      id=sessionStorage.getItem('b3Games_studentId');
      pin=sessionStorage.getItem('b3Games_classPin');
    }
    if(!id||!pin||!(/^[A-Za-z0-9_-]{1,100}$/).test(id))return;
    if(!window.firebase?.database){
      if(!window.firebase)await load('https://www.gstatic.com/firebasejs/12.15.0/firebase-app-compat.js');
      await load('https://www.gstatic.com/firebasejs/12.15.0/firebase-database-compat.js');
    }
    if(!window.B3_FIREBASE_CONFIG)await load(new URL('firebase-config.js',root).href);
    if(!firebase.apps.length)firebase.initializeApp(window.B3_FIREBASE_CONFIG);
    const auth=await fetch(studentAuth,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'verify',studentId:id,pin})});
    if(!auth.ok||!(await auth.json()).ok)return;
    // Use the same class resolver as the existing student dashboard.
    // It respects a selected class and never revives a removed membership.
    if(!window.FunTorahStudentClass)await load(new URL('student-class.js',root).href);
    const scope=await window.FunTorahStudentClass.resolve(firebase.database(),id);
    const classId=scope.classId;
    if(scope.workspaceId!==ws||!/^[A-Za-z0-9_-]{1,100}$/.test(classId||''))return;
    const sessions=firebase.database().ref('b3Games/workspaces/'+ws+'/classes/'+classId+'/classPointerSessions');
    const holder=document.createElement('div');
    holder.id='fttActivityScreenShare';
    holder.style.cssText='position:fixed;right:14px;bottom:14px;z-index:2147483640;display:none;align-items:center;gap:8px;padding:8px;border-radius:14px;background:#f8fbff;border:2px solid #2563eb;box-shadow:0 5px 24px #15284666;font:700 15px system-ui,sans-serif';
    const btn=document.createElement('button');btn.type='button';btn.textContent='🖥 Share My Screen';
    btn.style.cssText='background:#1d4ed8;color:#fff;border:0;border-radius:10px;padding:11px 16px;cursor:pointer;font:inherit';
    const label=document.createElement('span');label.setAttribute('role','status');label.style.cssText='font-size:12px;color:#1e3a8a;max-width:180px';
    // Fall back to the classroom's established screen-sharing path if the
    // optional Cloud Function for sharing within activities is unavailable.
    const fallback=document.createElement('button');fallback.type='button';
    fallback.textContent='Open Class Pointer';fallback.hidden=true;
    fallback.style.cssText='border:1px solid #1d4ed8;background:white;color:#1d4ed8;border-radius:9px;padding:8px 10px;cursor:pointer;font:700 13px system-ui';
    fallback.addEventListener('click',()=>location.assign(new URL('class-pointer-prototype/dashboard.html',root).href));
    holder.append(btn,label,fallback);document.body.appendChild(holder);
    let active=null,peer=null,call=null,stream=null,busy=false;
    const inviteKey='fttPointerShareInvite:'+ws+':'+classId;
    function routeTeacherRequest(session){
      // Teacher directs only this student's verified class; reject stale requests.
      const request=session?.destinationRequest;
      const supported=request&&['screens','boards'].includes(request.mode);
      const at=supported?request.at:session?.shareRequest?.at;
      if(!Number.isFinite(at)||(!supported&&at<loadedAt-6000)||at>Date.now()+60000||Date.now()-at>45000)return;
      // Per-student exclusions belong to the active authenticated class.
      if(supported&&request.mode==='boards'&&session.whiteboardDenied?.[id]===true)return;
      if((!supported||request.mode==='screens')&&session.screenSharingDenied?.[id]===true)return;
      const marker=session.roomId+':'+at+':'+(supported?request.mode:'screens');
      if(stream)return;
      try{
        if(sessionStorage.getItem(inviteKey)===marker)return;
        sessionStorage.setItem(inviteKey,marker);
      }catch{return}
      // Screen sharing is available here, without leaving Shorashim or Chumash.
      // Only whiteboard mode must navigate into the student's individual board.
      if(supported&&request.mode==='boards'){
        location.assign(new URL('class-pointer-prototype/dashboard.html',root).href);
        return;
      }
      status('Your teacher requested your screen. Click Share My Screen here.');
      fallback.hidden=false;
    }
    function stop(){
      const prior=stream;stream=null;try{call?.close()}catch{}call=null;
      try{peer?.destroy()}catch{}peer=null;
      prior?.getTracks().forEach(t=>t.stop());
      btn.textContent='🖥 Share My Screen';btn.style.background='#1d4ed8';
      label.textContent='';
      fallback.hidden=true;
    }
    function status(text){label.textContent=text}
    function current(rows){
      return Object.entries(rows||{}).filter(([key,v])=>v&&v.roomId===key&&/^class-pointer-[a-f0-9-]{36}$/.test(key)
        &&Number.isFinite(v.createdAt)&&Date.now()-v.createdAt<14400000&&Date.now()-v.createdAt>=-60000)
        .sort((a,b)=>b[1].createdAt-a[1].createdAt)[0]?.[1]||null;
    }
    sessions.on('value',snapshot=>{
      // Student switching must never reuse another boy's classroom invitation.
      if(sessionStorage.getItem('b3Games_studentId')!==id){
        if(stream)stop();
        active=null;holder.style.display='none';
        return;
      }
      const next=current(snapshot.val());
      const shareable=next?.studentScreenSharing===true&&next?.screenSharingDenied?.[id]!==true?next:null;
      if(!shareable||!active||shareable.roomId!==active.roomId){if(stream)stop()}
      active=shareable;holder.style.display=active?'flex':'none';
      if(next)routeTeacherRequest(next);
    },()=>{active=null;holder.style.display='none';stop()});
    btn.addEventListener('click',async()=>{
      if(stream){stop();return}
      if(busy||!active)return;
      const lesson=active;
      busy=true;btn.disabled=true;
      let captured=null;
      try{
        if(!navigator.mediaDevices?.getDisplayMedia)throw Error('Use Microsoft Edge or Chrome on a computer.');
        // Capture must be called synchronously from the user click, before any await.
        const capturePromise=navigator.mediaDevices.getDisplayMedia({
          video:{displaySurface:'browser',frameRate:{ideal:5,max:8}},audio:false,
          preferCurrentTab:true,surfaceSwitching:'include'
        });
        captured=await capturePromise;
        if(active?.roomId!==lesson.roomId||!captured.active)throw Error('The lesson ended or sharing permission changed.');
        status('Connecting to teacher…');
        // A missing, blocked or unavailable Cloud Function can surface as a
        // generic "Failed to fetch" after the student approves screen capture.
        let response;
        try{
          response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({action:'issue',studentId:id,pin,classId,room:lesson.roomId}),
            signal:AbortSignal.timeout(15000)});
        }catch{
          const error=new Error('Activity sharing service unavailable. Open Class Pointer to share your screen instead.');
          error.code='ACTIVITY_SHARE_NETWORK';throw error;
        }
        let ticket;
        try{ticket=await response.json()}catch{
          const error=new Error('Activity sharing service returned an invalid response. Open Class Pointer instead.');
          error.code='ACTIVITY_SHARE_NETWORK';throw error;
        }
        if(!response.ok||!ticket?.ok){
          const error=new Error(ticket?.error||'Screen sharing is not allowed.');
          if(response.status===404||response.status>=500)error.code='ACTIVITY_SHARE_NETWORK';
          throw error;
        }
        if(active?.roomId!==lesson.roomId||!captured.active)throw Error('The lesson ended or sharing permission changed.');
        if(!window.Peer)await load(new URL('class-pointer-prototype/vendor/peerjs-1.5.5.min.js',root).href);
        const connection=new Peer('class-pointer-activity-'+crypto.randomUUID());
        peer=connection;
        await new Promise((resolve,reject)=>{
          const timeout=setTimeout(()=>reject(Error('Connection timed out')),15000);
          connection.once('open',()=>{clearTimeout(timeout);resolve()});
          connection.once('error',e=>{clearTimeout(timeout);reject(e)});
        });
        if(active?.roomId!==lesson.roomId||!captured.active)throw Error('The lesson ended or sharing permission changed.');
        const media=connection.call(lesson.roomId,captured,{metadata:{kind:'activity-screen',token:ticket.token}});
        if(!media)throw Error('The teacher is not connected.');
        call=media;stream=captured;
        captured.getVideoTracks()[0]?.addEventListener('ended',stop,{once:true});
        media.on('close',stop);media.on('error',stop);
        btn.textContent='⏹ Stop Sharing';btn.style.background='#a91f37';
        status('Sharing started — ask your teacher to confirm');
      }catch(error){
        captured?.getTracks().forEach(t=>t.stop());stop();
        const networkFailure=error?.code==='ACTIVITY_SHARE_NETWORK';
        status(error?.name==='NotAllowedError'?'Sharing canceled.':error.message||'Could not share.');
        if(networkFailure)fallback.hidden=false;
      }
      finally{busy=false;btn.disabled=false}
    });
    window.addEventListener('pagehide',stop);
  }catch(error){console.warn('Class Pointer activity sharing unavailable',error)}
})();

