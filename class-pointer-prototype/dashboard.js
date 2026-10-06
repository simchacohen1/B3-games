(async function(){
  'use strict';
  const C=window.ClassPointerDashboardCore,$=id=>document.getElementById(id),query=new URL(location.href).searchParams,ws=window.B3_APP_CONTEXT.workspaceId;
  if(!firebase.apps.length)firebase.initializeApp(window.B3_FIREBASE_CONFIG);
  const db=firebase.database(),classes=db.ref('b3Games/workspaces/'+ws+'/classes');
  const message=text=>{$('message').textContent=text};
  if(query.get('teacher')==='1'){
    $('welcome').textContent='Choose the class you are teaching.';$('teacherChoice').hidden=false;
    $('teacherSignIn').onclick=()=>window.B3SiteSettings.signInWithGoogle().catch(()=>message('Could not sign in. Please try again.'));
    let generation=0;
    window.B3SiteSettings.onAuthStateChanged(async(user,authorized,access)=>{
      const current=++generation;$('openTeacher').disabled=true;$('classChoice').replaceChildren();$('teacherSignIn').hidden=!!authorized;
      if(!authorized){message('Sign in with your teacher account.');return}
      try{
        const rows=access.role==='admin'?(await classes.once('value')).val()||{}:Object.fromEntries(await Promise.all((access.classIds||[]).filter(C.validId).map(async id=>[id,(await classes.child(id).once('value')).val()])));
        if(current!==generation)return;
        for(const [id,row] of Object.entries(rows))if(C.permitted(access,id,row)){const option=document.createElement('option');option.value=id;option.textContent=row.name||id;$('classChoice').appendChild(option)}
        const requested=query.get('class');if(requested&&Array.from($('classChoice').options).some(option=>option.value===requested))$('classChoice').value=requested;
        $('openTeacher').disabled=!$('classChoice').value;message($('classChoice').value?'Start the class, then share your teaching screen. Students click Class Pointer on their dashboard.':'No classes with Class Pointer enabled are assigned to you.');
      }catch{message('Could not load your classes. Refresh to try again.')}
    });
    $('openTeacher').onclick=()=>{if($('classChoice').value)location.href='classroom.html?dashboard=teacher&class='+encodeURIComponent($('classChoice').value)};
    return;
  }
  try{
    const id=localStorage.getItem('b3Games_studentId'),pin=localStorage.getItem('b3Games_classPin');
    if(!C.validId(id)||!pin)throw Error('Sign in on the Fun Torah Tools dashboard, then click Class Pointer.');
    const response=await fetch('https://us-central1-b3-games.cloudfunctions.net/funTorahStudentAuth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'verify',studentId:id,pin}),signal:AbortSignal.timeout(15000)});
    if(!response.ok||!(await response.json()).ok)throw Error('Your sign-in needs to be renewed. Go back to Fun Torah Tools and sign in.');
    const scope=await window.FunTorahStudentClass.resolve(db,id);
    if(scope.workspaceId!==ws||!C.validId(scope.classId))throw Error('Your account is not assigned to a class. Ask your teacher.');
    const ref=classes.child(scope.classId),[profileSnap,classSnap]=await Promise.all([db.ref('b3Games/students/'+id+'/profile').once('value'),ref.once('value')]);
    const profile=profileSnap.val(),row=classSnap.val(),member=row?.members?.[id];
    if(!profile||profile.active===false||!row||row.active===false||!member||member.active===false)throw Error('Your class access is unavailable. Ask your teacher.');
    if(!['et','wt'].includes(scope.classId)&&row.toolGrants?.['class-pointer']!==true)throw Error('Class Pointer is not enabled for your class yet.');
    const name=String(profile.name||'').trim().slice(0,32);if(!name)throw Error('Your account needs a student name. Ask your teacher.');
    $('welcome').textContent='Hello, '+name+'.';message('Waiting for your teacher to start '+(row.name||'your class')+'. Keep this page open.');
    let joining=false;
    const sessions=ref.child('classPointerSessions');
    sessions.on('value',snapshot=>{
      const session=C.latest(snapshot.val());if(!session||joining)return;joining=true;
      try{sessionStorage.setItem('classPointerDashboardJoin',JSON.stringify({room:session.roomId,name,studentId:id,classId:scope.classId,at:Date.now()}));location.replace('classroom.html?dashboard=student&room='+encodeURIComponent(session.roomId))}
      catch{joining=false;message('Allow browser storage, then refresh to join with your saved name.')}
    },()=>message('Could not find your lesson. Refresh to try again.'));
  }catch(error){message(error.message||'Could not open the classroom. Please try again.')}
})();
