(function(root){
  'use strict';
  const colors=['#57b8ff','#ff7979','#75df9a','#dca0ff','#ffa65c','#7ce4dc'];
  const tools=['target','arrow','star','heart','paw','sparkle'];
  const highlightTools=['highlight','pencil','crayon','underline','box'];
  function cleanStroke(value){
    if(!value||!highlightTools.includes(value.tool)||!Array.isArray(value.points)||value.points.length<2||value.points.length>256||!value.points.every(validPoint))return null;
    return{tool:value.tool,color:pointStyle(value).color||'#ffcc00',size:[0.008,0.016,0.028].includes(value.size)?value.size:0.016,points:value.points.map(({x,y})=>({x,y}))};
  }
  class HighlightStore{
    constructor(){this.strokes=[];this.sequence=0}
    add(owner,value){const stroke=cleanStroke(value);if(!stroke||this.strokes.length>=240||this.strokes.filter(s=>s.owner===owner).length>=40)return false;this.strokes.push({...stroke,owner,id:'h'+(++this.sequence)});return true}
    edit(owner,action){if(action==='clear'){this.strokes=this.strokes.filter(s=>s.owner!==owner);return}if(action==='undo'){const i=this.strokes.findLastIndex(s=>s.owner===owner);if(i>=0)this.strokes.splice(i,1)}}
    reset(){this.strokes=[]}
  }
  function pointStyle(point){return{tool:tools.includes(point?.tool)?point.tool:'target',color:[...colors,'#ffcc00'].includes(point?.color)?point.color:null}}
  function cleanName(value){return typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,32):''}
  function validPoint(value){return !!value&&Number.isFinite(value.x)&&Number.isFinite(value.y)&&value.x>=0&&value.x<=1&&value.y>=0&&value.y<=1}
  function canPoint(mode,student){return !!student?.admitted&&(mode==='everyone'||(mode==='selected'&&student.allowed===true))}
  function canWrite(mode,student){return canPoint(mode,student)&&student?.writeAllowed===true}
  function pictureBox(width,height,videoWidth,videoHeight){
    if(!width||!height||!videoWidth||!videoHeight)return null;
    const scale=Math.min(width/videoWidth,height/videoHeight),w=videoWidth*scale,h=videoHeight*scale;
    return{w,h,left:(width-w)/2,top:(height-h)/2};
  }
  const api={cleanName,validPoint,canPoint,canWrite,pictureBox,colors,tools,pointStyle,highlightTools,cleanStroke,HighlightStore};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ClassPointerCore=api;
})(typeof window==='undefined'?{}:window);
