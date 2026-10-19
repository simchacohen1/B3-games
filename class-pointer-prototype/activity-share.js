'use strict';
/* Class-scoped activity sharing: keep a student on his learning page for
   screen requests and teacher-controlled individual whiteboards.
   Browser screen capture always requires an explicit student click. */
(async function(){
  if(window.__classPointerActivityShareLoaded)return;
  window.__classPointerActivityShareLoaded=true;
  // The student classroom already has its working central share control in Screens mode.
  // Do not cover it with a second floating share prompt.
  if(/\/class-pointer-prototype\/classroom\.html$/.test(location.pathname))return;
  const src=document.currentScript?.src||'';
  const root=new URL('../',src);
  const persistentShareWindow=new URL(location.href).searchParams.get('pointerShare')==='1';
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
      // Some tools initialize the student session after this deferred script runs.
      // Listen for the homepage event and for same-tab session initialization;
      // never copy student credentials into persistent cross-tab storage.
      await new Promise(resolve=>{
        let checks=0;
        const timer=setInterval(()=>{
          if(sessionStorage.getItem('b3Games_studentId')&&sessionStorage.getItem('b3Games_classPin'))finish();
          else if(++checks>=120)finish();
        },500);
        function finish(){clearInterval(timer);window.removeEventListener('fttStudentSignedIn',finish);resolve()}
        window.addEventListener('fttStudentSignedIn',finish,{once:true});
      });
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
    // Mount the existing student whiteboard on real browser pages. Synthetic
    // auth-only tests use deliberately minimal DOM mocks without append().
    if(typeof document.body?.append==='function'){
    const boardStage=document.createElement('div');
    boardStage.id='fttEmbeddedPointerStage';
    boardStage.style.cssText='position:fixed;inset:0;z-index:2147483636;display:none;background:#e8eef7';
    document.body.append(boardStage);
    const boardCss=document.createElement('link');boardCss.rel='stylesheet';
    boardCss.href=new URL('class-pointer-prototype/student-boards.css?v=20261018-embedded1',root).href;
    document.head.append(boardCss);
    window.ClassPointerBridge={isTeacher:false,embedded:true,embeddedStage:boardStage,
      sendTeacher:message=>{
        if(admitted&&presenceConn?.open&&latestSession?.roomId===presenceTarget){
          try{presenceConn.send(message)}catch{}
        }
      },status:()=>{},callTeacher:null};
    await load(new URL('class-pointer-prototype/student-boards.js?v=20261018-embedded1',root).href);
    }
    const sessions=firebase.database().ref('b3Games/workspaces/'+ws+'/classes/'+classId+'/classPointerSessions');
    const holder=document.createElement('div');
    holder.id='fttActivityScreenShare';
    holder.style.cssText='position:fixed;right:14px;bottom:14px;z-index:2147483640;display:none;align-items:center;gap:8px;padding:8px;border-radius:14px;background:#f8fbff;border:2px solid #2563eb;box-shadow:0 5px 24px #15284666;font:700 15px system-ui,sans-serif';
    const btn=document.createElement('button');btn.type='button';btn.textContent='🖥 Share My Screen';
    btn.style.cssText='background:#1d4ed8;color:#fff;border:0;border-radius:10px;padding:11px 16px;cursor:pointer;font:inherit';
    const label=document.createElement('span');label.setAttribute('role','status');label.style.cssText='font-size:12px;color:#1e3a8a;max-width:180px';
    // Screen-sharing errors must never send a student into the retired Pointer page.
    const fallback=document.createElement('button');fallback.type='button';
    fallback.textContent='Try again';fallback.hidden=true;
    fallback.style.cssText='border:1px solid #1d4ed8;background:white;color:#1d4ed8;border-radius:9px;padding:8px 10px;cursor:pointer;font:700 13px system-ui';
    fallback.addEventListener('click',()=>void beginShare());
    holder.append(btn,label,fallback);
    const shareArea=persistentShareWindow&&typeof document.querySelector==='function'?document.querySelector('#fttShareControlArea'):null;
    if(shareArea){holder.style.position='static';holder.style.boxShadow='none';holder.style.padding='16px';shareArea.appendChild(holder)}
    else document.body.appendChild(holder);
    let active=null,peer=null,call=null,stream=null,busy=false,latestSession=null,permission={},permissionKey='',permissionRequest=0,permissionReady=false;
    // A student's click on the small Share My Screen button opens the browser picker.
    // Teacher requests must not create a second consent dialog or sharing tab.
    // ---------- Background class connection ----------
    // While the teacher has Classroom Pointer open, a signed-in student is connected to his own class
    // from whichever Fun Torah Tools page he is on, so he shows as joined without pressing anything.
    // The teacher's page admits him only with a fresh server-issued ticket for this class and lesson,
    // gives him no lesson data here, and a deliberate removal by the teacher stops it.
    let presencePeer=null,presenceConn=null,presenceTimer=null,presenceDelay=0,presenceTarget='',presenceFailures=0;
    const later=(fn,ms)=>typeof setTimeout==='function'?setTimeout(fn,ms):0,cancelLater=t=>{if(t&&typeof clearTimeout==='function')clearTimeout(t)};
    const removedRoom=()=>{try{return sessionStorage.getItem('classPointerRemovedRoom')||''}catch{return''}};
    function activityName(){
      if(persistentShareWindow)return 'Screen sharing window';
      const path=location.pathname.replace(/\/index\.html$/,'/');
      if(path==='/'||/\/B3-games\/$/.test(path))return 'Home page';
      return String(document.title||'').split(/\s[|·–-]\s/)[0].trim().slice(0,40)||'Another activity';
    }
    // Teacher media sits above the activity; its DOM, answers and scroll stay intact.
    let admitted=false,lessonId='',lessonActive=false,lessonCall=null,pendingLessonCall=null,pendingLessonTimer=null,lessonRetryTimer=null,lessonReceiveTimer=null,lessonRetries=0;
    const lessonOverlay=document.createElement('section');lessonOverlay.id='fttTeacherLessonOverlay';
    lessonOverlay.setAttribute('aria-label','Teacher lesson');
    lessonOverlay.style.cssText='position:fixed;inset:0;z-index:2147483638;background:#071426;display:none;flex-direction:column;font:700 16px system-ui,sans-serif;color:white';
    const lessonToolbar=document.createElement('div');lessonToolbar.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;background:#102748';
    const lessonStatus=document.createElement('span');lessonStatus.setAttribute('role','status');lessonStatus.textContent='Connecting to your teacher…';
    const back=document.createElement('button');back.type='button';back.textContent='Back to Activity';
    back.style.cssText='padding:10px 16px;border:0;border-radius:9px;background:white;color:#102748;font:inherit;cursor:pointer';
    const lessonVideo=document.createElement('video');lessonVideo.autoplay=true;lessonVideo.muted=true;lessonVideo.playsInline=true;
    lessonVideo.style.cssText='display:block;position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#071426';
    const reopen=document.createElement('button');reopen.type='button';reopen.id='fttShowTeacherLesson';reopen.textContent='Show Lesson';
    reopen.style.cssText='display:none;position:fixed;left:14px;bottom:14px;z-index:2147483638;padding:12px 18px;border:2px solid white;border-radius:12px;background:#1d4ed8;color:white;font:700 16px system-ui;cursor:pointer';
    // The embedded activity presence view must have its own tools: the retired Pointer page is never opened.
    const drawTools=document.createElement('div');drawTools.id='fttLessonDrawTools';
    drawTools.style.cssText='display:flex;align-items:center;gap:8px;flex-wrap:wrap';
    const lessonModes=[['point','☝ Pointer'],['highlight','🖍 Highlight'],['pen','✎ Pen']];
    const toolButtons=new Map();let lessonLevel='none',lessonTool='point',lessonMarks={points:{},strokes:[],members:[]},lessonDraft=null;
    const lessonStage=document.createElement('div');
    lessonStage.style.cssText='position:relative;flex:1;min-height:0;overflow:hidden;touch-action:auto';
    const markLayer=typeof document.createElementNS==='function'?document.createElementNS('http://www.w3.org/2000/svg','svg'):document.createElement('svg');
    markLayer.style.cssText='position:absolute;pointer-events:none;overflow:visible';
    markLayer.setAttribute('viewBox','0 0 1000 1000');
    const pointerLayer=document.createElement('div');
    pointerLayer.style.cssText='position:absolute;pointer-events:none';
    const hitLayer=document.createElement('div');
    hitLayer.style.cssText='position:absolute;cursor:crosshair;touch-action:none';
    const viewOnly=document.createElement('span');viewOnly.textContent='View only';viewOnly.style.cssText='font-size:13px;opacity:.85';
    const undo=document.createElement('button');undo.type='button';undo.textContent='↶ Undo';undo.style.cssText='padding:7px 10px;border-radius:8px;border:1px solid #86a6df;background:#193b6c;color:white;cursor:pointer';
    const allowedMode=mode=>lessonLevel==='pen'||mode==='point'&&lessonLevel!=='none'||mode==='highlight'&&lessonLevel==='highlight';
    function redrawToolbar(){
      if(!allowedMode(lessonTool))lessonTool=lessonLevel==='none'?'point':lessonLevel==='highlight'?'highlight':lessonLevel==='pen'?'pen':'point';
      for(const [mode,button] of toolButtons){button.hidden=!allowedMode(mode);button.setAttribute('aria-pressed',String(mode===lessonTool))}
      viewOnly.hidden=lessonLevel!=='none';undo.hidden=!['highlight','pen'].includes(lessonTool)||!allowedMode(lessonTool);
      hitLayer.style.pointerEvents=lessonLevel==='none'?'none':'auto';
    }
    for(const [mode,title] of lessonModes){
      const button=document.createElement('button');button.type='button';button.textContent=title;
      button.style.cssText='padding:7px 10px;border-radius:8px;border:1px solid #86a6df;background:#193b6c;color:white;cursor:pointer;font:700 13px system-ui';
      button.addEventListener('click',()=>{lessonTool=mode;redrawToolbar()});drawTools.append(button);toolButtons.set(mode,button);
    }
    undo.addEventListener('click',()=>{if(admitted&&presenceConn?.open&&allowedMode(lessonTool))presenceConn.send({type:'edit-highlights',action:'undo'})});
    drawTools.append(undo,viewOnly);
    const ns='http://www.w3.org/2000/svg',svg=(name,attrs)=>{const el=typeof document.createElementNS==='function'?document.createElementNS(ns,name):document.createElement(name);for(const [key,value] of Object.entries(attrs))el.setAttribute(key,String(value));return el};
    function picture(){
      const rect=lessonStage.getBoundingClientRect(),width=lessonVideo.videoWidth,height=lessonVideo.videoHeight;
      if(!width||!height||!rect.width||!rect.height)return{left:0,top:0,width:rect.width,height:rect.height};
      const scale=Math.min(rect.width/width,rect.height/height),w=width*scale,h=height*scale;
      return{left:(rect.width-w)/2,top:(rect.height-h)/2,width:w,height:h};
    }
    function renderLessonMarks(){
      const b=picture();
      for(const layer of [markLayer,pointerLayer,hitLayer])Object.assign(layer.style,{left:b.left+'px',top:b.top+'px',width:b.width+'px',height:b.height+'px'});
      markLayer.replaceChildren();pointerLayer.replaceChildren();
      for(const stroke of [...(Array.isArray(lessonMarks.strokes)?lessonMarks.strokes:[]),...(lessonDraft?[lessonDraft]:[])]){
        if(!stroke||!Array.isArray(stroke.points)||!stroke.points.length||stroke.points.length>256)continue;
        const points=stroke.points.filter(p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1);
        if(!points.length)continue;
        const color=/^#[0-9a-fA-F]{6}$/.test(stroke.color)?stroke.color:'#57b8ff';
        const alpha=stroke.tool==='highlight'?.4:1,width=Math.max(2,Math.min(30,(Number(stroke.size)||.016)*450));
        const d=points.map((p,i)=>(i?'L':'M')+(p.x*1000)+' '+(p.y*1000)).join(' ');
        const mark=svg('path',{d,stroke:color,'stroke-width':width,'stroke-linecap':'round','stroke-linejoin':'round',fill:'none',opacity:alpha});
        markLayer.appendChild(mark);
      }
      for(const [id,point] of Object.entries(lessonMarks.points||{})){
        if(!Number.isFinite(point?.x)||!Number.isFinite(point?.y)||point.x<0||point.x>1||point.y<0||point.y>1)continue;
        const tag=document.createElement('span');tag.textContent='●';
        const who=(lessonMarks.members||[]).find(m=>m.id===id);tag.title=who?.name||'Pointer';
        tag.style.cssText='position:absolute;transform:translate(-50%,-50%);color:#ffcc00;font:900 26px system-ui;text-shadow:0 1px 4px #000';
        tag.style.left=(point.x*100)+'%';tag.style.top=(point.y*100)+'%';pointerLayer.appendChild(tag);
      }
    }
    const normalized=e=>{const rect=hitLayer.getBoundingClientRect();const x=(e.clientX-rect.left)/rect.width,y=(e.clientY-rect.top)/rect.height;return Number.isFinite(x)&&Number.isFinite(y)&&x>=0&&x<=1&&y>=0&&y<=1?{x,y}:null};
    let lastPointSend=0;
    hitLayer.addEventListener('pointerdown',e=>{
      if(!admitted||!lessonActive||!allowedMode(lessonTool)||e.button!==0)return;
      const p=normalized(e);if(!p)return;e.preventDefault();
      if(lessonTool==='point'){presenceConn?.send({type:'point',point:{...p,tool:'target'}});return}
      lessonDraft={tool:lessonTool,color:'#57b8ff',size:.016,points:[p,p]};
      try{hitLayer.setPointerCapture(e.pointerId)}catch{}renderLessonMarks();
    });
    hitLayer.addEventListener('pointermove',e=>{
      if(!admitted||!lessonActive||!allowedMode(lessonTool))return;
      const p=normalized(e);if(!p)return;
      if(lessonTool==='point'){if(Date.now()-lastPointSend>=75){lastPointSend=Date.now();presenceConn?.send({type:'point',point:{...p,tool:'target'}})}return}
      if(!lessonDraft)return;
      const pts=lessonDraft.points,last=pts[pts.length-1];
      if(pts.length<256&&Math.hypot(p.x-last.x,p.y-last.y)>.003){pts.push(p);renderLessonMarks()}
    });
    function finishDrawing(e){
      if(!lessonDraft)return;
      const stroke=lessonDraft;lessonDraft=null;renderLessonMarks();
      if(admitted&&lessonActive&&allowedMode(stroke.tool)&&presenceConn?.open&&stroke.points.length>=2)presenceConn.send({type:'highlight',stroke});
    }
    hitLayer.addEventListener('pointerup',finishDrawing);
    hitLayer.addEventListener('pointercancel',()=>{lessonDraft=null;renderLessonMarks()});
    hitLayer.addEventListener('pointerleave',()=>{if(lessonTool==='point'&&presenceConn?.open)presenceConn.send({type:'pointer-hide'})});
    lessonVideo.addEventListener('loadedmetadata',renderLessonMarks);
    if(typeof ResizeObserver==='function')new ResizeObserver(renderLessonMarks).observe(lessonStage);
    lessonToolbar.append(lessonStatus,drawTools,back);
    lessonStage.append(lessonVideo,markLayer,pointerLayer,hitLayer);
    lessonOverlay.append(lessonToolbar,lessonStage);document.body.appendChild(lessonOverlay);document.body.appendChild(reopen);
    redrawToolbar();
    back.addEventListener('click',()=>{lessonOverlay.style.display='none';reopen.style.display=lessonActive?'block':'none'});
    reopen.addEventListener('click',()=>{if(lessonActive){lessonOverlay.style.display='flex';reopen.style.display='none';lessonVideo.play?.().catch(()=>{})}});
    function closeLessonCall(){cancelLater(lessonReceiveTimer);lessonReceiveTimer=null;const old=lessonCall;lessonCall=null;try{old?.close()}catch{}lessonVideo.srcObject=null}
    function clearLesson(){
      lessonLevel='none';lessonDraft=null;lessonMarks={points:{},strokes:[],members:[]};redrawToolbar();renderLessonMarks();
      admitted=false;lessonActive=false;lessonId='';cancelLater(pendingLessonTimer);cancelLater(lessonRetryTimer);pendingLessonTimer=null;lessonRetryTimer=null;
      const waiting=pendingLessonCall;pendingLessonCall=null;try{waiting?.close()}catch{}closeLessonCall();lessonOverlay.style.display='none';reopen.style.display='none';
    }
    function retryLesson(){
      if(!admitted||!lessonActive||!presenceConn?.open||lessonRetryTimer||lessonRetries>=6)return;
      lessonStatus.textContent='Reconnecting to your teacher…';
      lessonRetryTimer=later(()=>{lessonRetryTimer=null;if(admitted&&lessonActive&&presenceConn?.open){lessonRetries++;presenceConn.send({type:'lesson-retry',id:lessonId});lessonReceiveTimer=later(retryLesson,15000)}},1500);
    }
    function acceptLesson(incoming){
      if(!admitted||!lessonActive||incoming.peer!==presenceTarget||incoming.metadata?.presentationId!==lessonId){try{incoming.close()}catch{}return}
      cancelLater(lessonRetryTimer);lessonRetryTimer=null;closeLessonCall();lessonCall=incoming;
      incoming.on('stream',media=>{
        if(lessonCall!==incoming)return;cancelLater(lessonReceiveTimer);lessonReceiveTimer=null;
        lessonVideo.srcObject=media;lessonStatus.textContent='Your teacher’s lesson';lessonVideo.play?.().catch(()=>{lessonStatus.textContent='Press Show Lesson to view your teacher';reopen.style.display='block'});
        media.getVideoTracks?.().forEach(track=>track.addEventListener('ended',()=>{if(lessonCall===incoming){closeLessonCall();retryLesson()}},{once:true}));
      });
      const lost=()=>{if(lessonCall===incoming){closeLessonCall();retryLesson()}};
      incoming.on('close',lost);incoming.on('error',lost);
      // Receiving needs no camera, microphone or screen capture permission.
      try{incoming.answer();if(!lessonVideo.srcObject)lessonReceiveTimer=later(()=>{if(lessonCall===incoming){closeLessonCall();retryLesson()}},15000)}catch{lost()}
    }
    function incomingLesson(incoming){
      if(incoming.peer!==presenceTarget||incoming.metadata?.kind!=='activity-lesson'||typeof incoming.metadata?.presentationId!=='string'||incoming.metadata.presentationId.length>120){try{incoming.close()}catch{}return}
      if(admitted&&lessonActive&&incoming.metadata.presentationId===lessonId){acceptLesson(incoming);return}
      // Signalling may beat the reliable announcement. Never answer before admission.
      try{pendingLessonCall?.close()}catch{}pendingLessonCall=incoming;cancelLater(pendingLessonTimer);
      pendingLessonTimer=later(()=>{if(pendingLessonCall===incoming){pendingLessonCall=null;try{incoming.close()}catch{}}},5000);
    }
    function announceLesson(message){
      if(!admitted||typeof message.id!=='string'||!message.id||message.id.length>120||typeof message.active!=='boolean')return;
      if(!message.active){if(message.id===lessonId){lessonActive=false;cancelLater(lessonRetryTimer);lessonRetryTimer=null;cancelLater(pendingLessonTimer);const waiting=pendingLessonCall;pendingLessonCall=null;try{waiting?.close()}catch{}closeLessonCall();lessonOverlay.style.display='none';reopen.style.display='none'}return}
      if(lessonId!==message.id||!lessonActive){closeLessonCall();lessonId=message.id;lessonActive=true;lessonRetries=0;cancelLater(lessonRetryTimer);lessonRetryTimer=null;lessonReceiveTimer=later(retryLesson,15000);lessonStatus.textContent='Connecting to your teacher…';lessonOverlay.style.display='flex';reopen.style.display='none'}
      if(pendingLessonCall?.metadata?.presentationId===lessonId){const waiting=pendingLessonCall;pendingLessonCall=null;cancelLater(pendingLessonTimer);acceptLesson(waiting)}
    }
    function stopPresence(){
      window.ClassPointerBoards?.reset?.();
      clearLesson();cancelLater(presenceTimer);presenceTimer=null;
      const conn=presenceConn;presenceConn=null;try{conn?.close()}catch{}
      const old=presencePeer;presencePeer=null;try{old?.destroy()}catch{}
    }
    function schedulePresence(ms){cancelLater(presenceTimer);presenceTimer=later(connectPresence,ms)}
    // Give up after repeated failures until the teacher's lesson changes; never retry in a tight loop.
    function retryPresence(){if(!latestSession)return;stopPresence();if(++presenceFailures>6)return;presenceDelay=Math.min(60000,(presenceDelay||2000)*2);schedulePresence(presenceDelay)}
    function showRemovedNotice(){
      const note=document.createElement('div');note.setAttribute('role','status');
      note.style.cssText='position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483641;padding:12px 18px;border-radius:12px;background:#fff2ef;color:#8a2119;border:1px solid #e4a69e;font:700 15px system-ui,sans-serif;box-shadow:0 6px 24px #0003';
      note.textContent='Your teacher removed you from the class.';document.body.appendChild(note);later(()=>note.remove(),9000);
    }
    async function connectPresence(){
      presenceTimer=null;
      const session=latestSession;
      if(!session||sessionStorage.getItem('b3Games_studentId')!==id){stopPresence();return}
      const room=session.roomId;
      if(removedRoom()===room||(presenceConn&&presenceConn.peer===room))return;
      stopPresence();
      try{
        if(!window.Peer)await load(new URL('class-pointer-prototype/vendor/peerjs-1.5.5.min.js',root).href);
        const own=new Peer('class-pointer-student-'+crypto.randomUUID());
        if(typeof own.on!=='function'||typeof own.connect!=='function'){try{own.destroy?.()}catch{}return}
        presencePeer=own;
        own.on('call',incoming=>{if(presencePeer!==own){try{incoming.close()}catch{}return}incomingLesson(incoming)});
        await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('timeout')),15000);own.once('open',()=>{clearTimeout(t);resolve()});own.once('error',e=>{clearTimeout(t);reject(e)})});
        if(presencePeer!==own||latestSession?.roomId!==room)return;
        own.on('error',error=>{if(presencePeer!==own)return;if(error?.type==='peer-unavailable'){stopPresence();return}retryPresence()});
        own.on('disconnected',()=>{if(presencePeer===own&&!own.destroyed){try{own.reconnect()}catch{}}});
        const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'joinIssue',room,classId,studentId:id,pin,peerId:own.id}),signal:AbortSignal.timeout(15000)});
        const ticket=await response.json().catch(()=>({}));
        if(presencePeer!==own)return;
        // Not in this class or signed out: stop quietly. Server trouble: try again later.
        if(!response.ok||!ticket.ok){if(response.status>=400&&response.status<500){stopPresence();return}throw Error('ticket')}
        const conn=own.connect(room,{reliable:true});presenceConn=conn;
        conn.on('open',()=>{if(presenceConn===conn)conn.send({type:'join',presence:true,ticket:ticket.token,activity:activityName(),name:ticket.studentName})});
        conn.on('data',message=>{
          if(presenceConn!==conn||!message||typeof message!=='object')return;
          if(message.type==='present'){admitted=true;presenceDelay=0;presenceFailures=0;return}
          if(typeof message.type==='string'&&message.type.startsWith('board-')){
            if(admitted)window.ClassPointerBoards?.fromTeacher(message);
            return;
          }
          if(message.type==='lesson-tools'){if(admitted&&['none','point','highlight','pen'].includes(message.level)){lessonLevel=message.level;lessonDraft=null;redrawToolbar();renderLessonMarks()}return}
          if(message.type==='lesson-marks'){if(admitted&&Array.isArray(message.strokes)&&message.strokes.length<=1500){lessonMarks={points:message.points||{},strokes:message.strokes,members:Array.isArray(message.members)?message.members:[]};renderLessonMarks()}return}
          if(message.type==='lesson-presentation'){if(!persistentShareWindow)announceLesson(message);return}
          if(message.type==='removed'){try{sessionStorage.setItem('classPointerRemovedRoom',room)}catch{}stopPresence();showRemovedNotice();return}
          // Already connected in the lesson or another window, or the lesson ended: check again later.
          if(['elsewhere','replaced','full'].includes(message.type)){stopPresence();schedulePresence(60000);return}
          if(message.type==='ended'){stopPresence()}
        });
        const lost=()=>{if(presenceConn===conn){presenceConn=null;retryPresence()}};
        conn.on('close',lost);conn.on('error',lost);
      }catch{if(latestSession?.roomId===room)retryPresence()}
    }
    function followSession(next){
      if(!next){presenceTarget='';presenceDelay=0;stopPresence();return}
      if(next.roomId!==presenceTarget){presenceTarget=next.roomId;presenceDelay=0;presenceFailures=0;schedulePresence(400)}
    }
    window.addEventListener('pagehide',stopPresence);
    const identityTimer=typeof setInterval==='function'?setInterval(()=>{if(sessionStorage.getItem('b3Games_studentId')!==id){stopPresence();stop();clearInterval(identityTimer)}},1000):null;
    identityTimer?.unref?.();
    window.addEventListener('pagehide',()=>{if(identityTimer)clearInterval(identityTimer)},{once:true});

    async function watchPermission(session){
      const request=session?.destinationRequest,at=request?.at||session?.shareRequest?.at;
      const hasRequest=(request&&['screens','boards'].includes(request.mode))||(session?.studentScreenSharing===true&&Number.isFinite(at));
      // Sharing enabled without a request: the student may start sharing himself.
      const enabledOnly=!hasRequest&&session?.studentScreenSharing===true;
      if(!hasRequest&&!enabledOnly){permissionKey='';permission={};permissionReady=false;refreshSessionState();return}
      const key=session.roomId+':'+String(session.permissionRevision||'')+':'+(enabledOnly?'enabled':String(at||''));
      if(permissionKey===key&&permissionReady)return;
      // Until his own permission is confirmed the button is hidden, so a teacher's change hides it at once.
      // (A share already running is not interrupted while the check is in progress.)
      const keep=permission;permissionKey=key;permission={};permissionReady=false;const current=++permissionRequest;
      if(!stream)holder.style.display='none';else{permission=keep;permissionReady=true}
      try{
        const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({action:'permissions',studentId:id,pin,classId,room:session.roomId}),signal:AbortSignal.timeout(10000)});
        const result=await response.json();
        if(current!==permissionRequest||latestSession?.roomId!==session.roomId||permissionKey!==key)return;
        if(response.ok&&result?.ok){
          permission={screenSharingDenied:result.screenSharingDenied===true,whiteboardDenied:result.whiteboardDenied===true};permissionReady=true;
        }else if(enabledOnly&&response.status===403&&/no active student activity request/i.test(result?.error||'')){
          // The sharing service in use does not answer this question without a request yet; it still
          // refuses a student the teacher turned off when he tries to share.
          permission={};permissionReady=true;
        }else throw Error(result?.error||'Could not check your sharing permissions.');
      }catch{
        if(current===permissionRequest&&permissionKey===key){
          if(enabledOnly){permission={};permissionReady=true}
          else{permission={};permissionReady=false;status('Could not check sharing permissions. Ask your teacher to resend.');}
        }
      }
      refreshSessionState();
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
    function refreshSessionState(){
      const next=latestSession;
      if(!permissionReady){if(stream)stop();active=null;holder.style.display='none';return}
      const shareable=next?.studentScreenSharing===true&&permission?.screenSharingDenied!==true?next:null;
      if(!shareable||!active||shareable.roomId!==active.roomId){if(stream)stop()}
      active=shareable;holder.style.display=active?'flex':'none';
    }
    function current(rows){
      return Object.entries(rows||{}).filter(([key,v])=>v&&v.roomId===key&&/^class-pointer-[a-f0-9-]{36}$/.test(key)
        &&Number.isFinite(v.createdAt)&&Date.now()-v.createdAt<14400000&&Date.now()-v.createdAt>=-60000)
        .sort((a,b)=>b[1].createdAt-a[1].createdAt)[0]?.[1]||null;
    }
    sessions.on('value',async snapshot=>{
      // Student switching must never reuse another boy's classroom invitation.
      if(sessionStorage.getItem('b3Games_studentId')!==id){
        if(stream)stop();
        latestSession=null;active=null;permissionKey='';permissionRequest++;permission={};permissionReady=false;holder.style.display='none';
        followSession(null);
        return;
      }
      const next=current(snapshot.val());
      latestSession=next;
      followSession(next);
      if(next)await watchPermission(next);else{permissionKey='';permissionRequest++;permission={};permissionReady=false;refreshSessionState()}
    },()=>{stopPresence();latestSession=null;permissionKey='';permissionRequest++;permission={};permissionReady=false;active=null;holder.style.display='none';stop()});
    async function beginShare(){
      if(stream){stop();return}
      if(busy||!active)return;
      const lesson=active;
      busy=true;btn.disabled=true;
      let captured=null;
      try{
        if(!navigator.mediaDevices?.getDisplayMedia)throw Error('Use Chrome or Edge on a computer.');
        // Capture must be called synchronously from the user click, before any await.
        const capturePromise=navigator.mediaDevices.getDisplayMedia({
          video:{displaySurface:'monitor',frameRate:{ideal:5,max:8}},audio:false,
          selfBrowserSurface:'exclude',surfaceSwitching:'exclude',monitorTypeSurfaces:'include'
        });
        captured=await capturePromise;
        const displaySurface=captured.getVideoTracks()[0]?.getSettings?.().displaySurface;
        if(displaySurface&&displaySurface!=='monitor')throw Error('Please choose Entire Screen in the browser picker.');
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
          const error=new Error('Activity sharing service unavailable. Please retry or ask your teacher.');
          error.code='ACTIVITY_SHARE_NETWORK';throw error;
        }
        let ticket;
        try{ticket=await response.json()}catch{
          const error=new Error('Activity sharing service returned an invalid response. Please retry or ask your teacher.');
          error.code='ACTIVITY_SHARE_NETWORK';throw error;
        }
        if(!response.ok||!ticket?.ok){
          const error=new Error(ticket?.error||'Screen sharing is not allowed.');
          if(response.status===404||response.status>=500)error.code='ACTIVITY_SHARE_NETWORK';
          if(response.status===403&&/turned off your screen sharing/i.test(ticket?.error||''))error.code='ACTIVITY_SHARE_DENIED';
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
        status('Sharing your screen with the teacher');
      }catch(error){
        captured?.getTracks().forEach(t=>t.stop());
        // A failure must release media/peer resources without erasing the error or reopening a blocking dialog.
        stop();
        const networkFailure=error?.code==='ACTIVITY_SHARE_NETWORK';
        status(error?.name==='NotAllowedError'?'Sharing canceled.':error.message||'Could not share.');
        if(networkFailure)fallback.hidden=false;
        // The teacher has turned this student off: hide the button until the teacher changes it.
        if(error?.code==='ACTIVITY_SHARE_DENIED'){permission={...permission,screenSharingDenied:true};refreshSessionState()}
      }
      finally{busy=false;btn.disabled=false}
    }
    btn.addEventListener('click',beginShare);
    window.addEventListener('pagehide',stop);
  }catch(error){console.warn('Class Pointer activity sharing unavailable',error)}
})();
