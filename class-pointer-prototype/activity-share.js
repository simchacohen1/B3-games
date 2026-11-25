'use strict';
/* Class-scoped activity sharing: keep a student on his learning page for
   screen requests and teacher-controlled individual whiteboards.
   Browser screen capture always requires an explicit student click. */
(async function(){
  if(window.__classPointerActivityShareLoaded)return;
  // Staging runs this like live: classPointerShareAuth and the session rules are deployed to the staging project,
  // and the staging build already points the endpoints below at it.
  window.__classPointerActivityShareLoaded=true;
  // The student classroom already has its working central share control in Screens mode.
  // Do not cover it with a second floating share prompt.
  if(/\/class-pointer-prototype\/classroom\.html$/.test(location.pathname))return;
  const src=document.currentScript?.src||'';
  const root=new URL('../',src);
  const persistentShareWindow=new URL(location.href).searchParams.get('pointerShare')==='1';
  const presentationView=/\/class-pointer-prototype\/student-view\.html$/.test(location.pathname);
  const endpoint='https://us-central1-b3-games.cloudfunctions.net/classPointerShareAuth';
  const studentAuth='https://us-central1-b3-games.cloudfunctions.net/funTorahStudentAuth';
  const ws='b3-2026';
  const load=(url)=>new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=url;script.onload=resolve;script.onerror=reject;
    document.head.appendChild(script);
  });
  // ---------- Class connection status (shown to the student, and logged for support) ----------
  // Every step that used to fail silently now says what is wrong: "Connected to class" or "Can't connect – <reason>".
  // Good news fades after a few seconds; a problem stays on screen. Not shown in the sharing tab.
  let linkPill=null,linkTimer=null,linkKey='';
  function classLink(kind,text){
    try{
      const key=kind+'|'+text;
      window.ClassPointerLinkStatus={kind,text,at:Date.now()};
      if(key===linkKey)return;
      linkKey=key;
      (kind==='bad'?console.warn:console.info)('[Class Pointer] '+text);
      if(persistentShareWindow||typeof document.body?.appendChild!=='function')return;
      if(!linkPill){
        linkPill=document.createElement('div');linkPill.id='fttClassLinkStatus';linkPill.setAttribute('role','status');linkPill.setAttribute('aria-live','polite');
        linkPill.style.cssText='position:fixed;right:14px;top:14px;z-index:2147483638;max-width:min(360px,calc(100vw - 28px));padding:8px 14px;border-radius:12px;font:700 14px/1.35 system-ui,sans-serif;color:#fff;box-shadow:0 4px 18px #0004;pointer-events:none';
        document.body.appendChild(linkPill);
      }
      clearTimeout(linkTimer);linkTimer=null;
      linkPill.textContent=text;
      linkPill.style.background=kind==='ok'?'#15803d':kind==='bad'?'#b91c1c':'#475569';
      linkPill.style.display='block';
      if(kind!=='bad')linkTimer=setTimeout(()=>{if(linkPill)linkPill.style.display='none'},kind==='ok'?8000:12000);
    }catch{/* a status line must never break the page */}
  }
  // Plain-language reason for a refused request to the class server.
  function classLinkWhy(status,serverText){
    const said=String(serverText||'').slice(0,160);
    if(status===401)return 'the class server did not accept your passcode (error 401). Sign out and sign in again. If this keeps happening, tell your teacher the code: JOIN-401.';
    if(status===429)return 'too many tries. Wait a few minutes, then reload.';
    if(status===404)return 'the class connection service was not found (wrong or old link).';
    if(status>=500)return 'the class server is busy or down. It will try again.';
    if(status===403)return said||'you are not allowed in this class right now.';
    return said||'the class server refused the request ('+(status||'no answer')+').';
  }
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
        const timer=setInterval(()=>{
          if(sessionStorage.getItem('b3Games_studentId')&&sessionStorage.getItem('b3Games_classPin'))finish();
        },500);
        // Stay subscribed for the lifetime of this page: pupils often leave
        // the sign-in screen open before class. A timeout loses the only
        // listener that can start their classroom connection after signing in.
        function finish(){clearInterval(timer);window.removeEventListener('fttStudentSignedIn',finish);window.removeEventListener('pagehide',finish);resolve()}
        window.addEventListener('fttStudentSignedIn',finish,{once:true});
        window.addEventListener('pagehide',finish,{once:true});
      });
      id=sessionStorage.getItem('b3Games_studentId');
      pin=sessionStorage.getItem('b3Games_classPin');
    }
    if(!id||!pin||!(/^[A-Za-z0-9_-]{1,100}$/).test(id))return;
    // game-gate owns Firebase startup on activity/presentation pages. Waiting
    // here prevents two app SDK loads from replacing each other's services.
    if(window.B3GameGateAuthReady)await window.B3GameGateAuthReady;
    // The sharing tab has no game-gate.js, which is what signs the student in on the activity pages. Without that
    // sign-in the database refuses to read the lesson and the student's class (the rules need a signed-in student),
    // so the tab could never start. It loads Firebase's sign-in part itself and waits for the saved sign-in below.
    let ownSignIn=false;
    if(!window.firebase?.database){
      if(!window.firebase)await load('https://www.gstatic.com/firebasejs/12.15.0/firebase-app-compat.js');
      await load('https://www.gstatic.com/firebasejs/12.15.0/firebase-database-compat.js');
      if(persistentShareWindow&&!window.firebase.auth){await load('https://www.gstatic.com/firebasejs/12.15.0/firebase-auth-compat.js');ownSignIn=true}
    }
    if(!window.B3_FIREBASE_CONFIG)await load(new URL('firebase-config.js',root).href);
    if(!firebase.apps.length)firebase.initializeApp(window.B3_FIREBASE_CONFIG);
    if(ownSignIn){
      // The saved student sign-in is restored from the browser a moment after start. Do not read anything before it
      // is back (but never wait forever).
      const auth0=firebase.auth();
      await Promise.race([
        typeof auth0.authStateReady==='function'?auth0.authStateReady():new Promise(resolve=>{const off=auth0.onAuthStateChanged(()=>{off();resolve()})}),
        new Promise(resolve=>setTimeout(resolve,8000))
      ]);
    }
    let auth;
    try{auth=await fetch(studentAuth,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'verify',studentId:id,pin})})}
    catch{classLink('bad','Can’t connect – no internet or the school server can’t be reached.');return}
    if(!auth.ok||!(await auth.json()).ok){classLink('bad','Can’t connect – your sign-in was not accepted. Sign out and sign in again.');return}
    // Use the same class resolver as the existing student dashboard.
    // It respects a selected class and never revives a removed membership.
    if(!window.FunTorahStudentClass)await load(new URL('student-class.js',root).href);
    const scope=await window.FunTorahStudentClass.resolve(firebase.database(),id);
    let classId=scope.classId;
    if(scope.workspaceId!==ws||!/^[A-Za-z0-9_-]{1,100}$/.test(classId||'')){classLink('bad','Can’t connect – you are not in a class that uses Class Pointer (class: '+(classId||'none')+').');return}
    function sameStudent(){return sessionStorage.getItem('b3Games_studentId')===id &&
      (sessionStorage.getItem('b3Games_studentClass')||classId)===classId}
    // Mount the existing student whiteboard on real browser pages. Synthetic
    // auth-only tests use deliberately minimal DOM mocks without append().
    // The dedicated sharing tab only holds the screen capture: the whiteboard,
    // lesson view and class connection stay in the tab the student works in.
    if(!persistentShareWindow&&typeof document.body?.append==='function'){
    const boardStage=document.createElement('div');
    boardStage.id='fttEmbeddedPointerStage';
    boardStage.style.cssText='position:fixed;inset:0;z-index:2147483636;display:none;background:#e8eef7';
    document.body.append(boardStage);
    const boardCss=document.createElement('link');boardCss.rel='stylesheet';
    boardCss.href=new URL('class-pointer-prototype/student-boards.css?v=20261124-pages1',root).href;
    document.head.append(boardCss);
    window.ClassPointerBridge={isTeacher:false,embedded:true,embeddedStage:boardStage,
      sendTeacher:message=>{
        if(admitted&&presenceConn?.open&&latestSession?.roomId===presenceTarget){
          try{presenceConn.send(message)}catch{}
        }
      },status:()=>{},callTeacher:null};
    // Shared drawing toolbar: shown only while this student shares his screen or has his whiteboard open.
    // The whiteboard's fonts (a student sees the teacher's words in the font the teacher chose).
    await load(new URL('class-pointer-prototype/classroom-core.js?v=hlshapes2',root).href).catch(()=>{});
    await load(new URL('class-pointer-prototype/annotation-toolbar.js?v=20261123-tiles2',root).href).catch(()=>{});
    await load(new URL('class-pointer-prototype/poll-core.js?v=2',root).href);
    await load(new URL('class-pointer-prototype/poll.js?v=2',root).href);
    await load(new URL('class-pointer-prototype/board-tiles-core.js?v=20261123-tiles2',root).href).catch(()=>{});
    await load(new URL('class-pointer-prototype/board-pages-core.js?v=20261124-pages1',root).href).catch(()=>{});
    await load(new URL('class-pointer-prototype/student-boards.js?v=20261124-groups1',root).href);
    // Save and My files for the student's own whiteboard.
    await load(new URL('class-pointer-prototype/saved-work-core.js?v=20261124-pages1',root).href).catch(()=>{});
    await load(new URL('class-pointer-prototype/saved-work.js?v=20261124-groups1',root).href).catch(()=>{});
    // Save and My files for the student's own whiteboard.
    await load(new URL('class-pointer-prototype/saved-work-core.js?v=20261124-pages1',root).href).catch(()=>{});
    await load(new URL('class-pointer-prototype/saved-work.js?v=20261124-groups1',root).href).catch(()=>{});
    }
    let sessions=firebase.database().ref('b3Games/workspaces/'+ws+'/classes/'+classId+'/classPointerSessions');
    const holder=document.createElement('div');
    holder.id='fttActivityScreenShare';
    holder.style.cssText='position:fixed;right:14px;bottom:14px;z-index:2147483640;display:none;align-items:center;gap:8px;padding:8px;border-radius:14px;background:#f8fbff;border:2px solid #2563eb;box-shadow:0 5px 24px #15284666;font:700 15px system-ui,sans-serif';
    const btn=document.createElement('button');btn.type='button';btn.textContent='🖥 Share My Screen';
    // The sharing tab is for young students: one big button, almost no words. After the sharing tab itself is refreshed
    // the capture is gone (a browser ends it when its page reloads), so the button reads Resume sharing.
    const BTN_BASE=persistentShareWindow
      ?'background:#1d4ed8;color:#fff;border:0;border-radius:18px;padding:26px 34px;width:100%;cursor:pointer;font:800 30px system-ui,sans-serif'
      :'background:#1d4ed8;color:#fff;border:0;border-radius:10px;padding:11px 16px;cursor:pointer;font:inherit';
    const BTN_RESUME=BTN_BASE;
    btn.style.cssText=BTN_BASE;
    const label=document.createElement('span');label.setAttribute('role','status');label.style.cssText='font-size:12px;color:#1e3a8a;max-width:190px';
    const IDLE_TEXT=persistentShareWindow?'':'Click to show your teacher your screen. Choose Entire Screen.';label.textContent=IDLE_TEXT;
    label.hidden=persistentShareWindow;   // the sharing tab only shows a short line when there is something to say
    // Screen-sharing errors must never send a student into the retired Pointer page.
    const fallback=document.createElement('button');fallback.type='button';
    fallback.textContent='Try again';fallback.hidden=true;
    fallback.style.cssText='border:1px solid #1d4ed8;background:white;color:#1d4ed8;border-radius:9px;padding:8px 10px;cursor:pointer;font:700 13px system-ui';
    fallback.addEventListener('click',()=>{if(persistentShareWindow)void beginShare();else openHolder()});
    holder.append(btn,label,fallback);
    const shareArea=persistentShareWindow&&typeof document.querySelector==='function'?document.querySelector('#fttShareControlArea'):null;
    if(shareArea){
      // Plain and centred: the page itself is the control. The start-up placeholder button (see student-share-window.html)
      // stays until this control is actually shown (setHolderDisplay), so there is never a moment with no button.
      holder.style.cssText='position:static;display:none;justify-content:center;align-items:center;flex-wrap:wrap;gap:12px;width:100%;padding:0;border:0;background:none;box-shadow:none;font:700 20px system-ui,sans-serif';
      shareArea.appendChild(holder);
    }
    else document.body.appendChild(holder);
    let boardShown=false;   // this student's own whiteboard is on display (student-boards.js tells us)
    let lessonOnAir=false,sharePaused=false;   // teacher presenting (own tab) / told to pause by the own tab (sharing tab)
    let active=null,peer=null,call=null,stream=null,busy=false,latestSession=null,permission={},permissionKey='',permissionRequest=0,permissionReady=false;
    // Remembered per tab (sessionStorage survives a refresh of the same tab): this student was sharing from this tab
    // when the page was unloaded. A deliberate stop, the end of the lesson or a "no" from the teacher clear it.
    const RESUME_KEY='fttShareTabWasSharing';
    let resumeNeeded=false;
    if(persistentShareWindow){try{resumeNeeded=!!id&&sessionStorage.getItem(RESUME_KEY)===id}catch{}}
    const clearResume=()=>{try{sessionStorage.removeItem(RESUME_KEY)}catch{}};
    // In the sharing tab the real control replaces the start-up placeholder button in the same step it is shown or hidden.
    function setHolderDisplay(value){
      holder.style.display=sharePaused?'none':value;
      if(persistentShareWindow){try{document.getElementById('fttShareShell')?.remove()}catch{}}
    }
    const rememberSharing=()=>{try{sessionStorage.setItem(RESUME_KEY,id)}catch{}};
    function styleIdleButton(){
      btn.textContent=resumeNeeded?'▶ Resume sharing':'🖥 Share My Screen';
      btn.style.cssText=resumeNeeded?BTN_RESUME:BTN_BASE;
      holder.style.flexWrap=resumeNeeded?'wrap':'nowrap';
    }
    function styleSharingButton(){
      btn.textContent='⏹ Stop Sharing';btn.style.cssText=BTN_BASE;btn.style.background='#a91f37';holder.style.flexWrap='nowrap';
    }
    if(resumeNeeded){styleIdleButton();setHolderDisplay('flex')}   // right away, before the lesson record has loaded
    const SHARING_TEXT='';   // the sharing tab's title says it ("Sharing your screen"); no extra sentence
    // Shown when the browser would not open the sharing tab and this page shares by itself (see openHolder).
    const PAGE_SHARING_TEXT='✅ Your teacher can see your screen. Stay on this page: leaving it stops sharing.';
    const sharingText=()=>persistentShareWindow?SHARING_TEXT:PAGE_SHARING_TEXT;
    // ---------- Dedicated sharing tab ----------
    // Capturing inside an activity page ends the share as soon as the student opens another page.
    // So Share My Screen opens one small sharing tab (student-share-window.html) that asks for the
    // screen itself and holds the capture. The student keeps working in his own tab, which shows a
    // small "sharing" banner with Stop. The two tabs talk over a same-origin BroadcastChannel, so the
    // banner follows him from page to page. Only one sharing tab exists: it is opened by name.
    // Both tabs follow the lesson record by themselves (see "Teacher connection drops" below), so the
    // sharing tab ends its capture when the lesson ends even if the student's own tab is closed.
    const HOLDER_NAME='classPointerStudentShare';
    /* share-window-open:start */
    // Opens the sharing window by name WITHOUT ever reloading one that already exists. window.open(url, name) would
    // navigate an existing window to url, and a page reload ends a screen capture. window.open('', name) only
    // returns the existing window, which is then just brought to the front; a window that did not exist yet comes
    // back blank and is sent to the sharing page once.
    function openShareWindowOnce(win,url,name){
      let target=null;
      try{target=win.open('',name)}catch{}
      if(!target)return{win:null,existing:false};
      let existing=false;
      try{existing=/\/student-share-window\.html$/.test(String(target.location.pathname))}catch{}
      if(existing){try{target.focus?.()}catch{}return{win:target,existing:true}}
      try{target.location.href=url}catch{try{target.close?.()}catch{}return{win:null,existing:false}}
      return{win:target,existing:false};
    }
    /* share-window-open:end */
    const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('ftt-class-pointer-share'):null;
    // settled: this page has had its first answer about the lesson and this student's permission.
    let holderState=null,holderSeen=0,autoTried=false,settled=false;
    const tell=message=>{try{channel?.postMessage({...message,studentId:id})}catch{}};
    // Whatever the teacher presents (whiteboard, screen, PDF, webpage) comes first for everybody: while it is on, no Share My Screen
    // button is offered, and a share already running is paused (its picture stops being sent, nothing is torn down) until the teacher stops.
    function applyPause(){
      const paused=persistentShareWindow?sharePaused:lessonOnAir;
      try{stream?.getVideoTracks?.().forEach(t=>{t.enabled=!paused})}catch{}
    }
    function setPresenting(on){
      on=!!on;if(lessonOnAir===on)return;lessonOnAir=on;
      try{document.dispatchEvent(new CustomEvent('classpointer:teacher-presenting',{detail:{on}}))}catch{}
      if(persistentShareWindow)return;
      tell({type:'presenting',on});applyPause();showLinked();
    }
    const headline=persistentShareWindow&&typeof document.getElementById==='function'?document.getElementById('fttShareHeadline'):null;
    const shareLine=persistentShareWindow&&typeof document.getElementById==='function'?document.getElementById('fttShareLine'):null;
    function report(){
      if(!persistentShareWindow)return;
      // Once there is nothing to share to (lesson over, sharing turned off) this tab no longer counts as
      // open, so the student's own tab goes back to its ordinary button instead of showing Cancel.
      tell({type:'holder',open:!settled||!!stream||!!active||busy,sharing:!!stream});
      // While sharing: a title and one short line. Otherwise nothing but the big button.
      if(headline)headline.textContent=sharePaused?'Paused ⏸':stream?'Sharing your screen ✅':'';
      if(shareLine)shareLine.textContent=sharePaused?'Your teacher is presenting. Keep this tab open: sharing continues when they stop.':stream?'Keep this tab open':'';
      try{document.title=(sharePaused?'⏸ Sharing paused':stream?'📺 Sharing':'Screen Share')+' · SOLS'}catch{}
    }
    // The student ended it (Stop here, Stop in his other tab, or the browser's own Stop sharing bar).
    function studentStop(){
      resumeNeeded=false;
      stop();
      if(!persistentShareWindow)return;
      tell({type:'holder',open:false,sharing:false});
      later(()=>{try{window.close()}catch{}},150);
    }
    // Tell the teacher's page now, so the screen tile goes away at once instead of waiting for a reconnect.
    function tellTeacherStopped(){if(admitted&&presenceConn?.open){try{presenceConn.send({type:'board-screen',sharing:false,from:'share-tab'})}catch{}}}
    function showLinked(){
      if(persistentShareWindow)return;
      const s=holderState;
      fallback.hidden=true;
      // No sharing tab could be opened, so this page is sharing by itself: keep its Stop button and its status line.
      if(stream){btn.textContent='⏹ Stop Sharing';btn.style.background='#a91f37';holder.style.display=lessonOnAir?'none':'flex';return}
      if(s?.sharing){btn.textContent='⏹ Stop Sharing';btn.style.background='#a91f37';label.textContent='📺 You’re sharing your screen. Keep working here.'}
      else if(s?.open){btn.textContent='✖ Cancel';btn.style.background='#64748b';label.textContent='Choose Entire Screen in the sharing tab that opened.'}
      else{btn.textContent='🖥 Share My Screen';btn.style.background='#1d4ed8';label.textContent=IDLE_TEXT}
      // A sharing tab that is open keeps its Stop / Cancel button here whatever else happens.
      holder.style.display=((active&&permissionReady)||s?.open)&&!lessonOnAir&&!(boardShown&&!s?.open)?'flex':'none';
    }
    // While the student's whiteboard is on display there is no Share My Screen button (as while the teacher presents).
    // A share or a sharing tab that is already open keeps its Stop / Cancel button.
    document.addEventListener?.('classpointer:student-board',event=>{
      const on=event.detail?.on===true;if(boardShown===on)return;boardShown=on;
      try{showLinked()}catch{}
    });
    function openHolder(){
      if(busy||!active||!sameStudent()||lessonOnAir)return;
      // Opened straight from the click so the browser allows the new tab.
      const opened=openShareWindowOnce(window,new URL('class-pointer-prototype/student-share-window.html?pointerShare=1',root).href,HOLDER_NAME);
      // The browser would not open the sharing tab (pop-ups blocked): share from this page as before, so the
      // student is never left unable to share. That share ends when he leaves this page.
      if(!opened.win){void beginShare();return}
      // A sharing tab that is already open is only brought to the front (never reloaded, which would end its share).
      // This page may have just been refreshed and not heard from it yet, so ask it how it is.
      if(opened.existing){holderState=holderState||{open:true,sharing:false};holderSeen=Date.now();showLinked();tell({type:'ping'});label.textContent='Your sharing tab is already open. Click its tab to see it.';return}
      holderState={open:true,sharing:false};holderSeen=Date.now();showLinked();
    }
    if(channel){
      channel.onmessage=event=>{
        const m=event?.data;
        if(!m||typeof m!=='object'||!id)return;
        if(m.studentId!==id){
          // Another student is now signed in on this computer: the screen in front of the sharing tab is no
          // longer its own student's, so it stops and closes rather than show someone else's work under his name.
          if(persistentShareWindow&&m.type==='ping'&&typeof m.studentId==='string'&&m.studentId)studentStop();
          return;
        }
        if(persistentShareWindow){
          if(m.type==='ping')report();
          else if(m.type==='stop')studentStop();
          else if(m.type==='presenting'&&typeof m.on==='boolean'&&m.on!==sharePaused){sharePaused=m.on;applyPause();setHolderDisplay(stream||active||resumeNeeded?'flex':'none');report()}
          return;
        }
        if(m.type!=='holder')return;
        if(m.open&&lessonOnAir)tell({type:'presenting',on:true});
        const wasSharing=holderState?.sharing===true;
        holderState=m.open?{open:true,sharing:m.sharing===true}:null;holderSeen=Date.now();
        // My screen is no longer shared: take the teacher's marks off this page.
        if(wasSharing&&!holderState?.sharing){
          window.ClassPointerBoards?.clearScreenMarks?.();
          tellTeacherStopped();
        }
        showLinked();
      };
      if(!persistentShareWindow){
        // Ask straight away (a new page should show the banner at once), then keep checking: a sharing
        // tab that was closed without saying goodbye stops counting after a short while.
        tell({type:'ping'});
        const pinger=typeof setInterval==='function'?setInterval(()=>{
          tell({type:'ping'});
          if(holderState?.open)tell({type:'presenting',on:lessonOnAir});
          if(holderState&&Date.now()-holderSeen>15000){const was=holderState.sharing;holderState=null;if(was)window.ClassPointerBoards?.clearScreenMarks?.();showLinked()}
        },5000):null;
        pinger?.unref?.();
      }
    }
    // ---------- Background class connection ----------
    // While the teacher has Classroom Pointer open, a signed-in student is connected to his own class
    // from whichever Fun Torah Tools page he is on, so he shows as joined without pressing anything.
    // The teacher's page admits him only with a fresh server-issued ticket for this class and lesson,
    // gives him no lesson data here, and a deliberate removal by the teacher stops it.
    let presencePeer=null,presenceConn=null,presenceTimer=null,presenceDelay=0,presenceTarget='',presenceFailures=0;
    // The ordinary activity gate stays locked. Only server-admitted teaching
    // surfaces and explicitly permitted share controls can receive interaction.
    window.B3PointerAssignedUI={allowsEvent(target){
      if(!sameStudent())return false;
      if(window.FTTAnnotate?.owns?.(target))return true;
      if(holder.contains?.(target) && ((active && permissionReady && permission.screenSharingDenied!==true) || holderState?.open))return true;
      return admitted && ((lessonActive && lessonOverlay.contains?.(target)) ||
        document.getElementById('fttEmbeddedPointerStage')?.contains?.(target) ||
        document.getElementById('fttReturnPointerBoard')?.contains?.(target) || reopen.contains?.(target));
    }};
    const later=(fn,ms)=>typeof setTimeout==='function'?setTimeout(fn,ms):0,cancelLater=t=>{if(t&&typeof clearTimeout==='function')clearTimeout(t)};
    // A long background wait.
    const quietLater=(fn,ms)=>{const t=later(fn,ms);t?.unref?.();return t};
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
    const back=document.createElement(presentationView?'a':'button');back.type='button';back.textContent='Back to Activity';
    if(presentationView)back.href=new URL('index.html',root).href;
    back.style.cssText='padding:10px 16px;border:0;border-radius:9px;background:white;color:#102748;font:inherit;cursor:pointer';
    const lessonVideo=document.createElement('video');lessonVideo.autoplay=true;lessonVideo.muted=true;lessonVideo.playsInline=true;
    lessonVideo.style.cssText='display:block;position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#071426';
    const reopen=document.createElement('button');reopen.type='button';reopen.id='fttShowTeacherLesson';reopen.textContent='Show Lesson';
    reopen.style.cssText='display:none;position:fixed;left:14px;bottom:14px;z-index:2147483638;padding:12px 18px;border:2px solid white;border-radius:12px;background:#1d4ed8;color:white;font:700 16px system-ui;cursor:pointer';
    // The embedded activity presence view must have its own tools: the retired Pointer page is never opened.
    const drawTools=document.createElement('div');drawTools.id='fttLessonDrawTools';
    drawTools.style.cssText='display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;max-width:100%';
    const highlightShapes=[['highlight-rectangle','▧','Highlight rectangle'],['highlight-ellipse','◉','Highlight ellipse']];
    const isHighlightShape=tool=>highlightShapes.some(([id])=>id===tool);
    const lessonModes=[['select','🖱️','Select'],['point','☝','Pointer'],['highlight','🖍','Highlight'],['box','▧','Highlight box'],['pen','✎','Pen'],['line','━','Line'],['pen-arrow','➜','Arrow'],['rectangle','▭','Rectangle'],['ellipse','◯','Oval'],...highlightShapes,['triangle','△','Triangle'],['text','T','Text']];
    const toolButtons=new Map();let lessonLevel='none',lessonTool='point',lessonColor='#57b8ff',lessonSize=.016,lessonMarks={points:{},strokes:[],members:[]},lessonDraft=null;
    let selIds=[],selDrag=null,selPreview=new Map(),selSendAt=0;
    const lessonStage=document.createElement('div');
    lessonStage.style.cssText='position:relative;flex:1;min-height:0;overflow:hidden;touch-action:auto';
    const markLayer=typeof document.createElementNS==='function'?document.createElementNS('http://www.w3.org/2000/svg','svg'):document.createElement('svg');
    markLayer.style.cssText='position:absolute;pointer-events:none;overflow:hidden';
    markLayer.setAttribute('viewBox','0 0 1000 1000');
    markLayer.setAttribute('preserveAspectRatio','none');
    const pointerLayer=document.createElement('div');
    pointerLayer.style.cssText='position:absolute;pointer-events:none';
    const hitLayer=document.createElement('div');
    hitLayer.style.cssText='position:absolute;cursor:crosshair;touch-action:none';
    const viewOnly=document.createElement('span');viewOnly.textContent='View only';viewOnly.style.cssText='font-size:13px;opacity:.85';
    const undo=document.createElement('button');undo.type='button';undo.textContent='↶ Undo';undo.style.cssText='padding:7px 10px;border-radius:8px;border:1px solid #86a6df;background:#193b6c;color:white;cursor:pointer';
    const allowedMode=mode=>mode==='point'?lessonLevel!=='none':lessonLevel==='pen'||lessonLevel==='highlight'&&(['select','highlight','box'].includes(mode)||isHighlightShape(mode));
    function redrawToolbar(){
      // The same permission also decides whether the drawing toolbar shows while this student shares their screen.
      window.FTTAnnotate?.setStudentLevel?.(lessonLevel);
      if(!allowedMode(lessonTool))lessonTool=lessonLevel==='none'?'point':lessonLevel==='highlight'?'highlight':lessonLevel==='pen'?'pen':'point';
      for(const [mode,button] of toolButtons){button.hidden=!allowedMode(mode);button.setAttribute('aria-pressed',String(mode===lessonTool));button.style.background=mode===lessonTool?'#fef08a':'#193b6c';button.style.color=mode===lessonTool?'#102748':'white';button.style.borderColor=mode===lessonTool?'#facc15':'#86a6df'}
      viewOnly.textContent=lessonLevel==='none'?'👀 Watch only':lessonLevel==='point'?'You may point':lessonLevel==='highlight'?'You may point and highlight':'You may point, highlight and write';
      viewOnly.title=lessonLevel==='none'?'Your teacher has not turned on pointing or drawing for you.':'Pick a tool, then use it on the lesson. Everyone sees it.';
      undo.hidden=lessonLevel==='none';clear.hidden=lessonLevel==='none';for(const button of [...colorButtons,...sizeButtons])button.disabled=lessonLevel==='none';colorSelect.style.display=sizeSelect.style.display=lessonLevel==='none'?'none':'flex';
      hitLayer.style.pointerEvents=lessonLevel==='none'?'none':'auto';
      if(lessonTool!=='text')finishTextEditor(true);
      if(lessonTool!=='select'){selIds=[];selDrag=null;selPreview=new Map()}
      textOptions.style.display=lessonLevel!=='none'&&lessonTool==='text'&&allowedMode('text')?'flex':'none';
    }
    for(const [mode,symbol,name] of lessonModes){
      // Icon plus a visible name, so a student never has to guess what a tool does.
      const button=document.createElement('button');button.type='button';button.title=name;button.setAttribute('aria-label',name);
      const icon=document.createElement('span');icon.textContent=symbol;icon.setAttribute('aria-hidden','true');icon.style.cssText='display:block;font:900 22px/1 system-ui';
      const caption=document.createElement('span');caption.textContent=name.replace('Highlight box','Box');caption.setAttribute('aria-hidden','true');caption.style.cssText='display:block;margin-top:2px;font:700 10px/1.1 system-ui;white-space:nowrap';
      button.append(icon,caption);
      button.style.cssText='min-width:52px;height:50px;padding:3px 5px;border-radius:12px;border:3px solid #86a6df;background:#193b6c;color:white;cursor:pointer;line-height:1;touch-action:manipulation';
      button.addEventListener('click',()=>{const enteringHighlightShape=isHighlightShape(mode)&&!isHighlightShape(lessonTool);lessonTool=mode;if(enteringHighlightShape)selectColor(highlightColor);redrawToolbar()});drawTools.append(button);toolButtons.set(mode,button);
    }
    undo.addEventListener('click',()=>{if(admitted&&presenceConn?.open&&allowedMode(lessonTool))presenceConn.send({type:'edit-highlights',action:'undo'})});
    const colors=[['#57b8ff','Sky blue'],['#ffcc00','Yellow'],['#ff7979','Coral'],['#75df9a','Green'],['#dca0ff','Purple'],['#ffa65c','Orange'],['#7ce4dc','Teal'],['#1f2937','Black'],['#1d4ed8','Blue ink']];
    const colorSelect=document.createElement('div');colorSelect.setAttribute('role','group');colorSelect.setAttribute('aria-label','Choose drawing color');
    colorSelect.style.cssText='display:flex;gap:7px;flex-wrap:wrap;align-items:center;justify-content:center';
    const colorButtons=[];
    let highlightColor='#ffcc00';
    const selectColor=color=>{lessonColor=color;if(isHighlightShape(lessonTool))highlightColor=color;if(lessonTool==='select')recolorSelection(color);for(const b of colorButtons){const on=b.dataset.color===color;b.setAttribute('aria-pressed',String(on));b.style.border=on?'4px solid #fff':'3px solid #55739c';b.style.outline=on?'3px solid #facc15':'none';b.style.transform=on?'scale(1.09)':'none'}};
    for(const [color,name] of colors){const b=document.createElement('button');b.type='button';b.dataset.color=color;b.title=name;b.setAttribute('aria-label',name);b.style.cssText='width:39px;height:39px;border-radius:50%;background:'+color+';cursor:pointer;touch-action:manipulation;flex:none';b.addEventListener('click',()=>selectColor(color));colorButtons.push(b);colorSelect.append(b)}
    const sizeSelect=document.createElement('div');sizeSelect.setAttribute('role','group');sizeSelect.setAttribute('aria-label','Choose line thickness');sizeSelect.style.cssText='display:flex;gap:6px;align-items:center';
    const sizeButtons=[];
    const selectSize=value=>{lessonSize=value;for(const b of sizeButtons){const on=Number(b.dataset.size)===value;b.setAttribute('aria-pressed',String(on));b.style.background=on?'#fef08a':'#193b6c';b.style.borderColor=on?'#facc15':'#86a6df'}};
    for(const [size,name,thickness] of [[.008,'Thin',2],[.016,'Medium',5],[.028,'Thick',9]]){const b=document.createElement('button');b.type='button';b.dataset.size=String(size);b.title=name;b.setAttribute('aria-label',name+' line');b.style.cssText='width:47px;height:47px;display:flex;align-items:center;justify-content:center;border:3px solid #86a6df;border-radius:11px;background:#193b6c;cursor:pointer;touch-action:manipulation';const line=document.createElement('span');line.style.cssText='width:28px;height:'+thickness+'px;border-radius:10px;background:#fff';b.append(line);b.addEventListener('click',()=>selectSize(size));sizeButtons.push(b);sizeSelect.append(b)}
    undo.textContent='↶ Undo';undo.title='Undo my last drawing';undo.setAttribute('aria-label','Undo my last drawing');
    const clear=document.createElement('button');clear.type='button';clear.textContent='🧽 Clear mine';clear.title='Clear only my drawings';clear.setAttribute('aria-label','Clear only my drawings');
    for(const b of [undo,clear])b.style.cssText='height:47px;padding:0 10px;border:3px solid #86a6df;border-radius:11px;background:#193b6c;color:white;font:800 15px system-ui;white-space:nowrap;cursor:pointer;touch-action:manipulation';
    clear.addEventListener('click',()=>{if(admitted&&lessonActive&&presenceConn?.open&&lessonLevel!=='none')presenceConn.send({type:'edit-highlights',action:'clear'})});
    const bottomRow=document.createElement('div');bottomRow.style.cssText='display:flex;gap:8px;align-items:center;justify-content:center';
    bottomRow.append(sizeSelect,undo,clear);
    selectColor(lessonColor);selectSize(lessonSize);

    // Size (A-, a number box for any size from 10 to 200, A+) and bold (B), shown while the Text tool is chosen.
    let textLabel=24,textBold=false,textEditor=null;
    const textOptions=document.createElement('div');textOptions.setAttribute('role','group');textOptions.setAttribute('aria-label','Text size and bold');
    textOptions.style.cssText='display:none;gap:6px;align-items:center;justify-content:center;color:#dbeafe;font:700 14px system-ui';
    const textButton=(label,title,onClick)=>{
      const b=document.createElement('button');b.type='button';b.textContent=label;b.title=title;b.setAttribute('aria-label',title);
      b.style.cssText='min-width:44px;height:44px;padding:0 10px;border:3px solid #86a6df;border-radius:11px;background:#193b6c;color:white;font:800 18px system-ui;cursor:pointer;touch-action:manipulation';
      // Pressing these must not take the typing cursor out of the words.
      b.addEventListener('mousedown',event=>event.preventDefault());b.addEventListener('click',onClick);return b;
    };
    const textSizeBox=document.createElement('input');textSizeBox.type='number';textSizeBox.min='10';textSizeBox.max='200';textSizeBox.step='1';textSizeBox.inputMode='numeric';textSizeBox.value=String(textLabel);
    textSizeBox.setAttribute('aria-label','Text size in pixels, 10 to 200');textSizeBox.title='Type any size from 10 to 200';
    textSizeBox.style.cssText='width:68px;height:44px;box-sizing:border-box;text-align:center;border:3px solid #86a6df;border-radius:11px;background:#fff;color:#102748;font:800 17px system-ui';
    const boldButton=textButton('B','Bold (Ctrl+B)',()=>setTextBold(!textBold));boldButton.style.fontFamily='Georgia,serif';boldButton.style.fontWeight='900';boldButton.setAttribute('aria-pressed','false');
    function setTextLabel(value){textLabel=Math.max(10,Math.min(200,Math.round(value)));textSizeBox.value=String(textLabel);restyleTextEditor()}
    function stepTextLabel(direction){const next=direction>0?STUDENT_TEXT_STEPS.find(v=>v>textLabel):[...STUDENT_TEXT_STEPS].reverse().find(v=>v<textLabel);if(next)setTextLabel(next)}
    function setTextBold(on){
      textBold=on;boldButton.setAttribute('aria-pressed',String(on));boldButton.style.background=on?'#fef08a':'#193b6c';boldButton.style.color=on?'#102748':'white';restyleTextEditor();
    }
    const applyTypedSize=()=>{const typed=Number(textSizeBox.value);if(textSizeBox.value===''||!Number.isFinite(typed)){textSizeBox.value=String(textLabel);return}setTextLabel(typed)};
    textSizeBox.addEventListener('change',applyTypedSize);
    textSizeBox.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Enter'){event.preventDefault();applyTypedSize();textEditor?.box.focus()}});
    textOptions.append(textButton('A−','Smaller letters',()=>stepTextLabel(-1)),textSizeBox,textButton('A+','Bigger letters',()=>stepTextLabel(1)),boldButton);
    // The typing box: on the board where the student clicked, the size the words will have.
    function restyleTextEditor(){
      if(!textEditor)return;const b=picture(),box=textEditor.box;
      box.style.fontSize=(studentTextSize(textLabel)*2.4*b.width)+'px';box.style.fontWeight=textBold?'700':'400';
      box.style.height='auto';box.style.height=box.scrollHeight+'px';
    }
    function startTextEditor(p){
      finishTextEditor(true);
      const b=picture();if(!b.width||!b.height)return;
      // The box stays on the board: the picture can be wider or taller than the board, and words past its edge would be cut.
      const fit=lessonMarks.boardBox,right=fit&&fit.w>.2?Math.min(.96,fit.w-.02):.96,bottom=fit&&fit.h>.2?Math.min(1,fit.h):1;
      const left=Math.max(0,Math.min(p.x,right-.25)),maxW=right-left,step=studentTextSize(textLabel)*1.25*2.4*(b.width/b.height),top=Math.max(0,Math.min(bottom-step,p.y-step/2));
      const box=document.createElement('textarea');box.rows=1;box.maxLength=600;box.dir='auto';box.spellcheck=false;
      box.setAttribute('aria-label','Type your words. Click anywhere else when you are done. Escape cancels.');
      box.style.cssText='position:absolute;box-sizing:border-box;margin:0;padding:0 2px;resize:none;overflow:hidden;border:2px dashed #38bdf8;background:#ffffffd9;font-family:sans-serif;line-height:1.25;outline:none;z-index:3';
      Object.assign(box.style,{left:(b.left+left*b.width)+'px',top:(b.top+top*b.height)+'px',width:(maxW*b.width)+'px',color:lessonColor});
      textEditor={box,left,maxW,top,bottom};
      lessonStage.append(box);restyleTextEditor();box.focus();
      box.addEventListener('input',restyleTextEditor);
      box.addEventListener('keydown',event=>{
        event.stopPropagation();
        if(event.key==='Escape'){event.preventDefault();finishTextEditor(false)}
        else if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();finishTextEditor(true)}
        else if((event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&String(event.key).toLowerCase()==='b'){event.preventDefault();setTextBold(!textBold)}
      });
      for(const type of ['keyup','paste','pointerdown','click','dblclick'])box.addEventListener(type,event=>event.stopPropagation());
      // Going to the size or bold buttons keeps the words open; anywhere else keeps what was typed.
      box.addEventListener('blur',event=>{if(event.relatedTarget&&textOptions.contains(event.relatedTarget))return;finishTextEditor(true)});
    }
    function finishTextEditor(save){
      const open=textEditor;if(!open)return;textEditor=null;
      const text=open.box.value;open.box.remove();
      if(!save||!text.trim()||!admitted||!lessonActive||!presenceConn?.open||!allowedMode('text'))return;
      const b=picture(),block='b'+Date.now().toString(36)+Math.floor(Math.random()*1296).toString(36);
      const made=studentTextStrokes({text,label:textLabel,bold:textBold,color:lessonColor,block,top:open.top,bottom:open.bottom,left:open.left,maxW:open.maxW,aspect:b.width/Math.max(1,b.height),measure:measureStudentText});
      for(const stroke of made.strokes)presenceConn.send({type:'highlight',stroke});
    }
    drawTools.append(colorSelect,textOptions,bottomRow,viewOnly);
        const ns='http://www.w3.org/2000/svg',svg=(name,attrs)=>{const el=typeof document.createElementNS==='function'?document.createElementNS(ns,name):document.createElement(name);for(const [key,value] of Object.entries(attrs))el.setAttribute(key,String(value));return el};
    function picture(){
      const rect=typeof lessonStage.getBoundingClientRect==='function'?lessonStage.getBoundingClientRect():{width:0,height:0},width=lessonVideo.videoWidth,height=lessonVideo.videoHeight;
      if(!width||!height||!rect.width||!rect.height)return{left:0,top:0,width:rect.width,height:rect.height};
      const scale=Math.min(rect.width/width,rect.height/height),w=width*scale,h=height*scale;
      return{left:(rect.width-w)/2,top:(rect.height-h)/2,width:w,height:h};
    }

    // ---------- Words a student types on the board ----------
    // The student clicks where the words go and types right there, like the teacher. Each line of the words is one text mark
    // (the lines share a block id; a line that only wrapped is "soft"), sized as a fraction of the picture's width, 2.4 times
    // the mark size, exactly as the teacher's board draws words. The teacher's page sees each mark as it is sent.
    function wrapStudentText(paragraph,widthOf,fit){
      const out=[];let line='';
      for(const part of paragraph.split(/(\s+)/)){
        if(!part)continue;
        const next=line+part;
        if(widthOf(next.replace(/\s+$/,''))<=fit&&next.length<=200){line=next;continue}
        if(line.trim())out.push(line.replace(/\s+$/,''));
        line='';
        if(!part.trim())continue;
        // One word wider than the box: break it between letters.
        for(const letter of Array.from(part)){if(line&&(widthOf(line+letter)>fit||line.length>=200)){out.push(line);line=''}line+=letter}
      }
      if(line.trim())out.push(line.replace(/\s+$/,''));
      return out;
    }
    // o: text, label (size in pixels on a board 1280 wide), bold, color, block, top and left (where the box starts), maxW (its
    // width), aspect (picture width / height) and measure(line,bold) (width of a line at a 100px font). All positions are
    // fractions of the picture. Returns {strokes,cut,size}.
    function studentTextStrokes(o){
      const round=value=>Math.round(value*1e4)/1e4;
      const size=round(Math.max(.003,Math.min(.08,o.label/(2.4*1280)))),step=size*1.25*2.4*o.aspect;
      const rtl=/[\u0590-\u08ff]/.test(o.text),right=Math.min(.96,o.left+o.maxW),fit=Math.max(.05,o.maxW-.008);
      const widthOf=line=>o.measure(line,o.bold)/100*size*2.4;
      const lines=[];
      for(const paragraph of String(o.text).replace(/\r/g,'').split('\n')){
        let first=true;
        for(const line of wrapStudentText(paragraph,widthOf,fit)){if(!line.trim())continue;lines.push({text:line,soft:!first});first=false}
      }
      const maxLines=Math.max(1,Math.floor(((o.bottom==null?1:o.bottom)-o.top)/step+1e-9)),cut=lines.length>maxLines;
      if(cut)lines.length=maxLines;
      const strokes=lines.map((line,index)=>{
        const y=Math.min(1,o.top+index*step),reach=Math.max(.02,Math.min(fit,widthOf(line.text))),start=rtl?right:o.left;
        const out={tool:'text',color:o.color,size,text:line.text.slice(0,240),block:o.block,
          points:[{x:round(start),y:round(y)},{x:round(rtl?Math.max(0,start-reach):Math.min(1,start+reach)),y:round(Math.min(1,y+step))}]};
        if(o.bold)out.bold=true;
        if(line.soft)out.soft=true;
        return out;
      });
      return{strokes,cut,size};
    }
    const STUDENT_TEXT_STEPS=[10,12,14,16,18,20,24,28,32,40,48,64,80,96,120,144,200];
    const studentTextSize=label=>Math.round(Math.max(.003,Math.min(.08,label/(2.4*1280)))*1e4)/1e4;
    let studentMeasure=null;
    function measureStudentText(line,bold){
      if(!studentMeasure)studentMeasure=document.createElement('canvas').getContext('2d');
      studentMeasure.font=(bold?'bold ':'')+'100px sans-serif';
      return studentMeasure.measureText(line).width;
    }

    // ---------- Select (a student's own marks only) ----------
    // Pure helpers: marks are {id,tool,size,points:[{x,y}]} with points as fractions of the picture; w and h are its size in pixels.
    function selectionBox(list){
      const xs=[],ys=[];
      for(const mark of list)for(const point of mark.points){xs.push(point.x);ys.push(point.y)}
      return xs.length?{x1:Math.min(...xs),y1:Math.min(...ys),x2:Math.max(...xs),y2:Math.max(...ys)}:null;
    }
    function segmentDistance(px,py,ax,ay,bx,by){
      const dx=bx-ax,dy=by-ay,len=dx*dx+dy*dy,t=len?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/len)):0;
      return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
    }
    // The top mark under pixel (px,py): lines by their distance, everything else by the box around it.
    function markHit(list,px,py,w,h){
      for(let i=list.length-1;i>=0;i--){
        const mark=list[i],pts=mark.points.map(point=>[point.x*w,point.y*h]);
        if(['pen','highlight','underline','pencil','crayon','line','pen-arrow'].includes(mark.tool)){
          for(let k=0;k<pts.length;k++){const a=pts[k],c=pts[k+1]||a;if(segmentDistance(px,py,a[0],a[1],c[0],c[1])<=10)return mark}
        }else{
          const xs=pts.map(point=>point[0]),ys=pts.map(point=>point[1]);
          if(px>=Math.min(...xs)-6&&px<=Math.max(...xs)+6&&py>=Math.min(...ys)-6&&py<=Math.max(...ys)+6)return mark;
        }
      }
      return null;
    }
    // orig: Map id -> {points,size}. Moved as one piece, held back so none of it leaves the picture.
    function movedMarks(orig,box,dx,dy){
      dx=Math.max(-box.x1,Math.min(1-box.x2,dx));dy=Math.max(-box.y1,Math.min(1-box.y2,dy));
      return new Map([...orig].map(([id,o])=>[id,{points:o.points.map(q=>({x:q.x+dx,y:q.y+dy})),size:o.size}]));
    }
    // A corner dragged to p (fractions): everything scales about the opposite corner. Words scale evenly and change size.
    function resizedMarks(orig,box,handle,p,words){
      const ax=handle[1]==='w'?box.x2:box.x1,ay=handle[0]==='n'?box.y2:box.y1;
      const w0=Math.max(1e-4,box.x2-box.x1),h0=Math.max(1e-4,box.y2-box.y1);
      let kx=Math.abs(p.x-ax)/w0,ky=Math.abs(p.y-ay)/h0;
      if(words)kx=ky=Math.max(kx,ky);
      kx=Math.max(.05,kx);ky=Math.max(.05,ky);
      const pin=v=>Math.max(0,Math.min(1,v));
      return new Map([...orig].map(([id,o])=>[id,{size:words?Math.max(.003,Math.min(.08,o.size*kx)):o.size,
        points:o.points.map(q=>({x:pin(ax+(q.x-ax)*kx),y:pin(ay+(q.y-ay)*ky)}))}]));
    }

    // The student's own marks are the ones the teacher's page filed under this page's connection (see classroom.js).
    const myOwner=()=>presencePeer?.id?'presence:'+presencePeer.id:null;
    const ownMarks=()=>{const me=myOwner();return me?(Array.isArray(lessonMarks.strokes)?lessonMarks.strokes:[]).filter(m=>m&&m.owner===me&&(lessonLevel==='pen'||isHighlightShape(m.tool))&&typeof m.id==='string'&&Array.isArray(m.points)&&m.points.length):[]};
    const previewed=mark=>{const next=selPreview.get(mark.id);return next?{...mark,...next}:mark};
    const NUDGE={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    // Picked marks: words move and change together, every line of the block.
    const selectedMarks=()=>{const wanted=new Set(selIds);return ownMarks().filter(m=>wanted.has(m.id))};
    const groupOf=mark=>mark.tool==='text'&&mark.block?ownMarks().filter(m=>m.tool==='text'&&m.block===mark.block):[mark];
    const markFields=(mark,change)=>({tool:mark.tool,color:change.color||mark.color,size:change.size==null?mark.size:change.size,points:change.points||mark.points,
      ...(mark.tool==='text'?{text:mark.text,...(mark.block?{block:mark.block}:{}),...(mark.soft===true?{soft:true}:{}),...(mark.bold===true?{bold:true}:{})}:{})});
    // One message, only ever about this student's marks: the teacher's page checks the owner again.
    function sendChanges(map,color){
      if(!admitted||!lessonActive||!presenceConn?.open||!allowedMode('select'))return;
      const changes=selectedMarks().slice(0,60).map(mark=>({id:mark.id,stroke:markFields(mark,{...(map&&map.get(mark.id)||{}),...(color?{color}:{})})}));
      if(changes.length)presenceConn.send({type:'edit-highlights',action:'replace',changes});
    }
    function pointerFraction(event){
      const rect=hitLayer.getBoundingClientRect();
      return{x:Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(1,rect.width))),y:Math.max(0,Math.min(1,(event.clientY-rect.top)/Math.max(1,rect.height)))};
    }
    function startSelect(event,point){
      const b=picture(),px=point.x*b.width,py=point.y*b.height,group=selectedMarks().map(previewed),box=group.length?selectionBox(group):null;
      let handle=null;
      if(box)for(const [id,hx,hy] of [['nw',box.x1,box.y1],['ne',box.x2,box.y1],['sw',box.x1,box.y2],['se',box.x2,box.y2]])if(Math.hypot(hx*b.width-px,hy*b.height-py)<=14)handle=id;
      if(!handle){
        const hit=markHit(ownMarks().map(previewed),px,py,b.width,b.height);
        if(hit)selIds=groupOf(hit).map(m=>m.id);
        else if(!(box&&px>=box.x1*b.width-6&&px<=box.x2*b.width+6&&py>=box.y1*b.height-6&&py<=box.y2*b.height+6)){selIds=[];selPreview=new Map();renderLessonMarks();return}
      }
      const picked=selectedMarks();
      selDrag={kind:handle?'resize':'move',handle,start:point,box:selectionBox(picked),words:picked.some(m=>m.tool==='text'),pid:event.pointerId,moved:false,
        orig:new Map(picked.map(m=>[m.id,{points:m.points.map(q=>({x:q.x,y:q.y})),size:m.size}]))};
      try{hitLayer.setPointerCapture(event.pointerId)}catch{}
      renderLessonMarks();
    }
    function moveSelect(event){
      const drag=selDrag;if(!drag||event.pointerId!==drag.pid)return;
      const p=pointerFraction(event),b=picture();
      if(!drag.moved&&Math.hypot((p.x-drag.start.x)*b.width,(p.y-drag.start.y)*b.height)<3)return;
      drag.moved=true;
      selPreview=drag.kind==='move'?movedMarks(drag.orig,drag.box,p.x-drag.start.x,p.y-drag.start.y):resizedMarks(drag.orig,drag.box,drag.handle,p,drag.words);
      // The teacher sees it while it is dragged (a few times a second), and once more when it is let go.
      const now=Date.now();if(now-selSendAt>=90){selSendAt=now;sendChanges(selPreview)}
      renderLessonMarks();
    }
    function endSelect(commit){
      const drag=selDrag;selDrag=null;
      if(drag&&commit&&drag.moved)sendChanges(selPreview);else if(drag&&!commit){selPreview=new Map();renderLessonMarks()}
    }
    function eraseSelection(){
      const ids=selectedMarks().map(m=>m.id);selIds=[];selPreview=new Map();
      if(ids.length&&presenceConn?.open&&allowedMode('select'))presenceConn.send({type:'edit-highlights',action:'erase',ids:ids.slice(0,60)});
      renderLessonMarks();
    }
    function nudgeSelection(direction,px){
      const picked=selectedMarks();if(!picked.length)return;
      const b=picture(),box=selectionBox(picked);if(!b.width||!b.height||!box)return;
      const orig=new Map(picked.map(m=>[m.id,{points:m.points,size:m.size}]));
      selPreview=movedMarks(orig,box,direction[0]*px/b.width,direction[1]*px/b.height);
      sendChanges(selPreview);renderLessonMarks();
    }
    function recolorSelection(color){if(selectedMarks().length)sendChanges(null,color)}
    // The dashed frame and corner handles of the picked marks, in the layer that is not stretched.
    function drawSelection(){
      const picked=selectedMarks().map(previewed),box=picked.length?selectionBox(picked):null;if(!box)return;
      const frame=document.createElement('div');
      frame.style.cssText='position:absolute;box-sizing:border-box;border:2px dashed #2563eb;pointer-events:none;left:calc('+(box.x1*100)+'% - 4px);top:calc('+(box.y1*100)+'% - 4px);width:calc('+((box.x2-box.x1)*100)+'% + 8px);height:calc('+((box.y2-box.y1)*100)+'% + 8px)';
      pointerLayer.appendChild(frame);
      for(const [x,y] of [[box.x1,box.y1],[box.x2,box.y1],[box.x1,box.y2],[box.x2,box.y2]]){
        const knob=document.createElement('div');
        knob.style.cssText='position:absolute;width:12px;height:12px;box-sizing:border-box;background:#fff;border:2px solid #2563eb;pointer-events:none;transform:translate(-50%,-50%);left:'+(x*100)+'%;top:'+(y*100)+'%';
        pointerLayer.appendChild(knob);
      }
    }
    if(typeof document.addEventListener==='function')document.addEventListener('keydown',event=>{
      if(lessonTool!=='select'||!selIds.length||!admitted||!lessonActive)return;
      if(event.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
      if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();event.stopPropagation();eraseSelection();return}
      if(event.key==='Escape'){selIds=[];selPreview=new Map();renderLessonMarks();return}
      const direction=NUDGE[event.key];
      if(!direction||event.ctrlKey||event.metaKey||event.altKey)return;
      event.preventDefault();event.stopPropagation();nudgeSelection(direction,event.shiftKey?10:1);
    },true);
    function renderLessonMarks(){
      if(typeof markLayer.replaceChildren!=='function'||typeof pointerLayer.replaceChildren!=='function')return;
      const b=picture(),textRatio=b.width/Math.max(1,b.height);
      for(const layer of [markLayer,pointerLayer,hitLayer])Object.assign(layer.style,{left:b.left+'px',top:b.top+'px',width:b.width+'px',height:b.height+'px'});
      markLayer.replaceChildren();pointerLayer.replaceChildren();
      for(const stroke of [...(Array.isArray(lessonMarks.strokes)?lessonMarks.strokes:[]).map(previewed),...(lessonDraft?[lessonDraft]:[])]){
        if(!stroke||!Array.isArray(stroke.points)||!stroke.points.length||stroke.points.length>256)continue;
        // The whiteboard picture already has every word painted in. Drawing them again made each word show twice.
        if(stroke.tool==='text'&&lessonMarks.marksInVideo===true)continue;
        // A mark partly outside the teacher's view keeps its off-view points (the layer clips them); dropping them
        // bent the shape or hid the whole mark.
        const points=stroke.points.filter(p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y)&&Math.abs(p.x)<=8&&Math.abs(p.y)<=8);
        if(!points.length)continue;
        const color=/^#[0-9a-fA-F]{6}$/.test(stroke.color)?stroke.color:'#57b8ff';
        const highlightShape=isHighlightShape(stroke.tool);
        if(highlightShape&&lessonMarks.marksInVideo===true&&stroke!==lessonDraft&&!selPreview.has(stroke.id))continue;
        const alpha=highlightShape?.35:['highlight','box'].includes(stroke.tool)?.4:1,width=Math.max(2,Math.min(30,(Number(stroke.size)||.016)*450));
        const a=points[0],b=points[points.length-1],x1=a.x*1000,y1=a.y*1000,x2=b.x*1000,y2=b.y*1000;
        const x=Math.min(x1,x2),y=Math.min(y1,y2),w=Math.abs(x2-x1),h=Math.abs(y2-y1);
        const attrs={stroke:color,'stroke-width':width,'stroke-linecap':'round','stroke-linejoin':'round',fill:stroke.fill===true&&['rectangle','ellipse','triangle'].includes(stroke.tool)?color:'none',opacity:alpha};
        if(highlightShape)Object.assign(attrs,{fill:color,stroke:'none'});
        let mark;
        if(stroke.tool==='box')mark=svg('rect',{x,y,width:w,height:h,fill:color,opacity:alpha});
        else if(stroke.tool==='rectangle'||stroke.tool==='highlight-rectangle')mark=svg('rect',{x,y,width:w,height:h,...attrs});
        else if(stroke.tool==='ellipse'||stroke.tool==='highlight-ellipse')mark=svg('ellipse',{cx:x+w/2,cy:y+h/2,rx:w/2,ry:h/2,...attrs});
        else if(stroke.tool==='triangle')mark=svg('polygon',{points:`${x+w/2},${y} ${x+w},${y+h} ${x},${y+h}`,...attrs});
        else if(stroke.tool==='line')mark=svg('line',{x1,y1,x2,y2,...attrs});
        else if(stroke.tool==='pen-arrow'){mark=svg('g',{});mark.append(svg('line',{x1,y1,x2,y2,...attrs}));const angle=Math.atan2(y2-y1,x2-x1),radius=Math.max(width*3,10);mark.append(svg('path',{d:`M${x2-radius*Math.cos(angle-.5)} ${y2-radius*Math.sin(angle-.5)} L${x2} ${y2} L${x2-radius*Math.cos(angle+.5)} ${y2-radius*Math.sin(angle+.5)}`,...attrs}));}
        // Words are drawn at the teacher's size: 2.4 times the mark size, as a fraction of the board width.
        // This layer is 1000 x 1000 stretched over the picture, so the text is scaled back up by the
        // picture's width/height to keep its letters undistorted.
        else if(stroke.tool==='text'){mark=svg('text',{x:0,y:0,'font-family':window.ClassPointerCore?.fontStack?.(stroke.font)||'sans-serif',...(stroke.bold?{'font-weight':'700'}:{}),transform:`translate(${x1} ${y1}) scale(1 ${textRatio})`,'font-size':Math.max(4,(Number(stroke.size)||.016)*1000*2.4),fill:color,'dominant-baseline':'hanging',direction:/[\u0590-\u08ff]/.test(stroke.text||'')?'rtl':'ltr'});mark.textContent=stroke.text||'';}
        else {const drawn=stroke.tool==='underline'?[a,{x:b.x,y:a.y}]:points;mark=svg('path',{d:drawn.map((p,i)=>(i?'L':'M')+(p.x*1000)+' '+(p.y*1000)).join(' '),...attrs})}
        markLayer.appendChild(mark);
      }
      for(const [id,point] of Object.entries(lessonMarks.points||{})){
        if(!Number.isFinite(point?.x)||!Number.isFinite(point?.y)||point.x<0||point.x>1||point.y<0||point.y>1)continue;
        const who=id==='teacher'?{name:'Teacher',color:'#ffcc00'}:(lessonMarks.members||[]).find(m=>m.id===id);
        const color=/^#[0-9a-fA-F]{6}$/.test(point.color||'')?point.color:/^#[0-9a-fA-F]{6}$/.test(who?.color||'')?who.color:'#ffcc00';
        const tag=document.createElement('span');tag.title=who?.name||'Pointer';
        tag.style.cssText='position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;pointer-events:none';
        const dot=document.createElement('span');dot.textContent='●';dot.style.cssText='color:'+color+';font:900 26px/1 system-ui;text-shadow:0 1px 4px #000';
        const name=document.createElement('span');name.textContent=String(who?.name||'').slice(0,32);
        name.style.cssText='margin-top:2px;padding:1px 6px;border-radius:6px;background:#0f172acc;color:#fff;font:700 12px system-ui;white-space:nowrap';
        tag.append(dot);if(name.textContent)tag.append(name);
        tag.style.left=(point.x*100)+'%';tag.style.top=(point.y*100)+'%';pointerLayer.appendChild(tag);
      }
      drawSelection();
    }
    const normalized=e=>{const rect=hitLayer.getBoundingClientRect();const x=(e.clientX-rect.left)/rect.width,y=(e.clientY-rect.top)/rect.height;return Number.isFinite(x)&&Number.isFinite(y)&&x>=0&&x<=1&&y>=0&&y<=1?{x,y}:null};
    let lastPointSend=0;
    hitLayer.addEventListener('pointerdown',e=>{
      if(!admitted||!lessonActive||!allowedMode(lessonTool)||e.button!==0)return;
      const p=normalized(e);if(!p)return;e.preventDefault();
      if(lessonTool==='point'){presenceConn?.send({type:'point',point:{...p,tool:'target'}});return}
      if(lessonTool==='text'){startTextEditor(p);return}
      if(lessonTool==='select'){startSelect(e,p);return}
      lessonDraft={tool:lessonTool,color:lessonColor,size:lessonSize,points:[p,p]};
      try{hitLayer.setPointerCapture(e.pointerId)}catch{}renderLessonMarks();
    });
    hitLayer.addEventListener('pointermove',e=>{
      if(!admitted||!lessonActive||!allowedMode(lessonTool))return;
      if(lessonTool==='select'){moveSelect(e);return}
      const p=normalized(e);if(!p)return;
      if(lessonTool==='point'){if(Date.now()-lastPointSend>=75){lastPointSend=Date.now();presenceConn?.send({type:'point',point:{...p,tool:'target'}})}return}
      if(!lessonDraft)return;
      const pts=lessonDraft.points,last=pts[pts.length-1];
      if(!['pen','highlight'].includes(lessonDraft.tool)){lessonDraft.points=[pts[0],p];renderLessonMarks()}else if(pts.length<256&&Math.hypot(p.x-last.x,p.y-last.y)>.003){pts.push(p);renderLessonMarks()}
    });
    function finishDrawing(e){
      if(lessonTool==='select'){endSelect(true);return}
      if(!lessonDraft)return;
      const stroke=lessonDraft;lessonDraft=null;renderLessonMarks();
      if(admitted&&lessonActive&&allowedMode(stroke.tool)&&presenceConn?.open&&stroke.points.length>=2)presenceConn.send({type:'highlight',stroke});
    }
    hitLayer.addEventListener('pointerup',finishDrawing);
    hitLayer.addEventListener('pointercancel',()=>{if(lessonTool==='select'){endSelect(false);return}lessonDraft=null;renderLessonMarks()});
    hitLayer.addEventListener('pointerleave',()=>{if(lessonTool==='point'&&presenceConn?.open)presenceConn.send({type:'pointer-hide'})});
    lessonVideo.addEventListener('loadedmetadata',renderLessonMarks);
    if(typeof ResizeObserver==='function')new ResizeObserver(renderLessonMarks).observe(lessonStage);
    lessonToolbar.append(lessonStatus,drawTools,back);
    // A plain dark window is what students called "a black or blue screen": the window was open but there was no picture in it
    // (the teacher stopped, switched or closed, or the picture never arrived). Whenever there is no live picture this panel says so.
    const lessonWait=document.createElement('div');lessonWait.id='fttLessonWaiting';lessonWait.setAttribute('role','status');
    lessonWait.style.cssText='position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:24px;background:#071426;color:white;pointer-events:none';
    const lessonWaitTitle=document.createElement('strong');lessonWaitTitle.style.cssText='font:800 30px system-ui,sans-serif';
    const lessonWaitNote=document.createElement('span');lessonWaitNote.style.cssText='font:600 17px/1.4 system-ui,sans-serif;opacity:.88;max-width:460px';
    lessonWait.append(lessonWaitTitle,lessonWaitNote);
    lessonStage.append(lessonVideo,lessonWait,markLayer,pointerLayer,hitLayer);
    lessonOverlay.append(lessonToolbar,lessonStage);document.body.appendChild(lessonOverlay);document.body.appendChild(reopen);
    redrawToolbar();
    function followingPresentation(){return presentationView && !!window.FTTFollowStudent?.activityPolicy('class-pointer');}
    function refreshPresentationLock(){
      back.hidden=followingPresentation();
      back.textContent=presentationView?'Back to Fun Torah Tools':'Back to Activity';
      if(followingPresentation() && lessonActive){lessonOverlay.style.display='flex';reopen.style.display='none'}
    }
    window.addEventListener('ftt:follow-activity-changed',refreshPresentationLock);
    window.addEventListener('ftt:follow-policy-changed',refreshPresentationLock);
    back.addEventListener('click',event=>{
      if(followingPresentation()){event.preventDefault();return}
      if(presentationView)return;
      userClosed=true;lessonOverlay.style.display='none';reopen.style.display=lessonActive?'block':'none';
    });
    reopen.addEventListener('click',()=>{if(lessonActive){userClosed=false;lessonOverlay.style.display='flex';reopen.style.display='none';watchWaiting();lessonVideo.play?.().catch(()=>{})}});
    function closeLessonCall(){cancelLater(lessonReceiveTimer);lessonReceiveTimer=null;const old=lessonCall;lessonCall=null;try{old?.close()}catch{}lessonVideo.srcObject=null;syncWaiting()}
    // ---------- What the student sees when there is no picture, and the connection sign ----------
    let connState='ok',rtt=0,lastPong=0,pingTimer=null,waitTimer=null,connPill=null;
    let overlayShownAt=0,playBlocked=false,userClosed=false;   // userClosed: the student pressed Back to Activity himself
    // Read only, for checking the sign from a test or the console.
    window.FTTConnectionSign={state:()=>({sign:connState,rtt,sinceLastAnswerMs:Date.now()-lastPong})};
    function liveVideo(){
      const stream=lessonVideo.srcObject,track=stream&&stream.getVideoTracks?stream.getVideoTracks()[0]:null;
      return !!track&&track.readyState==='live'&&lessonVideo.readyState>=2&&!lessonVideo.paused;
    }
    // The lesson window is shown only while there is a picture to show. It never sits there dark and empty with only the other
    // students' pointer dots: with no picture the dots are hidden too, and after a few seconds the window closes completely, so the
    // student sees their own page. When a picture arrives it opens again by itself.
    const NO_PICTURE_CLOSE_MS=8000;
    function showLayers(on){const v=on?'':'none';markLayer.style.display=v;pointerLayer.style.display=v;hitLayer.style.display=v}
    function tryPlay(){
      try{const p=lessonVideo.play&&lessonVideo.play();if(p&&p.catch)p.catch(error=>{if(error&&error.name==='NotAllowedError'){playBlocked=true;syncWaiting()}/* anything else: a newer picture replaced this one, which plays by itself */})}catch(_){}
    }
    function syncWaiting(){
      if(lessonOverlay.style.display==='none'){overlayShownAt=0;return}
      if(!overlayShownAt)overlayShownAt=Date.now();
      if(liveVideo()){lessonWait.style.display='none';lessonWait.style.pointerEvents='none';showLayers(true);return}
      showLayers(false);
      lessonWait.style.display='flex';
      // The browser refused to start the picture by itself (rare): one tap anywhere starts it, and the whole screen says so.
      if(lessonVideo.srcObject&&playBlocked&&lessonVideo.paused){
        lessonWait.style.pointerEvents='auto';
        lessonWaitTitle.textContent='Tap to show your teacher’s lesson';
        lessonWaitNote.textContent='Your browser needs one tap to start the picture. Tap anywhere on this screen.';
        return;
      }
      lessonWait.style.pointerEvents='none';
      const lost=connState==='reconnecting';
      lessonWaitTitle.textContent=lost?'Reconnecting…':presentationView?'Waiting for your teacher…':'Connecting to your teacher…';
      lessonWaitNote.textContent=lost?'Your connection dropped for a moment. The lesson comes back by itself.':'It will appear here by itself.';
      if(!presentationView&&Date.now()-overlayShownAt>NO_PICTURE_CLOSE_MS){lessonOverlay.style.display='none';reopen.style.display='none';overlayShownAt=0}
    }
    function tickWaiting(){
      if(lessonOverlay.style.display==='none'){waitTimer=null;overlayShownAt=0;return}
      if(lessonVideo.srcObject&&lessonVideo.paused)tryPlay();   // start it for the student; a blocked start is shown by syncWaiting
      syncWaiting();
      waitTimer=later(tickWaiting,1000);
    }
    function watchWaiting(){if(!waitTimer){overlayShownAt=Date.now();waitTimer=later(tickWaiting,1000)}syncWaiting()}
    if(typeof lessonVideo.addEventListener==='function')lessonVideo.addEventListener('playing',()=>{playBlocked=false;syncWaiting()});
    if(typeof lessonWait.addEventListener==='function')lessonWait.addEventListener('click',tryPlay);
    // The first tap or key press anywhere starts a picture the browser would not start by itself.
    if(typeof document.addEventListener==='function')for(const type of ['pointerdown','keydown','touchend'])document.addEventListener(type,()=>{if(lessonVideo.srcObject&&lessonVideo.paused)tryPlay()},true);
    // The sign for a weak or lost connection: on any page, as long as this student is meant to be connected to a lesson.
    function showConn(state){
      if(!connPill){
        connPill=document.createElement('div');connPill.id='fttConnectionSign';connPill.setAttribute('role','status');
        connPill.style.cssText='display:none;position:fixed;left:14px;bottom:14px;z-index:2147483639;padding:9px 14px;border-radius:999px;font:800 15px system-ui,sans-serif;color:white;box-shadow:0 6px 22px #0005;pointer-events:none';
        document.body.appendChild(connPill);
      }
      connState=state;
      connPill.style.display=state==='ok'?'none':'block';
      connPill.style.background=state==='reconnecting'?'#b91c1c':'#b45309';
      connPill.textContent=state==='reconnecting'?'Reconnecting…':'Weak connection';
      syncWaiting();
    }
    // Every 4 seconds the student pings the teacher's page. No answer for 12 seconds, or a closed connection, is "Reconnecting…";
    // a slow answer (over 2 seconds) is a "Weak connection". The teacher sees the same as a dot next to the student's name.
    function stopHeartbeat(){cancelLater(pingTimer);pingTimer=null}
    function startHeartbeat(conn){
      stopHeartbeat();lastPong=Date.now();rtt=0;
      const tick=()=>{
        pingTimer=null;
        if(presenceConn!==conn)return;
        const age=Date.now()-lastPong;
        if(!conn.open||age>12000)showConn('reconnecting');
        else if(rtt>2000||age>7000)showConn('weak');
        else showConn('ok');
        try{if(conn.open)conn.send({type:'ping',t:Date.now(),rtt,weak:connState!=='ok'})}catch{}
        pingTimer=later(tick,4000);
      };
      tick();
    }
    function clearLesson(){
      lessonLevel='none';lessonDraft=null;lessonMarks={points:{},strokes:[],members:[]};redrawToolbar();renderLessonMarks();
      admitted=false;lessonActive=false;setPresenting(false);lessonId='';cancelLater(pendingLessonTimer);cancelLater(lessonRetryTimer);pendingLessonTimer=null;lessonRetryTimer=null;
      const waiting=pendingLessonCall;pendingLessonCall=null;try{waiting?.close()}catch{}closeLessonCall();lessonOverlay.style.display='none';reopen.style.display='none';
    }
    function retryLesson(){
      if(!admitted||!lessonActive||!presenceConn?.open||lessonRetryTimer)return;
      // The picture stopped and did not come back (the teacher stopped showing it, or the connection is poor). Do not sit on
      // "Reconnecting…" forever: say what is going on and let the student go back to work.
      if(lessonRetries>=6){lessonStatus.textContent='Waiting for your teacher… Nothing is showing right now. Press Back to Activity to keep working; the lesson comes back by itself.';return}
      lessonStatus.textContent='Reconnecting to your teacher…';
      lessonRetryTimer=later(()=>{lessonRetryTimer=null;if(admitted&&lessonActive&&presenceConn?.open){lessonRetries++;presenceConn.send({type:'lesson-retry',id:lessonId});lessonReceiveTimer=later(retryLesson,15000)}},1500);
    }
    function acceptLesson(incoming){
      if(!admitted||!lessonActive||incoming.peer!==presenceTarget||incoming.metadata?.presentationId!==lessonId){try{incoming.close()}catch{}return}
      cancelLater(lessonRetryTimer);lessonRetryTimer=null;closeLessonCall();lessonCall=incoming;
      incoming.on('stream',media=>{
        if(lessonCall!==incoming)return;cancelLater(lessonReceiveTimer);lessonReceiveTimer=null;
        lessonVideo.srcObject=media;lessonStatus.textContent='Your teacher’s lesson';tryPlay();
        // A picture is here: the lesson shows by itself (no button to press), unless the student chose Back to Activity.
        if(admitted&&lessonActive&&!userClosed){lessonOverlay.style.display='flex';reopen.style.display='none'}
        for(const type of ['pause','emptied','waiting','stalled'])lessonVideo.addEventListener(type,syncWaiting,{once:true});
        watchWaiting();
        media.getVideoTracks?.().forEach(track=>track.addEventListener('ended',()=>{if(lessonCall===incoming){closeLessonCall();retryLesson()}},{once:true}));
      });
      const lost=()=>{if(lessonCall===incoming){closeLessonCall();retryLesson()}};
      incoming.on('close',lost);incoming.on('error',lost);
      // Receiving needs no camera, microphone or screen capture permission.
      try{incoming.answer();if(!lessonVideo.srcObject)lessonReceiveTimer=later(()=>{if(lessonCall===incoming){closeLessonCall();retryLesson()}},15000)}catch{lost()}
    }
    function incomingLesson(incoming){
      if(!sameStudent()||incoming.peer!==presenceTarget||incoming.metadata?.kind!=='activity-lesson'||typeof incoming.metadata?.presentationId!=='string'||incoming.metadata.presentationId.length>120){try{incoming.close()}catch{}return}
      if(admitted&&lessonActive&&incoming.metadata.presentationId===lessonId){acceptLesson(incoming);return}
      // Signalling may beat the reliable announcement. Never answer before admission.
      try{pendingLessonCall?.close()}catch{}pendingLessonCall=incoming;cancelLater(pendingLessonTimer);
      pendingLessonTimer=later(()=>{if(pendingLessonCall===incoming){pendingLessonCall=null;try{incoming.close()}catch{}}},5000);
    }
    function announceLesson(message){
      refreshPresentationLock();
      if(!admitted||typeof message.id!=='string'||!message.id||message.id.length>120||typeof message.active!=='boolean')return;
      if(!message.active){if(message.id===lessonId){lessonActive=false;setPresenting(false);cancelLater(lessonRetryTimer);lessonRetryTimer=null;cancelLater(pendingLessonTimer);const waiting=pendingLessonCall;pendingLessonCall=null;try{waiting?.close()}catch{}closeLessonCall();lessonOverlay.style.display='none';reopen.style.display='none'}return}
      if(lessonId!==message.id||!lessonActive){closeLessonCall();lessonId=message.id;lessonActive=true;setPresenting(true);userClosed=false;lessonRetries=0;cancelLater(lessonRetryTimer);lessonRetryTimer=null;lessonReceiveTimer=later(retryLesson,15000);lessonStatus.textContent='Connecting to your teacher…';lessonOverlay.style.display='flex';watchWaiting();reopen.style.display='none'}
      if(pendingLessonCall?.metadata?.presentationId===lessonId){const waiting=pendingLessonCall;pendingLessonCall=null;cancelLater(pendingLessonTimer);acceptLesson(waiting)}
    }
    function stopPresence(){
      window.ClassPointerPoll?.reset();
      window.ClassPointerBoards?.reset?.();
      clearLesson();cancelLater(presenceTimer);presenceTimer=null;
      const conn=presenceConn;presenceConn=null;try{conn?.close()}catch{}
      const old=presencePeer;presencePeer=null;try{old?.destroy()}catch{}
      stopHeartbeat();
      // Lost while the lesson is still on: say so. A lesson that really ended (no session) clears the sign.
      showConn(latestSession?'reconnecting':'ok');
    }
    function schedulePresence(ms){cancelLater(presenceTimer);presenceTimer=later(connectPresence,ms)}
    // Give up after repeated failures until the teacher's lesson changes; never retry in a tight loop.
    // Never retry in a tight loop, and never give up for good: a poor connection keeps trying, slowly, while the lesson is on.
    function retryPresence(){if(!latestSession)return;stopPresence();presenceFailures++;presenceDelay=Math.min(presenceFailures>6?30000:60000,(presenceDelay||2000)*2);schedulePresence(presenceDelay)}
    window.addEventListener('online',()=>{if(latestSession&&!presenceConn&&!presenceTimer){presenceDelay=0;schedulePresence(300)}});
    window.addEventListener('offline',()=>{if(latestSession)showConn('reconnecting')});
    function showRemovedNotice(){
      const note=document.createElement('div');note.setAttribute('role','status');
      note.style.cssText='position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483641;padding:12px 18px;border-radius:12px;background:#fff2ef;color:#8a2119;border:1px solid #e4a69e;font:700 15px system-ui,sans-serif;box-shadow:0 6px 24px #0003';
      note.textContent='Your teacher removed you from the class.';document.body.appendChild(note);later(()=>note.remove(),9000);
    }
    async function connectPresence(){
      presenceTimer=null;
      const session=latestSession;
      if(!session||!sameStudent()){stopPresence();return}
      const room=session.roomId;
      if(removedRoom()===room||(presenceConn&&presenceConn.peer===room))return;
      stopPresence();
      try{
        if(!window.Peer)await load(new URL('class-pointer-prototype/vendor/peerjs-1.5.5.min.js',root).href);
        const own=new Peer('class-pointer-student-'+crypto.randomUUID());
        if(typeof own.on!=='function'||typeof own.connect!=='function'){try{own.destroy?.()}catch{}return}
        presencePeer=own;
        own.on('call',incoming=>{if(presencePeer!==own){try{incoming.close()}catch{}return}incomingLesson(incoming)});
        classLink('wait','Connecting to your teacher’s class…');
        try{await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('timeout')),15000);own.once('open',()=>{clearTimeout(t);resolve()});own.once('error',e=>{clearTimeout(t);reject(e)})})}
        catch(e){if(presencePeer===own)classLink('bad','Can’t connect – the classroom connection service could not be reached ('+(e?.type||e?.message||'error')+'). The school network may block it (0.peerjs.com, port 443). Trying again.');throw e}
        if(presencePeer!==own||latestSession?.roomId!==room)return;
        // The teacher's room may not be registered yet (student page opened as the lesson starts):
        // retry with backoff instead of giving up until a reload.
        own.on('error',e=>{if(presencePeer!==own)return;classLink('bad',e?.type==='peer-unavailable'?'Can’t connect – your teacher’s lesson is not reachable yet. Trying again.':'Can’t connect – classroom connection problem ('+(e?.type||'error')+'). Trying again.');retryPresence()});
        own.on('disconnected',()=>{if(presencePeer===own&&!own.destroyed){try{own.reconnect()}catch{}}});
        const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'joinIssue',room,classId,studentId:id,pin,peerId:own.id}),signal:AbortSignal.timeout(15000)});
        const ticket=await response.json().catch(()=>({}));
        if(presencePeer!==own)return;
        // Not in this class or signed out: stop (but say why). Server trouble: try again later.
        if(!response.ok||!ticket.ok){classLink('bad','Can’t connect – '+classLinkWhy(response.status,ticket.error));if(response.status>=400&&response.status<500&&response.status!==429){stopPresence();return}throw Error('ticket')}
        const conn=own.connect(room,{reliable:true});presenceConn=conn;
        conn.on('open',()=>{if(presenceConn===conn){conn.send({type:'join',presence:true,ticket:ticket.token,activity:activityName(),name:ticket.studentName});startHeartbeat(conn)}});
        conn.on('data',message=>{
          if(presenceConn!==conn||!sameStudent()||!message||typeof message!=='object')return;
          if(message.type==='pong'){if(Number.isFinite(message.t)){rtt=Math.max(0,Date.now()-message.t);lastPong=Date.now()}return}
          if(message.type==='poll-state'){if(admitted)window.ClassPointerPoll?.fromTeacher(message);return}
          if(message.type==='present'){admitted=true;presenceDelay=0;presenceFailures=0;classLink('ok','Connected to class (lesson …'+String(room).slice(-4)+')'+(latestSession?.studentScreenSharing===true?' – screen sharing is ON':''));return}
          if(typeof message.type==='string'&&message.type.startsWith('board-')){
            if(admitted)window.ClassPointerBoards?.fromTeacher(message);
            return;
          }
          // The teacher's page refused a mark (too many marks, or not allowed): say so instead of letting it vanish quietly.
          if(message.type==='highlight-error'){
            if(admitted){const before=lessonStatus.textContent;lessonStatus.textContent='That mark could not be added. Try a shorter one, or ask your teacher.';setTimeout(()=>{if(lessonStatus.textContent.startsWith('That mark could not'))lessonStatus.textContent=before},4000)}
            return;
          }
          if(message.type==='lesson-tools'){if(admitted&&['none','point','highlight','pen'].includes(message.level)){const raised=message.level!==lessonLevel&&(message.level==='highlight'||message.level==='pen');lessonLevel=message.level;if(raised)lessonTool=message.level;lessonDraft=null;redrawToolbar();renderLessonMarks()}return}
          if(message.type==='lesson-marks'){if(admitted&&Array.isArray(message.strokes)&&message.strokes.length<=1500){if(!selDrag)selPreview=new Map();lessonMarks={points:message.points||{},strokes:message.strokes,members:Array.isArray(message.members)?message.members:[],marksInVideo:message.marksInVideo===true,boardBox:Number.isFinite(message.boardBox?.w)&&Number.isFinite(message.boardBox?.h)?{w:message.boardBox.w,h:message.boardBox.h}:null};renderLessonMarks()}return}
          if(message.type==='lesson-presentation'){if(!persistentShareWindow)announceLesson(message);return}
          // The teacher pressed Stop viewing on this student's screen: end the share in his sharing tab.
          if(message.type==='share-stop'){if(admitted&&holderState?.open)tell({type:'stop'});return}
          if(message.type==='removed'){try{sessionStorage.setItem('classPointerRemovedRoom',room)}catch{}if(holderState?.open)tell({type:'stop'});stopPresence();classLink('bad','Can’t connect – your teacher removed you from this lesson.');showRemovedNotice();return}
          // Already connected in the lesson or another window, or the lesson ended: check again later.
          if(['elsewhere','replaced','full'].includes(message.type)){classLink('bad',message.type==='full'?'Can’t connect – the class is full right now. Trying again soon.':'Can’t connect – you are already connected to this class in another window or tab.');stopPresence();schedulePresence(60000);return}
          if(message.type==='ended'){classLink('wait','Your teacher ended the lesson.');stopPresence()}
        });
        const lost=()=>{if(presenceConn===conn){presenceConn=null;if(!admitted)classLink('bad','Can’t connect – your teacher’s page did not accept the connection (your teacher may have refreshed). Trying again.');retryPresence()}};
        conn.on('close',lost);conn.on('error',lost);
      }catch{if(latestSession?.roomId===room)retryPresence()}
    }
    function followSession(next){
      // The sharing tab never joins the class itself; the student's own tab does that.
      if(persistentShareWindow)return;
      if(!next){presenceTarget='';presenceDelay=0;stopPresence();return}
      if(next.roomId!==presenceTarget){presenceTarget=next.roomId;presenceDelay=0;presenceFailures=0;schedulePresence(400)}
    }
    window.addEventListener('pagehide',stopPresence);
    // The teacher locked Class Pointer for this class (Locks panel): leave the lesson and stop sharing at once. When it opens
    // again the normal follow of the lesson record starts the connection again (the server also refuses new tickets while locked).
    window.addEventListener('b3lock:class-pointer',event=>{
      if(event?.detail?.locked){
        try{stopPresence()}catch{}
        if(persistentShareWindow)studentStop();else if(stream)stop();
      }else if(lastRows)void onSessions({val:()=>lastRows});
    });
    // Another boy (or another class) signing in on this same page must not leave the old connection
    // running, and must not leave the new boy waiting for a refresh: drop everything that belonged to
    // the old identity, then adopt the new one in place and listen for his class's lesson.
    let switching=false,failedAttempt='';
    async function adoptNewIdentity(){
      if(switching)return;
      switching=true;
      try{
        stopPresence();stop();
        // A different student now uses this browser tab: end the previous student's sharing tab too.
        if(!persistentShareWindow&&holderState?.open)tell({type:'stop'});
        holderState=null;
        cancelLater(permissionRetryTimer);permissionRetryTimer=null;
        try{sessions.off('value',onSessions)}catch{}
        cancelLater(graceTimer);graceTimer=null;cancelLater(resubscribeTimer);resubscribeTimer=null;lastRows=null;
        latestSession=null;active=null;presenceTarget='';presenceDelay=0;presenceFailures=0;
        permissionKey='';permissionRequest++;permission={};permissionReady=false;holder.style.display='none';
        // The "removed from this lesson" note belongs to the previous boy's browser session only.
        try{sessionStorage.removeItem('classPointerRemovedRoom')}catch{}
        // Until a new boy is confirmed, nobody owns this connection (so the same boy signing back in is picked up too).
        id='';
        const nextId=sessionStorage.getItem('b3Games_studentId'),nextPin=sessionStorage.getItem('b3Games_classPin');
        if(!nextId||!nextPin||!(/^[A-Za-z0-9_-]{1,100}$/).test(nextId))return; // signed out: the timer tries again once someone signs in
        const attempt=nextId+':'+nextPin;
        if(attempt===failedAttempt)return;
        failedAttempt=attempt;
        const verified=await fetch(studentAuth,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'verify',studentId:nextId,pin:nextPin})});
        if(!verified.ok||!(await verified.json()).ok)return;
        const nextScope=await window.FunTorahStudentClass.resolve(firebase.database(),nextId);
        if(nextScope.workspaceId!==ws||!/^[A-Za-z0-9_-]{1,100}$/.test(nextScope.classId||''))return;
        // He may have switched again while this was checking.
        if(sessionStorage.getItem('b3Games_studentId')!==nextId)return;
        failedAttempt='';id=nextId;pin=nextPin;classId=nextScope.classId;
        sessions=firebase.database().ref('b3Games/workspaces/'+ws+'/classes/'+classId+'/classPointerSessions');
        sessions.on('value',onSessions,onSessionsError);
      }catch(error){console.warn('Class Pointer could not switch student',error)}
      finally{switching=false}
    }
    const identityTimer=typeof setInterval==='function'?setInterval(()=>{if(!switching&&!sameStudent())void adoptNewIdentity()},1000):null;
    identityTimer?.unref?.();
    window.addEventListener('pagehide',()=>{if(identityTimer)clearInterval(identityTimer)},{once:true});

    // A failed check (school network hiccup, busy server) must never end a share that is running. Only a clear
    // "no" from the school server, or the teacher turning sharing off, does. A failed check is tried again quietly.
    let permissionRetryTimer=null,permissionRetries=0;
    function retryPermission(key){
      cancelLater(permissionRetryTimer);permissionRetryTimer=null;
      if(permissionRetries>=6)return;
      permissionRetryTimer=quietLater(()=>{
        permissionRetryTimer=null;
        if(permissionKey===key&&latestSession)void watchPermission(latestSession,true);
      },Math.min(30000,3000*2**permissionRetries++));
    }
    // Calling the teacher again after a dropped connection (see connectShare).
    const RECALL_DELAYS=[1000,2000,4000,8000,15000,30000,30000,30000];
    let recallTimer=null,recallAttempts=0,watchTimer=null,everLinked=false;
    async function watchPermission(session,again){
      const request=session?.destinationRequest,at=request?.at||session?.shareRequest?.at;
      const hasRequest=(request&&['screens','boards'].includes(request.mode))||(session?.studentScreenSharing===true&&Number.isFinite(at));
      // Sharing enabled without a request: the student may start sharing himself.
      const enabledOnly=!hasRequest&&session?.studentScreenSharing===true;
      if(!hasRequest&&!enabledOnly){permissionKey='';permission={};permissionReady=false;refreshSessionState();return}
      const key=session.roomId+':'+String(session.permissionRevision||'')+':'+(enabledOnly?'enabled':String(at||''));
      if(permissionKey===key&&permissionReady&&again!==true)return;
      if(permissionKey!==key){permissionRetries=0;cancelLater(permissionRetryTimer);permissionRetryTimer=null}
      // Until his own permission is confirmed the button is hidden, so a teacher's change hides it at once.
      // (A share already running is not interrupted while the check is in progress.)
      const keep=permission;permissionKey=key;permission={};permissionReady=false;const current=++permissionRequest;
      // (In the sharing tab the Resume button stays while this is checked, so it never blinks out on a refresh.)
      if(!stream&&!holderState?.open){if(persistentShareWindow)setHolderDisplay(resumeNeeded?'flex':'none');else holder.style.display='none'}else if(stream){permission=keep;permissionReady=true}
      // unsure: no clear answer came back (no internet, time-out, busy or broken server).
      let unsure=false,failedStatus=0,failedText='';
      try{
        let response,result;
        try{
          response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({action:'permissions',studentId:id,pin,classId,room:session.roomId}),signal:AbortSignal.timeout(10000)});
          result=await response.json();
        }catch(error){unsure=true;throw error}
        if(current!==permissionRequest||latestSession?.roomId!==session.roomId||permissionKey!==key)return;
        if(response.ok&&result?.ok){
          permission={screenSharingDenied:result.screenSharingDenied===true,whiteboardDenied:result.whiteboardDenied===true};permissionReady=true;permissionRetries=0;
        }else if(enabledOnly&&response.status===403&&/no active student activity request/i.test(result?.error||'')){
          // The sharing service in use does not answer this question without a request yet; it still
          // refuses a student the teacher turned off when he tries to share.
          permission={};permissionReady=true;
        }else{
          unsure=response.status===429||response.status>=500;
          failedStatus=response.status;failedText=result?.error;
          throw Error(result?.error||'Could not check your sharing permissions.');
        }
      }catch{
        if(current===permissionRequest&&permissionKey===key){
          if(enabledOnly){permission={};permissionReady=true}
          // A share that is running keeps its last known permission; the check is simply tried again.
          else if(unsure&&(stream||holderState?.sharing)){permission=keep;permissionReady=true}
          else{permission={};permissionReady=false;status(unsure?'Checking with your teacher. One moment…':'Could not check sharing permissions. Ask your teacher to resend.');
            if(!unsure)classLink('bad','Screen sharing is ON but you can’t share – '+classLinkWhy(failedStatus,failedText));}
          if(unsure&&!enabledOnly)retryPermission(key);
        }
      }
      refreshSessionState();
    }
    function stop(){
      cancelLater(recallTimer);recallTimer=null;recallAttempts=0;cancelLater(watchTimer);watchTimer=null;everLinked=false;
      const prior=stream;stream=null;try{call?.close()}catch{}call=null;
      // My screen is no longer shared: take the teacher's marks off it.
      if(prior){window.ClassPointerBoards?.clearScreenMarks?.();window.FTTAnnotate?.setReason('sharing',false)}
      try{peer?.destroy()}catch{}peer=null;
      prior?.getTracks().forEach(t=>t.stop());
      // The student's own tab shows what his sharing tab is doing.
      if(!persistentShareWindow){if(prior)tellTeacherStopped();showLinked();return}
      if(!resumeNeeded)clearResume();   // still waiting to resume: keep it, so a second refresh also offers Resume
      styleIdleButton();
      status(IDLE_TEXT);
      fallback.hidden=true;
      if(prior)report();
    }
    function status(text){label.textContent=text;if(persistentShareWindow)label.hidden=!text}
    function refreshSessionState(){
      const next=latestSession;
      settled=true;
      if(!permissionReady){
        const was=stream;active=null;if(was)stop();
        if(!persistentShareWindow){showLinked();return}
        // A lesson that is gone cannot be resumed; otherwise keep the Resume button while the permission is checked.
        if(!latestSession&&resumeNeeded){resumeNeeded=false;clearResume();styleIdleButton()}
        setHolderDisplay(resumeNeeded?'flex':'none');
        if(!was)report();
        return;
      }
      const shareable=next?.studentScreenSharing===true&&permission?.screenSharingDenied!==true?next:null;
      if(!shareable||!active||shareable.roomId!==active.roomId){if(stream)stop()}
      active=shareable;
      if(!persistentShareWindow){showLinked();return}
      // Permission is known and there is nothing to share to (sharing turned off, a "no" for this student): nothing to resume.
      if(resumeNeeded&&!active){resumeNeeded=false;clearResume();styleIdleButton()}
      setHolderDisplay(active||resumeNeeded?'flex':'none');
      report();
      // The sharing tab asks for the screen by itself as soon as it knows sharing is allowed.
      if(active&&!autoTried&&!stream&&!busy&&!sharePaused){autoTried=true;void beginShare()}
    }
    // ---------- Teacher connection drops (issue #801) ----------
    // When the teacher's page loses its database connection, the lesson is stamped teacherOfflineAt
    // instead of being deleted. A short drop must not end every boy's share or hide his button, so the
    // lesson still counts for a grace period. If the teacher has not returned by then, it counts as
    // over: this page stops its own capture and hides the button, exactly as when a lesson ends.
    // When the teacher returns the stamp is cleared and the button comes back without a refresh.
    const TEACHER_GRACE_MS=120000;
    let serverOffset=0,lastRows=null,graceTimer=null,resubscribeTimer=null,resubscribeDelay=0;
    try{firebase.database().ref('.info/serverTimeOffset').on('value',snapshot=>{serverOffset=Number(snapshot.val())||0})}catch{}
    const serverNow=()=>Date.now()+serverOffset;
    const teacherGone=v=>Number.isFinite(v.teacherOfflineAt)&&serverNow()-v.teacherOfflineAt>=TEACHER_GRACE_MS;
    function current(rows){
      return Object.entries(rows||{}).filter(([key,v])=>v&&v.roomId===key&&/^class-pointer-[a-f0-9-]{36}$/.test(key)
        &&Number.isFinite(v.createdAt)&&Date.now()-v.createdAt<14400000&&Date.now()-v.createdAt>=-60000&&!teacherGone(v))
        .sort((a,b)=>b[1].createdAt-a[1].createdAt)[0]?.[1]||null;
    }
    // No database event arrives when the grace period runs out, so look again at that moment.
    function watchGrace(next){
      cancelLater(graceTimer);graceTimer=null;
      if(!next||!Number.isFinite(next.teacherOfflineAt))return;
      const rows=lastRows;
      graceTimer=later(()=>{graceTimer=null;if(lastRows===rows)void onSessions({val:()=>rows})},Math.max(250,next.teacherOfflineAt+TEACHER_GRACE_MS-serverNow()+250));
      graceTimer?.unref?.();
    }
    async function onSessions(snapshot){
      // Student switching must never reuse another boy's classroom invitation.
      if(sessionStorage.getItem('b3Games_studentId')!==id){
        if(stream)stop();
        latestSession=null;active=null;permissionKey='';permissionRequest++;permission={};permissionReady=false;holder.style.display='none';
        followSession(null);
        return;
      }
      resubscribeDelay=0;
      lastRows=snapshot.val();
      const next=current(lastRows);
      watchGrace(next);
      latestSession=next;
      if(!next)classLink('wait',lastRows&&Object.keys(lastRows).length?'No open lesson right now (the last one is old or ended). Waiting for your teacher.':'Waiting for your teacher to open Class Pointer for your class ('+classId+').');
      else if(!admitted)classLink('wait','Found your teacher’s lesson. Connecting…');
      followSession(next);
      if(next)await watchPermission(next);else{permissionKey='';permissionRequest++;permission={};permissionReady=false;refreshSessionState()}
    }
    function onSessionsError(error){
      classLink('bad','Can’t connect – your class’s lesson list could not be read ('+(error?.code||error?.message||'database refused')+'). Please sign in again. Retrying.');
      stopPresence();latestSession=null;permissionKey='';permissionRequest++;permission={};permissionReady=false;active=null;holder.style.display='none';stop();
      // The database cancelled this listener. Without listening again this boy would have no
      // Share My Screen button for the rest of the day, so try again, slowly.
      cancelLater(graceTimer);graceTimer=null;lastRows=null;
      cancelLater(resubscribeTimer);resubscribeDelay=Math.min(60000,(resubscribeDelay||5000)*2);
      const watched=sessions;
      resubscribeTimer=later(()=>{resubscribeTimer=null;if(sessions===watched&&sameStudent())sessions.on('value',onSessions,onSessionsError)},resubscribeDelay);
      resubscribeTimer?.unref?.();
    }
    sessions.on('value',onSessions,onSessionsError);
    // ---------- Keeping a running share connected ----------
    // The picture travels over a direct connection that a school network can drop for a moment. While the
    // screen is still being captured and sharing is still allowed, the sharing tab quietly gets a fresh
    // ticket and calls the teacher again (a few tries, waiting longer each time) instead of ending the share.
    // The tries add up to about two minutes, the same time a lesson survives a teacher who went offline;
    // after that, or as soon as the lesson counts as over, the capture is released.
    function dropCall(){
      cancelLater(watchTimer);watchTimer=null;
      const oldCall=call;call=null;try{oldCall?.close()}catch{}
      const oldPeer=peer;peer=null;try{oldPeer?.destroy()}catch{}
    }
    async function issueTicket(lesson){
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
        error.status=response.status;
        if(response.status===404||response.status>=500)error.code='ACTIVITY_SHARE_NETWORK';
        if(response.status===403&&/turned off your screen sharing/i.test(ticket?.error||''))error.code='ACTIVITY_SHARE_DENIED';
        throw error;
      }
      return ticket;
    }
    // resume: calling again for a share that is already running (the teacher's page keeps the same tile).
    async function connectShare(lesson,captured,resume){
      const usable=()=>active?.roomId===lesson.roomId&&captured.active&&(!resume||stream===captured);
      const ticket=await issueTicket(lesson);
      if(!usable())throw Error('The lesson ended or sharing permission changed.');
      if(!window.Peer)await load(new URL('class-pointer-prototype/vendor/peerjs-1.5.5.min.js',root).href);
      const connection=new Peer('class-pointer-activity-'+crypto.randomUUID());
      peer=connection;
      await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(Error('Connection timed out')),15000);
        connection.once('open',()=>{clearTimeout(timeout);resolve()});
        connection.once('error',e=>{clearTimeout(timeout);reject(e)});
      });
      if(peer!==connection||!usable())throw Error('The lesson ended or sharing permission changed.');
      const media=connection.call(lesson.roomId,captured,{metadata:{kind:'activity-screen',token:ticket.token,...(resume?{resume:true}:{})}});
      if(!media)throw Error('The teacher is not connected.');
      call=media;if(!resume)stream=captured;
      const lost=()=>{if(call===media)connectionLost()};
      media.on('close',lost);media.on('error',lost);
      // The connection service socket may drop while the picture keeps flowing: reconnect it, do not end the share.
      connection.on?.('disconnected',()=>{if(peer===connection&&!connection.destroyed){try{connection.reconnect()}catch{}}});
      // The teacher's page could not be reached at all (its own connection is down for a moment): call again later.
      connection.on?.('error',error=>{if(peer===connection&&error?.type==='peer-unavailable')lost()});
      let linked=false,dropTimer=null;
      const isLinked=()=>['connected','completed'].includes(media.peerConnection?.iceConnectionState);
      media.on('iceStateChanged',state=>{
        if(call!==media)return;
        if(state==='connected'||state==='completed'){
          linked=true;everLinked=true;recallAttempts=0;cancelLater(watchTimer);watchTimer=null;cancelLater(dropTimer);dropTimer=null;
          if(stream===captured)status(sharingText());
        }else if(state==='disconnected'&&!dropTimer){
          // The browser gives up by itself only after a long while. If the picture is still cut off after a
          // few seconds, call again now; the teacher keeps seeing the last picture meanwhile.
          dropTimer=quietLater(()=>{dropTimer=null;if(call===media&&!isLinked())lost()},12000);
        }
      });
      // The call never connected (teacher unreachable or the school network blocked it): try again.
      // (Only where the connection state can be read at all; otherwise a share is never dropped on a guess.)
      watchTimer=quietLater(()=>{watchTimer=null;if(call===media&&media.peerConnection&&!linked&&!isLinked())lost()},25000);
    }
    function connectionLost(){
      if(!stream)return;
      // A brand-new share that never reached the teacher is not retried in the background: say so plainly.
      if(!everLinked){giveUp('Your screen did not reach your teacher. Click Share My Screen to try again.');return}
      dropCall();
      scheduleRecall();
    }
    function giveUp(text){stop();status(text||(persistentShareWindow?'Sharing stopped.':'Sharing stopped. Click Share My Screen to share again, or close this tab.'))}
    function scheduleRecall(){
      if(recallTimer||!stream)return;
      if(!active||!stream.active||!sameStudent()||recallAttempts>=RECALL_DELAYS.length){giveUp();return}
      status('Reconnecting to your teacher…');
      recallTimer=quietLater(async()=>{
        recallTimer=null;
        const captured=stream,lesson=active;
        if(!captured)return;
        if(!lesson||!captured.active||!sameStudent()){giveUp();return}
        recallAttempts++;
        try{await connectShare(lesson,captured,true)}
        catch(error){
          if(stream!==captured)return; // stopped in the meantime
          dropCall();
          // The teacher turned this student off: a clear no. Everything else is tried again.
          if(error?.code==='ACTIVITY_SHARE_DENIED'){giveUp(error.message);permission={...permission,screenSharingDenied:true};refreshSessionState();return}
          if(error?.status===401){giveUp('Please sign in again, then share your screen.');return}
          scheduleRecall();
        }
      },RECALL_DELAYS[recallAttempts]);
    }
    async function beginShare(){
      if(stream){studentStop();return}
      if(sharePaused||lessonOnAir)return;   // the teacher's presentation comes first
      if(!active&&resumeNeeded&&!busy){status('One moment…');return}
      if(busy||!active||!sameStudent())return;
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
        if(!sameStudent()||active?.roomId!==lesson.roomId||!captured.active)throw Error('The lesson ended or sharing permission changed.');
        status('Connecting to teacher…');
        await connectShare(lesson,captured,false);
        captured.getVideoTracks()[0]?.addEventListener('ended',studentStop,{once:true});
        resumeNeeded=false;clearResume();
        styleSharingButton();
        status(sharingText());
        window.FTTAnnotate?.setReason('sharing',true);
      }catch(error){
        captured?.getTracks().forEach(t=>t.stop());
        // A failure must release media/peer resources without erasing the error or reopening a blocking dialog.
        stop();
        const networkFailure=error?.code==='ACTIVITY_SHARE_NETWORK';
        // InvalidStateError: this browser only opens its screen picker after a click in this tab.
        // In the sharing tab the big button is the whole instruction: no sentence for "needs a click" or "cancelled".
        const justClick=persistentShareWindow&&(error?.name==='NotAllowedError'||error?.name==='InvalidStateError');
        status(justClick?'':error?.name==='NotAllowedError'?'Sharing canceled. Click Share My Screen to try again.':error?.name==='InvalidStateError'?'Click Share My Screen to choose your screen.':error.message||'Could not share.');
        if(networkFailure)fallback.hidden=false;
        // The teacher has turned this student off: hide the button until the teacher changes it.
        if(error?.code==='ACTIVITY_SHARE_DENIED'){permission={...permission,screenSharingDenied:true};refreshSessionState()}
      }
      finally{busy=false;btn.disabled=false;report()}
    }
    function shareClick(){
      if(persistentShareWindow){void beginShare();return}
      // This page is sharing by itself (no sharing tab could be opened): the button stops it.
      if(stream){stop();return}
      // In the student's own tab the button opens the sharing tab, or ends it.
      if(holderState?.open){tell({type:'stop'});label.textContent='Stopping…';return}
      openHolder();
    }
    btn.addEventListener('click',shareClick);
    window.addEventListener('pagehide',()=>{
      // Changing pages in the student's own tab never stops the sharing tab.
      const wasSharing=!!stream;
      stop();
      // This sharing tab itself is being refreshed or closed: the capture ends with the page, so remember that it was
      // sharing and offer Resume when it loads again.
      if(persistentShareWindow&&wasSharing)rememberSharing();
      if(persistentShareWindow)tell({type:'holder',open:false,sharing:false});
    });
    report();
  }catch(error){console.warn('Class Pointer activity sharing unavailable',error)}
})();
