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
    try{await source.play()}catch(error){if(error.name!=='AbortError')throw error}
    await waitForVideo(source);
    if(!HTMLCanvasElement.prototype.captureStream){
      return{stream:rawStream,active:false,stop(){rawStream.getTracks().forEach(track=>track.stop());source.srcObject=null}};
    }
    const sourceWidth=source.videoWidth,sourceHeight=source.videoHeight,aspect=sourceWidth/sourceHeight,size=V.outputSize(sourceWidth,sourceHeight);
    const canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;
    const context=canvas.getContext('2d',{alpha:false});
    if(!context)throw new Error('The browser could not prepare the cropped lesson view.');
    const stream=canvas.captureStream(15);
    let base={x:0,y:0,w:1,h:1},view={...base},zoom=1,raf=0,lastFrame=0,stopped=false,panMode=false,dragPointer=null,lastDrag=null,selection={...base},selectStart=null;
    function renderFrame(time){
      if(stopped)return;
      if(time-lastFrame>=60&&source.readyState>=2){
        const sx=view.x*sourceWidth,sy=view.y*sourceHeight,sw=view.w*sourceWidth,sh=view.h*sourceHeight;
        context.fillStyle='#151a23';context.fillRect(0,0,canvas.width,canvas.height);
        try{context.drawImage(source,sx,sy,sw,sh,0,0,canvas.width,canvas.height)}catch{}
        lastFrame=time;
      }
      raf=requestAnimationFrame(renderFrame);
    }
    raf=requestAnimationFrame(renderFrame);

    const shareButton=document.getElementById('shareScreen'),controls=document.createElement('div');controls.className='controls share-view-controls';
    const areaButton=makeButton('Choose shared area'),fullButton=makeButton('Share full screen'),zoomOut=makeButton('Zoom −'),zoomIn=makeButton('Zoom +'),moveButton=makeButton('Move view');
    const zoomLabel=document.createElement('span');zoomLabel.className='zoom-label';zoomLabel.setAttribute('aria-live','polite');
    moveButton.setAttribute('aria-pressed','false');controls.append(areaButton,fullButton,zoomOut,zoomLabel,zoomIn,moveButton);
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
    dialog.append(title,help,preview,dialogControls);document.body.appendChild(dialog);

    function setPanMode(next){
      panMode=!!next&&zoom>1;moveButton.setAttribute('aria-pressed',String(panMode));moveButton.classList.toggle('active',panMode);stage.classList.toggle('viewport-pan-mode',panMode);
      if(!panMode){
        const pointer=dragPointer;dragPointer=null;lastDrag=null;
        if(pointer!==null&&stage.hasPointerCapture?.(pointer))stage.releasePointerCapture(pointer);
        stage.classList.remove('viewport-panning');
      }
    }
    function updateControls(){
      zoomLabel.textContent=Math.round(zoom*100)+'%';zoomOut.disabled=zoom<=1.001;zoomIn.disabled=zoom>=5.99;moveButton.disabled=zoom<=1.001;
      if(zoom<=1.001)setPanMode(false);
      fullButton.disabled=base.x===0&&base.y===0&&base.w===1&&base.h===1&&zoom===1;
    }
    function resetOverlays(){try{before()}catch{}}
    function zoomTo(next){
      const value=V.clamp(next,1,6);if(Math.abs(value-zoom)<0.001)return;
      resetOverlays();const center={x:view.x+view.w/2,y:view.y+view.h/2};zoom=value;view=V.zoomRegion(base,zoom,center);updateControls();
      say('Shared lesson zoom: '+Math.round(zoom*100)+'%.'+(zoom>1?' Turn on Move view and drag the lesson to pan.':''));
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
    moveButton.addEventListener('click',()=>{if(zoom<=1)return;setPanMode(!panMode);if(panMode){resetOverlays();say('Move view is on. Drag the lesson to pan around the zoomed screen.')}else say('Move view is off.')});

    const listeners=[];
    function listen(target,type,handler,capture=false){target.addEventListener(type,handler,capture);listeners.push(()=>target.removeEventListener(type,handler,capture))}
    // Choosing a lesson tool returns input to the pointer/highlighter handlers.
    const teacherTool=document.getElementById('teacherTool');
    if(teacherTool)listen(teacherTool,'change',()=>{if(panMode){setPanMode(false);say('Move view is off. Hover to point, or drag with a highlighting tool.')}});
    function lessonEvent(event){return !event.target?.closest?.('button')}
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
        if(stopped)return;stopped=true;cancelAnimationFrame(raf);setPanMode(false);stage.classList.remove('viewport-panning');
        listeners.forEach(remove=>remove());
        controls.remove();dialog.remove();source.srcObject=null;stream.getTracks().forEach(track=>track.stop());rawStream.getTracks().forEach(track=>track.stop());
      }
    };
  }
  window.ClassPointerViewport={create};
})();
