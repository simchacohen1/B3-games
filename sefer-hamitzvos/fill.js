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
  // Protect against tiny breaks in full-resolution artwork without erasing the
  // interiors of small shapes in thumbnails and tiny canvases.
  const radius=Number.isInteger(options.guardRadius)?Math.max(0,Math.min(2,options.guardRadius)):(Math.min(width,height)>=128?2:0);
  const blocked=new Uint8Array(total);
  if(radius){
   for(let py=0;py<height;py++)for(let px=0;px<width;px++){
    const i=(py*width+px)*4;
    if(data[i+3]>0&&(data[i]<threshold||data[i+1]<threshold||data[i+2]<threshold)){
     for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
      const xx=px+dx,yy=py+dy;
      if(xx>=0&&yy>=0&&xx<width&&yy<height)blocked[yy*width+xx]=1;
     }
    }
   }
  }
  const start=y*width+x;
  if(blocked[start]||!open(start))return {reason:'border'};
  if(width!==bufferWidth||height!==bufferHeight){bufferWidth=width;bufferHeight=height;queue=new Int32Array(total);seen=new Uint32Array(total);generation=0;}
  generation=(generation+1)>>>0;if(generation===0){seen.fill(0);generation=1;}
  let head=0,tail=0,touchesEdge=false;
  queue[tail++]=start;seen[start]=generation;
  const enqueue=next=>{if(seen[next]===generation||blocked[next]||!open(next))return;seen[next]=generation;queue[tail++]=next;};
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
