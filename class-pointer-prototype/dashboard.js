(async function(){
  'use strict';
  const C=window.ClassPointerDashboardCore,$=id=>document.getElementById(id),query=new URL(location.href).searchParams,ws=window.B3_APP_CONTEXT.workspaceId;
  if(!firebase.apps.length)firebase.initializeApp(window.B3_FIREBASE_CONFIG);
  const db=firebase.database(),classes=db.ref('b3Games/workspaces/'+ws+'/classes');
  const message=text=>{$('message').textContent=text};
  if(query.get('teacher')==='1'){
    let mode=query.get('sendEveryoneBoards')==='1'?'boards':query.get('sendEveryoneShare')==='1'?'screens':'lesson';
    // The regular entry opens a class by itself. Keep the class chooser hidden until we know it must be shown,
    // so it never flashes on screen before the redirect.
    let settled=mode!=='lesson';
    $('teacherChoice').hidden=!settled;
    $('classChoice').hidden=true;$('openTeacher').hidden=true;
    document.querySelector('label[for="classChoice"]')?.setAttribute('hidden','');
    const buttons=$('teacherClassButtons'),classChoices=[];
    const modeCards=Array.from(document.querySelectorAll?.('[data-classroom-mode]')||[]);
    function setMode(next){
      if(!['lesson','screens','boards'].includes(next))return;
      mode=next;
      modeCards.forEach(btn=>btn.setAttribute('aria-pressed',String(btn.getAttribute('data-classroom-mode')===mode)));
      const label=mode==='boards'?'Send to Whiteboards':mode==='screens'?'View Student Screens':'Start classroom';
      if(settled)$('welcome').textContent='Choose a class for '+label+'.';
      classChoices.forEach(({btn,name})=>{
        btn.textContent=(mode==='boards'?'📝 ':mode==='screens'?'🖥 ':'👆 ')+name;
        btn.setAttribute('aria-label',label+' for '+name);
      });
      if(buttons.childElementCount)message(mode==='lesson'?'The class starts after you choose it.':'Only the class you select will receive the request; screen sharing still requires each student’s browser permission.');
    }
    function reveal(){if(settled)return;settled=true;$('teacherChoice').hidden=false;setMode(mode)}
    modeCards.forEach(btn=>btn.addEventListener('click',()=>setMode(btn.getAttribute('data-classroom-mode'))));
    setMode(mode);
    $('teacherSignIn').onclick=()=>window.B3SiteSettings.signInWithGoogle().catch(()=>message('Could not sign in. Please try again.'));
    let generation=0;
    window.B3SiteSettings.onAuthStateChanged(async(user,authorized,access)=>{
      const current=++generation;
      buttons.replaceChildren();classChoices.length=0;$('teacherSignIn').hidden=!!authorized;
      if(!authorized){reveal();message('Sign in with your teacher account to select a class.');return}
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
        reveal();
        message(buttons.childElementCount
          ?(mode==='lesson'?'Nothing starts until you choose a class.':'Only the class you select will receive the request; screen sharing still requires each student’s browser permission.')
          :'No classes with Class Pointer enabled are assigned to you.');
      }catch{reveal();if(current===generation)message('Could not load your classes. Refresh to try again.')}
    });
    return;
  }
  // Students use their existing Fun Torah Tools activities. The verified
  // classroom presence and individual boards now live on those pages.
  // Keep this legacy student entry as a safe return to the student dashboard.
  location.replace(new URL('../index.html',location.href).href);
  return;
})();
