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
  const Web=window.ClassPointerWebpageCore;
  let webMode=false,opening=0;

  let doc=null,docId=null,docName='',bytes=null,lay=null,pageEls=[],rendered=new Map();
  // Page-by-page mode (big files): the teacher sends page pictures; students keep them in pageUrls.
  let paged=false,ratiosList=[],pageUrls=new Map(),pageTransfers=new Map(),pageCache=new Map(),pageJobs=new Map(),renderChain=Promise.resolve();
  let layoutOpts={spread:false,rtl:true,shift:false},zoom=1,W=0,H=0,loadToken=0,strokes=[],draft=null,dragId=null,transfer=null,pendingView=null;
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
  let nav=null,pageInput=null,pageTotal=null,zoomLabel=null,twoBtn=null,flipBtn=null,shiftBtn=null;
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
    twoBtn=button('⧉ Two pages','Show two pages side by side (drawings are cleared when you switch)',()=>changeLayout({spread:!layoutOpts.spread,shift:!layoutOpts.spread}),'pdf-btn pdf-two');
    flipBtn=button('⇄ Flip sides','Swap which side the first page of each pair is on',()=>changeLayout({rtl:!layoutOpts.rtl}),'pdf-btn pdf-spread-only');
    shiftBtn=button('◧ Page 1 alone','Show page 1 by itself and start the pairs at page 2',()=>changeLayout({shift:!layoutOpts.shift}),'pdf-btn pdf-spread-only');
    nav.appendChild(el('span',null,'pdf-sep'));
    button('✕ Close PDF','Close the PDF for everyone',()=>closePdf(),'pdf-btn pdf-close');
    const toggle=button('▾ Hide','Hide these buttons (for example while sharing this tab on Zoom)',()=>{const min=nav.classList.toggle('min');toggle.textContent=min?(webMode?'▴ Webpage controls':'▴ PDF controls'):'▾ Hide'},'pdf-btn pdf-toggle');
    ['pointerdown','pointermove','pointerup','pointercancel','click','dblclick','wheel'].forEach(type=>nav.addEventListener(type,event=>event.stopPropagation()));
    stage.appendChild(nav);
    // Ctrl + mouse wheel (or trackpad pinch) zooms the PDF instead of the whole page.
    scroller.addEventListener('wheel',event=>{
      if(!doc)return;
      if(event.ctrlKey){event.preventDefault();setZoom(P.nextZoom(zoom,event.deltaY<0?1:-1))}
      else if(event.shiftKey){event.preventDefault();const unit=event.deltaMode===1?16:event.deltaMode===2?scroller.clientHeight:1;scroller.scrollTop+=event.deltaY*unit;scroller.scrollLeft+=event.deltaX*unit}
    },{passive:false});
  }

  // ---------- Layout ----------
  function notReady(){return !lay}
  function currentView(){
    if(notReady()||!H)return{zoom,top:0,left:0,...layoutOpts};
    return{zoom,top:P.clamp(scroller.scrollTop/H,0,1),left:W>scroller.clientWidth?P.clamp(scroller.scrollLeft/W,0,1):0,...layoutOpts};
  }
  function relayout(){
    if(notReady())return;
    const cw=Math.max(80,scroller.clientWidth);W=cw*zoom;H=W*lay.total;
    content.style.width=W+'px';content.style.height=H+'px';
    pageEls.forEach((node,i)=>{node.style.top=(lay.tops[i]*W)+'px';node.style.height=(lay.heights[i]*W)+'px';node.style.left=(lay.lefts[i]*W)+'px';node.style.width=(lay.widths[i]*W)+'px'});
    if(webMode){const iframe=pageEls[0]?.querySelector('iframe');if(iframe)iframe.style.transform='scale('+(W/Web.WIDTH)+')'}
    ink.setAttribute('width',W);ink.setAttribute('height',H);ink.setAttribute('viewBox','0 0 '+W+' '+H);
    drawInk();
  }
  function applyView(view){
    if(notReady())return;
    quietUntil=Date.now()+150;zoom=view.zoom;
    if(!isTeacher&&'spread' in view&&(view.spread!==layoutOpts.spread||view.rtl!==layoutOpts.rtl||view.shift!==layoutOpts.shift)){layoutOpts={spread:view.spread,rtl:view.rtl,shift:view.shift};lay=P.layout(ratiosList,layoutOpts)}
    relayout();
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
    nav.setAttribute('aria-label',webMode?'Webpage controls':'PDF controls');
    if(nav.classList.contains('min'))nav.querySelector('.pdf-toggle').textContent=webMode?'▴ Webpage controls':'▴ PDF controls';
    nav.querySelectorAll('.pdf-jump,.pdf-two,.pdf-spread-only').forEach(node=>node.hidden=webMode);
    nav.querySelectorAll('button').forEach(node=>{if(node.title==='Previous page'||node.title==='Next page'||node.title==='Jump to this page')node.hidden=webMode;if(node.classList.contains('pdf-close')){node.textContent=webMode?'✕ Close webpage':'✕ Close PDF';node.title=webMode?'Close the webpage for everyone':'Close the PDF for everyone'}});
    pageTotal.textContent=' of '+lay.count;pageInput.max=String(lay.count);
    if(document.activeElement!==pageInput)pageInput.value=String(currentPage()+1);
    zoomLabel.textContent=Math.round(zoom*100)+'%';
    twoBtn.textContent=layoutOpts.spread?'⧉ Two pages: on':'⧉ Two pages';twoBtn.classList.toggle('on',layoutOpts.spread);
    flipBtn.hidden=shiftBtn.hidden=webMode||!layoutOpts.spread;
    flipBtn.textContent=layoutOpts.rtl?'⇄ Page 1 on right':'⇄ Page 1 on left';
    shiftBtn.textContent=layoutOpts.shift?'◧ Page 1 alone: on':'◧ Page 1 alone';shiftBtn.classList.toggle('on',layoutOpts.shift);
  }
  // Teacher: switch between one page and two pages. Old drawings sit on the old layout, so they are cleared.
  function changeLayout(patch){
    if(!isTeacher||notReady())return;
    const anchor=currentPage();
    layoutOpts={...layoutOpts,...patch};if(!layoutOpts.spread)layoutOpts.shift=false; // turning Two pages on starts with page 1 alone, like the printed book
    lay=P.layout(ratiosList,layoutOpts);
    quietUntil=Date.now()+150;relayout();
    scroller.scrollTop=lay.tops[anchor]*W;scroller.scrollLeft=0;
    B.resetMarks();afterMove(true);
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
    if(notReady()||!doc||webMode)return;
    const top=scroller.scrollTop,height=scroller.clientHeight,dpr=window.devicePixelRatio||1;
    for(let i=0;i<lay.count;i++){
      const y0=lay.tops[i]*W,y1=y0+lay.heights[i]*W;
      if(y1>top-height*0.6&&y0<top+height*1.6)renderPage(i,dpr);
      else if(y1<top-height*3||y0>top+height*4){const old=rendered.get(i);if(old){old.task?.cancel();rendered.delete(i);pageEls[i].replaceChildren()}}
    }
  }
  function renderPage(i,dpr){
    const pageW=W*lay.widths[i],key=Math.round(pageW)+'@'+dpr,old=rendered.get(i);if(old&&old.key===key)return;
    old?.task?.cancel();const token=loadToken,entry={key,task:null};rendered.set(i,entry);
    doc.getPage(i+1).then(page=>{
      if(token!==loadToken||rendered.get(i)!==entry)return;
      const base=page.getViewport({scale:1});let scale=(pageW*Math.min(dpr,2))/base.width;
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
    if(B.navigating()||notReady()||event.button!==0||!C.highlightTools.includes(tool)||!B.live()||!B.writingAllowed())return;
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
  async function loadDoc(data,noCopy){
    if(!pdfjs)throw new Error('The PDF reader could not load. Refresh the page and try again.');
    pdfjs.GlobalWorkerOptions.workerSrc='vendor/pdf.worker.min.js?v=3.11.174';
    const token=++loadToken;unload(false);loadToken=token;
    // pdf.js takes ownership of the bytes it is given, so give it a copy.
    const task=pdfjs.getDocument({data:noCopy?data:data.slice(),isEvalSupported:false,enableXfa:false});
    const loaded=await task.promise;if(token!==loadToken){loaded.destroy();return false}
    const ratios=[];
    for(let i=1;i<=loaded.numPages;i++){
      const page=await loaded.getPage(i),v=page.getViewport({scale:1});
      ratios.push(Math.round((v.height/v.width)*10000)/10000);
      if(token!==loadToken){loaded.destroy();return false}
    }
    doc=loaded;ratiosList=ratios;lay=P.layout(ratios,layoutOpts);zoom=1;
    scroller.setAttribute('aria-label','Lesson PDF');
    pageEls=ratios.map(()=>{const node=el('div',null,'pdf-page');content.insertBefore(node,ink);return node});
    scroller.hidden=false;stage.classList.add('pdf-open');$('placeholder').hidden=true;
    relayout();scroller.scrollTop=0;scroller.scrollLeft=0;scheduleRender();updateControls();
    return true;
  }
  function makeWebFrame(html,height){
    const iframe=el('iframe',null,'lesson-webpage');iframe.title='Static lesson webpage';
    iframe.setAttribute('sandbox','allow-same-origin');iframe.referrerPolicy='no-referrer';
    iframe.style.width=Web.WIDTH+'px';iframe.style.height=height+'px';
    iframe.srcdoc=html;return iframe;
  }
  async function measureWeb(html){
    const iframe=makeWebFrame(html,1000);iframe.classList.add('webpage-measure');
    const loaded=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Page took too long to load.')),15000);iframe.onload=()=>{clearTimeout(timer);resolve()}});
    document.body.appendChild(iframe);
    try{
      await loaded;const inner=iframe.contentDocument;if(!inner)throw Error('Could not read this page.');
      await Promise.race([Promise.all([inner.fonts?.ready,...Array.from(inner.images).map(image=>image.complete?Promise.resolve():new Promise(resolve=>{image.onload=image.onerror=resolve}))]),new Promise(resolve=>setTimeout(resolve,5000))]);
      const height=Math.max(1000,inner.documentElement.scrollHeight,inner.body?.scrollHeight||0);
      if(height>Web.MAX_HEIGHT)throw Error('This page is too long. Save the section you need as HTML or PDF.');
      return height;
    }finally{iframe.remove()}
  }
  async function loadWebDoc(data){
    const raw=Web.cleanPayload(JSON.parse(new TextDecoder().decode(data)));if(!raw)throw Error('Invalid lesson webpage.');
    const token=++loadToken;unload(false);loadToken=token;
    // Sanitize on receipt as well as on opening. The teacher and every student use
    // the same fixed document width/height, independent of their screen dimensions.
    const html=Web.prepare(raw.html,new DOMParser().parseFromString(raw.html,'text/html').querySelector('base')?.href);
    webMode=true;layoutOpts={spread:false,rtl:true,shift:false};
    scroller.setAttribute('aria-label','Lesson webpage');
    doc={destroy(){}};ratiosList=[raw.height/Web.WIDTH];lay=P.layout(ratiosList);zoom=1;
    const node=el('div',null,'pdf-page webpage-page');node.appendChild(makeWebFrame(html,raw.height));pageEls=[node];content.insertBefore(node,ink);
    scroller.hidden=false;stage.classList.add('pdf-open');$('placeholder').hidden=true;
    relayout();scroller.scrollTop=0;scroller.scrollLeft=0;updateControls();return true;
  }
  async function openWebpage(source,file){
    if(!isTeacher||!Web)return;
    const token=++opening;B.clearError();showNote('Opening webpage…');
    $('openWebpage').disabled=true;
    try{
      let html,base,name;
      if(file){
        if(!/\.html?$/i.test(file.name))throw Error('Please choose an HTML file (.html or .htm).');
        if(file.size>Web.MAX_BYTES)throw Error('Please choose an HTML file smaller than 8 MB.');
        html=await file.text();base='https://invalid.invalid/';name=file.name.replace(/\.html?$/i,'');
      }else{
        base=Web.cleanUrl(source);if(!base)throw Error('Enter a full http:// or https:// webpage URL.');
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
        try{
          const response=await fetch(base,{credentials:'omit',signal:controller.signal});
          if(!response.ok)throw Error('The webpage could not be loaded.');
          if(!/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type')||''))throw Error('This address must point to an HTML webpage.');
          if(Number(response.headers.get('content-length'))>Web.MAX_BYTES)throw Error('This webpage is too large.');
          html=await response.text();base=response.url;
        }catch(error){if(error.name==='TypeError'||error.name==='AbortError')throw Error('This website blocks direct loading or did not respond. Save a complete HTML copy and use Open HTML file, or use Share teaching screen.');throw error}
        finally{clearTimeout(timer)}
        name=new URL(base).hostname;
      }
      if(new TextEncoder().encode(html).length>Web.MAX_BYTES)throw Error('This webpage is larger than 8 MB.');
      const prepared=Web.prepare(html,base),height=await measureWeb(prepared);
      const data=new TextEncoder().encode(JSON.stringify({html:prepared,width:Web.WIDTH,height}));
      if(data.length>Web.MAX_BYTES)throw Error('This webpage is larger than 8 MB.');
      if(token!==opening)return;
      closePdf(true);const committed=opening;if(B.sharing())B.stopSharing();
      await loadWebDoc(data);if(opening!==committed)return;bytes=data;docName=P.cleanName(name);docId=crypto.randomUUID();
      showNote('');B.resetMarks();B.setPdf(true,'webpage');
      B.status('Webpage open. Students follow your scrolling and zoom. Use the lesson tools to point and highlight.');
      for(const member of B.members().values())if(member.admitted)deliver(member);
    }catch(error){showNote('');B.fail(error.message||'Could not open this webpage.')}
    finally{$('openWebpage').disabled=false}
  }
  async function openSnapshot(dataUrl,width,height){
    if(!isTeacher||!Web||typeof dataUrl!=='string'||!/^data:image\/jpeg;base64,/.test(dataUrl))throw Error('Invalid captured tab image.');
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<100||height<100)throw Error('Invalid snapshot size.');
    const token=++opening;B.clearError();showNote('Preparing captured tab…');
    try{
      const h=Math.max(100,Math.round(Web.WIDTH*height/width));
      const html='<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden}img{display:block;width:1000px;height:'+h+'px}</style></head><body><img alt="Captured browser tab" src="'+dataUrl+'"></body></html>';
      const prepared=Web.prepare(html,null);
      const data=new TextEncoder().encode(JSON.stringify({html:prepared,width:Web.WIDTH,height:h}));
      if(data.length>Web.MAX_BYTES)throw Error('Snapshot is too large. Try a smaller browser window.');
      if(token!==opening)return;
      closePdf(true);const committed=opening;if(B.sharing())B.stopSharing();
      await loadWebDoc(data);if(opening!==committed)return;
      bytes=data;docName='Browser tab snapshot';docId=crypto.randomUUID();
      showNote('');B.resetMarks();B.setPdf(true,'webpage');
      B.status('Static tab snapshot open. Zoom, drag and highlight here without changing the original tab.');
      for(const member of B.members().values())if(member.admitted)deliver(member);
    }catch(error){showNote('');B.fail(error.message||'Could not open the captured tab.')}
  }
  function unload(hide){
    loadToken++;rendered.forEach(item=>item.task?.cancel());rendered.clear();
    pageEls.forEach(node=>node.remove());pageEls=[];
    try{doc?.destroy()}catch(_){}doc=null;lay=null;draft=null;dragId=null;W=H=0;webMode=false;
    paged=false;ratiosList=[];pageUrls.forEach(url=>URL.revokeObjectURL(url));pageUrls.clear();pageTransfers.clear();pageCache.clear();pageJobs.clear();renderChain=Promise.resolve();
    if(hide){scroller.hidden=true;stage.classList.remove('pdf-open');showNote('');if(nav)nav.hidden=true;drawInk();B.redraw()}
  }

  // Teacher: choose a PDF from this computer.
  async function openFile(file){
    if(!isTeacher||!file)return;
    opening++;
    if(!/pdf$/i.test(file.type)&&!/\.pdf$/i.test(file.name)){B.fail('Please choose a PDF file.');return}
    if(file.size>P.PAGED_MAX_BYTES){B.fail('That PDF is bigger than 500 MB. Save just the pages you need as a smaller PDF.');return}
    const big=file.size>P.SMALL_BYTES;
    B.clearError();showNote(big?'Opening a large PDF… this can take a little while.':'Opening '+file.name+'…');
    try{
      if(B.sharing())B.stopSharing();
      const data=new Uint8Array(await file.arrayBuffer());
      const ok=await loadDoc(data,big);if(!ok)return;
      paged=big;bytes=big?null:data;docName=P.cleanName(file.name.replace(/\.pdf$/i,''));docId=(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random());
      showNote('');B.resetMarks();B.setPdf(true);
      B.status(big?'Large PDF open. Students receive the pages you teach on, so the first page may take a moment.':'PDF open. Students receive it automatically. Use the buttons at the bottom of the lesson to zoom and turn pages.');
      for(const member of B.members().values())if(member.admitted)deliver(member);
      if(big)scheduleViewSend(true);
    }catch(error){
      unload(true);bytes=null;docId=null;showNote('');
      B.fail(error&&error.name==='PasswordException'?'That PDF needs a password. Save an unprotected copy and try again.':'Could not open that PDF. Try another copy of the file.');
    }
  }
  function closePdf(quiet){
    if(!isTeacher){return}
    opening++;
    const had=!!doc;
    if(had)for(const member of B.members().values())B.send(member.connection,{type:'pdf-close'});
    docId=null;bytes=null;unload(true);strokes=[];
    if(had||!quiet)B.setPdf(false);
    if(had)$('placeholder').hidden=B.sharing();
  }

  // Teacher: send the file to a student (in small pieces, so a slow connection never freezes the page).
  function buffered(connection){return(connection.dataChannel?.bufferedAmount||0)+(connection.bufferSize||0)*P.CHUNK}
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function sendFile(member){
    const connection=member.connection,token=docId,data=bytes;
    if(!data||!connection?.open)return;
    const chunks=P.chunkCount(data.length);
    B.send(connection,{type:'pdf-offer',id:token,name:docName,size:data.length,chunks,kind:webMode?'webpage':'pdf'});
    for(let i=0;i<chunks;i++){
      if(docId!==token||!connection.open)return;
      while(buffered(connection)>1500000){await sleep(40);if(docId!==token||!connection.open)return}
      B.send(connection,{type:'pdf-chunk',id:token,i,data:data.slice(i*P.CHUNK,(i+1)*P.CHUNK)});
      if(i%16===15)await sleep(0);
    }
    if(docId===token&&connection.open){B.send(connection,{type:'pdf-view',id:token,...currentView()});B.send(connection,{type:'highlights',strokes:B.highlights()})}
  }
  function deliver(member){if(paged){sendInfo(member);B.send(member.connection,{type:'pdf-view',id:docId,...currentView()});B.send(member.connection,{type:'highlights',strokes:B.highlights()});pumpPages(member)}else sendFile(member)}
  function sendInfo(member){B.send(member.connection,{type:'pdf-info',id:docId,name:docName,ratios:ratiosList})}
  function wantedPages(){
    if(notReady()||!H)return[];
    const view=currentView();
    const last=P.pageAt(lay,view.top+scroller.clientHeight/H);
    return P.pagesNear(lay.count,P.pageAt(lay,view.top),lay.spread?Math.min(lay.count-1,last+1):last);
  }
  // Teacher: turn one page into a picture (JPEG) once, and reuse it for every student.
  async function renderJpeg(i,token){
    if(!doc||token!==docId)throw new Error('closed');
    const page=await doc.getPage(i+1),base=page.getViewport({scale:1});
    let scale=P.PAGE_IMAGE_WIDTH/base.width;const pixels=base.width*scale*base.height*scale;if(pixels>14e6)scale*=Math.sqrt(14e6/pixels);
    const viewport=page.getViewport({scale}),canvas=document.createElement('canvas');
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    // 'print' intent renders without waiting for screen refreshes, so it keeps working even if this tab is covered or hidden.
    await page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport,intent:'print'}).promise;
    for(const quality of [0.85,0.65,0.45]){
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
      if(blob&&blob.size<=P.PAGE_MAX){canvas.width=0;return new Uint8Array(await blob.arrayBuffer())}
    }
    canvas.width=0;throw new Error('page too large');
  }
  function pageImage(i){
    if(pageCache.has(i)){const data=pageCache.get(i);pageCache.delete(i);pageCache.set(i,data);return Promise.resolve(data)}
    if(pageJobs.has(i))return pageJobs.get(i);
    const token=docId;
    const job=renderChain.then(()=>renderJpeg(i,token)).then(data=>{
      pageJobs.delete(i);
      if(token===docId){pageCache.set(i,data);while(pageCache.size>40)pageCache.delete(pageCache.keys().next().value)}
      return data;
    },error=>{pageJobs.delete(i);throw error});
    renderChain=job.catch(()=>{});pageJobs.set(i,job);return job;
  }
  async function sendPage(connection,token,i,data){
    const chunks=P.chunkCount(data.length);
    B.send(connection,{type:'pdf-page-offer',id:token,i,size:data.length,chunks});
    for(let c=0;c<chunks;c++){
      if(docId!==token||!connection.open)return false;
      while(buffered(connection)>1500000){await sleep(40);if(docId!==token||!connection.open)return false}
      B.send(connection,{type:'pdf-page-chunk',id:token,i,c,data:data.slice(c*P.CHUNK,(c+1)*P.CHUNK)});
      if(c%16===15)await sleep(0);
    }
    return true;
  }
  // One sender per student; it keeps going until that student has every page near the teacher's view.
  async function pumpPages(member){
    if(!paged||member.pdfPump||!member.connection?.open)return;
    member.pdfPump=true;const token=docId;
    if(member.pdfHaveId!==token){member.pdfHave=new Set();member.pdfHaveId=token}
    try{
      for(;;){
        if(docId!==token||!member.connection.open)return;
        const want=wantedPages().find(i=>!member.pdfHave.has(i));if(want==null)return;
        const data=await pageImage(want);if(docId!==token||!member.connection.open)return;
        if(await sendPage(member.connection,token,want,data))member.pdfHave.add(want);else return;
      }
    }catch(_){/* page could not be made; the next view change tries again */}
    finally{member.pdfPump=false}
  }
  function scheduleViewSend(immediate){
    if(!isTeacher||!docId)return;
    const wait=immediate?0:Math.max(0,90-(Date.now()-lastViewSent));
    clearTimeout(viewTimer);
    viewTimer=setTimeout(()=>{
      lastViewSent=Date.now();const view=currentView();
      for(const member of B.members().values())if(member.admitted){B.send(member.connection,{type:'pdf-view',id:docId,...view});if(paged)pumpPages(member)}
    },wait);
  }

  // Student: receive messages from the teacher.
  function studentFinish(){
    const data=P.assemble(transfer),id=transfer.id,name=transfer.name,transferKind=transfer.kind;transfer=null;
    if(!data){showNote('The lesson file did not arrive completely. Leave and rejoin the class.');return}
    showNote('Opening '+name+'…');
    (transferKind==='webpage'?loadWebDoc(data):loadDoc(data)).then(ok=>{
      if(!ok)return;docId=id;docName=name;showNote('');
      if(pendingView&&pendingView.id===id)applyView(pendingView);
      B.status('Following your teacher in '+name+'.');
    }).catch(()=>showNote('Could not open the lesson file. Leave and rejoin the class.'));
  }
  function handleMessage(message){
    if(!message||typeof message.type!=='string'||!message.type.startsWith('pdf-'))return false;
    if(isTeacher)return true;
    if(message.type==='pdf-offer'){
      const offer=P.cleanOffer(message);if(!offer)return true;
      if(message.kind==='webpage'&&offer.size>Web.MAX_BYTES)return true;
      studentReset();transfer={...offer,kind:message.kind==='webpage'?'webpage':'pdf',parts:new Array(offer.chunks),received:0};
      scroller.setAttribute('aria-label',transfer.kind==='webpage'?'Lesson webpage':'Lesson PDF');
      scroller.hidden=false;stage.classList.add('pdf-open');$('placeholder').hidden=true;showNote('Receiving '+offer.name+'… 0%');
    }else if(message.type==='pdf-chunk'){
      if(P.acceptChunk(transfer,message)){
        if(transfer.received>=transfer.size)studentFinish();
        else if(message.i%8===0)showNote('Receiving '+transfer.name+'… '+Math.floor(100*transfer.received/transfer.size)+'%');
      }
    }else if(message.type==='pdf-info'){
      const info=P.cleanInfo(message);if(!info)return true;
      studentReset();paged=true;docId=info.id;docName=info.name;ratiosList=info.ratios;layoutOpts={spread:false,rtl:true,shift:false};lay=P.layout(info.ratios,layoutOpts);zoom=1;
      pageEls=info.ratios.map((_,i)=>{const node=el('div',null,'pdf-page');node.dataset.label='Loading page '+(i+1)+'…';content.insertBefore(node,ink);return node});
      scroller.hidden=false;stage.classList.add('pdf-open');$('placeholder').hidden=true;showNote('');
      relayout();if(pendingView&&pendingView.id===docId)applyView(pendingView);
      B.status('Following your teacher in '+info.name+'. Pages appear as your teacher turns to them.');
    }else if(message.type==='pdf-page-offer'){
      if(!paged||!lay)return true;
      const offer=P.cleanPageOffer(message,{id:docId,count:lay.count});if(!offer)return true;
      if(pageTransfers.size>=8)pageTransfers.clear();
      pageTransfers.set(offer.i,{...offer,parts:new Array(offer.chunks),received:0});
    }else if(message.type==='pdf-page-chunk'){
      const transfer=Number.isInteger(message.i)?pageTransfers.get(message.i):null;
      if(paged&&P.acceptPageChunk(transfer,message)&&transfer.received>=transfer.size){pageTransfers.delete(transfer.i);const data=P.assemble(transfer);if(data)showPageImage(transfer.i,data)}
    }else if(message.type==='pdf-view'){
      const view=P.cleanView(message);if(!view||typeof message.id!=='string')return true;
      pendingView={...view,id:message.id};
      if(lay&&docId===message.id)applyView(view);
    }else if(message.type==='pdf-close'){studentReset()}
    return true;
  }
  function showPageImage(i,data){
    if(!pageEls[i])return;
    const url=URL.createObjectURL(new Blob([data],{type:'image/jpeg'})),image=document.createElement('img'),old=pageUrls.get(i);
    image.alt='';image.draggable=false;image.src=url;pageUrls.set(i,url);
    pageEls[i].dataset.label='';pageEls[i].replaceChildren(image);if(old)setTimeout(()=>URL.revokeObjectURL(old),2000);
  }
  function studentReset(){layoutOpts={spread:false,rtl:true,shift:false};transfer=null;pendingView=null;docId=null;unload(true);strokes=[];drawInk();$('placeholder').hidden=B.sharing()}

  // Navigation mode keeps the selected tool intact. Dragging moves the document;
  // students still follow the teacher's view and cannot change it for the class.
  let pan=null;
  scroller.addEventListener('pointerdown',event=>{
    if(!isTeacher||!B.navigating()||notReady()||event.button!==0)return;
    cancelDraft();event.preventDefault();pan={id:event.pointerId,x:event.clientX,y:event.clientY,left:scroller.scrollLeft,top:scroller.scrollTop};scroller.setPointerCapture(event.pointerId);
  });
  scroller.addEventListener('pointermove',event=>{if(pan&&event.pointerId===pan.id){scroller.scrollLeft=pan.left+pan.x-event.clientX;scroller.scrollTop=pan.top+pan.y-event.clientY}});
  function stopPan(){if(pan&&scroller.hasPointerCapture(pan.id))scroller.releasePointerCapture(pan.id);pan=null}
  scroller.addEventListener('pointerup',stopPan);scroller.addEventListener('pointercancel',stopPan);scroller.addEventListener('lostpointercapture',()=>{pan=null});
  document.addEventListener('class-pointer-navigation',()=>{cancelDraft();stopPan()});
  document.addEventListener('keydown',event=>{
    if(!isTeacher||!B.navigating()||notReady()||event.ctrlKey||event.metaKey||event.altKey||event.target.closest?.('input,select,textarea,[contenteditable],dialog[open]'))return;
    const moves={ArrowDown:80,ArrowUp:-80,PageDown:scroller.clientHeight*0.8,PageUp:-scroller.clientHeight*0.8};
    if(event.key in moves){event.preventDefault();scroller.scrollTop+=moves[event.key]}
    else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();scroller.scrollLeft+=event.key==='ArrowLeft'?-80:80}
    else if(event.key==='Home'||event.key==='End'){event.preventDefault();scroller.scrollTop=event.key==='Home'?0:H}
  });

  // ---------- Wiring ----------
  if(isTeacher){
    const file=$('pdfFile'),open=$('openPdf');
    if(open&&file){open.addEventListener('click',()=>file.click());file.addEventListener('change',()=>{const chosen=file.files&&file.files[0];file.value='';if(chosen)openFile(chosen)})}
    const dialog=$('webpageDialog'),webFile=$('webpageFile');
    $('openWebpage')?.addEventListener('click',()=>dialog.showModal());
    $('cancelWebpage')?.addEventListener('click',()=>dialog.close());
    $('webpageForm')?.addEventListener('submit',event=>{event.preventDefault();const url=$('webpageUrl').value;dialog.close();openWebpage(url)});
    $('chooseWebpageFile')?.addEventListener('click',()=>webFile.click());
    webFile?.addEventListener('change',()=>{const chosen=webFile.files?.[0];webFile.value='';if(chosen){dialog.close();openWebpage(null,chosen)}});
  }
  window.ClassPointerPdf={
    active:()=>!!lay&&!scroller.hidden,box,normalized,handleMessage,setStrokes,
    studentJoined:member=>{if(isTeacher&&docId&&(bytes||paged))deliver(member)},
    close:closePdf,openSnapshot,reset:studentReset,isOpen:()=>!!lay
  };
})();
