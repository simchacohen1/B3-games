(function(root){
  'use strict';
  // Pure helpers for Class Pointer PDF mode (no browser needed, so they can be tested with node).
  // Every page is laid out one width unit wide. The whole PDF is one tall "document" whose
  // vertical position (0..1) is shared by teacher and students, so marks and pointers stay on the words.
  const GAP=0.02,COL_GAP=0.012,MIN_ZOOM=0.5,MAX_ZOOM=4,MAX_BYTES=80*1024*1024,CHUNK=64*1024;
  // Files up to SMALL_BYTES are sent whole. Bigger files (up to PAGED_MAX_BYTES) are sent one page picture at a time, only for the pages near the teacher's view.
  const SMALL_BYTES=25*1024*1024,PAGED_MAX_BYTES=500*1024*1024,PAGE_MAX=8*1024*1024,MAX_PAGES=5000,PAGE_IMAGE_WIDTH=2400;
  const ZOOM_STEPS=[0.5,0.75,1,1.25,1.5,1.75,2,2.5,3,4];
  function clamp(value,low,high){return Math.min(high,Math.max(low,value))}
  // opts: spread (two pages side by side), rtl (first page on the right, like a Hebrew book),
  // shift (the first page stands alone, so the pairs start at page 2). All sizes are in units of the content width.
  function layout(ratios,opts={}){
    const gap=Number.isFinite(opts.gap)?opts.gap:GAP,spread=opts.spread===true,rtl=opts.rtl===true,shift=opts.shift===true&&spread;
    const n=ratios.length,rs=ratios.map(r=>Number.isFinite(r)&&r>0.05&&r<20?r:1.4);
    const pw=spread?(1-COL_GAP)/2:1,rows=[];
    if(!spread)for(let i=0;i<n;i++)rows.push([i]);
    else{let i=0;if(shift&&n>0){rows.push([0]);i=1}for(;i<n;i+=2)rows.push(i+1<n?[i,i+1]:[i])}
    const tops=[],heights=[],lefts=[],widths=[];let y=0;
    rows.forEach((row,r)=>{
      let rowHeight=0;
      row.forEach((i,slot)=>{
        // A lone first page sits on the opposite side from the pairs, like the front page of a printed book (left for Hebrew).
        const col=spread?(shift&&i===0?(rtl?0:1):(rtl?1-slot:slot)):0;
        tops[i]=y;heights[i]=rs[i]*pw;widths[i]=pw;lefts[i]=col*(pw+COL_GAP);rowHeight=Math.max(rowHeight,heights[i]);
      });
      y+=rowHeight+(r<rows.length-1?gap:0);
    });
    return{tops,heights,lefts,widths,total:y||1,count:n,spread};
  }
  // Which page is at document position y (0..1)? Gaps belong to the page above.
  function pageAt(lay,y){
    if(!lay.count)return 0;const units=clamp(y,0,1)*lay.total;let low=0,high=lay.count-1;
    while(low<high){const mid=(low+high+1)>>1;if(lay.tops[mid]<=units)low=mid;else high=mid-1}
    while(low>0&&lay.tops[low-1]===lay.tops[low])low--; // side by side: the first page of the pair
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
    return{zoom:clamp(zoom,MIN_ZOOM,MAX_ZOOM),top:clamp(top,0,1),left:clamp(left,0,1),spread:view.spread===true,rtl:view.rtl===true,shift:view.shift===true};
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
