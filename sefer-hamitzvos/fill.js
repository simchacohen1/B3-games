(function(root){
 'use strict';
 function traceRegion(imageData,width,height,startX,startY,options={}){
  const data=imageData&&imageData.data,total=width*height;
  if(!data||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||data.length<total*4)return {reason:'invalid'};
  const x=Math.floor(startX),y=Math.floor(startY);
  if(x<0||y<0||x>=width||y>=height)return {reason:'outside'};
  const threshold=Number.isFinite(options.threshold)?options.threshold:232;
  const maxFraction=Number.isFinite(options.maxAreaFraction)?options.maxAreaFraction:.36;
  const maxArea=Math.max(1,Math.floor(total*Math.min(.9,Math.max(.01,maxFraction))));
  const open=index=>{const i=index*4;return data[i+3]>0&&data[i]>=threshold&&data[i+1]>=threshold&&data[i+2]>=threshold;};
  const start=y*width+x;
  if(!open(start))return {reason:'border'};
  const queue=new Int32Array(Math.min(total,maxArea+1));
  const visited=new Uint8Array(total);
  let head=0,tail=0,touchesEdge=false;
  queue[tail++]=start;visited[start]=1;
  while(head<tail){
   const index=queue[head++],px=index%width,py=(index/width)|0;
   if(px===0||py===0||px===width-1||py===height-1)touchesEdge=true;
   const enqueue=next=>{if(visited[next]||!open(next))return true;visited[next]=1;if(tail>=maxArea)return false;queue[tail++]=next;return true;};
   if((px>0&&!enqueue(index-1))||(px<width-1&&!enqueue(index+1))||(py>0&&!enqueue(index-width))||(py<height-1&&!enqueue(index+width)))return {reason:'large'};
  }
  if(touchesEdge)return {reason:'open'};
  return {pixels:queue.slice(0,tail)};
 }
 const api={traceRegion};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.FTTMitzvahFill=api;
})(typeof window==='object'?window:globalThis);
