'use strict';
window.createClassHighlighter=function(options){
  const C=window.ClassPointerCore,$=id=>document.getElementById(id),ns='http://www.w3.org/2000/svg';
  let strokes=[],draft=null,dragId=null;
  function svg(tag,attrs={}){const element=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([key,value])=>element.setAttribute(key,String(value)));return element}
  function tool(){return $(options.teacher?'teacherTool':'studentTool').value}
  function drawing(){return C.highlightTools.includes(tool())}
  function box(){const video=$('lesson'),rect=$('stage').getBoundingClientRect();return{rect,picture:C.pictureBox(rect.width,rect.height,video.videoWidth,video.videoHeight),width:video.videoWidth,height:video.videoHeight}}
  function point(event){const b=box();if(!b.picture)return null;const p={x:(event.clientX-b.rect.left-b.picture.left)/b.picture.w,y:(event.clientY-b.rect.top-b.picture.top)/b.picture.h};return C.validPoint(p)?p:null}
  function path(stroke,w,h,color){
    const first=stroke.points[0],last=stroke.points[stroke.points.length-1],width=stroke.size*w;
    if(stroke.tool==='box')return svg('rect',{x:Math.min(first.x,last.x)*w,y:Math.min(first.y,last.y)*h,width:Math.abs(last.x-first.x)*w,height:Math.abs(last.y-first.y)*h,fill:color});
    const points=stroke.tool==='underline'?[first,{x:last.x,y:first.y}]:stroke.points;
    return svg('path',{d:points.map((p,i)=>(i?'L':'M')+p.x*w+' '+p.y*h).join(' '),fill:'none',stroke:color,'stroke-width':width,'stroke-linecap':'round','stroke-linejoin':'round'});
  }
  function render(){
    const b=box(),layer=$('highlightLayer');layer.replaceChildren();if(!b.picture||!options.sharing())return;
    layer.style.left=b.picture.left+'px';layer.style.top=b.picture.top+'px';layer.style.width=b.picture.w+'px';layer.style.height=b.picture.h+'px';
    layer.setAttribute('viewBox','0 0 '+b.width+' '+b.height);
    const defs=svg('defs');layer.appendChild(defs);const entries=draft?[...strokes,{...draft,owner:options.owner(),id:'draft'}]:strokes;
    const owners=new Map();
    entries.forEach((stroke,index)=>{
      // Earlier marks from other people win at overlaps. A student cannot paint over another layer.
      const older=entries.slice(0,index).filter(s=>s.owner!==stroke.owner);
      let mask=null;if(older.length){mask='mask-'+stroke.id;const m=svg('mask',{id:mask,maskUnits:'userSpaceOnUse',x:0,y:0,width:b.width,height:b.height});m.appendChild(svg('rect',{width:b.width,height:b.height,fill:'white'}));older.forEach(s=>m.appendChild(path(s,b.width,b.height,'black')));defs.appendChild(m)}
      let group=owners.get(stroke.owner);if(!group){group=svg('g',{'data-owner':stroke.owner});owners.set(stroke.owner,group);layer.appendChild(group)}
      const mark=path(stroke,b.width,b.height,stroke.color);mark.setAttribute('opacity','0.32');mark.dataset.stroke=stroke.id;if(mask)mark.setAttribute('mask','url(#'+mask+')');group.appendChild(mark);
    });
  }
  function cancel(){if(dragId!==null&&$('stage').hasPointerCapture?.(dragId))$('stage').releasePointerCapture(dragId);draft=null;dragId=null;render()}
  function append(event){if(!draft||event.pointerId!==dragId)return;const p=point(event);if(!p)return;
    if(draft.tool!=='highlight'){draft.points=[draft.points[0],p];return}
    const last=draft.points[draft.points.length-1];if(Math.hypot(p.x-last.x,p.y-last.y)>0.003&&draft.points.length<256)draft.points.push(p);
  }
  $('stage').addEventListener('pointerdown',event=>{
    if(!drawing()||!options.sharing()||!options.allowed()||event.button!==0)return;const p=point(event);if(!p)return;
    event.preventDefault();dragId=event.pointerId;const color=$(options.teacher?'teacherColor':'studentColor').value||options.color();
    draft={tool:tool(),color,size:Number($(options.teacher?'teacherSize':'studentSize').value),points:[p,p]};$('stage').setPointerCapture(dragId);render();
  });
  $('stage').addEventListener('pointermove',event=>{if(!draft)return;if(!options.allowed()){cancel();return}append(event);render()});
  $('stage').addEventListener('pointerup',event=>{if(!draft||event.pointerId!==dragId)return;append(event);const stroke=draft;const mayDraw=options.allowed()&&options.sharing();cancel();if(mayDraw&&C.cleanStroke(stroke))options.submit(stroke)});
  $('stage').addEventListener('pointercancel',cancel);$('stage').addEventListener('lostpointercapture',()=>{if(draft)cancel()});
  [options.teacher?'teacherTool':'studentTool',options.teacher?'teacherColor':'studentColor',options.teacher?'teacherSize':'studentSize'].forEach(id=>$(id).addEventListener('change',cancel));
  $(options.teacher?'undoTeacherHighlight':'undoStudentHighlight').addEventListener('click',()=>{cancel();options.edit('undo')});
  $(options.teacher?'clearTeacherHighlights':'clearStudentHighlights').addEventListener('click',()=>{cancel();options.edit('clear')});
  if(options.teacher)$('clearAllHighlights').addEventListener('click',()=>{cancel();options.edit('all')});
  new ResizeObserver(render).observe($('stage'));$('lesson').addEventListener('loadedmetadata',render);$('lesson').addEventListener('resize',render);
  return{receive(next){strokes=next;render()},cancel,render,drawing};
};
