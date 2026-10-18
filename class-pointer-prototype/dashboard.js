(async function(){
  'use strict';
  const C=window.ClassPointerDashboardCore,$=id=>document.getElementById(id),query=new URL(location.href).searchParams,ws=window.B3_APP_CONTEXT.workspaceId;
  if(!firebase.apps.length)firebase.initializeApp(window.B3_FIREBASE_CONFIG);
  const db=firebase.database(),classes=db.ref('b3Games/workspaces/'+ws+'/classes');
  const message=text=>{$('message').textContent=text};
  if(query.get('teacher')==='1'){
    let mode=query.get('sendEveryoneBoards')==='1'?'boards':query.get('sendEveryoneShare')==='1'?'screens':'lesson';
    $('teacherChoice').hidden=false;
    $('classChoice').hidden=true;$('openTeacher').hidden=true;
    document.querySelector('label[for="classChoice"]')?.setAttribute('hidden','');
    const buttons=$('teacherClassButtons'),classChoices=[];
    const modeCards=Array.from(document.querySelectorAll?.('[data-classroom-mode]')||[]);
    function setMode(next){
      if(!['lesson','screens','boards'].includes(next))return;
      mode=next;
      modeCards.forEach(btn=>btn.setAttribute('aria-pressed',String(btn.getAttribute('data-classroom-mode')===mode)));
      const label=mode==='boards'?'Send to Whiteboards':mode==='screens'?'View Student Screens':'Start classroom';
      $('welcome').textContent='Choose a class for '+label+'.';
      classChoices.forEach(({btn,name})=>{
        btn.textContent=(mode==='boards'?'📝 ':mode==='screens'?'🖥 ':'👆 ')+name;
        btn.setAttribute('aria-label',label+' for '+name);
      });
      if(buttons.childElementCount)message(mode==='lesson'?'The class starts after you choose it.':'Only the class you select will receive the request; screen sharing still requires each student’s browser permission.');
    }
    modeCards.forEach(btn=>btn.addEventListener('click',()=>setMode(btn.getAttribute('data-classroom-mode'))));
    setMode(mode);
    $('teacherSignIn').onclick=()=>window.B3SiteSettings.signInWithGoogle().catch(()=>message('Could not sign in. Please try again.'));
    let generation=0;
    window.B3SiteSettings.onAuthStateChanged(async(user,authorized,access)=>{
      const current=++generation;
      buttons.replaceChildren();classChoices.length=0;$('teacherSignIn').hidden=!!authorized;
      if(!authorized){message('Sign in with your teacher account to select a class.');return}
      try{
        const rows=access.role==='admin'?(await classes.once('value')).val()||{}:Object.fromEntries(await Promise.all((access.classIds||[]).filter(C.validId).map(async id=>[id,(await classes.child(id).once('value')).val()])));
        if(current!==generation)return;
        for(const [id,row] of Object.entries(rows)){
          if(!C.permitted(access,id,row))continue;
          const name=String(row.name||id);
          const btn=document.createElement('button');
          btn.type='button';btn.className='class-launch-button';btn.setAttribute('data-class-id',id);
          classChoices.push({btn,name,id});
          btn.textContent=(mode==='boards'?'📝 ':mode==='screens'?'🖥 ':'👆 ')+name;
          btn.setAttribute('aria-label',(mode==='boards'?'Send to Whiteboards':mode==='screens'?'View Student Screens':'Start classroom')+' for '+name);
          btn.addEventListener('click',()=>{
            try{localStorage.setItem('classPointerLastTeacherClass',id)}catch{}
            buttons.querySelectorAll('button').forEach(button=>button.disabled=true);
            const target=new URL('classroom.html',location.href);
            target.searchParams.set('dashboard','teacher');target.searchParams.set('class',id);
            if(mode==='screens')target.searchParams.set('sendEveryoneShare','1');
            if(mode==='boards')target.searchParams.set('sendEveryoneBoards','1');
            location.assign(target.href);
          });
          buttons.appendChild(btn);
        }
        // Open the teacher workspace directly for the regular classroom entry.
        // Use a previously selected authorized class; otherwise prefer ET, then the first authorized class.
        // The class picker remains available on the workspace itself.
        if(mode==='lesson'&&classChoices.length){
          let saved='';try{saved=localStorage.getItem('classPointerLastTeacherClass')||''}catch{}
          // Only classes this teacher is authorized for are in classChoices.
          const chosen=classChoices.find(choice=>choice.id===saved)||classChoices.find(choice=>choice.id==='et')||classChoices[0];
          if(chosen){message('Opening '+chosen.name+'…');chosen.btn.click();return}
        }
        message(buttons.childElementCount
          ?(mode==='lesson'?'Nothing starts until you choose a class.':'Only the class you select will receive the request; screen sharing still requires each student’s browser permission.')
          :'No classes with Class Pointer enabled are assigned to you.');
      }catch{if(current===generation)message('Could not load your classes. Refresh to try again.')}
    });
    return;
  }
  try{
    const id=sessionStorage.getItem('b3Games_studentId'),pin=sessionStorage.getItem('b3Games_classPin');
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
    let lastEnter=0;try{lastEnter=Number(sessionStorage.getItem('classPointerLastEnter'))||0}catch{}
    sessions.on('value',snapshot=>{
      const session=C.latest(snapshot.val());if(!session||joining)return;
      // A student the teacher removed from this lesson is not sent back into it.
      let removedRoom='';try{removedRoom=sessionStorage.getItem('classPointerRemovedRoom')||''}catch{}
      if(removedRoom===session.roomId){message('Your teacher removed you from this lesson.');return}
      joining=true;message('Your teacher’s lesson is open. Connecting…');
      const enter=()=>{
        try{sessionStorage.setItem('classPointerLastEnter',String(Date.now()));sessionStorage.setItem('classPointerDashboardJoin',JSON.stringify({room:session.roomId,name,studentId:id,classId:scope.classId,at:Date.now()}));location.replace('classroom.html?dashboard=student&room='+encodeURIComponent(session.roomId))}
        catch{joining=false;message('Allow browser storage, then refresh to join with your saved name.')}
      };
      // If the lesson page just sent him back here, pause briefly instead of bouncing.
      Date.now()-lastEnter<20000?setTimeout(enter,8000):enter();
    },()=>message('Could not find your lesson. Refresh to try again.'));
  }catch(error){message(error.message||'Could not open the classroom. Please try again.')}
})();
