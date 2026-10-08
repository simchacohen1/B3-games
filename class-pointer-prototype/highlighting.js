'use strict';
window.createClassHighlighter=function(options){
  const C=window.ClassPointerCore,$=id=>document.getElementById(id),ns='http://www.w3.org/2000/svg';
  let strokes=[],draft=null,dragId=null,labelTimer=null;
  const ownerLabel=document.createElement('div');ownerLabel.className='drawing-owner-label';ownerLabel.hidden=true;ownerLabel.setAttribute('aria-live','polite');$('stage').appendChild(ownerLabel);
  function svg(tag,attrs={}){const element=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([key,value])=>element.setAttribute(key,String(value)));return element}
  function tool(){return $(options.teacher?'teacherTool':'studentTool').value}
  function drawing(){return C.highlightTools.includes(tool())}
  function box(){const video=$('lesson'),rect=$('stage').getBoundingClientRect();return{rect,picture:C.pictureBox(rect.width,rect.height,video.videoWidth,video.videoHeight),width:video.videoWidth,height:video.videoHeight}}
  function point(event){const b=box();if(!b.picture)return null;const p={x:(event.clientX-b.rect.left-b.picture.left)/b.picture.w,y:(event.clientY-b.rect.top-b.picture.top)/b.picture.h};return C.validPoint(p)?p:null}
  function segmentDistance(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy;if(!len)return Math.hypot(p.x-a.x,p.y-a.y);const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len));return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy))}
  function hits(stroke,p){const first=stroke.points[0],last=stroke.points[stroke.points.length-1],threshold=Math.max(0.012,(stroke.size||0.016)*0.9);
    if(stroke.tool==='box'){const minX=Math.min(first.x,last.x),maxX=Math.max(first.x,last.x),minY=Math.min(first.y,last.y),maxY=Math.max(first.y,last.y);return p.x>=minX&&p.x<=maxX&&p.y>=minY&&p.y<=maxY}
    if(stroke.tool==='underline')return segmentDistance(p,first,{x:last.x,y:first.y})<=threshold;
    for(let i=1;i<stroke.points.length;i++)if(segmentDistance(p,stroke.points[i-1],stroke.points[i])<=threshold)return true;return false;
  }
  function hideOwner(){clearTimeout(labelTimer);ownerLabel.hidden=true}
  function showOwner(event,linger=false){if(draft){hideOwner();return}const p=point(event);if(!p){hideOwner();return}const stroke=strokes.find(item=>hits(item,p));if(!stroke){hideOwner();return}const name=options.ownerName?.(stroke.owner)|| (stroke.owner==='teacher'?'Teacher':'Student');ownerLabel.textContent=name;const rect=$('stage').getBoundingClientRect();ownerLabel.style.left=(event.clientX-rect.left+12)+'px';ownerLabel.style.top=(event.clientY-rect.top+12)+'px';ownerLabel.hidden=false;clearTimeout(labelTimer);if(linger)labelTimer=setTimeout(hideOwner,1800)}
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
      // Transparency is applied once per owner group, so a person's overlapping marks stay one flat layer instead of darkening.
      const kind=['pencil','crayon'].includes(stroke.tool)?stroke.tool:'highlight',key=stroke.owner+'|'+kind;
      let group=owners.get(key);if(!group){group=svg('g',{'data-owner':stroke.owner,'data-tool':kind,opacity:kind==='pencil'?'0.94':kind==='crayon'?'0.78':'0.32'});owners.set(key,group);layer.appendChild(group)}
      const mark=path(stroke,b.width,b.height,stroke.color);mark.dataset.strokeTool=stroke.tool;mark.dataset.stroke=stroke.id;if(mask)mark.setAttribute('mask','url(#'+mask+')');group.appendChild(mark);
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
  $('stage').addEventListener('pointermove',event=>{if(!draft){if(event.pointerType!=='touch')showOwner(event);return}hideOwner();if(!options.allowed()){cancel();return}append(event);render()});
  $('stage').addEventListener('pointerup',event=>{if(!draft||event.pointerId!==dragId)return;append(event);const stroke=draft;const mayDraw=options.allowed()&&options.sharing();cancel();if(mayDraw&&C.cleanStroke(stroke))options.submit(stroke)});
  $('stage').addEventListener('pointercancel',()=>{hideOwner();cancel()});$('stage').addEventListener('pointerleave',hideOwner);$('stage').addEventListener('click',event=>{if(event.pointerType==='touch')showOwner(event,true)});$('stage').addEventListener('lostpointercapture',()=>{if(draft)cancel()});
  [options.teacher?'teacherTool':'studentTool',options.teacher?'teacherColor':'studentColor',options.teacher?'teacherSize':'studentSize'].forEach(id=>$(id).addEventListener('change',cancel));
  $(options.teacher?'undoTeacherHighlight':'undoStudentHighlight').addEventListener('click',()=>{cancel();options.edit('undo')});
  $(options.teacher?'clearTeacherHighlights':'clearStudentHighlights').addEventListener('click',()=>{cancel();options.edit('clear')});
  if(options.teacher)$('clearAllHighlights').addEventListener('click',()=>{cancel();options.edit('all')});
  new ResizeObserver(render).observe($('stage'));$('lesson').addEventListener('loadedmetadata',render);$('lesson').addEventListener('resize',render);
  return{receive(next){strokes=next;hideOwner();render()},cancel,render,drawing};
};
