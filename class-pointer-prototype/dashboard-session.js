/* Dashboard sessions use existing class-scoped teacher permissions. */
(function(){
  'use strict';
  const query=new URL(location.href).searchParams,C=window.ClassPointerDashboardCore;
  if(query.get('dashboard')!=='teacher')return;
  const classId=query.get('class'),ws=window.B3_APP_CONTEXT.workspaceId;
  let activeRef=null,activePolicyRef=null,revision=0,ending=false,sessionWrites=Promise.resolve();
  function permissionPath(room){return 'b3Private/classPointerSharePermissions/'+ws+'/'+classId+'/'+room}
  function permissionRows(policy){
    const clean=raw=>Object.fromEntries(Object.entries(raw||{}).filter(([id,v])=>C.validId(id)&&!['__proto__','constructor','prototype'].includes(id)&&v===true));
    const screens=clean(policy?.screens),boards=clean(policy?.boards),ids=new Set([...Object.keys(screens),...Object.keys(boards)]),rows={};
    for(const id of ids){const row={};if(screens[id]===true)row.screenSharingDenied=true;if(boards[id]===true)row.whiteboardDenied=true;if(Object.keys(row).length)rows[id]=row}
    return rows;
  }
  // ---------- Teacher connection drops (issue #801) ----------
  // The lesson record is what every student page watches. It used to be DELETED the moment this
  // page's database connection blinked, and nothing wrote it back, so the whole class lost its
  // shares and its Share My Screen button until the lesson was restarted. Now a drop only stamps
  // the record with the time the teacher went offline. Students keep going for a short grace
  // period (activity-share.js) and stop by themselves if the teacher does not return. When the
  // connection returns, the stamp is cleared here and armed again for the next drop.
  // End Class and closing this page still remove the record straight away.
  const OFFLINE='teacherOfflineAt',LAST_ROOM='classPointerLastRoom:'+classId;
  let sharingOn=false,wentOffline=false,connectionWatched=false,restoreTimer=null,endRequested=null;
  function armOffline(ref){return ref.child(OFFLINE).onDisconnect().set(firebase.database.ServerValue.TIMESTAMP)}
  function disarmOffline(ref){return ref.child(OFFLINE).onDisconnect().cancel()}
  async function restoreSession(ref,context,attempt){
    if(ending||activeRef!==ref||endRequested===ref)return;
    try{
      await writeSession(ref,async()=>{
        await armOffline(ref);
        const row=(await ref.once('value')).val();
        if(row&&row.roomId===ref.key)await ref.child(OFFLINE).remove();
        // The record is gone (for example removed by an older copy of this page): put it back.
        else await ref.set({roomId:ref.key,teacherUid:context.user.uid,createdAt:firebase.database.ServerValue.TIMESTAMP,studentScreenSharing:sharingOn});
      });
    }catch(error){
      // Still offline or the sign-in is refreshing: try a few more times, then wait for the next reconnect.
      if(attempt<5&&activeRef===ref&&typeof setTimeout==='function'){if(restoreTimer)clearTimeout(restoreTimer);restoreTimer=setTimeout(()=>void restoreSession(ref,context,attempt+1),3000);restoreTimer?.unref?.()}
      else console.warn('Class Pointer could not restore the lesson after reconnecting',error);
    }
  }
  function watchConnection(context){
    if(connectionWatched)return;
    const info=context.db.ref('.info/connected');
    if(typeof info?.on!=='function')return;
    connectionWatched=true;
    info.on('value',snapshot=>{
      if(snapshot.val()!==true){wentOffline=true;return}
      if(!wentOffline)return;
      wentOffline=false;
      if(!activeRef||ending)return;
      // End Class was pressed while offline: finish ending it; never bring that lesson back.
      if(endRequested===activeRef)void window.ClassPointerDashboard.end().catch(()=>{});
      else void restoreSession(activeRef,context,0);
    });
  }
  // A lesson this browser left behind without End Class (crash, power loss) is cleared when the next one opens.
  async function clearAbandoned(context,room){
    let last='';try{last=localStorage.getItem(LAST_ROOM)||''}catch{}
    try{localStorage.setItem(LAST_ROOM,room)}catch{}
    if(!C.validRoom(last)||last===room)return;
    try{
      const old=context.ref.child('classPointerSessions/'+last),row=(await old.once('value')).val();
      if(row&&row.roomId===last&&row.teacherUid===context.user.uid&&Number.isFinite(row[OFFLINE]))await Promise.all([old.remove(),context.db.ref(permissionPath(last)).remove()]);
    }catch{/* best effort: students already ignore a lesson whose teacher stayed offline */}
  }
  // Closing or reloading the teacher page ends the lesson for students at once (no grace period).
  if(typeof window.addEventListener==='function')window.addEventListener('pagehide',event=>{
    if(event?.persisted||!activeRef)return;
    try{activeRef.remove().catch(()=>{})}catch{}
    try{activePolicyRef?.remove().catch(()=>{})}catch{}
  });
  function writeSession(ref,operation){
    if(ending)throw Error('The previous classroom is still ending.');
    const current=revision;
    const pending=sessionWrites.catch(()=>{}).then(()=>{
      if(ending||activeRef!==ref||revision!==current)return;
      return operation();
    });
    sessionWrites=pending;
    return pending;
  }
  // ---------- Teacher sign-in guard ----------
  // Firebase keeps ONE signed-in account per browser profile, shared by every tab. If a student (or
  // another account) signs in in another tab of this same browser, this page's teacher session is
  // replaced. Every change below first checks it is still the teacher who opened the lesson; if not,
  // nothing is written and the teacher is asked to sign in again.
  const SIGNIN_CHANGED='Your teacher sign-in changed in this browser (often because a student signed in in another tab). Sign in again as the teacher; nothing was changed.';
  let teacherUid=null,banner=null;
  function bannerNode(){
    if(banner||typeof document==='undefined'||!document.body)return banner;
    banner=document.createElement('div');banner.id='cpTeacherSignInBanner';banner.setAttribute('role','alert');banner.hidden=true;
    banner.style.cssText='position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483000;max-width:min(680px,calc(100% - 24px));display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:14px 16px;border-radius:14px;background:#fff7e6;color:#5c3a00;border:2px solid #f5b800;box-shadow:0 12px 36px #0004;font:600 15px system-ui';
    const text=document.createElement('span');text.className='cp-signin-text';text.style.cssText='flex:1 1 300px';
    const again=document.createElement('button');again.type='button';again.textContent='Sign in again as teacher';
    again.style.cssText='min-height:44px;padding:0 16px;border:0;border-radius:10px;background:#1d4ed8;color:#fff;font:800 15px system-ui;cursor:pointer';
    again.addEventListener('click',()=>{again.disabled=true;Promise.resolve(window.B3SiteSettings?.signInWithGoogle?.()).catch(()=>{}).finally(()=>{again.disabled=false;checkTeacher()})});
    banner.append(text,again);document.body.appendChild(banner);return banner;
  }
  function teacherSessionChanged(){
    const node=bannerNode();if(!node)return;
    const user=firebase.auth?.().currentUser;
    node.querySelector('.cp-signin-text').textContent=user?SIGNIN_CHANGED:'You are signed out in this browser. Sign in again as the teacher to keep changing permissions; nothing was changed.';
    node.hidden=false;
  }
  function checkTeacher(){
    if(!teacherUid)return;
    const user=firebase.auth?.().currentUser;
    if(user&&user.uid===teacherUid){if(banner)banner.hidden=true;document.dispatchEvent(new Event('class-pointer-teacher-restored'));return}
    teacherSessionChanged();
    // Revoke live lesson transport immediately when this browser loses its teacher identity.
    document.dispatchEvent(new Event('class-pointer-teacher-signed-out'));
  }
  try{firebase.auth?.().onAuthStateChanged?.(()=>checkTeacher())}catch{}
  const ready=new Promise((resolve,reject)=>{
    window.B3SiteSettings.onAuthStateChanged(async(user,authorized,access)=>{
      try{
        if(!user||!authorized||!C.validId(classId))throw Error('Open Class Pointer from Teacher Tools and sign in with your teacher account.');
        const db=firebase.database(),ref=db.ref('b3Games/workspaces/'+ws+'/classes/'+classId),row=(await ref.once('value')).val();
        if(!C.permitted(access,classId,row))throw Error('Class Pointer is not enabled for this teacher and class.');
        // Remember the last authorized class so Teacher Tools reopens it directly next time.
        try{localStorage.setItem('classPointerLastTeacherClass',classId)}catch{}
        // Class selection is navigation, never a silent session transfer.
        const picker=typeof document==='undefined'?null:document.getElementById('pointerClassChoice');
        if(picker){
          const base=db.ref('b3Games/workspaces/'+ws+'/classes');
          const ids=access.role==='admin'?Object.keys((await base.once('value')).val()||{}):(access.classIds||[]).filter(C.validId);
          picker.replaceChildren();
          for(const id of ids){
            const classRow=id===classId?row:(await base.child(id).once('value')).val();
            if(C.permitted(access,id,classRow)){const opt=document.createElement('option');opt.value=id;opt.textContent=classRow.name||id;picker.appendChild(opt)}
          }
          picker.value=classId;
          if(window.self!==window.top && query.get('followTeacherWhiteboard')==='1'){
            picker.disabled=true;
            picker.title='Choose the teaching class in Follow the Teacher.';
          }
          picker.addEventListener('change',()=>{
            if(!picker.value||picker.value===classId)return;
            if(!document.getElementById('endClass').disabled&&!confirm('End this classroom and switch classes?')){picker.value=classId;return}
            window.ClassPointerDashboard?.end().finally(()=>location.assign('classroom.html?dashboard=teacher&class='+encodeURIComponent(picker.value)));
          });
        }
        if(!teacherUid)teacherUid=user.uid;
        resolve({db,ref,user,row});
      }catch(error){reject(error)}
    });
  });
  // startClass awaits this authorization automatically when Open teacher classroom is clicked; consume any rejection safely.
  ready.catch(()=>{});
  window.ClassPointerDashboard={
  ready,
  async students(){
    const context=await ready;
    const members=context.row.members||{};
    const ids=Object.keys(members).filter(id=>C.validId(id)&&members[id]?.active!==false);
    const result=await Promise.all(ids.map(async id=>{
      let name=String(members[id]?.name||'').trim();
      try{
        const profile=(await context.db.ref('b3Games/students/'+id+'/profile').once('value')).val();
        if(profile?.name)name=String(profile.name).trim();
      }catch(_){/* The class membership remains authoritative when profiles are unavailable. */}
      return {id,name:name||id};
    }));
    return result.sort((a,b)=>a.name.localeCompare(b.name));
  },
  async updateActivityPermissions(policy){
    const ref=activeRef;if(!ref)return;
    const context=await ready;
    if(!firebase.auth().currentUser||firebase.auth().currentUser.uid!==context.user.uid){teacherSessionChanged();throw Error(SIGNIN_CHANGED)};
    await writeSession(ref,async()=>{
      const rows=permissionRows(policy);
      await context.db.ref(permissionPath(ref.key)).set(rows);
      const denied=Object.entries(rows).filter(([,row])=>row.screenSharingDenied===true).map(([id])=>id);
      window.ClassPointerActivityShares?.revokeStudents(denied);
      return ref.update({permissionRevision:firebase.database.ServerValue.TIMESTAMP});
    });
  },
  async publish(room){
    if(ending)throw Error('The previous classroom is still ending.');
    const current=++revision;
    const context=await ready;
    if(!C.validRoom(room))throw Error('The classroom connection is not ready.');
    if(!firebase.auth().currentUser||firebase.auth().currentUser.uid!==context.user.uid){teacherSessionChanged();throw Error(SIGNIN_CHANGED)};
    const ref=context.ref.child('classPointerSessions/'+room);activeRef=ref;
    const policyRef=context.db.ref(permissionPath(room));activePolicyRef=policyRef;
    // A dropped connection marks this lesson offline; it never deletes it (see the note above).
    // Arm it before the lesson is written, so there is no moment when a live lesson is unprotected.
    // Stricter database rules refuse this until the lesson exists; it is armed again just below.
    await armOffline(ref).catch(()=>{});
    if(current!==revision){await disarmOffline(ref);return}
    sharingOn=false;
    await ref.set({roomId:room,teacherUid:context.user.uid,createdAt:firebase.database.ServerValue.TIMESTAMP,studentScreenSharing:false});
    // A lesson that cannot be marked offline must not open: students would trust it for hours after a crash.
    try{await armOffline(ref)}catch(error){await ref.remove().catch(()=>{});if(activeRef===ref){activeRef=null;activePolicyRef=null}throw error}
    if(current!==revision){await Promise.all([ref.remove(),policyRef.remove(),disarmOffline(ref)]);return}
    watchConnection(context);
    void clearAbandoned(context,room);
  },async requestScreenSharing(){
    const ref=activeRef;if(!ref)throw Error('Open a classroom before sending students.');
    const context=await ready;
    if(!firebase.auth().currentUser||firebase.auth().currentUser.uid!==context.user.uid){teacherSessionChanged();throw Error(SIGNIN_CHANGED)};
    // An authenticated, class-scoped live session is the only broadcast source.
    // Keep the existing session and use a server timestamp so stale prompts cannot replay.
    await writeSession(ref,async()=>{
      await ref.update({
        studentScreenSharing:true,
        shareRequest:{at:firebase.database.ServerValue.TIMESTAMP}
      });
      sharingOn=true;
    });
  },async requestStudentDestination(mode,policy){
    if(!['screens','boards'].includes(mode))throw Error('Choose screens or whiteboards.');
    const ref=activeRef;if(!ref)throw Error('Open a classroom before sending students.');
    const context=await ready;
    if(!firebase.auth().currentUser||firebase.auth().currentUser.uid!==context.user.uid){teacherSessionChanged();throw Error(SIGNIN_CHANGED)};
    // A live class session is authorized and scoped to the teacher's assigned class.
    // Use a server timestamp: existing student pages reject old requests.
    await writeSession(ref,async()=>{
      // Publish private student policy before the class-visible broadcast so
      // recipients never act on stale permission state.
      const rows=permissionRows(policy);
      await context.db.ref(permissionPath(ref.key)).set(rows);
      const denied=Object.entries(rows).filter(([,row])=>row.screenSharingDenied===true).map(([id])=>id);
      window.ClassPointerActivityShares?.revokeStudents(denied);
      await ref.update({
        // Moving to whiteboards changes what is displayed, not the student's
        // already approved Entire Screen capture. Only an explicit Disable
        // student sharing or the class ending may revoke that permission.
        ...(mode==='screens'?{studentScreenSharing:true}:{}),
        permissionRevision:firebase.database.ServerValue.TIMESTAMP,
        destinationRequest:{mode,at:firebase.database.ServerValue.TIMESTAMP}
      });
      if(mode==='screens')sharingOn=true;
    });
  },async setStudentScreenSharing(enabled){
    const ref=activeRef;if(!ref)return;
    const context=await ready;
    if(!firebase.auth().currentUser||firebase.auth().currentUser.uid!==context.user.uid){teacherSessionChanged();throw Error(SIGNIN_CHANGED)};
    await writeSession(ref,async()=>{
      await ref.child('studentScreenSharing').set(enabled===true);
      sharingOn=enabled===true;
      if(enabled!==true)window.ClassPointerActivityShares?.closeAll();
    });
  },async end(){
    revision++;
    const ref=activeRef,policyRef=activePolicyRef;
    if(!ref)return;
    const context=await ready;
    // Preserve the reference if cleanup fails, so another attempt (or closing
    // the page) can still remove the previous classroom session.
    ending=true;endRequested=ref;
    try{
      // Drain writes already sent; queued changes are invalidated by revision.
      // The final removal must happen after them so no child can resurrect a room.
      await sessionWrites.catch(()=>{});
      await Promise.all([ref.remove(),policyRef?.remove()]);
      await disarmOffline(ref);
      if(restoreTimer)clearTimeout(restoreTimer);
      try{if(localStorage.getItem(LAST_ROOM)===ref.key)localStorage.removeItem(LAST_ROOM)}catch{}
      if(endRequested===ref)endRequested=null;
      if(activeRef===ref){activeRef=null;activePolicyRef=null}
    }finally{ending=false}
  }};
})();

