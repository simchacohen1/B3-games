'use strict';
// My files (student page): a student's own saved whiteboards and PDFs, by class folder.
// Whiteboards show as a picture here (to draw on one again, open it from 📂 My files on the whiteboard).
// PDFs open in a small reader that remembers the page and zoom for each PDF.
// Storage, sign-in checks and the shared list come from saved-work.js.
(function(){
  const Core=window.FTTSavedWorkCore,Saved=window.FTTSavedWork;
  if(!Core||!Saved)return;
  const {store,ui}=Saved,$=id=>document.getElementById(id);
  const page={say(text){$('filesStatus').textContent=text||''},fail(error){$('filesStatus').textContent=Core.errorText(error)}};
  let state={folders:{},saveTarget:null};

  async function refresh(){
    page.say('Loading…');
    try{
      const [files,folders]=await Promise.all([store.list(),store.folders().catch(()=>state)]);
      state=folders;
      ui.fileList($('filesList'),files,state,file=>[
        ui.button(file.kind==='pdf'?'Open':'See picture',()=>file.kind==='pdf'?openPdf(file):showPicture(file),'main'),
        ...ui.manageButtons(file,page,refresh)]);
      $('addPdf').hidden=false;page.say('');
    }catch(error){$('filesList').replaceChildren();page.fail(error)}
  }

  // ---------- A saved whiteboard, as a picture ----------
  async function showPicture(file){
    const box=ui.openDialog(file.name);
    box.say('Opening…');
    const picture=await store.picture(file);
    if(picture){
      const image=ui.h('img','ftt-picture'),url=URL.createObjectURL(picture);
      image.alt='Picture of the whiteboard '+file.name;image.src=url;
      box.dialog.addEventListener('close',()=>URL.revokeObjectURL(url));
      box.body.append(image);
    }else box.body.append(ui.h('p','ftt-saved-note','There is no picture of this whiteboard.'));
    box.body.append(ui.h('p','ftt-saved-note','To draw on it again, open your whiteboard and press 📂 My files.'));
    box.say('');
  }

  // ---------- Add a PDF from this computer ----------
  $('addPdf').addEventListener('click',()=>$('pdfFile').click());
  $('pdfFile').addEventListener('change',()=>{
    const file=$('pdfFile').files[0];$('pdfFile').value='';
    if(!file)return;
    const box=ui.openDialog('Add a PDF'),name=ui.h('input'),label=ui.h('label',null,'Name');
    name.type='text';name.id='fttPdfName';name.maxLength=Core.LIMITS.fileName;name.value=Core.cleanName(file.name.replace(/\.pdf$/i,''));label.htmlFor=name.id;
    box.body.append(label,name);
    const picker=ui.folderPicker(state,state.saveTarget);
    if(picker.node){
      const folderLabel=ui.h('label',null,'Folder');picker.node.id='fttPdfFolder';folderLabel.htmlFor=picker.node.id;
      if(state.saveTarget)box.body.append(ui.h('p','ftt-saved-hint','Your teacher asked you to save in: '+Core.folderLabel(state,state.saveTarget)));
      box.body.append(folderLabel,picker.node);
    }
    const meter=ui.h('progress');meter.max=100;meter.value=0;meter.hidden=true;meter.setAttribute('aria-label','Saving');
    const save=ui.button('Save',async()=>{
      const clean=Core.cleanName(name.value);
      if(!clean){box.say('Type a name first.');return}
      save.disabled=true;meter.hidden=false;box.say('Saving…');
      try{
        await store.savePdf(file,{name:clean,folderId:picker.value()},percent=>{meter.value=percent;box.say('Saving… '+percent+'%')});
        box.dialog.close();await refresh();
      }catch(error){box.fail(error);save.disabled=false;meter.hidden=true}
    },'main');
    const actions=ui.h('div','ftt-saved-actions');actions.append(save,ui.button('Cancel',()=>box.dialog.close()));
    box.body.append(actions,meter);
  });

  // ---------- PDF reader ----------
  let pdf=null,current=null,pageNumber=1,zoom=1,drawing=null,drawToken=0,saveTimer=0,unsaved=false;
  const placeKey=file=>'saved:'+file.id;
  async function openPdf(file){
    page.say('Opening…');
    try{
      const reader=window.pdfjsLib;
      if(!reader)throw Core.plain('The PDF reader could not load. Refresh the page and try again.');
      reader.GlobalWorkerOptions.workerSrc='vendor/pdf.worker.min.js?v=3.11.174';
      const data=new Uint8Array(await (await store.readPdf(file)).arrayBuffer());
      const loaded=await reader.getDocument({data,isEvalSupported:false,enableXfa:false}).promise.catch(()=>{throw Core.plain('This PDF could not be opened.')});
      closePdf();pdf=loaded;current=file;
      // Use whichever is newer: the place kept in this browser, or the place saved with the file.
      let local=null;try{local=Core.readPosition(localStorage,placeKey(file))}catch(_){}
      const resume=local&&local.at>=file.placeAt?local:{page:file.lastPage,zoom:file.zoom};
      pageNumber=Math.min(pdf.numPages,Math.max(1,resume.page));zoom=Math.min(4,Math.max(0.5,resume.zoom));
      $('viewerName').textContent=file.name;$('viewer').hidden=false;page.say('');
      draw();
    }catch(error){page.fail(error)}
  }
  async function draw(){
    if(!pdf)return;
    const token=++drawToken;drawing?.cancel();
    const sheet=await pdf.getPage(pageNumber);
    if(token!==drawToken)return;
    const holder=$('viewerPage'),base=sheet.getViewport({scale:1}),sharp=Math.min(window.devicePixelRatio||1,2);
    const shown=Math.max(200,holder.clientWidth-24)*zoom;
    let scale=shown*sharp/base.width;
    const pixels=base.width*scale*base.height*scale;if(pixels>14e6)scale*=Math.sqrt(14e6/pixels);
    const viewport=sheet.getViewport({scale}),canvas=document.createElement('canvas');
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);canvas.style.width=shown+'px';
    drawing=sheet.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport});
    try{await drawing.promise}catch(_){return}
    if(token!==drawToken)return;
    holder.replaceChildren(canvas);
    $('viewerCount').textContent='Page '+pageNumber+' of '+pdf.numPages;$('viewerZoom').textContent=Math.round(zoom*100)+'%';
    $('viewerPrevious').disabled=pageNumber<=1;$('viewerNext').disabled=pageNumber>=pdf.numPages;
  }
  const place=()=>({page:pageNumber,zoom,at:Date.now()});
  // The place is kept in this browser at once (so closing the tab keeps it) and with the file a moment later.
  function move(nextPage,nextZoom){
    if(!pdf)return;
    const before=pageNumber;
    pageNumber=Math.min(pdf.numPages,Math.max(1,nextPage));zoom=Math.min(4,Math.max(0.5,nextZoom));
    if(pageNumber!==before)$('viewerPage').scrollTop=0;
    try{Core.savePosition(localStorage,placeKey(current),place())}catch(_){}
    unsaved=true;clearTimeout(saveTimer);saveTimer=setTimeout(savePlace,2500);
    draw();
  }
  function savePlace(){
    clearTimeout(saveTimer);
    if(!unsaved||!current)return;
    unsaved=false;store.remember(current,place()).catch(()=>{});
  }
  function closePdf(){
    savePlace();drawToken++;drawing?.cancel();drawing=null;
    try{pdf?.destroy()}catch(_){}
    pdf=null;current=null;$('viewer').hidden=true;$('viewerPage').replaceChildren();
  }
  $('viewerBack').addEventListener('click',()=>{closePdf();refresh()});
  $('viewerPrevious').addEventListener('click',()=>move(pageNumber-1,zoom));
  $('viewerNext').addEventListener('click',()=>move(pageNumber+1,zoom));
  $('viewerZoomOut').addEventListener('click',()=>move(pageNumber,zoom/1.25));
  $('viewerZoomIn').addEventListener('click',()=>move(pageNumber,zoom*1.25));
  document.addEventListener('keydown',event=>{
    if(!pdf||event.target.closest('input,select,dialog[open]'))return;
    if(event.key==='ArrowRight'||event.key==='PageDown'){event.preventDefault();move(pageNumber+1,zoom)}
    else if(event.key==='ArrowLeft'||event.key==='PageUp'){event.preventDefault();move(pageNumber-1,zoom)}
  });
  let resizeTimer=0;
  window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(draw,150)});
  window.addEventListener('pagehide',savePlace);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')savePlace()});

  refresh();
})();
