/* Dashboard sessions use existing class-scoped teacher permissions. */
(function(){
  'use strict';
  const query=new URL(location.href).searchParams,C=window.ClassPointerDashboardCore;
  if(query.get('dashboard')!=='teacher')return;
  const classId=query.get('class'),ws=window.B3_APP_CONTEXT.workspaceId;
  let activeRef=null,revision=0,ending=false,sessionWrites=Promise.resolve();
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
  const ready=new Promise((resolve,reject)=>{
    window.B3SiteSettings.onAuthStateChanged(async(user,authorized,access)=>{
      try{
        if(!user||!authorized||!C.validId(classId))throw Error('Open Class Pointer from Teacher Tools and sign in with your teacher account.');
        const db=firebase.database(),ref=db.ref('b3Games/workspaces/'+ws+'/classes/'+classId),row=(await ref.once('value')).val();
        if(!C.permitted(access,classId,row))throw Error('Class Pointer is not enabled for this teacher and class.');
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
    if(!firebase.auth().currentUser||firebase.auth().currentUser.uid!==context.user.uid)throw Error('Teacher authentication expired.');
    const clean=raw=>Object.fromEntries(Object.entries(raw||{}).filter(([id,v])=>C.validId(id)&&!['__proto__','constructor','prototype'].includes(id)&&v===true));
    await writeSession(ref,()=>ref.update({screenSharingDenied:clean(policy?.screens),whiteboardDenied:clean(policy?.boards)}));
  },
  async publish(room){
    if(ending)throw Error('The previous classroom is still ending.');
    const current=++revision;
    const context=await ready;
    if(!C.validRoom(room))throw Error('The classroom connection is not ready.');
    if(!firebase.auth().currentUser||firebase.auth().currentUser.uid!==context.user.uid)throw Error('Sign in again before starting the class.');
    const ref=context.ref.child('classPointerSessions/'+room);activeRef=ref;
    await ref.onDisconnect().remove();
    if(current!==revision){await ref.onDisconnect().cancel();return}
    await ref.set({roomId:room,teacherUid:context.user.uid,createdAt:firebase.database.ServerValue.TIMESTAMP,studentScreenSharing:false});
    if(current!==revision){await ref.remove();await ref.onDisconnect().cancel()}
  },async requestScreenSharing(){
    const ref=activeRef;if(!ref)throw Error('Open a classroom before sending students.');
    const context=await ready;
    if(!firebase.auth().currentUser||firebase.auth().currentUser.uid!==context.user.uid)throw Error('Teacher authentication expired.');
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
    if(!firebase.auth().currentUser||firebase.auth().currentUser.uid!==context.user.uid)throw Error('Teacher authentication expired.');
    // A live class session is authorized and scoped to the teacher's assigned class.
    // Use a server timestamp: existing student pages reject old requests.
    const clean=raw=>Object.fromEntries(Object.entries(raw||{}).filter(([id,v])=>C.validId(id)&&!['__proto__','constructor','prototype'].includes(id)&&v===true));
    await writeSession(ref,()=>ref.update({
      studentScreenSharing:mode==='screens',
      screenSharingDenied:clean(policy?.screens),whiteboardDenied:clean(policy?.boards),
      destinationRequest:{mode,at:firebase.database.ServerValue.TIMESTAMP}
    }));
  },async setStudentScreenSharing(enabled){
    const ref=activeRef;if(!ref)return;
    const context=await ready;
    if(!firebase.auth().currentUser||firebase.auth().currentUser.uid!==context.user.uid)throw Error('Teacher authentication expired.');
    await writeSession(ref,()=>ref.child('studentScreenSharing').set(enabled===true));
  },async end(){
    revision++;
    const ref=activeRef;
    if(!ref)return;
    // Preserve the reference if cleanup fails, so a refresh/onDisconnect
    // or another attempt can still remove the previous classroom session.
    ending=true;
    try{
      // Drain writes already sent; queued changes are invalidated by revision.
      // The final removal must happen after them so no child can resurrect a room.
      await sessionWrites.catch(()=>{});
      await ref.remove();
      await ref.onDisconnect().cancel();
      if(activeRef===ref)activeRef=null;
    }finally{ending=false}
  }};
})();

