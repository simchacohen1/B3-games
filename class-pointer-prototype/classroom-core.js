(function(root){
  'use strict';
  const colors=['#57b8ff','#ff7979','#75df9a','#dca0ff','#ffa65c','#7ce4dc'];
  const tools=['target','arrow','star','heart','paw','sparkle'];
  const highlightTools=['highlight','pencil','crayon','underline','box','pen','line','pen-arrow','rectangle','ellipse','triangle','text'];
  // Dark ink colors read well on the whiteboard. They are allowed for pointers and marks, but are not class colors.
  const inkColors=['#1f2937','#1d4ed8','#777777','#ffffff','#29b6f6','#4dd0e1','#009688','#c62828','#ff7043','#ef6c00','#ffc107','#fff176','#cddc39','#8bc34a','#2e7d32','#a5d6a7','#7b1fa2','#ab47bc','#b39ddb','#ec407a','#f48fb1','#795548','#bcaaa4','#ffd1a9'];
  function cleanStroke(value){
    if(!value||!highlightTools.includes(value.tool)||!Array.isArray(value.points)||value.points.length<2||value.points.length>256||!value.points.every(validPoint))return null;
    const text=value.tool==='text'?String(value.text||'').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,240):'';if(value.tool==='text'&&!text.trim())return null;
    return{tool:value.tool,color:pointStyle(value).color||'#ffcc00',size:[0.008,0.016,0.028].includes(value.size)?value.size:0.016,points:value.points.map(({x,y})=>({x,y})),...(value.tool==='text'?{text}:{})};
  }
  class HighlightStore{
    constructor(){this.strokes=[];this.sequence=0}
    add(owner,value){const stroke=cleanStroke(value);if(!stroke)return false;
      // Highlights keep the original limits (40 per person, 240 per class). Pen writing needs more lines: 150 per person, 400 marks in total.
      const mine=this.strokes.filter(s=>s.owner===owner),pen=['pen','line','pen-arrow','rectangle','ellipse','triangle','text'].includes(stroke.tool);
      if(this.strokes.length>=400||(pen?mine.filter(s=>['pen','line','pen-arrow','rectangle','ellipse','triangle','text'].includes(s.tool)).length>=150:(mine.filter(s=>s.tool!=='pen').length>=40||this.strokes.filter(s=>s.tool!=='pen').length>=240)))return false;this.strokes.push({...stroke,owner,id:'h'+(++this.sequence)});return true}
    edit(owner,action,id){if(action==='erase'){const i=this.strokes.findIndex(s=>s.owner===owner&&s.id===id);if(i>=0)this.strokes.splice(i,1);return}if(action==='clear'){this.strokes=this.strokes.filter(s=>s.owner!==owner);return}if(action==='undo'){const i=this.strokes.findLastIndex(s=>s.owner===owner);if(i>=0)this.strokes.splice(i,1)}}
    reset(){this.strokes=[]}
  }
  function pointStyle(point){return{tool:tools.includes(point?.tool)?point.tool:'target',color:[...colors,...inkColors,'#ffcc00'].includes(point?.color)?point.color:null}}
  function cleanName(value){return typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,60):''}
  function validPoint(value){return !!value&&Number.isFinite(value.x)&&Number.isFinite(value.y)&&value.x>=0&&value.x<=1&&value.y>=0&&value.y<=1}
  function canPoint(mode,student){return !!student?.admitted&&(mode==='everyone'||(mode==='selected'&&student.allowed===true))}
  function canWrite(mode,student){return canPoint(mode,student)&&student?.writeAllowed===true}
  function pictureBox(width,height,videoWidth,videoHeight){
    if(!width||!height||!videoWidth||!videoHeight)return null;
    const scale=Math.min(width/videoWidth,height/videoHeight),w=videoWidth*scale,h=videoHeight*scale;
    return{w,h,left:(width-w)/2,top:(height-h)/2};
  }
  const api={cleanName,validPoint,canPoint,canWrite,pictureBox,colors,inkColors,tools,pointStyle,highlightTools,cleanStroke,HighlightStore};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ClassPointerCore=api;
})(typeof window==='undefined'?{}:window);
