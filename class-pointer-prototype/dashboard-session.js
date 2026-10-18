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
    if(user&&user.uid===teacherUid){if(banner)banner.hidden=true;return}
    teacherSessionChanged();
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
    await Promise.all([ref.onDisconnect().remove(),policyRef.onDisconnect().remove()]);
    if(current!==revision){await Promise.all([ref.onDisconnect().cancel(),policyRef.onDisconnect().cancel()]);return}
    await ref.set({roomId:room,teacherUid:context.user.uid,createdAt:firebase.database.ServerValue.TIMESTAMP,studentScreenSharing:false});
    if(current!==revision){await Promise.all([ref.remove(),policyRef.remove(),ref.onDisconnect().cancel(),policyRef.onDisconnect().cancel()])}
  },async requestScreenSharing(){
    const ref=activeRef;if(!ref)throw Error('Open a classroom before sending students.');
    const context=await ready;
    if(!firebase.auth().currentUser||firebase.auth().currentUser.uid!==context.user.uid){teacherSessionChanged();throw Error(SIGNIN_CHANGED)};
    // An authenticated, class-scoped live session is the only broadcast source.
    // Keep the existing session and use a server timestamp so stale prompts cannot replay.
    await writeSession(ref,()=>ref.update({
      studentScreenSharing:true,
      shareRequest:{at:firebase.database.ServerValue.TIMESTAMP}
    }));
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
      return ref.update({
        studentScreenSharing:mode==='screens',
        permissionRevision:firebase.database.ServerValue.TIMESTAMP,
        destinationRequest:{mode,at:firebase.database.ServerValue.TIMESTAMP}
      });
    });
  },async setStudentScreenSharing(enabled){
    const ref=activeRef;if(!ref)return;
    const context=await ready;
    if(!firebase.auth().currentUser||firebase.auth().currentUser.uid!==context.user.uid){teacherSessionChanged();throw Error(SIGNIN_CHANGED)};
    await writeSession(ref,async()=>{
      await ref.child('studentScreenSharing').set(enabled===true);
      if(enabled!==true)window.ClassPointerActivityShares?.closeAll();
    });
  },async end(){
    revision++;
    const ref=activeRef,policyRef=activePolicyRef;
    if(!ref)return;
    const context=await ready;
    // Preserve the reference if cleanup fails, so a refresh/onDisconnect
    // or another attempt can still remove the previous classroom session.
    ending=true;
    try{
      // Drain writes already sent; queued changes are invalidated by revision.
      // The final removal must happen after them so no child can resurrect a room.
      await sessionWrites.catch(()=>{});
      await Promise.all([ref.remove(),policyRef?.remove()]);
      await Promise.all([ref.onDisconnect().cancel(),policyRef?.onDisconnect().cancel()]);
      if(activeRef===ref){activeRef=null;activePolicyRef=null}
    }finally{ending=false}
  }};
})();

