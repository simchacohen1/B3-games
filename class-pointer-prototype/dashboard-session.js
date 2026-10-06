/* Dashboard sessions use existing class-scoped teacher permissions. */
(function(){
  'use strict';
  const query=new URL(location.href).searchParams,C=window.ClassPointerDashboardCore;
  if(query.get('dashboard')!=='teacher')return;
  const classId=query.get('class'),ws=window.B3_APP_CONTEXT.workspaceId;
  let activeRef=null,revision=0;
  const ready=new Promise((resolve,reject)=>{
    window.B3SiteSettings.onAuthStateChanged(async(user,authorized,access)=>{
      try{
        if(!user||!authorized||!C.validId(classId))throw Error('Open Class Pointer from Teacher Tools and sign in with your teacher account.');
        const db=firebase.database(),ref=db.ref('b3Games/workspaces/'+ws+'/classes/'+classId),row=(await ref.once('value')).val();
        if(!C.permitted(access,classId,row))throw Error('Class Pointer is not enabled for this teacher and class.');
        resolve({db,ref,user});
      }catch(error){reject(error)}
    });
  });
  // Avoid an unhandled rejection while the teacher has not clicked Start class.
  ready.catch(()=>{});
  window.ClassPointerDashboard={ready,async publish(room){
    const current=++revision;
    const context=await ready;
    if(!C.validRoom(room))throw Error('The classroom connection is not ready.');
    if(!firebase.auth().currentUser||firebase.auth().currentUser.uid!==context.user.uid)throw Error('Sign in again before starting the class.');
    const ref=context.ref.child('classPointerSessions/'+room);activeRef=ref;
    await ref.onDisconnect().remove();
    if(current!==revision){await ref.onDisconnect().cancel();return}
    await ref.set({roomId:room,teacherUid:context.user.uid,createdAt:firebase.database.ServerValue.TIMESTAMP});
    if(current!==revision){await ref.remove();await ref.onDisconnect().cancel()}
  },async end(){revision++;const ref=activeRef;activeRef=null;if(ref){await ref.remove();await ref.onDisconnect().cancel()}}};
})();
