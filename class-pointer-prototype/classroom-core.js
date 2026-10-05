(function(root){
  'use strict';
  const colors=['#57b8ff','#ff7979','#75df9a','#dca0ff','#ffa65c','#7ce4dc'];
  function cleanName(value){return typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,32):''}
  function validPoint(value){return !!value&&Number.isFinite(value.x)&&Number.isFinite(value.y)&&value.x>=0&&value.x<=1&&value.y>=0&&value.y<=1}
  function canPoint(mode,student){return !!student?.admitted&&(mode==='everyone'||(mode==='selected'&&student.allowed===true))}
  function pictureBox(width,height,videoWidth,videoHeight){
    if(!width||!height||!videoWidth||!videoHeight)return null;
    const scale=Math.min(width/videoWidth,height/videoHeight),w=videoWidth*scale,h=videoHeight*scale;
    return{w,h,left:(width-w)/2,top:(height-h)/2};
  }
  const api={cleanName,validPoint,canPoint,pictureBox,colors};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ClassPointerCore=api;
})(typeof window==='undefined'?{}:window);
