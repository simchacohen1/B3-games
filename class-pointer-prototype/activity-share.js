'use strict';
/* Optional student activity screen sharing and verified class-wide navigation.
   Teacher requests move a signed-in student to Classroom Pointer. Screen capture
   always requires that student's separate browser permission. */
(async function(){
  if(window.__classPointerActivityShareLoaded)return;
  window.__classPointerActivityShareLoaded=true;
  const pageParams=new URL(location.href).searchParams;
  const onStudentClassroom=/\/class-pointer-prototype\/classroom\.html$/.test(location.pathname)&&pageParams.get('dashboard')==='student';
  if(/\/class-pointer-prototype\/classroom\.html$/.test(location.pathname)&&!onStudentClassroom)return;
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
    const id=sessionStorage.getItem('b3Games_studentId');
    const pin=sessionStorage.getItem('b3Games_classPin');
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
    if(onStudentClassroom){
      holder.style.cssText='position:fixed;top:72px;left:50%;transform:translateX(-50%);z-index:2147483640;display:none;align-items:center;gap:12px;max-width:95vw;padding:14px;border-radius:16px;background:#fff;border:3px solid #2563eb;box-shadow:0 8px 30px #15284666;font:700 16px system-ui,sans-serif';
      btn.style.cssText='background:#1d4ed8;color:#fff;border:0;border-radius:12px;padding:17px 22px;cursor:pointer;font:800 17px system-ui,sans-serif';
      label.textContent='Click, choose your screen, then press Share.';
    }
    holder.append(btn,label);document.body.appendChild(holder);
    let active=null,peer=null,call=null,stream=null,busy=false;
    const inviteKey='fttPointerShareInvite:'+ws+':'+classId;
    function routeTeacherRequest(session){
      // Teacher directs only this student's verified class; reject stale requests.
      const request=session?.destinationRequest;
      const supported=request&&['screens','boards'].includes(request.mode);
      const at=supported?request.at:session?.shareRequest?.at;
      if(!Number.isFinite(at)||at<loadedAt-6000||at>Date.now()+60000||Date.now()-at>45000)return;
      const marker=session.roomId+':'+at+':'+(supported?request.mode:'screens');
      if(onStudentClassroom||stream)return;
      try{
        if(sessionStorage.getItem(inviteKey)===marker)return;
        sessionStorage.setItem(inviteKey,marker);
      }catch{return}
      // No capture is started automatically; each boy approves screen capture himself.
      location.assign(new URL('class-pointer-prototype/dashboard.html',root).href);
    }
    function stop(){
      const prior=stream;stream=null;try{call?.close()}catch{}call=null;
      try{peer?.destroy()}catch{}peer=null;
      prior?.getTracks().forEach(t=>t.stop());
      btn.textContent='🖥 Share My Screen';btn.style.background='#1d4ed8';
      label.textContent=onStudentClassroom?'Click, choose your screen, then press Share.':'';
    }
    function status(text){label.textContent=text}
    function current(rows){
      return Object.entries(rows||{}).filter(([key,v])=>v&&v.roomId===key&&/^class-pointer-[a-f0-9-]{36}$/.test(key)
        &&Number.isFinite(v.createdAt)&&Date.now()-v.createdAt<14400000&&Date.now()-v.createdAt>=-60000)
        .sort((a,b)=>b[1].createdAt-a[1].createdAt)[0]?.[1]||null;
    }
    sessions.on('value',snapshot=>{
      const next=current(snapshot.val());
      const shareable=next?.studentScreenSharing===true?next:null;
      if(!shareable||!active||shareable.roomId!==active.roomId){if(stream)stop()}
      active=shareable;holder.style.display=active?'flex':'none';
      if(next)routeTeacherRequest(next);
    },()=>{active=null;holder.style.display='none';stop()});
    btn.addEventListener('click',async()=>{
      if(stream){stop();return}
      if(busy||!active)return;
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
        status('Connecting to teacher…');
        const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({action:'issue',studentId:id,pin,classId,room:active.roomId})});
        const ticket=await response.json();
        if(!response.ok||!ticket.ok)throw Error(ticket.error||'Screen sharing is not allowed.');
        if(!active||!captured.active)throw Error('The lesson ended.');
        if(!window.Peer)await load(new URL('class-pointer-prototype/vendor/peerjs-1.5.5.min.js',root).href);
        const connection=new Peer('class-pointer-activity-'+crypto.randomUUID());
        peer=connection;
        await new Promise((resolve,reject)=>{
          const timeout=setTimeout(()=>reject(Error('Connection timed out')),15000);
          connection.once('open',()=>{clearTimeout(timeout);resolve()});
          connection.once('error',e=>{clearTimeout(timeout);reject(e)});
        });
        if(!active||!captured.active)throw Error('The lesson ended.');
        const media=connection.call(active.roomId,captured,{metadata:{kind:'activity-screen',token:ticket.token}});
        if(!media)throw Error('The teacher is not connected.');
        call=media;stream=captured;
        captured.getVideoTracks()[0]?.addEventListener('ended',stop,{once:true});
        media.on('close',stop);media.on('error',stop);
        btn.textContent='⏹ Stop Sharing';btn.style.background='#a91f37';
        status('Sharing started — ask your teacher to confirm');
      }catch(error){captured?.getTracks().forEach(t=>t.stop());stop();status(error?.name==='NotAllowedError'?'Sharing canceled.':error.message||'Could not share.')}
      finally{busy=false;btn.disabled=false}
    });
    window.addEventListener('pagehide',stop);
  }catch(error){console.warn('Class Pointer activity sharing unavailable',error)}
})();
