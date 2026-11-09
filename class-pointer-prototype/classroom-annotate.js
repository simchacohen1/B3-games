'use strict';
/* Class Pointer teacher page: the shared drawing toolbar (annotation-toolbar.js) drives the lesson's own tools.
   While the teacher shares a screen, or shows a whiteboard, PDF or web page, the lesson is the toolbar's surface.
   Choosing a tool on the toolbar just picks the matching tool in the lesson's own (hidden) tool, color and size
   menus, so everything the teacher draws goes to the students exactly as before (same permissions, same limits).
   The toolbar opens by itself while sharing and on the whiteboard. */
(function(){
  const B=window.ClassPointerBridge,FA=window.FTTAnnotate;
  if(!B||!FA||!B.isTeacher)return;
  const $=id=>document.getElementById(id);
  const toolSel=$('teacherTool'),colorSel=$('teacherColor'),sizeSel=$('teacherSize'),stage=$('stage');
  if(!toolSel||!colorSel||!sizeSel||!stage)return;
  FA.setRole('teacher');
  // The lesson's own tool rail docks on the left; keep this toolbar on the right.
  FA.setSide('right');
  const SHAPE_TOOL={rect:'rectangle',ellipse:'ellipse',line:'line',arrow:'pen-arrow'};
  const TOOL_SHAPE=Object.fromEntries(Object.entries(SHAPE_TOOL).map(([a,b])=>[b,a]));
  const POINTERS=['target','arrow','star','heart','paw','sparkle'];
  let lastPointer='target',fromDock=false;
  function set(select,value){
    if(value==null||select.disabled)return;value=String(value);
    if(select.value===value)return;
    const option=Array.from(select.options).find(o=>o.value===value);if(!option||option.disabled)return;
    select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));
  }
  const colors=Array.from(colorSel.options).filter(o=>/^#[0-9a-f]{6}$/i.test(o.value)).map(o=>[o.value.toLowerCase(),o.textContent.trim()]);
  const sizes=Array.from(sizeSel.options).map(o=>Number(o.value)).filter(Number.isFinite);
  const black=colors.find(c=>/black/i.test(c[1]))?.[0];
  const lesson={id:'classroom',
    get defaultTool(){return B.lessonKind?.()==='whiteboard'?'pen':'pointer'},
    tools:['pointer','hand','highlight','text','shape','eraser','pen'],
    label:'Drawing on your lesson. Students see it. (Select is not available here.)',
    rect:()=>B.lessonKind?.()?stage.getBoundingClientRect():null,
    colors:colors.length?colors:undefined,
    sizes:()=>sizes.length?sizes:undefined,
    delegate:{
      apply({tool,shape,color,size,open}){
        if(fromDock)return;
        B.setNavigation?.(tool==='hand'&&open);
        if(tool==='pointer')set(toolSel,lastPointer);
        else if(tool==='shape')set(toolSel,SHAPE_TOOL[shape]);
        else if(['highlight','text','eraser','pen'].includes(tool))set(toolSel,tool);
        if(tool!=='hand'&&tool!=='eraser'){set(colorSel,color);set(sizeSel,size)}
      },
      minimized(){B.setNavigation?.(false)},
      undo(){$('undoTeacherHighlight')?.click()},
      clear(){$('clearTeacherHighlights')?.click()}
    }};
  // The teacher may still use the lesson's own toolbar; show the same tool on this one.
  toolSel.addEventListener('change',()=>{
    const v=toolSel.value;let tool=null,shape;
    if(POINTERS.includes(v)){lastPointer=v;tool='pointer'}
    else if(v==='highlight'||v==='box')tool='highlight';
    else if(TOOL_SHAPE[v]){tool='shape';shape=TOOL_SHAPE[v]}
    else if(['pen','text','eraser'].includes(v))tool=v;
    else if(v==='triangle')tool='shape';
    if(!tool||FA.state().surface!=='classroom')return;
    fromDock=true;try{FA.select(tool,{shape})}finally{fromDock=false}
  });
  let pushed=false,lastKind=null;
  function check(){
    const kind=B.lessonKind?.()||null;
    if(kind&&!pushed){pushed=true;FA.push(lesson)}
    else if(!kind&&pushed){pushed=false;FA.release(lesson)}
    if(kind!==lastKind){
      lastKind=kind;
      if(kind==='whiteboard')FA.select('pen',{color:black});
      FA.setReason('sharing',kind==='screen');
      FA.setReason('whiteboard',kind==='whiteboard');
    }
    // Hand = the lesson's mouse mode. A key press there turns it off, so keep it on while Hand is chosen.
    const s=FA.state();
    if(pushed&&s.surface==='classroom'&&s.mode==='open'&&s.tool==='hand'&&!B.navigating?.())B.setNavigation?.(true);
  }
  setInterval(check,400);check();
})();
