'use strict';
(function(){
  const V=window.ClassPointerViewportCore,C=window.ClassPointerCore;
  if(!V)return;
  function waitForVideo(video){
    if(video.videoWidth&&video.videoHeight)return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{cleanup();reject(new Error('The shared screen did not become ready. Please try sharing again.'))},12000);
      function cleanup(){clearTimeout(timer);video.removeEventListener('loadedmetadata',ready);video.removeEventListener('error',failed)}
      function ready(){cleanup();resolve()}
      function failed(){cleanup();reject(new Error('The shared screen could not be read. Please try sharing again.'))}
      video.addEventListener('loadedmetadata',ready,{once:true});video.addEventListener('error',failed,{once:true});
    });
  }
  function makeButton(text){const button=document.createElement('button');button.type='button';button.textContent=text;return button}
  async function create(options){
    const rawStream=options.rawStream,stage=options.stage,lesson=options.lesson;
    const before=options.onBeforeViewChange||function(){},say=options.onStatus||function(){},fail=options.onError||function(){};
    const source=document.createElement('video');source.muted=true;source.autoplay=true;source.playsInline=true;source.srcObject=rawStream;
    const rawTrack=rawStream.getVideoTracks?.()[0];if(rawTrack&&'contentHint' in rawTrack){try{rawTrack.contentHint='text'}catch{}}
    try{await source.play()}catch(error){if(error.name!=='AbortError')throw error}
    await waitForVideo(source);
    if(!HTMLCanvasElement.prototype.captureStream){
      return{stream:rawStream,active:false,stop(){rawStream.getTracks().forEach(track=>track.stop());source.srcObject=null}};
    }
    const sourceWidth=source.videoWidth,sourceHeight=source.videoHeight,aspect=sourceWidth/sourceHeight,size=V.outputSize(sourceWidth,sourceHeight);
    const canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;
    const context=canvas.getContext('2d',{alpha:false});
    if(!context)throw new Error('The browser could not prepare the cropped lesson view.');
    context.imageSmoothingEnabled=true;if('imageSmoothingQuality' in context)context.imageSmoothingQuality='high';
    const stream=canvas.captureStream(8);const outputTrack=stream.getVideoTracks?.()[0];if(outputTrack&&'contentHint' in outputTrack){try{outputTrack.contentHint='text'}catch{}}
    let stopTicker=()=>{},base={x:0,y:0,w:1,h:1},view={...base},zoom=1,stopped=false,panMode=false,dragPointer=null,lastDrag=null,selection={...base},selectStart=null,boxMode=false,boxDrag=null,boxEl=null;
    // Browsers do not run animation frames for a hidden tab or a covered window. Teaching from another tab
    // (sharing a browser tab makes the teacher switch to it) used to freeze this picture, so students saw black.
    // A worker's timer keeps ticking, and frames are read straight from the capture track when the browser allows it.
    function startTicker(fn,ms){
      try{
        const url=URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},'+ms+')'],{type:'text/javascript'}));
        const worker=new Worker(url);worker.onmessage=fn;
        return()=>{worker.terminate();URL.revokeObjectURL(url)};
      }catch{const id=setInterval(fn,ms);return()=>clearInterval(id)}
    }
    const capture=(typeof ImageCapture==='function'&&rawTrack)?new ImageCapture(rawTrack):null;
    let drawing=false;
    async function renderFrame(){
      if(stopped||drawing)return;
      drawing=true;
      let frame=null;
      try{
        if(capture){try{frame=await capture.grabFrame()}catch{frame=null}}
        if(stopped)return;
        if(frame||source.readyState>=2){
          const fw=frame?frame.width:sourceWidth,fh=frame?frame.height:sourceHeight;
          const sx=view.x*fw,sy=view.y*fh,sw=view.w*fw,sh=view.h*fh;
          context.fillStyle='#151a23';context.fillRect(0,0,canvas.width,canvas.height);
          try{context.drawImage(frame||source,sx,sy,sw,sh,0,0,canvas.width,canvas.height)}catch{}
        }
      }finally{if(frame&&frame.close)frame.close();drawing=false}
    }
    stopTicker=startTicker(renderFrame,120);

    const shareButton=document.getElementById('shareScreen'),controls=document.createElement('div');controls.className='controls share-view-controls';
    const areaButton=makeButton('Choose shared area'),fullButton=makeButton('Share full screen'),zoomOut=makeButton('Zoom −'),zoomIn=makeButton('Zoom +'),moveButton=makeButton('Move view'),boxButton=makeButton('Zoom to box'),resetButton=makeButton('Reset zoom');
    areaButton.id='viewChooseArea';fullButton.id='viewShareFull';zoomOut.id='viewZoomOut';zoomIn.id='viewZoomIn';moveButton.id='viewMove';boxButton.id='viewZoomBox';resetButton.id='viewZoomReset';boxButton.title='Drag a box on the lesson to zoom in on it';resetButton.title='Back to 100%';
    const zoomLabel=document.createElement('span');zoomLabel.id='viewZoomLabel';zoomLabel.className='zoom-label';zoomLabel.setAttribute('aria-live','polite');
    moveButton.setAttribute('aria-pressed','false');boxButton.setAttribute('aria-pressed','false');controls.append(areaButton,fullButton,zoomOut,zoomLabel,zoomIn,resetButton,boxButton,moveButton);
    if(shareButton?.parentElement)shareButton.parentElement.insertAdjacentElement('afterend',controls);

    const dialog=document.createElement('dialog');dialog.className='share-area-dialog';
    const title=document.createElement('h2');title.textContent='Choose the part students should see';
    const help=document.createElement('p');help.textContent='Drag a box around the teaching area. The box keeps the same shape as the lesson window, so the picture will not stretch.';
    const preview=document.createElement('div');preview.className='share-area-preview';preview.style.aspectRatio=sourceWidth+' / '+sourceHeight;
    source.className='share-area-video';preview.appendChild(source);
    const shade=document.createElement('div');shade.className='share-area-shade';preview.appendChild(shade);
    const selectionBox=document.createElement('div');selectionBox.className='share-area-selection';preview.appendChild(selectionBox);
    const dialogControls=document.createElement('div');dialogControls.className='controls';
    const useArea=makeButton('Use selected area'),cancelArea=makeButton('Cancel');dialogControls.append(useArea,cancelArea);
    dialog.append(title,help,preview,dialogControls);stage.appendChild(dialog);

    function setBoxMode(next){
      boxMode=!!next;boxButton.setAttribute('aria-pressed',String(boxMode));boxButton.classList.toggle('active',boxMode);stage.classList.toggle('viewport-box-mode',boxMode);
      if(!boxMode){boxDrag=null;if(boxEl){boxEl.remove();boxEl=null}}
    }
    function setPanMode(next){
      if(next&&boxMode)setBoxMode(false);
      panMode=!!next&&zoom>1;moveButton.setAttribute('aria-pressed',String(panMode));moveButton.classList.toggle('active',panMode);stage.classList.toggle('viewport-pan-mode',panMode);
      if(!panMode){
        const pointer=dragPointer;dragPointer=null;lastDrag=null;
        if(pointer!==null&&stage.hasPointerCapture?.(pointer))stage.releasePointerCapture(pointer);
        stage.classList.remove('viewport-panning');
      }
    }
    function updateControls(){
      zoomLabel.textContent=Math.round(zoom*100)+'%';zoomOut.disabled=zoom<=1.001;zoomIn.disabled=zoom>=5.99;boxButton.disabled=zoom>=5.99;moveButton.disabled=zoom<=1.001;resetButton.disabled=zoom<=1.001;
      if(zoom<=1.001)setPanMode(false);
      fullButton.disabled=base.x===0&&base.y===0&&base.w===1&&base.h===1&&zoom===1;
    }
    function resetOverlays(){try{before()}catch{}}
    function zoomTo(next){
      const value=V.clamp(next,1,6);if(Math.abs(value-zoom)<0.001)return;
      resetOverlays();const center={x:view.x+view.w/2,y:view.y+view.h/2};zoom=value;view=V.zoomRegion(base,zoom,center);updateControls();
      say('Shared lesson zoom: '+Math.round(zoom*100)+'%.'+(zoom>1?' Turn on Move view and drag the lesson to pan.':''));
    }
    function applyZoom(result,message){
      if(!result)return;resetOverlays();zoom=result.zoom;view=result.view;updateControls();say(message||('Shared lesson zoom: '+Math.round(zoom*100)+'%.'));
    }
    function stagePicture(){
      const rect=stage.getBoundingClientRect(),box=C?.pictureBox?.(rect.width,rect.height,lesson.videoWidth,lesson.videoHeight);
      return{rect,left:box?.left||0,top:box?.top||0,w:box?.w||rect.width,h:box?.h||rect.height};
    }
    function picturePoint(event){
      const pic=stagePicture();return{x:V.clamp((event.clientX-pic.rect.left-pic.left)/pic.w,0,1),y:V.clamp((event.clientY-pic.rect.top-pic.top)/pic.h,0,1)};
    }
    function showSelection(){
      selectionBox.style.left=(selection.x*100)+'%';selectionBox.style.top=(selection.y*100)+'%';selectionBox.style.width=(selection.w*100)+'%';selectionBox.style.height=(selection.h*100)+'%';
    }
    function openDialog(){
      setPanMode(false);selection={...base};showSelection();
      const maxWidth=Math.max(280,Math.min(window.innerWidth*0.88,window.innerHeight*0.68*aspect));preview.style.width=maxWidth+'px';preview.style.margin='0 auto';
      if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
    }
    function closeDialog(){if(typeof dialog.close==='function'&&dialog.open)dialog.close();else dialog.removeAttribute('open')}
    function pointerPosition(event){
      const rect=preview.getBoundingClientRect();return{x:V.clamp(event.clientX-rect.left,0,rect.width),y:V.clamp(event.clientY-rect.top,0,rect.height),width:rect.width,height:rect.height};
    }
    preview.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;event.preventDefault();const p=pointerPosition(event);selectStart={x:p.x,y:p.y};preview.setPointerCapture?.(event.pointerId);
    });
    preview.addEventListener('pointermove',event=>{
      if(!selectStart)return;const p=pointerPosition(event),next=V.selectionFromDrag(selectStart,{x:p.x,y:p.y},p.width,p.height,aspect);
      if(next){selection=next;showSelection()}
    });
    function endSelection(event){if(!selectStart)return;selectStart=null;try{preview.releasePointerCapture?.(event.pointerId)}catch{}}
    preview.addEventListener('pointerup',endSelection);preview.addEventListener('pointercancel',endSelection);
    useArea.addEventListener('click',()=>{
      const next=V.cleanRegion(selection);if(!next)return;
      resetOverlays();base=next;zoom=1;view={...base};updateControls();closeDialog();say('Students now see only the selected part of the shared screen. Use Zoom + to move in closer.');
    });
    cancelArea.addEventListener('click',closeDialog);dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog()});
    areaButton.addEventListener('click',openDialog);
    fullButton.addEventListener('click',()=>{resetOverlays();base={x:0,y:0,w:1,h:1};zoom=1;view={...base};updateControls();say('Sharing the full selected screen again.')});
    zoomOut.addEventListener('click',()=>zoomTo(zoom/1.25));zoomIn.addEventListener('click',()=>zoomTo(zoom*1.25));
    resetButton.addEventListener('click',()=>{if(zoom<=1.001)return;applyZoom(V.zoomAt(base,view,1,{x:0.5,y:0.5}),'Zoom reset to 100%.')});
    boxButton.addEventListener('click',()=>{setBoxMode(!boxMode);if(boxMode){setPanMode(false);resetOverlays();say('Zoom to box is on. Drag a box on the lesson to zoom in on it.')}else say('Zoom to box is off.')});
    moveButton.addEventListener('click',()=>{if(zoom<=1)return;setPanMode(!panMode);if(panMode){resetOverlays();say('Move view is on. Drag the lesson to pan around the zoomed screen.')}else say('Move view is off.')});

    const listeners=[];
    function listen(target,type,handler,capture=false){target.addEventListener(type,handler,capture);listeners.push(()=>target.removeEventListener(type,handler,capture))}
    // Choosing a lesson tool returns input to the pointer/highlighter handlers.
    const teacherTool=document.getElementById('teacherTool');
    if(teacherTool)listen(teacherTool,'change',()=>{if(panMode){setPanMode(false);say('Move view is off. Hover to point, or drag with a highlighting tool.')}if(boxMode)setBoxMode(false)});
    // Ctrl/Cmd + wheel (also a trackpad pinch) zooms around the mouse; wheel alone pans while Move view is on.
    listen(stage,'wheel',event=>{
      if(!lessonEvent(event))return;
      if(event.ctrlKey||event.metaKey){
        event.preventDefault();const p=picturePoint(event),factor=Math.exp(-event.deltaY*0.0025);
        const next=V.clamp(zoom*factor,1,6);if(Math.abs(next-zoom)<0.002)return;
        applyZoom(V.zoomAt(base,view,next,p));
      }else if(panMode){
        event.preventDefault();const pic=stagePicture();resetOverlays();
        view=V.panRegion(base,view,event.deltaX/pic.w*view.w,event.deltaY/pic.h*view.h);
      }
    },false);
    listen(stage,'pointerdown',event=>{
      if(!boxMode||panMode||!lessonEvent(event)||event.button!==0)return;stopStageEvent(event);
      const pic=stagePicture();boxDrag={start:picturePoint(event),pic,pointerId:event.pointerId,end:picturePoint(event)};
      boxEl=document.createElement('div');boxEl.className='viewport-box-selection';boxEl.setAttribute('data-stage-ui','');stage.appendChild(boxEl);stage.setPointerCapture?.(event.pointerId);
    },true);
    function drawBox(){
      if(!boxDrag||!boxEl)return;const a=boxDrag.start,b=boxDrag.end,pic=boxDrag.pic;
      boxEl.style.left=(pic.left+Math.min(a.x,b.x)*pic.w)+'px';boxEl.style.top=(pic.top+Math.min(a.y,b.y)*pic.h)+'px';
      boxEl.style.width=(Math.abs(a.x-b.x)*pic.w)+'px';boxEl.style.height=(Math.abs(a.y-b.y)*pic.h)+'px';
    }
    listen(stage,'pointermove',event=>{
      if(!boxMode||!boxDrag||event.pointerId!==boxDrag.pointerId)return;stopStageEvent(event);boxDrag.end=picturePoint(event);drawBox();
    },true);
    function endBox(event){
      if(!boxDrag||event.pointerId!==boxDrag.pointerId)return;stopStageEvent(event);
      const a=boxDrag.start,b=boxDrag.end;try{stage.releasePointerCapture?.(event.pointerId)}catch{}
      boxDrag=null;if(boxEl){boxEl.remove();boxEl=null}
      const box={x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)};
      if(box.w<0.02&&box.h<0.02)return;
      applyZoom(V.zoomToBox(base,view,zoom,box),'Zoomed to the box. Use Reset zoom to go back.');setBoxMode(false);
    }
    listen(stage,'pointerup',endBox,true);listen(stage,'pointercancel',endBox,true);
    listen(stage,'click',event=>{if(boxMode&&lessonEvent(event))stopStageEvent(event)},true);
    function lessonEvent(event){return !event.target?.closest?.('[data-stage-ui],button')}
    function stopStageEvent(event){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation?.()}
    listen(stage,'pointerdown',event=>{
      if(!panMode||!lessonEvent(event)||event.button!==0)return;stopStageEvent(event);dragPointer=event.pointerId;lastDrag={x:event.clientX,y:event.clientY};stage.setPointerCapture?.(dragPointer);stage.classList.add('viewport-panning');
    },true);
    listen(stage,'pointermove',event=>{
      if(!panMode||!lessonEvent(event))return;stopStageEvent(event);if(event.pointerId!==dragPointer||!lastDrag)return;
      const rect=stage.getBoundingClientRect(),box=C?.pictureBox?.(rect.width,rect.height,lesson.videoWidth,lesson.videoHeight),w=box?.w||rect.width,h=box?.h||rect.height;
      const dx=event.clientX-lastDrag.x,dy=event.clientY-lastDrag.y;lastDrag={x:event.clientX,y:event.clientY};
      view=V.panRegion(base,view,-dx/w*view.w,-dy/h*view.h);
    },true);
    function endPan(event){
      if(event.pointerId!==dragPointer)return;if(panMode)stopStageEvent(event);try{stage.releasePointerCapture?.(dragPointer)}catch{}dragPointer=null;lastDrag=null;stage.classList.remove('viewport-panning');
    }
    listen(stage,'pointerup',endPan,true);listen(stage,'pointercancel',endPan,true);
    listen(stage,'click',event=>{if(panMode&&lessonEvent(event))stopStageEvent(event)},true);
    updateControls();

    return{
      stream,active:true,
      stop(){
        if(stopped)return;stopped=true;stopTicker();setPanMode(false);setBoxMode(false);stage.classList.remove('viewport-panning');
        listeners.forEach(remove=>remove());
        controls.remove();dialog.remove();source.srcObject=null;stream.getTracks().forEach(track=>track.stop());rawStream.getTracks().forEach(track=>track.stop());
      }
    };
  }
  window.ClassPointerViewport={create};
})();
