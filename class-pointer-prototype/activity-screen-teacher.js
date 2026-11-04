'use strict';
/* Accept separate activity-screen PeerJS calls only after server verifies a
   short-lived, class-scoped ticket for the authenticated session owner.
   One tile per student: the server-verified student id decides which tile a
   screen belongs to, so a boy sharing from two tabs never appears twice and a
   screen is never shown under another boy's name. */
(function(){
  const query=new URLSearchParams(location.search);
  if(query.get('dashboard')!=='teacher')return;
  const classId=query.get('class');
  const endpoint='https://us-central1-b3-games.cloudfunctions.net/classPointerShareAuth';
  const stage=document.getElementById('stage');
  const screens=new Map();   // call -> student id (every live call)
  const students=new Map();  // student id -> {card,video,heading,enlarge,name,calls:[{call,stream}]}
  const tray=document.createElement('aside');
  tray.id='activityScreenTray';tray.dataset.stageUi='true';tray.hidden=true;
  const TRAY='position:absolute;right:12px;bottom:52px;z-index:8;display:flex;gap:10px;flex-wrap:wrap;max-width:min(90%,700px);max-height:55%;overflow:auto;pointer-events:auto';
  const TRAY_BIG='position:absolute;inset:8px;z-index:30;display:flex;pointer-events:auto';
  tray.style.cssText=TRAY;
  stage.appendChild(tray);
  const help=document.createElement('div');
  help.id='activityScreenHelp';help.dataset.stageUi='true';
  help.style.cssText='position:absolute;right:12px;bottom:52px;z-index:7;max-width:320px;padding:10px 14px;background:#eaf3ff;color:#15345b;border-radius:10px;font:600 13px system-ui;pointer-events:none';
  help.textContent='Students sharing from Shorashim or another activity appear here after they accept the request. They do not need to join Pointer.';
  help.hidden=true;stage.appendChild(help);
  const observer=new MutationObserver(()=>{help.hidden=!tray.hidden||document.getElementById('endClass')?.disabled!==false});
  observer.observe(tray,{attributes:true,attributeFilter:['hidden']});
  const lessonButton=document.getElementById('endClass');if(lessonButton)observer.observe(lessonButton,{attributes:true,attributeFilter:['disabled']});

  const CARD_SMALL='background:#172033;color:white;padding:8px;border-radius:12px;width:min(320px,75vw);box-shadow:0 8px 28px #0006;display:flex;flex-direction:column;gap:6px';
  const CARD_BIG='background:#0b1222;color:white;padding:10px;border-radius:14px;flex:1;min-width:0;min-height:0;box-shadow:0 12px 40px #0008;display:flex;flex-direction:column;gap:8px';
  const VIDEO_SMALL='pointer-events:auto;position:static;width:100%;height:180px;object-fit:contain;background:#050a16;cursor:zoom-in';
  const VIDEO_BIG='pointer-events:auto;position:static;width:100%;flex:1;min-height:0;height:auto;object-fit:contain;background:#050a16;cursor:zoom-out';
  const BUTTON='min-height:40px;padding:0 14px;border-radius:10px;border:1px solid #ffffff55;background:#1d4ed8;color:#fff;font:700 15px system-ui;cursor:pointer';
  let focused=null; // student id shown large

  function reportFailure(message){
    let notice=document.getElementById('activityScreenFailure');
    if(!notice){notice=document.createElement('div');notice.id='activityScreenFailure';notice.dataset.stageUi='true';notice.style.cssText='position:absolute;right:12px;bottom:52px;z-index:9;max-width:370px;padding:12px;background:#fff2ef;color:#8a2119;border:1px solid #e4a69e;border-radius:10px;font:600 13px system-ui';stage.appendChild(notice)}
    notice.textContent='Student screen connection failed: '+message;
    notice.hidden=false;
  }
  function close(call){try{call.close()}catch{}}
  // Tell the Student Screens gallery (student-boards.js) that a student's live screen changed.
  function notify(){
    // The boy stopped sharing (or was turned off): his screen must leave the whole class at once.
    const shared=window.ClassPointerClassShare?.current();
    if(shared&&!students.get(shared.studentId)?.calls.some(item=>item.stream))window.ClassPointerClassShare.stop();
    document.dispatchEvent(new CustomEvent('classpointer:activity-screens'));
  }

  // ---------- Show one student's screen to the whole class (teacher's choice only) ----------
  // One clear red Stop bar stays on the lesson (also in full screen) for as long as it is on.
  const classBar=document.createElement('div');
  classBar.id='classShareBar';classBar.dataset.stageUi='true';classBar.hidden=true;classBar.setAttribute?.('role','status');
  classBar.style.cssText='position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:60;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px;max-width:calc(100% - 24px);padding:10px 14px;background:#fff7ed;border:2px solid #ea580c;border-radius:14px;box-shadow:0 10px 30px #0006;color:#7c2d12;font:700 16px system-ui;pointer-events:auto';
  const classBarText=document.createElement('span'),classBarStop=document.createElement('button');
  classBarStop.type='button';classBarStop.style.cssText='min-height:44px;padding:0 16px;border-radius:10px;border:2px solid #b91c1c;background:#dc2626;color:#fff;font:800 15px system-ui;cursor:pointer';
  classBarStop.onclick=()=>window.ClassPointerClassShare?.stop();
  classBar.append(classBarText,classBarStop);stage.appendChild(classBar);
  ['pointerdown','pointermove','pointerup','click'].forEach(type=>classBar.addEventListener?.(type,event=>event.stopPropagation()));
  function shareToClass(studentId,name){
    const entry=students.get(studentId);
    const stream=entry?.calls[entry.calls.length-1]?.stream;
    if(!stream||!window.ClassPointerClassShare)return false;
    return window.ClassPointerClassShare.start(studentId,name||entry.name,stream);
  }
  document.addEventListener?.('classpointer:class-share',event=>{
    const on=event.detail;
    classBar.hidden=!on;
    if(on){classBarText.textContent='🔴 The whole class is seeing '+on.name+'’s screen.';classBarStop.textContent='Stop showing '+on.name+'’s screen'}
    for(const [id,entry] of students){
      const mine=!!on&&on.studentId===id;
      entry.showClass.textContent=mine?'Showing to class ✓':'📣 Show to whole class';
      entry.showClass.disabled=mine;
    }
  });

  // ---------- Enlarged view: one student's screen fills the lesson area ----------
  // Only the layout changes; every connection stays open.
  function setFocus(studentId){
    focused=studentId&&students.has(studentId)?studentId:null;
    tray.style.cssText=focused?TRAY_BIG:TRAY;
    tray.hidden=!students.size||!!(document.getElementById('boardsView')&&!document.getElementById('boardsView').hidden);
    for(const [id,entry] of students){
      const big=id===focused;
      entry.card.hidden=!!focused&&!big;
      entry.card.style.cssText=big?CARD_BIG:CARD_SMALL;
      entry.video.style.cssText=big?VIDEO_BIG:VIDEO_SMALL;
      entry.enlarge.textContent=big?'◀ Back to gallery':'⤢ Enlarge';
      entry.enlarge.setAttribute?.('aria-pressed',String(big));
      entry.enlarge.title=big?'Return to all student screens (sharing continues)':'Show '+entry.name+'’s screen large';
    }
    if(focused)students.get(focused).enlarge.focus?.({preventScroll:true});
  }
  document.addEventListener?.('keydown',event=>{if(event.key==='Escape'&&focused){event.stopPropagation();setFocus(null)}},true);
  // The adaptive gallery owns the full lesson area; avoid a duplicate floating tray on top.
  document.addEventListener?.('classpointer:sharing-state',()=>setFocus(null));

  // Show the newest live screen this student is sharing (another tab's share replaces the picture, not the tile).
  function showLatest(entry){
    const latest=entry.calls[entry.calls.length-1];
    const stream=latest?.stream||null;
    if(entry.video.srcObject!==stream){entry.video.srcObject=stream;if(stream)entry.video.play?.().catch?.(()=>{})}
    notify();
  }
  function tileFor(studentId,name){
    let entry=students.get(studentId);
    if(entry){if(name&&entry.name!==name){entry.name=name;entry.heading.textContent=name+' · Live screen'}return entry}
    const card=document.createElement('div');card.className='cp-activity-screen';card.dataset.studentId=studentId;
    const top=document.createElement('div');top.style.cssText='display:flex;align-items:center;gap:8px;flex-wrap:wrap';
    const heading=document.createElement('strong');heading.textContent=name+' · Live screen';heading.style.cssText='flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    const enlarge=document.createElement('button');enlarge.type='button';enlarge.className='cp-screen-enlarge';enlarge.style.cssText=BUTTON;
    enlarge.onclick=()=>setFocus(focused===studentId?null:studentId);
    top.append(heading,enlarge);
    const video=document.createElement('video');video.autoplay=true;video.playsInline=true;video.muted=true;
    video.setAttribute?.('aria-label',name+'’s shared screen');
    // Clicking the screen itself enlarges it; clicking the large screen returns to the gallery.
    video.addEventListener?.('click',()=>setFocus(focused===studentId?null:studentId));
    const dismiss=document.createElement('button');dismiss.textContent='Stop viewing';dismiss.type='button';
    dismiss.title='Close this student’s screen (he can share again)';
    dismiss.style.cssText='align-self:flex-start;min-height:34px;padding:0 12px;border-radius:9px;border:1px solid #ffffff44;background:transparent;color:#fff;cursor:pointer';
    dismiss.onclick=()=>closeStudent(studentId);
    const showClass=document.createElement('button');showClass.type='button';showClass.textContent='📣 Show to whole class';
    showClass.title='Let every student in this class see '+name+'’s screen. You can stop it at any time.';
    showClass.style.cssText=BUTTON+';background:#c2410c';
    showClass.onclick=()=>{shareToClass(studentId)};
    const row=document.createElement('div');row.style.cssText='display:flex;gap:8px;flex-wrap:wrap;align-items:center';row.append(dismiss,showClass);
    card.append(top,video,row);tray.appendChild(card);
    entry={card,video,heading,enlarge,name,showClass,calls:[]};students.set(studentId,entry);
    setFocus(focused);
    return entry;
  }
  function clear(call){
    const studentId=screens.get(call);if(studentId===undefined)return;
    screens.delete(call);
    const entry=students.get(studentId);
    if(entry){
      entry.calls=entry.calls.filter(item=>item.call!==call);
      // Another tab of the same boy is still sharing: keep his tile and show that screen.
      if(entry.calls.length)showLatest(entry);
      else{entry.card.remove();students.delete(studentId);if(focused===studentId)focused=null}
    }
    setFocus(focused);
    notify();
  }
  function closeStudent(studentId){
    const entry=students.get(studentId);if(!entry)return;
    for(const item of entry.calls.slice()){close(item.call);clear(item.call)}
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
      if(typeof verified.studentId!=='string'||!verified.studentId)throw Error('The server did not confirm which student this is.');
      // A student the teacher removed from this class session is not shown.
      if((window.ClassPointerRoster?.removedIds?.()||[]).includes(verified.studentId))throw Error(verified.studentName+' was removed from this class.');
      const priorFailure=document.getElementById('activityScreenFailure');if(priorFailure)priorFailure.hidden=true;
      const entry=tileFor(verified.studentId,String(verified.studentName||'Student'));
      const item={call,stream:null};entry.calls.push(item);screens.set(call,verified.studentId);
      call.on('stream',stream=>{if(!screens.has(call))return;item.stream=stream;showLatest(entry)});
      // Tidy up after the closing call has finished its own work (keeps this safe if close fires more than once).
      const later=()=>(typeof queueMicrotask==='function'?queueMicrotask:fn=>fn())(()=>clear(call));
      call.on('close',later);call.on('error',later);
      call.answer();
      tray.hidden=!!(document.getElementById('boardsView')&&!document.getElementById('boardsView').hidden);
    }catch(e){console.warn('Class Pointer activity screen rejected:',e?.message||e);reportFailure(e?.message||'Unknown connection error');close(call)}
    return true;
  }
  window.ClassPointerActivityShares={incomingCall,
    showToClass:shareToClass,
    enlarge:studentId=>{if(!students.has(studentId))return false;setFocus(studentId);return true},
    showAll:()=>setFocus(null),
    count:()=>students.size,
    // The newest live MediaStream this verified student is sharing (null when none). The large Student Screens
    // viewer in student-boards.js uses this, because these students are not joined to Pointer.
    streamFor:studentId=>{
      const entry=typeof studentId==='string'?students.get(studentId):null;
      return entry?.calls[entry.calls.length-1]?.stream||null;
    },
    revokeStudents(studentIds){
      const denied=new Set(Array.isArray(studentIds)?studentIds:[]);
      for(const id of Array.from(students.keys()))if(denied.has(id))closeStudent(id);
    },
    closeAll(){for(const id of Array.from(students.keys()))closeStudent(id)}
  };
})();
