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
 function segmentRegions(imageData,width,height){
  const data=imageData?.data,total=width*height;
  if(!data||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||data.length!==total*4)return null;
  const ink=new Uint8Array(total);
  for(let i=0;i<total;i++)ink[i]=Number(data[i*4+3]===0||data[i*4]<232||data[i*4+1]<232||data[i*4+2]<232);
  const radius=Math.max(2,Math.round(Math.min(width,height)/180));
  const barrier=morphology(morphology(ink,width,height,radius,true),width,height,radius,false);
  for(let i=0;i<total;i++)if(ink[i])barrier[i]=1;
  const labels=new Uint32Array(total),queue=new Int32Array(total),open=new Uint8Array(total);let id=0;
  for(let start=0;start<total;start++){
   if(barrier[start]||labels[start])continue;
   id++;let head=0,tail=1,touchesEdge=false;queue[0]=start;labels[start]=id;
   const add=i=>{if(!barrier[i]&&!labels[i]){labels[i]=id;queue[tail++]=i}};
   while(head<tail){const i=queue[head++],x=i%width,y=(i/width)|0;
    if(!x||!y||x===width-1||y===height-1)touchesEdge=true;
    if(x)add(i-1);if(x<width-1)add(i+1);if(y)add(i-width);if(y<height-1)add(i+width);
   }
   if(touchesEdge||tail>total*.18)for(let n=0;n<tail;n++){barrier[queue[n]]=1;open[queue[n]]=1;}
  }
  for(let i=0;i<total;i++)if(barrier[i])labels[i]=0;
  return {width,height,labels,open,ink,radius};
 }
 function createRegionMask(imageData,width,height){
  const seg=segmentRegions(imageData,width,height);
  return seg?{width:seg.width,height:seg.height,labels:seg.labels}:null;
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
 // The closing step deliberately puts virtual barriers over short cracks.
 // Their white fringe should still be colored, without ever painting real ink
 // or another labeled region. This is a limited cosmetic recovery only: it does
 // not guess whether separately outlined semantic objects should be merged.
 function includeSafeWhiteFringe(mask,imageData,result,maxDistance=2){
  if(!result?.pixels||!mask?.labels||!imageData?.data)return result;
  const {width,height,labels}=mask,total=width*height,data=imageData.data;
  if(!Number.isInteger(width)||!Number.isInteger(height)||labels.length!==total||data.length!==total*4)return result;
  const original=result.pixels,region=result.region;
  if(!region)return result;
  if(!mask.fringeCache)mask.fringeCache=new Map();
  if(mask.fringeCache.has(region)){
   const saved=mask.fringeCache.get(region);
   mask.fringeCache.delete(region);mask.fringeCache.set(region,saved);
   return {pixels:saved,region};
  }
  const seen=new Uint8Array(total),added=[];
  for(const i of original)seen[i]=1;
  let frontier=original;
  for(let step=0;step<maxDistance&&frontier.length;step++){
   const next=[];
   for(const i of frontier){
    const x=i%width,y=(i/width)|0;
    const neighbours=[x?i-1:-1,x+1<width?i+1:-1,y?i-width:-1,y+1<height?i+width:-1];
    for(const j of neighbours){
     if(j<0||seen[j]||labels[j])continue;
     seen[j]=1;
     const p=j*4;
     if(data[p+3]===0||data[p]<232||data[p+1]<232||data[p+2]<232)continue;
     // Require enclosure on at least two sides: never bleed out through a
     // one-sided outline crack into white background.
     const near=[j%width?j-1:-1,(j%width)+1<width?j+1:-1,j>=width?j-width:-1,j+width<total?j+width:-1];
     if(near.filter(k=>k>=0&&labels[k]===region).length<2)continue;
     // A gap bordering another valid region is not safe to reclaim.
     const xx=j%width,yy=(j/width)|0;
     let competing=false;
     for(let dy=-1;dy<=1&&!competing;dy++)for(let dx=-1;dx<=1;dx++){
      const nx=xx+dx,ny=yy+dy;if(nx<0||ny<0||nx>=width||ny>=height)continue;
      const other=labels[ny*width+nx];
      if(other&&other!==region){competing=true;break;}
     }
     if(competing)continue;
     added.push(j);next.push(j);
    }
   }
   frontier=next;
  }
  const expanded=new Uint32Array(original.length+added.length);
  expanded.set(original);expanded.set(added,original.length);
  mask.fringeCache.set(region,expanded);
  while(mask.fringeCache.size>4)mask.fringeCache.delete(mask.fringeCache.keys().next().value);
  return {pixels:expanded,region};
 }
 // ---- Object-aware sections (objectVersion 2) -------------------------------
 // The sections above stop at every ink line, so a thin fold line cuts one pair
 // of pants into strips. Object masks start from those same sections and then:
 //  1. let each section grow over the thin-line slivers around it (never over a
 //     thick outline and never into the open background), so no white gaps stay;
 //  2. join sections ONLY where region-groups.js names them. Image analysis
 //     cannot tell a fold line from the edge of a hand, so nothing is guessed.
 // Groups are written as seed points, so they survive any change in section numbering.
 function thickRadius(width,height){return Math.max(1,Math.round(Math.min(width,height)/500));}
 function growIntoSlivers(seg,thick,area){
  const {labels,open,width,height,radius}=seg,total=width*height,out=Uint32Array.from(labels);
  const reach=radius*8+24;let frontier=[];
  for(let i=0;i<total;i++)if(labels[i])frontier.push(i);
  for(let step=0;step<reach&&frontier.length;step++){
   const next=[];
   for(const i of frontier){
    const x=i%width,y=(i/width)|0,id=out[i];
    if(x&&!out[i-1]&&!thick[i-1]&&!open[i-1]&&area[i]===area[i-1]){out[i-1]=id;next.push(i-1);}
    if(x<width-1&&!out[i+1]&&!thick[i+1]&&!open[i+1]&&area[i]===area[i+1]){out[i+1]=id;next.push(i+1);}
    if(y&&!out[i-width]&&!thick[i-width]&&!open[i-width]&&area[i]===area[i-width]){out[i-width]=id;next.push(i-width);}
    if(y<height-1&&!out[i+width]&&!thick[i+width]&&!open[i+width]&&area[i]===area[i+width]){out[i+width]=id;next.push(i+width);}
   }
   frontier=next;
  }
  return out;
 }
 // White pockets that were too narrow for a section of their own (e.g. a belt
 // band) become small sections instead of unpaintable gaps.
 function labelLeftoverPockets(seg,grown,thick){
  const {width,height,ink,open}=seg,total=width*height,queue=new Int32Array(total);
  let next=0;for(let i=0;i<total;i++)if(grown[i]>next)next=grown[i];
  const seen=new Uint8Array(total),free=i=>!seen[i]&&!grown[i]&&!ink[i]&&!open[i]&&!thick[i];
  for(let s=0;s<total;s++){
   if(!free(s))continue;
   let head=0,tail=1,edge=false;queue[0]=s;seen[s]=1;
   while(head<tail){const i=queue[head++],x=i%width,y=(i/width)|0;
    if(!x||!y||x===width-1||y===height-1)edge=true;
    if(x&&free(i-1)){seen[i-1]=1;queue[tail++]=i-1;}
    if(x<width-1&&free(i+1)){seen[i+1]=1;queue[tail++]=i+1;}
    if(y&&free(i-width)){seen[i-width]=1;queue[tail++]=i-width;}
    if(y<height-1&&free(i+width)){seen[i+width]=1;queue[tail++]=i+width;}
   }
   if(edge||tail<12||tail>total*.02)continue;
   next++;for(let n=0;n<tail;n++)grown[queue[n]]=next;
  }
 }
 // Specks too small for a finger (a few pixels wide) join the neighbouring
 // section they share the longest border with; they never stay as dead spots.
 function absorbSpecks(grown,width,height){
  const total=width*height,minArea=Math.max(30,Math.round(total*6e-5)),area=new Map();
  for(let i=0;i<total;i++)if(grown[i])area.set(grown[i],(area.get(grown[i])||0)+1);
  const contact=new Map();
  const touch=(a,b)=>{if(!a||!b||a===b)return;if(area.get(a)>=minArea&&area.get(b)>=minArea)return;
   let m=contact.get(a);if(!m){m=new Map();contact.set(a,m);}m.set(b,(m.get(b)||0)+1);
   m=contact.get(b);if(!m){m=new Map();contact.set(b,m);}m.set(a,(m.get(a)||0)+1);};
  for(let i=0;i<total;i++){const l=grown[i];if(!l)continue;if(i%width<width-1)touch(l,grown[i+1]);if(i+width<total)touch(l,grown[i+width]);}
  // Smallest first, so chains of specks collapse into the real section behind them.
  const target=new Map(),root=a=>{while(target.has(a))a=target.get(a);return a;};
  for(const [l,n] of [...area].filter(([,n])=>n<minArea).sort((a,b)=>a[1]-b[1])){
   const m=contact.get(l);if(!m)continue;let best=0,bestN=0;
   for(const [o,c] of m){const r=root(o);if(r===l)continue;if(c>bestN&&(area.get(r)||0)>n){best=r;bestN=c;}}
   if(best)target.set(l,best);
  }
  if(!target.size)return;
  for(let i=0;i<total;i++){const l=grown[i];if(l&&target.has(l))grown[i]=root(l);}
 }
 function outlineSections(seg,thick){
  // Sections bounded only by THICK outlines (fold lines ignored), used by a
  // group written as {seed, within:'outline'}.
  const {width,height,radius}=seg,total=width*height;
  const barrier=morphology(morphology(thick,width,height,radius,true),width,height,radius,false);
  for(let i=0;i<total;i++)if(thick[i])barrier[i]=1;
  const comp=new Uint32Array(total),queue=new Int32Array(total);let id=0;
  for(let s=0;s<total;s++){
   if(barrier[s]||comp[s])continue;
   id++;let head=0,tail=1;queue[0]=s;comp[s]=id;
   while(head<tail){const i=queue[head++],x=i%width,y=(i/width)|0;
    if(x&&!barrier[i-1]&&!comp[i-1]){comp[i-1]=id;queue[tail++]=i-1;}
    if(x<width-1&&!barrier[i+1]&&!comp[i+1]){comp[i+1]=id;queue[tail++]=i+1;}
    if(y&&!barrier[i-width]&&!comp[i-width]){comp[i-width]=id;queue[tail++]=i-width;}
    if(y<height-1&&!barrier[i+width]&&!comp[i+width]){comp[i+width]=id;queue[tail++]=i+width;}
   }
  }
  return comp;
 }
 function createObjectMask(imageData,width,height,groups){
  const seg=segmentRegions(imageData,width,height);
  if(!seg)return null;
  const total=width*height,rt=thickRadius(width,height);
  const thick=morphology(morphology(seg.ink,width,height,rt,false),width,height,rt,true);
  const area=outlineSections(seg,thick),grown=growIntoSlivers(seg,thick,area);labelLeftoverPockets(seg,grown,thick);absorbSpecks(grown,width,height);
  const parent=new Map(),find=a=>{while(parent.has(a))a=parent.get(a);return a;};
  const union=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent.set(Math.max(a,b),Math.min(a,b));};
  const labelAt=p=>{
   if(!Array.isArray(p)||p.length!==2)return 0;
   const x=Math.floor(p[0]),y=Math.floor(p[1]);
   return x<0||y<0||x>=width||y>=height?0:grown[y*width+x];
  };
  const report=[];let outline=area;
  for(const group of Array.isArray(groups)?groups:[]){
   const entry={name:group&&group.name||'',merged:0,ok:false};report.push(entry);
   const keep=new Set((group&&group.keep||[]).map(labelAt).filter(Boolean));
   let members=[];
   if(group&&Array.isArray(group.join)){
    members=group.join.map(labelAt);
    if(members.some(m=>!m)){entry.reason='seed-not-on-a-section';continue;}
   }else if(group&&group.within==='outline'){
    const base=labelAt(group.seed);if(!base){entry.reason='seed-not-on-a-section';continue;}
    
    // Any pixel of a section tells which outline-bounded area it lives in.
    const first=new Map();for(let i=0;i<total;i++){const l=seg.labels[i];if(l&&!first.has(l))first.set(l,i);}
    const wanted=outline[first.get(base)];
    if(!wanted){entry.reason='seed-not-in-outline-area';continue;}
    for(const [l,i] of first)if(outline[i]===wanted)members.push(l);
   }else{entry.reason='unknown-group-type';continue;}
   members=[...new Set(members.map(find))].filter(m=>!keep.has(m));
   if(members.length<2){entry.ok=true;continue;}
   // Safety: a group may not swallow a page-sized area.
   let size=0;const set=new Set(members.map(find));
   for(let i=0;i<total;i++)if(set.has(find(grown[i]||0))&&grown[i])size++;
   if(size>total*.3){entry.reason='group-too-large';continue;}
   for(const m of members.slice(1))union(members[0],m);
   entry.merged=members.length;entry.ok=true;
  }
  const labels=new Uint32Array(total);
  for(let i=0;i<total;i++){const l=grown[i];labels[i]=l?find(l):0;}
  return {width,height,labels,fine:seg.labels,thick,groups:report};
 }
 // Counting-sort index: every section's pixel list is one slice, so a tap,
 // undo, redo or full replay never rescans the whole picture.
 function buildRegionIndex(labels){
  let max=0;for(let i=0;i<labels.length;i++)if(labels[i]>max)max=labels[i];
  const starts=new Uint32Array(max+2);
  for(let i=0;i<labels.length;i++)if(labels[i])starts[labels[i]+1]++;
  for(let l=1;l<starts.length;l++)starts[l]+=starts[l-1];
  const items=new Uint32Array(starts[starts.length-1]),fill=starts.slice();
  for(let i=0;i<labels.length;i++){const l=labels[i];if(l)items[fill[l]++]=i;}
  return {starts,items};
 }
 function regionFromObjects(mask,startX,startY){
  const labels=mask&&mask.labels;
  if(!labels||!mask.width||!mask.height||labels.length!==mask.width*mask.height)return {reason:'unavailable'};
  const x=Math.floor(startX),y=Math.floor(startY);
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=mask.width||y>=mask.height)return {reason:'outside'};
  const label=labels[y*mask.width+x];
  if(!label)return {reason:'border'};
  if(!mask.index)mask.index=buildRegionIndex(labels);
  const {starts,items}=mask.index;
  return {pixels:items.subarray(starts[label],starts[label+1]),region:label};
 }
 const api={traceRegion,createRegionMask,regionFromMask,includeSafeWhiteFringe,createObjectMask,buildRegionIndex,regionFromObjects,morphology};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.FTTMitzvahFill=api;
})(typeof window==='object'?window:globalThis);
