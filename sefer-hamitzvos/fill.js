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
 // Compile an immutable mask from native-resolution artwork once per load.
 // Separable sliding windows make closing linear in the number of pixels.
 function morphology(input,width,height,radius,dilate){
  const horizontal=new Uint8Array(input.length),out=new Uint8Array(input.length),span=radius*2+1;
  for(let y=0;y<height;y++){
   let sum=0;for(let x=-radius;x<=radius;x++)sum+=x<0||x>=width?1:input[y*width+x];
   for(let x=0;x<width;x++){
    horizontal[y*width+x]=dilate?Number(sum>0):Number(sum===span);
    const left=x-radius,right=x+radius+1;
    sum-=(left<0||left>=width?1:input[y*width+left]);sum+=(right<0||right>=width?1:input[y*width+right]);
   }
  }
  for(let x=0;x<width;x++){
   let sum=0;for(let y=-radius;y<=radius;y++)sum+=y<0||y>=height?1:horizontal[y*width+x];
   for(let y=0;y<height;y++){
    out[y*width+x]=dilate?Number(sum>0):Number(sum===span);
    const top=y-radius,bottom=y+radius+1;
    sum-=(top<0||top>=height?1:horizontal[top*width+x]);sum+=(bottom<0||bottom>=height?1:horizontal[bottom*width+x]);
   }
  }
  return out;
 }
 function createRegionMask(imageData,width,height){
  const data=imageData?.data,total=width*height;
  if(!data||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||data.length!==total*4)return null;
  const ink=new Uint8Array(total);
  for(let i=0;i<total;i++)ink[i]=Number(data[i*4+3]===0||data[i*4]<232||data[i*4+1]<232||data[i*4+2]<232);
  const radius=Math.max(2,Math.round(Math.min(width,height)/180));
  const barrier=morphology(morphology(ink,width,height,radius,true),width,height,radius,false);
  for(let i=0;i<total;i++)if(ink[i])barrier[i]=1;
  const labels=new Uint32Array(total),queue=new Int32Array(total);let id=0;
  for(let start=0;start<total;start++){
   if(barrier[start]||labels[start])continue;
   id++;let head=0,tail=1,touchesEdge=false;queue[0]=start;labels[start]=id;
   const add=i=>{if(!barrier[i]&&!labels[i]){labels[i]=id;queue[tail++]=i}};
   while(head<tail){const i=queue[head++],x=i%width,y=(i/width)|0;
    if(!x||!y||x===width-1||y===height-1)touchesEdge=true;
    if(x)add(i-1);if(x<width-1)add(i+1);if(y)add(i-width);if(y<height-1)add(i+width);
   }
   if(touchesEdge||tail>total*.18)for(let n=0;n<tail;n++)barrier[queue[n]]=1;
  }
  for(let i=0;i<total;i++)if(barrier[i])labels[i]=0;
  return {width,height,labels};
 }
 // New strokes use precomputed, immutable region labels. A missing or invalid
 // mask fails closed; never fall back to flood-filling an ambiguous picture.
 function regionFromMask(mask,width,height,startX,startY){
  const data=mask&&mask.data,labels=mask&&mask.labels,total=width*height;
  if(!mask||mask.width!==width||mask.height!==height||(!labels&&(!data||data.length!==total*4))||(labels&&labels.length!==total))return {reason:'unavailable'};
  const x=Math.floor(startX),y=Math.floor(startY);
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=width||y>=height)return {reason:'outside'};
  const labelAt=i=>labels?labels[i]:data[i*4]|(data[i*4+1]<<8)|(data[i*4+2]<<16);
  const label=labelAt(y*width+x);
  if(!label)return {reason:'border'};
  // Recoloring one region should not rescan 1.5 million pixels on every tap.
  // Cache only a handful of bounded regions; source labels remain unchanged.
  if(labels&&mask.recentPixels?.has(label)){
   const saved=mask.recentPixels.get(label);
   mask.recentPixels.delete(label);mask.recentPixels.set(label,saved);
   return {pixels:saved,region:label};
  }
  const pixels=[];
  for(let i=0;i<total;i++)if(labelAt(i)===label)pixels.push(i);
  if(!pixels.length||pixels.length>total*.18)return {reason:'open'};
  const result=Uint32Array.from(pixels);
  if(labels){
   if(!mask.recentPixels)mask.recentPixels=new Map();
   mask.recentPixels.set(label,result);
   while(mask.recentPixels.size>4)mask.recentPixels.delete(mask.recentPixels.keys().next().value);
  }
  return {pixels:result,region:label};
 }
 const api={traceRegion,createRegionMask,regionFromMask};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.FTTMitzvahFill=api;
})(typeof window==='object'?window:globalThis);
