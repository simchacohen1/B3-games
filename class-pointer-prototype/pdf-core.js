(function(root){
  'use strict';
  // Pure helpers for Class Pointer PDF mode (no browser needed, so they can be tested with node).
  // Every page is laid out one width unit wide. The whole PDF is one tall "document" whose
  // vertical position (0..1) is shared by teacher and students, so marks and pointers stay on the words.
  const GAP=0.02,MIN_ZOOM=0.5,MAX_ZOOM=4,MAX_BYTES=80*1024*1024,CHUNK=64*1024;
  // Files up to SMALL_BYTES are sent whole. Bigger files (up to PAGED_MAX_BYTES) are sent one page picture at a time, only for the pages near the teacher's view.
  const SMALL_BYTES=25*1024*1024,PAGED_MAX_BYTES=500*1024*1024,PAGE_MAX=8*1024*1024,MAX_PAGES=5000,PAGE_IMAGE_WIDTH=2400;
  const ZOOM_STEPS=[0.5,0.75,1,1.25,1.5,1.75,2,2.5,3,4];
  function clamp(value,low,high){return Math.min(high,Math.max(low,value))}
  function layout(ratios,gap=GAP){
    const tops=[],heights=[];let y=0;
    ratios.forEach((ratio,i)=>{const r=Number.isFinite(ratio)&&ratio>0.05&&ratio<20?ratio:1.4;tops.push(y);heights.push(r);y+=r+(i<ratios.length-1?gap:0)});
    return{tops,heights,total:y||1,count:ratios.length};
  }
  // Which page is at document position y (0..1)? Gaps belong to the page above.
  function pageAt(lay,y){
    if(!lay.count)return 0;const units=clamp(y,0,1)*lay.total;let low=0,high=lay.count-1;
    while(low<high){const mid=(low+high+1)>>1;if(lay.tops[mid]<=units)low=mid;else high=mid-1}
    return low;
  }
  function pageTop(lay,page){return lay.count?lay.tops[clamp(page,0,lay.count-1)]/lay.total:0}
  function nextZoom(zoom,direction){
    const steps=ZOOM_STEPS;
    if(direction>0){for(const step of steps)if(step>zoom+0.001)return step;return steps[steps.length-1]}
    for(let i=steps.length-1;i>=0;i--)if(steps[i]<zoom-0.001)return steps[i];return steps[0];
  }
  function cleanView(view){
    if(!view||typeof view!=='object')return null;
    const zoom=Number(view.zoom),top=Number(view.top),left=Number(view.left);
    if(![zoom,top,left].every(Number.isFinite))return null;
    return{zoom:clamp(zoom,MIN_ZOOM,MAX_ZOOM),top:clamp(top,0,1),left:clamp(left,0,1)};
  }
  function cleanName(value){return typeof value==='string'?value.replace(/[\u0000-\u001f\u007f<>]/g,'').trim().slice(0,80)||'Lesson PDF':'Lesson PDF'}
  function chunkCount(size){return Math.max(1,Math.ceil(size/CHUNK))}
  // A student only accepts a file offer that is a sane size, and chunks that fit the offer.
  function cleanOffer(offer){
    if(!offer||typeof offer.id!=='string'||offer.id.length>64)return null;
    const size=Number(offer.size),chunks=Number(offer.chunks);
    if(!Number.isInteger(size)||size<=0||size>MAX_BYTES||chunks!==chunkCount(size))return null;
    return{id:offer.id,name:cleanName(offer.name),size,chunks};
  }
  function acceptChunk(transfer,message){
    if(!transfer||!message||message.id!==transfer.id||!Number.isInteger(message.i)||message.i<0||message.i>=transfer.chunks)return false;
    const data=message.data instanceof Uint8Array?message.data:message.data instanceof ArrayBuffer?new Uint8Array(message.data):null;
    if(!data||data.length>CHUNK||transfer.parts[message.i])return false;
    transfer.parts[message.i]=data;transfer.received+=data.length;return true;
  }
  function assemble(transfer){
    if(transfer.received!==transfer.size||transfer.parts.some(part=>!part))return null;
    const out=new Uint8Array(transfer.size);let at=0;for(const part of transfer.parts){out.set(part,at);at+=part.length}return out;
  }
  // Student side checks for page-by-page mode.
  function cleanInfo(info){
    if(!info||typeof info.id!=='string'||info.id.length>64||!Array.isArray(info.ratios))return null;
    const ratios=info.ratios;
    if(ratios.length<1||ratios.length>MAX_PAGES||!ratios.every(r=>typeof r==='number'&&Number.isFinite(r)&&r>0.05&&r<20))return null;
    return{id:info.id,name:cleanName(info.name),ratios:ratios.slice()};
  }
  function cleanPageOffer(offer,current){
    if(!offer||!current||offer.id!==current.id||!Number.isInteger(offer.i)||offer.i<0||offer.i>=current.count)return null;
    const size=Number(offer.size),chunks=Number(offer.chunks);
    if(!Number.isInteger(size)||size<=0||size>PAGE_MAX||chunks!==chunkCount(size))return null;
    return{id:offer.id,i:offer.i,size,chunks};
  }
  function acceptPageChunk(transfer,message){
    if(!transfer||!message||message.id!==transfer.id||message.i!==transfer.i||!Number.isInteger(message.c)||message.c<0||message.c>=transfer.chunks)return false;
    const data=message.data instanceof Uint8Array?message.data:message.data instanceof ArrayBuffer?new Uint8Array(message.data):null;
    if(!data||data.length>CHUNK||transfer.parts[message.c])return false;
    transfer.parts[message.c]=data;transfer.received+=data.length;return true;
  }
  // Pages the teacher should have sent: the ones in view first, then a few ahead and one behind.
  function pagesNear(count,first,last,ahead=3,behind=1){
    const out=[],add=i=>{if(i>=0&&i<count&&!out.includes(i))out.push(i)};
    first=clamp(first,0,count-1);last=clamp(last,first,count-1);
    for(let i=first;i<=last;i++)add(i);
    for(let i=1;i<=ahead;i++)add(last+i);
    for(let i=1;i<=behind;i++)add(first-i);
    return out;
  }
  const api={SMALL_BYTES,PAGED_MAX_BYTES,PAGE_MAX,MAX_PAGES,PAGE_IMAGE_WIDTH,cleanInfo,cleanPageOffer,acceptPageChunk,pagesNear,GAP,MIN_ZOOM,MAX_ZOOM,MAX_BYTES,CHUNK,ZOOM_STEPS,clamp,layout,pageAt,pageTop,nextZoom,cleanView,cleanName,chunkCount,cleanOffer,acceptChunk,assemble};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ClassPointerPdfCore=api;
})(typeof window==='undefined'?{}:window);
