/* Teacher dashboard: surface the existing Pointer controls in four clear sections. */
(function(){
  'use strict';
  function init(){
    const panel=document.getElementById('teacherPanel');
    const controls=panel?.querySelector('.session-controls');
    const dock=document.getElementById('teacherDock');
    if(!panel||!controls||panel.dataset.dashboardReady==='true')return;
    panel.dataset.dashboardReady='true';

    const dashboard=document.createElement('div');
    dashboard.className='teacher-dashboard';
    dashboard.setAttribute('aria-label','Class Pointer dashboard');
    const section=(title,description)=>{
      const card=document.createElement('section');
      card.className='teacher-dashboard-section';
      const heading=document.createElement('h2');heading.textContent=title;
      const intro=document.createElement('p');intro.className='teacher-dashboard-description';intro.textContent=description;
      const body=document.createElement('div');body.className='teacher-dashboard-content';
      card.append(heading,intro,body);dashboard.append(card);return body;
    };
    const classroom=section('Classroom','Choose your class and manage the student list.');
    const sharing=section('Sharing','Share your lesson screen and view student screens.');
    const activities=section('Student Activities','Choose an activity for the class.');
    const tools=section('Display & Tools','Open lesson materials and adjust the display.');
    panel.insertBefore(dashboard,panel.firstChild);

    const picker=controls.querySelector('.pointer-class-picker');
    if(picker)classroom.appendChild(picker);
    const join=document.getElementById('joinInstructions');
    if(join)classroom.appendChild(join);

    const studentMenu=document.getElementById('tbStudentsMenu');
    const studentsButton=document.getElementById('tbStudentsBtn');
    if(studentMenu){
      studentMenu.hidden=false;
      studentMenu.classList.add('teacher-dashboard-roster');
      const oldLaunch=Array.from(studentMenu.querySelectorAll('.pointer-bulk-actions')).find(group=>
        Array.from(group.querySelectorAll('button')).some(button=>/Send (screens|whiteboards)/i.test(button.textContent)));
      oldLaunch?.remove();
      classroom.appendChild(studentMenu);
    }
    if(studentsButton)studentsButton.closest('.tb-menu-wrap')?.classList.add('teacher-dashboard-menu-trigger');

    const shareButton=document.getElementById('shareScreen');
    const stopButton=document.getElementById('stopScreen');
    const shareToggle=document.getElementById('cpShareEnabled');
    const studentViews=document.getElementById('studentBoards');
    [shareButton,stopButton,shareToggle,studentViews].forEach(node=>{if(node)sharing.appendChild(node)});
    const shareHelp=document.createElement('p');
    shareHelp.className='teacher-dashboard-note';
    shareHelp.textContent='Students approve screen sharing in their browser. Their screens and whiteboards appear in Student Screens.';
    sharing.appendChild(shareHelp);

    const dialog=document.createElement('dialog');
    dialog.className='teacher-activities-dialog';
    dialog.setAttribute('aria-labelledby','teacherActivitiesTitle');
    const dialogHeader=document.createElement('div');dialogHeader.className='teacher-activities-header';
    const title=document.createElement('h2');title.id='teacherActivitiesTitle';title.textContent='Choose a student activity';
    const close=document.createElement('button');close.type='button';close.className='quiet';close.textContent='Close';
    close.addEventListener('click',()=>dialog.close());
    dialogHeader.append(title,close);
    const dialogChoices=document.createElement('div');dialogChoices.className='teacher-activities-choices';
    dialog.append(dialogHeader,dialogChoices);panel.appendChild(dialog);
    const openActivities=document.createElement('button');
    openActivities.id='teacherActivitiesButton';openActivities.type='button';
    openActivities.className='teacher-dashboard-primary';openActivities.textContent='Choose Student Activity';
    openActivities.addEventListener('click',()=>{if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','')});
    activities.appendChild(openActivities);

    const findAction=(pattern)=>Array.from(controls.querySelectorAll('button')).find(button=>pattern.test(button.textContent.trim()));
    const screens=findAction(/^📣?\s*Send to Screen Sharing$/i);
    const boards=findAction(/^📝\s*Send to Whiteboards$/i);
    const sharedBoard=document.getElementById('openWhiteboard');
    const actions=[screens,boards,sharedBoard].filter(Boolean);
    actions.forEach((button,index)=>{
      button.classList.add('teacher-activity-choice');
      button.setAttribute('type','button');
      if(index===0)button.textContent='🖥 Screen Sharing';
      if(index===1)button.textContent='📝 Student Whiteboards';
      if(index===2)button.textContent='🧾 Shared Whiteboard';
      dialogChoices.appendChild(button);
    });
    if(!actions.length){
      const note=document.createElement('p');note.textContent='No student activities are available until the classroom is ready.';dialogChoices.appendChild(note);
    }
    dialogChoices.addEventListener('click',event=>{
      if(event.target.closest('button'))dialog.close();
    });

    const capture=document.getElementById('openBrowserTab');
    const pdf=document.getElementById('openPdf');
    const webpage=document.getElementById('openWebpage');
    const tabControls=document.getElementById('tabControls');
    const fullScreen=document.getElementById('fullScreenLesson');
    [capture,pdf,webpage,tabControls,fullScreen].forEach(node=>{if(node)tools.appendChild(node)});
    if(capture)capture.textContent='📸 Capture a still image';
    const pdfInput=document.getElementById('pdfFile');
    if(pdfInput)tools.appendChild(pdfInput);

    const duplicateRequest=document.getElementById('sendEveryoneShare');
    if(duplicateRequest)duplicateRequest.hidden=true;
    const source=document.createElement('span');source.className='teacher-dashboard-source';source.hidden=true;
    controls.classList.add('teacher-dashboard-source');
    controls.insertAdjacentElement('afterend',source);

    if(dock){
      dock.querySelector('[data-menu="tbShareMenu"]')?.closest('.tb-menu-wrap')?.remove();
      dock.querySelector('#tbStudentScreensQuick')?.remove();
    }
    const closeOnEscape=event=>{if(event.key==='Escape'&&dialog.open)dialog.close()};
    document.addEventListener('keydown',closeOnEscape);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
