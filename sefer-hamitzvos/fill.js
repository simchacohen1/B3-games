(function(root){
 'use strict';
 let bufferWidth=0,bufferHeight=0,queue=null,seen=null,generation=0;
 function traceRegion(imageData,width,height,startX,startY,options={}){
  const data=imageData&&imageData.data,total=width*height;
  if(!data||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||data.length<total*4)return {reason:'invalid'};
  const x=Math.floor(startX),y=Math.floor(startY);
  if(x<0||y<0||x>=width||y>=height)return {reason:'outside'};
  const threshold=Number.isFinite(options.threshold)?options.threshold:232;
  const open=index=>{const i=index*4;return data[i+3]>0&&data[i]>=threshold&&data[i+1]>=threshold&&data[i+2]>=threshold;};
  const start=y*width+x;
  if(!open(start))return {reason:'border'};
  if(width!==bufferWidth||height!==bufferHeight){bufferWidth=width;bufferHeight=height;queue=new Int32Array(total);seen=new Uint32Array(total);generation=0;}
  generation++;if(generation===0){seen.fill(0);generation=1;}
  let head=0,tail=0,touchesEdge=false;
  queue[tail++]=start;seen[start]=generation;
  const enqueue=next=>{if(seen[next]===generation||!open(next))return;seen[next]=generation;queue[tail++]=next;};
  while(head<tail){
   const index=queue[head++],px=index%width,py=(index/width)|0;
   if(px===0||py===0||px===width-1||py===height-1)touchesEdge=true;
   if(px>0)enqueue(index-1);
   if(px<width-1)enqueue(index+1);
   if(py>0)enqueue(index-width);
   if(py<height-1)enqueue(index+width);
  }
  if(touchesEdge)return {reason:'open'};
  return {pixels:queue.slice(0,tail)};
 }
 const api={traceRegion};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.FTTMitzvahFill=api;
})(typeof window==='object'?window:globalThis);
