'use strict';
// Class Pointer PDF mode.
// The teacher opens a PDF from their own computer. It is sent straight to each student's browser over the
// existing Class Pointer connection (nothing is uploaded or stored anywhere). Everyone draws the PDF themselves,
// so text stays sharp and right-to-left Hebrew pages show exactly as in the file. The teacher's zoom and
// scroll are copied to the students. Pointers and drawings use one shared "document position" (0..1 across
// the whole PDF) so they stay on the words when anyone zooms or scrolls.
(function(){
  const B=window.ClassPointerBridge,P=window.ClassPointerPdfCore,C=window.ClassPointerCore;
  if(!B||!P||!C)return;
  const $=id=>document.getElementById(id),stage=$('stage'),isTeacher=B.isTeacher,ns='http://www.w3.org/2000/svg';
  const pdfjs=window.pdfjsLib;

  let doc=null,docId=null,docName='',bytes=null,lay=null,pageEls=[],rendered=new Map();
  let zoom=1,W=0,H=0,loadToken=0,strokes=[],draft=null,dragId=null,transfer=null,pendingView=null;
  let renderTimer=0,viewTimer=0,lastViewSent=0,frame=0,quietUntil=0;

  function el(tag,id,cls,text){const node=document.createElement(tag);if(id)node.id=id;if(cls)node.className=cls;if(text!=null)node.textContent=text;return node}
  function svg(tag,attrs){const node=document.createElementNS(ns,tag);for(const key in attrs)node.setAttribute(key,String(attrs[key]));return node}

  // ---------- Screen ----------
  const scroller=el('div','pdfView',isTeacher?'':'follow');scroller.hidden=true;scroller.setAttribute('aria-label','Lesson PDF');
  const content=el('div','pdfContent');const ink=svg('svg',{id:'pdfInk'});content.appendChild(ink);scroller.appendChild(content);
  stage.insertBefore(scroller,$('highlightLayer'));
  const note=el('div','pdfNote');note.hidden=true;note.setAttribute('role','status');stage.appendChild(note);
  function showNote(text){note.textContent=text||'';note.hidden=!text}

  // ---------- Teacher controls (inside the lesson so they also work in full screen) ----------
  let nav=null,pageInput=null,pageTotal=null,zoomLabel=null;
  if(isTeacher){
    nav=el('div','pdfNav');nav.hidden=true;nav.dataset.stageUi='true';nav.setAttribute('role','toolbar');nav.setAttribute('aria-label','PDF controls');
    const button=(label,title,onClick,cls)=>{const b=el('button',null,cls||'pdf-btn',label);b.type='button';b.title=title;b.addEventListener('click',onClick);nav.appendChild(b);return b};
    button('◀ Previous','Previous page',()=>goToPage(currentPage()-1));
    pageInput=el('input',null,'pdf-page-input');pageInput.type='number';pageInput.min='1';pageInput.step='1';pageInput.inputMode='numeric';pageInput.setAttribute('aria-label','Page number');
    pageInput.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Enter'){goToPage(Number(pageInput.value)-1);pageInput.blur()}});
    pageTotal=el('span',null,'pdf-page-total',' of 0');
    const jump=el('span',null,'pdf-jump');jump.append(el('span',null,'pdf-label','Page'),pageInput,pageTotal);nav.appendChild(jump);
    button('Go','Jump to this page',()=>goToPage(Number(pageInput.value)-1));
    button('Next ▶','Next page',()=>goToPage(currentPage()+1));
    nav.appendChild(el('span',null,'pdf-sep'));
    button('－','Zoom out',()=>setZoom(P.nextZoom(zoom,-1)),'pdf-btn pdf-zoom');
    zoomLabel=el('span',null,'pdf-zoom-label','100%');nav.appendChild(zoomLabel);
    button('＋','Zoom in',()=>setZoom(P.nextZoom(zoom,1)),'pdf-btn pdf-zoom');
    button('↔ Fit width','Fit the page to the width of the lesson',()=>setZoom(1,true));
    nav.appendChild(el('span',null,'pdf-sep'));
    button('✕ Close PDF','Close the PDF for everyone',()=>closePdf(),'pdf-btn pdf-close');
    const toggle=button('▾ Hide','Hide these buttons (for example while sharing this tab on Zoom)',()=>{const min=nav.classList.toggle('min');toggle.textContent=min?'▴ PDF controls':'▾ Hide'},'pdf-btn pdf-toggle');
    ['pointerdown','pointermove','pointerup','pointercancel','click','dblclick','wheel'].forEach(type=>nav.addEventListener(type,event=>event.stopPropagation()));
    stage.appendChild(nav);
    // Ctrl + mouse wheel (or trackpad pinch) zooms the PDF instead of the whole page.
    scroller.addEventListener('wheel',event=>{if(!doc||!event.ctrlKey)return;event.preventDefault();setZoom(P.nextZoom(zoom,event.deltaY<0?1:-1))},{passive:false});
  }

  // ---------- Layout ----------
  function notReady(){return !doc||!lay}
  function currentView(){
    if(notReady()||!H)return{zoom,top:0,left:0};
    return{zoom,top:P.clamp(scroller.scrollTop/H,0,1),left:W>scroller.clientWidth?P.clamp(scroller.scrollLeft/W,0,1):0};
  }
  function relayout(){
    if(notReady())return;
    const cw=Math.max(80,scroller.clientWidth);W=cw*zoom;H=W*lay.total;
    content.style.width=W+'px';content.style.height=H+'px';
    pageEls.forEach((node,i)=>{node.style.top=(lay.tops[i]*W)+'px';node.style.height=(lay.heights[i]*W)+'px'});
    ink.setAttribute('width',W);ink.setAttribute('height',H);ink.setAttribute('viewBox','0 0 '+W+' '+H);
    drawInk();
  }
  function applyView(view){
    if(notReady())return;
    quietUntil=Date.now()+150;zoom=view.zoom;relayout();
    scroller.scrollTop=view.top*H;scroller.scrollLeft=view.left*W;
    // scroll events caused by this move must not be sent back out (quietUntil)
    afterMove();
  }
  function setZoom(next,reset){
    if(notReady())return;next=P.clamp(next,P.MIN_ZOOM,P.MAX_ZOOM);
    const cw=Math.max(80,scroller.clientWidth),ch=scroller.clientHeight;
    const midY=(scroller.scrollTop+ch/2)/H,midX=W>cw?(scroller.scrollLeft+cw/2)/W:0.5;
    const topKeep=scroller.scrollTop/H;
    quietUntil=Date.now()+150;zoom=next;relayout();
    scroller.scrollTop=reset?topKeep*H:midY*H-ch/2;
    scroller.scrollLeft=reset||W<=cw?0:midX*W-cw/2;
    afterMove(true);
  }
  function currentPage(){return notReady()||!H?0:P.pageAt(lay,(scroller.scrollTop+scroller.clientHeight*0.25)/H)}
  function goToPage(index){
    if(notReady())return;
    if(!Number.isFinite(index)){updateControls();return}
    index=P.clamp(Math.round(index),0,lay.count-1);
    scroller.scrollTop=lay.tops[index]*W;afterMove();updateControls();
  }
  function updateControls(){
    if(!isTeacher||!nav)return;
    nav.hidden=!doc;if(!doc)return;
    pageTotal.textContent=' of '+lay.count;pageInput.max=String(lay.count);
    if(document.activeElement!==pageInput)pageInput.value=String(currentPage()+1);
    zoomLabel.textContent=Math.round(zoom*100)+'%';
  }
  function afterMove(forceSend){
    scheduleRender();updateControls();B.redraw();
    if(isTeacher&&(forceSend||Date.now()>quietUntil))scheduleViewSend(forceSend);
  }
  scroller.addEventListener('scroll',()=>{if(Date.now()<quietUntil)return;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>afterMove())});
  new ResizeObserver(()=>{
    if(notReady())return;
    // keep the same place in the PDF when the lesson area changes size
    const keep=isTeacher?currentView():pendingView||currentView();
    applyView({zoom,top:keep.top,left:keep.left});
  }).observe(scroller);

  // ---------- Drawing the pages ----------
  function scheduleRender(){clearTimeout(renderTimer);renderTimer=setTimeout(renderVisible,90)}
  function renderVisible(){
    if(notReady())return;
    const top=scroller.scrollTop,height=scroller.clientHeight,dpr=window.devicePixelRatio||1;
    for(let i=0;i<lay.count;i++){
      const y0=lay.tops[i]*W,y1=y0+lay.heights[i]*W;
      if(y1>top-height*0.6&&y0<top+height*1.6)renderPage(i,dpr);
      else if(y1<top-height*3||y0>top+height*4){const old=rendered.get(i);if(old){old.task?.cancel();rendered.delete(i);pageEls[i].replaceChildren()}}
    }
  }
  function renderPage(i,dpr){
    const key=Math.round(W)+'@'+dpr,old=rendered.get(i);if(old&&old.key===key)return;
    old?.task?.cancel();const token=loadToken,entry={key,task:null};rendered.set(i,entry);
    doc.getPage(i+1).then(page=>{
      if(token!==loadToken||rendered.get(i)!==entry)return;
      const base=page.getViewport({scale:1});let scale=(W*Math.min(dpr,2))/base.width;
      const pixels=base.width*scale*base.height*scale;if(pixels>14e6)scale*=Math.sqrt(14e6/pixels);
      const viewport=page.getViewport({scale}),canvas=document.createElement('canvas');
      canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      entry.task=page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport});
      entry.task.promise.then(()=>{if(token===loadToken&&rendered.get(i)===entry)pageEls[i].replaceChildren(canvas)}).catch(()=>{});
    }).catch(()=>{});
  }

  // ---------- Marks ----------
  function inkPath(stroke,color){
    const first=stroke.points[0],last=stroke.points[stroke.points.length-1];
    if(stroke.tool==='box')return svg('rect',{x:Math.min(first.x,last.x)*W,y:Math.min(first.y,last.y)*H,width:Math.abs(last.x-first.x)*W,height:Math.abs(last.y-first.y)*H,fill:color});
    const pts=stroke.tool==='underline'?[first,{x:last.x,y:first.y}]:stroke.points;
    return svg('path',{d:pts.map((p,i)=>(i?'L':'M')+(p.x*W).toFixed(1)+' '+(p.y*H).toFixed(1)).join(' '),fill:'none',stroke:color,'stroke-width':stroke.size*W,'stroke-linecap':'round','stroke-linejoin':'round'});
  }
  function drawInk(){
    ink.replaceChildren();if(notReady())return;
    const all=draft?[...strokes,{...draft,owner:B.owner()}]:strokes,groups=new Map();
    for(const stroke of all){
      const kind=['pencil','crayon'].includes(stroke.tool)?stroke.tool:'highlight',key=stroke.owner+'|'+kind;
      let group=groups.get(key);
      if(!group){group=svg('g',{'data-owner':stroke.owner,'data-tool':kind,opacity:kind==='pencil'?'0.94':kind==='crayon'?'0.78':'0.32'});groups.set(key,group);ink.appendChild(group)}
      group.appendChild(inkPath(stroke,stroke.color));
    }
  }
  function setStrokes(next){strokes=Array.isArray(next)?next:[];drawInk()}

  // ---------- Pointing and drawing (positions are fractions of the whole PDF) ----------
  function normalized(event){
    if(notReady())return null;
    const r=content.getBoundingClientRect();if(!r.width||!r.height)return null;
    const p={x:(event.clientX-r.left)/r.width,y:(event.clientY-r.top)/r.height};return C.validPoint(p)?p:null;
  }
  function box(){
    const s=stage.getBoundingClientRect(),r=content.getBoundingClientRect();
    return{left:r.left-s.left-stage.clientLeft,top:r.top-s.top-stage.clientTop,w:r.width,h:r.height};
  }
  const toolId=isTeacher?'teacherTool':'studentTool',colorId=isTeacher?'teacherColor':'studentColor',sizeId=isTeacher?'teacherSize':'studentSize';
  function cancelDraft(){if(dragId!==null&&content.hasPointerCapture?.(dragId))content.releasePointerCapture(dragId);draft=null;dragId=null;drawInk()}
  content.addEventListener('pointerdown',event=>{
    const tool=$(toolId).value;
    if(notReady()||event.button!==0||!C.highlightTools.includes(tool)||!B.live()||!B.writingAllowed())return;
    const p=normalized(event);if(!p)return;
    event.preventDefault();dragId=event.pointerId;
    draft={tool,color:$(colorId).value||B.ownColor(),size:Number($(sizeId).value),points:[p,p]};
    content.setPointerCapture(dragId);drawInk();
  });
  function extend(event){
    if(!draft||event.pointerId!==dragId)return;const p=normalized(event);if(!p)return;
    if(draft.tool!=='highlight'){draft.points=[draft.points[0],p];return}
    const last=draft.points[draft.points.length-1];
    if(Math.hypot((p.x-last.x)*W,(p.y-last.y)*H)>4&&draft.points.length<256)draft.points.push(p);
  }
  content.addEventListener('pointermove',event=>{if(!draft)return;if(!B.writingAllowed()){cancelDraft();return}extend(event);drawInk()});
  content.addEventListener('pointerup',event=>{
    if(!draft||event.pointerId!==dragId)return;extend(event);
    const stroke=draft,may=B.writingAllowed()&&B.live();cancelDraft();
    if(may&&C.cleanStroke(stroke))B.submitStroke(stroke);
  });
  content.addEventListener('pointercancel',cancelDraft);content.addEventListener('lostpointercapture',()=>{if(draft)cancelDraft()});
  [toolId,colorId,sizeId].forEach(id=>$(id).addEventListener('change',cancelDraft));

  // ---------- Opening and closing ----------
  async function loadDoc(data){
    if(!pdfjs)throw new Error('The PDF reader could not load. Refresh the page and try again.');
    pdfjs.GlobalWorkerOptions.workerSrc='vendor/pdf.worker.min.js?v=3.11.174';
    const token=++loadToken;unload(false);loadToken=token;
    // pdf.js takes ownership of the bytes it is given, so give it a copy.
    const task=pdfjs.getDocument({data:data.slice(),isEvalSupported:false,enableXfa:false});
    const loaded=await task.promise;if(token!==loadToken){loaded.destroy();return false}
    const ratios=[];
    for(let i=1;i<=loaded.numPages;i++){
      const page=await loaded.getPage(i),v=page.getViewport({scale:1});
      ratios.push(Math.round((v.height/v.width)*10000)/10000);
      if(token!==loadToken){loaded.destroy();return false}
    }
    doc=loaded;lay=P.layout(ratios);zoom=1;
    pageEls=ratios.map(()=>{const node=el('div',null,'pdf-page');content.insertBefore(node,ink);return node});
    scroller.hidden=false;stage.classList.add('pdf-open');$('placeholder').hidden=true;
    relayout();scroller.scrollTop=0;scroller.scrollLeft=0;scheduleRender();updateControls();
    return true;
  }
  function unload(hide){
    loadToken++;rendered.forEach(item=>item.task?.cancel());rendered.clear();
    pageEls.forEach(node=>node.remove());pageEls=[];
    try{doc?.destroy()}catch(_){}doc=null;lay=null;draft=null;dragId=null;W=H=0;
    if(hide){scroller.hidden=true;stage.classList.remove('pdf-open');showNote('');if(nav)nav.hidden=true;drawInk();B.redraw()}
  }

  // Teacher: choose a PDF from this computer.
  async function openFile(file){
    if(!isTeacher||!file)return;
    if(!/pdf$/i.test(file.type)&&!/\.pdf$/i.test(file.name)){B.fail('Please choose a PDF file.');return}
    if(file.size>P.MAX_BYTES){B.fail('That PDF is bigger than 80 MB. Try a smaller copy, or save just the pages you need.');return}
    B.clearError();showNote('Opening '+file.name+'…');
    try{
      if(B.sharing())B.stopSharing();
      const data=new Uint8Array(await file.arrayBuffer());
      const ok=await loadDoc(data);if(!ok)return;
      bytes=data;docName=P.cleanName(file.name.replace(/\.pdf$/i,''));docId=(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random());
      showNote('');B.setPdf(true);
      B.status('PDF open. Students receive it automatically. Use the buttons at the bottom of the lesson to zoom and turn pages.');
      for(const member of B.members().values())if(member.admitted)sendFile(member);
    }catch(error){
      unload(true);bytes=null;docId=null;showNote('');
      B.fail(error&&error.name==='PasswordException'?'That PDF needs a password. Save an unprotected copy and try again.':'Could not open that PDF. Try another copy of the file.');
    }
  }
  function closePdf(quiet){
    if(!isTeacher){return}
    const had=!!doc||!!bytes;
    if(had)for(const member of B.members().values())B.send(member.connection,{type:'pdf-close'});
    docId=null;bytes=null;unload(true);strokes=[];
    if(had||!quiet)B.setPdf(false);
  }

  // Teacher: send the file to a student (in small pieces, so a slow connection never freezes the page).
  function buffered(connection){return(connection.dataChannel?.bufferedAmount||0)+(connection.bufferSize||0)*P.CHUNK}
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function sendFile(member){
    const connection=member.connection,token=docId,data=bytes;
    if(!data||!connection?.open)return;
    const chunks=P.chunkCount(data.length);
    B.send(connection,{type:'pdf-offer',id:token,name:docName,size:data.length,chunks});
    for(let i=0;i<chunks;i++){
      if(docId!==token||!connection.open)return;
      while(buffered(connection)>1500000){await sleep(40);if(docId!==token||!connection.open)return}
      B.send(connection,{type:'pdf-chunk',id:token,i,data:data.slice(i*P.CHUNK,(i+1)*P.CHUNK)});
      if(i%16===15)await sleep(0);
    }
    if(docId===token&&connection.open)B.send(connection,{type:'pdf-view',id:token,...currentView()});
  }
  function scheduleViewSend(immediate){
    if(!isTeacher||!docId)return;
    const wait=immediate?0:Math.max(0,90-(Date.now()-lastViewSent));
    clearTimeout(viewTimer);
    viewTimer=setTimeout(()=>{
      lastViewSent=Date.now();const view=currentView();
      for(const member of B.members().values())if(member.admitted&&member.pdfReady!==false)B.send(member.connection,{type:'pdf-view',id:docId,...view});
    },wait);
  }

  // Student: receive messages from the teacher.
  function studentFinish(){
    const data=P.assemble(transfer),id=transfer.id,name=transfer.name;transfer=null;
    if(!data){showNote('The PDF did not arrive completely. Leave and rejoin the class.');return}
    showNote('Opening '+name+'…');
    loadDoc(data).then(ok=>{
      if(!ok)return;docId=id;docName=name;showNote('');
      if(pendingView&&pendingView.id===id)applyView(pendingView);
      B.status('Following your teacher in '+name+'.');
    }).catch(()=>showNote('Could not open the PDF. Leave and rejoin the class.'));
  }
  function handleMessage(message){
    if(!message||typeof message.type!=='string'||!message.type.startsWith('pdf-'))return false;
    if(isTeacher)return true;
    if(message.type==='pdf-offer'){
      const offer=P.cleanOffer(message);if(!offer)return true;
      studentReset();transfer={...offer,parts:new Array(offer.chunks),received:0};
      scroller.hidden=false;stage.classList.add('pdf-open');$('placeholder').hidden=true;showNote('Receiving '+offer.name+'… 0%');
    }else if(message.type==='pdf-chunk'){
      if(P.acceptChunk(transfer,message)){
        if(transfer.received>=transfer.size)studentFinish();
        else if(message.i%8===0)showNote('Receiving '+transfer.name+'… '+Math.floor(100*transfer.received/transfer.size)+'%');
      }
    }else if(message.type==='pdf-view'){
      const view=P.cleanView(message);if(!view||typeof message.id!=='string')return true;
      pendingView={...view,id:message.id};
      if(doc&&docId===message.id)applyView(view);
    }else if(message.type==='pdf-close'){studentReset()}
    return true;
  }
  function studentReset(){transfer=null;pendingView=null;docId=null;unload(true);strokes=[];drawInk()}

  // ---------- Wiring ----------
  if(isTeacher){
    const file=$('pdfFile'),open=$('openPdf');
    if(open&&file){open.addEventListener('click',()=>file.click());file.addEventListener('change',()=>{const chosen=file.files&&file.files[0];file.value='';if(chosen)openFile(chosen)})}
  }
  window.ClassPointerPdf={
    active:()=>!!doc&&!!lay&&!scroller.hidden,box,normalized,handleMessage,setStrokes,
    studentJoined:member=>{if(isTeacher&&docId&&bytes)sendFile(member)},
    close:closePdf,reset:studentReset,isOpen:()=>!!doc
  };
})();
