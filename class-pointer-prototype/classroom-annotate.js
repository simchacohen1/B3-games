'use strict';
/* Class Pointer classroom page: the shared drawing toolbar (annotation-toolbar.js) is the only toolbar.
   The lesson is the toolbar's surface. Choosing a tool on the toolbar just picks the matching tool in the
   lesson's own (hidden) tool, color and size menus, so everything goes to the class exactly as before
   (same permissions, same limits).

   Teacher: the toolbar opens by itself whenever a lesson is live. Besides the drawing tools it has
   • kinds of a tool: pointer shapes, highlight box, triangle (click the chosen tool again);
   • Clear: my drawings, my pointer, everyone's drawings, all pointers;
   • Students (who can point and draw), a red Stop in full screen, Lesson (switch what students see, zoom
     the shared screen) and More (full screen, spotlight, save);
   • keys: P pointer, H highlight, B highlight box, D pen, E eraser, U undo.
   It sits in its own strip on the left, so it never covers the lesson.

   Student who joined with a class link (?room=): the same toolbar, with only the tools the teacher allowed.
   It shows only while the teacher allows at least one tool. */
(function(){
  const B=window.ClassPointerBridge,FA=window.FTTAnnotate;
  if(!B||!FA)return;
  const $=id=>document.getElementById(id);
  const teacher=!!B.isTeacher;
  const toolSel=$(teacher?'teacherTool':'studentTool'),colorSel=$(teacher?'teacherColor':'studentColor'),sizeSel=$(teacher?'teacherSize':'studentSize'),stage=$('stage');
  if(!toolSel||!colorSel||!sizeSel||!stage)return;
  const usable=id=>{const node=$(id);return !!node&&!node.disabled};
  const click=id=>{if(usable(id))$(id).click()};
  const hasClass=name=>document.body.classList.contains(name);

  // ---------- Toolbar tools <-> the lesson's own tool menu ----------
  // [toolbar kind, icon, name, value in the lesson's tool menu (when it differs)]
  const POINTERS=[['target','◎','Target'],['arrow','➤','Arrow'],['star','★','Star'],['heart','♥','Heart'],['paw','🐾','Paw print'],['sparkle','✦','Sparkle']];
  const HIGHLIGHTS=[['highlight','🖍','Highlighter'],['box','▧','Highlight box']];
  const SHAPES=[['rect','▭','Rectangle','rectangle'],['ellipse','◯','Circle','ellipse'],['line','━','Line','line'],['arrow','➜','Arrow','pen-arrow'],['triangle','△','Triangle','triangle']];
  const valueOf=kind=>kind[3]||kind[0];
  // The teacher's choices show up as disabled options in the student's tool menu.
  const allowed=value=>{if(toolSel.disabled)return false;const o=Array.from(toolSel.options).find(o=>o.value===value);return !!o&&!o.disabled};
  const kinds=list=>list.filter(kind=>allowed(valueOf(kind))).map(kind=>kind.slice(0,3));
  function tools(){
    const out=['hand'];
    if(kinds(POINTERS).length)out.push('pointer');
    if(kinds(HIGHLIGHTS).length)out.push('highlight');
    if(allowed('text'))out.push('text');
    if(kinds(SHAPES).length)out.push('shape');
    if(allowed('eraser'))out.push('eraser');
    if(allowed('pen'))out.push('pen');
    return out;
  }
  let fromLesson=false;
  function set(select,value){
    if(value==null||select.disabled)return;value=String(value);
    if(select.value===value)return;
    const option=Array.from(select.options).find(o=>o.value===value);if(!option||option.disabled)return;
    select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));
  }
  // '' in the student's color menu is the class color the teacher gave him.
  const colors=Array.from(colorSel.options).filter(o=>!o.value||/^#[0-9a-f]{6}$/i.test(o.value)).map(o=>[o.value.toLowerCase(),o.textContent.trim()]);
  const sizes=Array.from(sizeSel.options).map(o=>Number(o.value)).filter(Number.isFinite);
  const black=colors.find(c=>/black/i.test(c[1]))?.[0];
  const expanded=()=>stage.classList.contains('lesson-fullscreen')||document.fullscreenElement===stage;
  // The lesson is in front (not the Student screens or Student whiteboards gallery, not the student's own whiteboard).
  const inFront=()=>!hasClass('cp-student-workspace')&&!(!teacher&&hasClass('boards-on'));
  const studentMay=()=>!!(B.allowed?.()||B.writingAllowed?.('highlight')||B.writingAllowed?.('pen'));
  const lessonOn=()=>teacher?!!B.lessonKind?.():studentMay();
  const lesson={id:'classroom',
    get defaultTool(){return teacher&&B.lessonKind?.()==='whiteboard'?'pen':'pointer'},
    get tools(){return tools()},
    get variants(){return{pointer:kinds(POINTERS),highlight:kinds(HIGHLIGHTS),shape:kinds(SHAPES)}},
    keys:{p:{tool:'pointer'},h:{tool:'highlight',variant:'highlight'},b:{tool:'highlight',variant:'box'},d:{tool:'pen'},e:{tool:'eraser'},u:'undo'},
    label:teacher?'Drawing on your lesson. Students see it. (Select is not available here.)':'Your tools for the lesson. Your teacher chooses which ones you can use.',
    rect:()=>lessonOn()&&inFront()?stage.getBoundingClientRect():null,
    colors:colors.length?colors:undefined,
    defaultColor:teacher?undefined:'',
    sizes:()=>sizes.length?sizes:undefined,
    delegate:{
      apply({tool,variant,color,size,open}){
        if(fromLesson)return;
        B.setNavigation?.(tool==='hand'&&open);
        if(tool==='pointer'||tool==='highlight')set(toolSel,variant);
        else if(tool==='shape')set(toolSel,valueOf(SHAPES.find(kind=>kind[0]===variant)||[]));
        else if(['text','eraser','pen'].includes(tool))set(toolSel,tool);
        if(tool!=='hand'&&tool!=='eraser'){set(colorSel,color);set(sizeSel,size)}
      },
      minimized(){B.setNavigation?.(false)},
      undo(){click(teacher?'undoTeacherHighlight':'undoStudentHighlight')},
      // A student can only clear his own drawings. The teacher gets the four choices.
      clear:teacher?undefined:()=>click('clearStudentHighlights'),
      clearMenu:teacher?()=>[
        {heading:'Mine'},
        {icon:'✏️',label:'My drawings',onClick:()=>click('clearTeacherHighlights')},
        {icon:'🔴',label:'My pointer',onClick:()=>click('clearTeacher')},
        {heading:'Whole class'},
        {icon:'🧽',label:'Everyone’s drawings',danger:true,onClick:()=>click('clearAllHighlights')},
        {icon:'🧹',label:'All pointers',danger:true,onClick:()=>click('clearAll')}
      ]:undefined
    }};
  // Something else changed the lesson's tool (for example the teacher took a tool away): show it on the toolbar.
  toolSel.addEventListener('change',()=>{
    const v=toolSel.value;let tool=null,variant;
    if(POINTERS.some(kind=>kind[0]===v)){tool='pointer';variant=v}
    else if(HIGHLIGHTS.some(kind=>kind[0]===v)){tool='highlight';variant=v}
    else if(SHAPES.some(kind=>valueOf(kind)===v)){tool='shape';variant=SHAPES.find(kind=>valueOf(kind)===v)[0]}
    else if(['pen','text','eraser'].includes(v))tool=v;
    if(!tool||FA.state().surface!=='classroom')return;
    fromLesson=true;try{FA.select(tool,{variant})}finally{fromLesson=false}
  });

  // ---------- Student (class link): the toolbar shows while the teacher allows a tool ----------
  if(!teacher){
    let pushed=false,lastSig='';
    const check=()=>{
      const on=studentMay()&&inFront();
      if(on&&!pushed){pushed=true;FA.push(lesson)}
      else if(!on&&pushed){pushed=false;FA.release(lesson)}
      FA.setReason('lesson',on);
      const sig=on?tools().join()+'|'+[POINTERS,HIGHLIGHTS,SHAPES].map(list=>kinds(list).length).join():'';
      if(sig!==lastSig){lastSig=sig;FA.refresh()}
      const s=FA.state();
      if(pushed&&s.surface==='classroom'&&s.mode==='open'&&s.tool==='hand'&&!B.navigating?.())B.setNavigation?.(true);
    };
    setInterval(check,400);check();
    return;
  }

  // ---------- Teacher ----------
  FA.setRole('teacher');
  const live=()=>hasClass('cp-is-live');
  const stopLabel=()=>$('cpStopBtn')?.textContent.trim()||'Stop';
  const SOURCES=[['shareScreen','🖥','Share my screen'],['openWhiteboard','📝','Whiteboard'],['openPdf','📄','PDF from this computer'],['pointerPdfLibrary','📚','My PDF library'],['openWebpage','🌐','Webpage'],['openBrowserTab','📷','Still picture of a tab']];
  // While a screen is shared, viewport.js adds these buttons (kept hidden in #tbViewSlot).
  const VIEW=[['viewChooseArea','✂️','Choose the part to share'],['viewShareFull','🖥','Share the whole screen'],['viewZoomIn','➕','Zoom in',true],['viewZoomOut','➖','Zoom out',true],['viewMove','✋','Move the zoomed view',true]];
  function lessonItems(){
    const out=[{heading:live()?'Switch to':'Teach from'}];
    for(const [id,icon,label] of SOURCES)if($(id))out.push({icon,label,disabled:!usable(id),onClick:()=>click(id)});
    if($('viewChooseArea')){
      out.push({heading:'What students see'+($('viewZoomLabel')?' · '+$('viewZoomLabel').textContent:'')});
      for(const [id,icon,label,keepOpen] of VIEW)if($(id))out.push({icon,label,keepOpen,disabled:!usable(id),pressed:id==='viewMove'?$(id).getAttribute('aria-pressed')==='true':undefined,onClick:()=>click(id)});
    }
    if(live())out.push({heading:'Finished'},{icon:'⏹',label:stopLabel(),danger:true,onClick:()=>click('cpStopBtn')});
    return out;
  }
  function moreItems(){
    const full=expanded(),spot=$('spotlight'),saved=window.FTTSavedWork;
    const out=[{icon:full?'⤢':'⛶',label:full?'Exit full screen':'Full screen',onClick:()=>$(full?'exitFullScreenLesson':'fullScreenLesson')?.click()}];
    if(spot)out.push({icon:'🔦',label:spot.checked?'Spotlight: on':'Spotlight',title:'Dim the lesson around your pointer',pressed:spot.checked,
      onClick(){spot.checked=!spot.checked;spot.dispatchEvent(new Event('change',{bubbles:true}))}});
    // Saved work is another script that may load later: look for it each time the menu opens.
    if(saved)out.push({heading:'Saved work'},
      {id:'save',icon:'💾',label:'Save',onClick:()=>window.FTTSavedWork?.saveCurrent?.()},
      {id:'files',icon:'📂',label:'My files',onClick:()=>window.FTTSavedWork?.open?.()});
    return out;
  }
  function actions(){
    const panel=window.ClassPointerStudentsPanel,waiting=panel?.waiting?.()||0;
    return [
      {id:'students',icon:'👥',label:'Students',primary:true,hidden:!panel,pressed:!!panel?.isOpen?.(),badge:waiting?String(waiting):'',
        title:'Students: choose who can point and draw'+(waiting?' ('+waiting+' waiting to join)':''),onClick:()=>panel.toggle()},
      // Outside full screen the red Stop button is right above the lesson.
      {id:'stop',icon:'⏹',label:'Stop',danger:true,hidden:!(expanded()&&live()),title:stopLabel(),onClick:()=>click('cpStopBtn')},
      {id:'lesson',icon:'🖥',label:'Lesson',title:'Lesson: change what students see',items:lessonItems},
      {id:'more',icon:'⋯',label:'More',title:'More: full screen, spotlight'+(window.FTTSavedWork?', save':''),items:moreItems}
    ];
  }
  FA.setActions?.(actions);
  // Everything the buttons and menus show, as one string: the toolbar is redrawn only when it changes.
  function signature(){
    const panel=window.ClassPointerStudentsPanel;
    return [B.lessonKind?.()||'',expanded(),live(),stopLabel(),!!panel,!!panel?.isOpen?.(),panel?.waiting?.()||0,!!$('spotlight')?.checked,!!window.FTTSavedWork,
      SOURCES.map(s=>$(s[0])?usable(s[0]):'-').join(),VIEW.map(v=>$(v[0])?usable(v[0]):'-').join(),$('viewZoomLabel')?.textContent||'',$('viewMove')?.getAttribute('aria-pressed')||''].join('|');
  }

  // The toolbar gets its own strip on the left: the page (in full screen: the lesson) is made a little narrower
  // instead of being covered. The lesson itself moves, not the things inside it, so pointers and drawings stay
  // exactly where they are. If the teacher drags the toolbar away from the left edge, the full width comes back.
  let gutter=0;
  function placeGutter(){
    const r=FA.barRect?.(),main=stage.parentElement;
    let next=0;
    if(r&&r.left<=24&&main&&hasClass('teacher-view')){
      next=Math.max(0,Math.round(r.right+8-(expanded()?0:main.getBoundingClientRect().left)));if(next>160)next=0;
    }
    if(next===gutter)return;gutter=next;
    document.body.classList.toggle('cp-tool-gutter',next>0);
    document.body.style.setProperty('--cp-tool-gutter',next+'px');
    // Let the PDF, whiteboard and pointer layers measure the lesson again.
    setTimeout(()=>window.dispatchEvent(new Event('resize')),60);
  }

  // Back on My screen the toolbar starts on the Pointer.
  document.addEventListener('class-pointer-workspace',event=>{if(event.detail==='teach')FA.select('pointer')});

  let pushed=false,lastKind=null,lastSig='',wasExpanded=false;
  function check(){
    const kind=B.lessonKind?.()||null,ended=!kind&&!!lastKind;
    if(kind&&!pushed){pushed=true;FA.push(lesson)}
    else if(!kind&&pushed){pushed=false;FA.release(lesson)}
    if(kind!==lastKind){
      lastKind=kind;
      // The toolbar opens by itself for every kind of lesson and shrinks to the pencil when the lesson ends.
      FA.setReason('lesson',!!kind);
      if(kind==='whiteboard')FA.select('pen',{color:black});
      FA.setReason('sharing',kind==='screen');
      FA.setReason('whiteboard',kind==='whiteboard');
    }
    // Full screen hides the top bar and the tabs, so the toolbar is the way out: keep it open when full screen starts or the lesson ends there.
    const full=expanded();
    if(full&&(!wasExpanded||ended)&&FA.state().mode!=='open')FA.open();
    wasExpanded=full;
    const sig=signature();
    if(sig!==lastSig){lastSig=sig;FA.refresh()}
    placeGutter();
    // Hand = the lesson's mouse mode. A key press there turns it off, so keep it on while Hand is chosen.
    const s=FA.state();
    if(pushed&&s.surface==='classroom'&&s.mode==='open'&&s.tool==='hand'&&!B.navigating?.())B.setNavigation?.(true);
  }
  setInterval(check,400);check();
})();
