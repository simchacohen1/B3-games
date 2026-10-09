'use strict';
const C=window.ClassPointerCore,$=id=>document.getElementById(id);
const room=new URL(location.href).searchParams.get('room'),isTeacher=!room;   const entry=new URL(location.href).searchParams.get('dashboard');
   if((isTeacher&&entry!=='teacher')||(!isTeacher&&entry!=='student')){document.body.innerHTML='<main style="padding:2rem;font:1rem system-ui">Open Class Pointer from Fun Torah Tools.</main>';throw Error('Class Pointer must be opened from the dashboard.')}
const members=new Map();
let peer=null,teacherConnection=null,screen=null,mediaCall=null,viewportController=null,state={sharing:false,mode:'nobody',members:[],points:{}},started=false,admitted=false,joining=false,joinTimer=null;
let captureControl=null,tabScrollOn=false;
let generation=0,colorIndex=0,pendingPoint=null,hoverTimer=null,lastHover=0;
let navigating=false;
const pointerNodes=new Map();
const highlightStore=new C.HighlightStore();let highlighter=null;
const pointerIcons={
  arrow:'<path d="M16 16L1 8L5 16L1 24Z" fill="currentColor"/>',
  star:'<path d="M16 3L19.5 11.5L29 12L21.5 18L24 27L16 22L8 27L10.5 18L3 12L12.5 11.5Z" fill="currentColor"/>',
  heart:'<path d="M16 28S3 20 3 11.5C3 5 11 3 16 10c5-7 13-5 13 1.5C29 20 16 28 16 28Z" fill="currentColor"/>',
  paw:'<circle cx="16" cy="21" r="7" fill="currentColor"/><ellipse cx="7" cy="11" rx="3.3" ry="4.5" fill="currentColor"/><ellipse cx="15" cy="7" rx="3.3" ry="4.5" fill="currentColor"/><ellipse cx="23" cy="9" rx="3.3" ry="4.5" fill="currentColor"/><ellipse cx="28" cy="15" rx="2.8" ry="3.8" fill="currentColor"/>',
  sparkle:'<path d="M16 1L19.5 12.5L31 16L19.5 19.5L16 31L12.5 19.5L1 16L12.5 12.5Z" fill="currentColor"/><path d="M26 1L27.5 5.5L32 7L27.5 8.5L26 13L24.5 8.5L20 7L24.5 5.5Z" fill="currentColor"/>'
};
function status(text){$('connectionStatus').textContent=text}
function fail(text){$('error').textContent=text;$('error').hidden=false}
function clearError(){$('error').hidden=true}
function send(connection,message){if(connection?.open){try{connection.send(message)}catch{fail('The connection was interrupted. Please rejoin the class.')}}}
function ownMember(){return state.members.find(member=>member.id==='student:'+peer?.id)}
function allowed(){return isTeacher||C.canPoint(state.mode,ownMember())}
function writingAllowed(){return isTeacher||C.canWrite(state.mode,ownMember())}
function pointerPermission(){
  const mayPoint=allowed(),mayWrite=writingAllowed();$('stage').style.cursor=navigating?'default':mayPoint?'crosshair':'not-allowed';
  if(!mayPoint){cancelHover();highlighter?.cancel()}
  if(!isTeacher){
    const tool=$('studentTool');if(tool){for(const option of tool.options)if(C.highlightTools.includes(option.value))option.disabled=!mayWrite;if(!mayWrite&&C.highlightTools.includes(tool.value)){tool.value='target';tool.dispatchEvent(new Event('change',{bubbles:true}))}}
    $('permissionText').textContent=!admitted?'Connecting to your class.':!mayPoint?'Watch the lesson. Your teacher has not enabled your pointer.':mayWrite?'You may point and use writing tools.':'Pointer only. Your teacher has not enabled writing tools.';
  }
}
function drawPointers(){
  const video=$('lesson'),rect=$('stage').getBoundingClientRect(),box=window.ClassPointerPdf?.active()?window.ClassPointerPdf.box():C.pictureBox(rect.width,rect.height,video.videoWidth,video.videoHeight);
  const visible=new Set();$('spotlightCircle').hidden=true;
  if(live()&&box)Object.entries(state.points).forEach(([id,point])=>{
    if(!C.validPoint(point))return;
    const member=id==='teacher'?{name:'Teacher',color:'#ffcc00'}:state.members.find(person=>person.id===id);
    if(!member)return;
    const style=C.pointStyle(point),left=box.left+point.x*box.w,top=box.top+point.y*box.h;visible.add(id);
    let pointer=pointerNodes.get(id);
    if(!pointer){pointer=document.createElement('div');pointer.dataset.person=id;pointerNodes.set(id,pointer);$('pointerLayer').appendChild(pointer)}
    if(pointer.dataset.tool!==style.tool){
      pointer.replaceChildren();pointer.dataset.tool=style.tool;
      if(pointerIcons[style.tool]){const icon=document.createElement('span');icon.className='pointer-icon';icon.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true">'+pointerIcons[style.tool]+'</svg>';pointer.appendChild(icon)}
      const name=document.createElement('span');name.className='name';name.textContent=member.name;pointer.appendChild(name);
    }
    pointer.className='pointer '+style.tool+(top>rect.height-38?' label-above':'')+(left<45?' label-right':left>rect.width-45?' label-left':'');
    pointer.style.setProperty('--color',style.color||member.color);pointer.style.left=left+'px';pointer.style.top=top+'px';
    if(id==='teacher'&&state.spotlight){const focus=$('spotlightCircle');focus.hidden=false;focus.style.left=left+'px';focus.style.top=top+'px'}
  });
  for(const [id,node] of pointerNodes)if(!visible.has(id)){node.remove();pointerNodes.delete(id)}
}
function publish(){
  state.members=Array.from(members.values()).filter(member=>member.admitted).map(({id,name,color,allowed,writeAllowed})=>({id,name,color,admitted:true,allowed,writeAllowed:writeAllowed===true}));
  for(const member of members.values())if(member.admitted)send(member.connection,{type:'state',state});
  drawPointers();pointerPermission();
}
function roster(){
  const list=$('roster');list.replaceChildren();
  if(!members.size){list.textContent=started?'No students yet. Send the join link to one student.':'Start a class to receive join requests.';return}
  for(const member of members.values()){
    const row=document.createElement('div');row.className='roster-row';const name=document.createElement('span');name.textContent=member.name+(member.admitted?' — admitted':' — waiting');row.appendChild(name);
    if(!member.admitted){const admit=document.createElement('button');admit.textContent='Admit '+member.name;admit.addEventListener('click',()=>{member.admitted=true;publish();send(member.connection,{type:"highlights",strokes:highlightStore.strokes});roster();if(screen)callStudent(member)});row.appendChild(admit)}
    else{
      const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=member.allowed;input.disabled=state.mode!=='selected';
      input.addEventListener('change',()=>{member.allowed=input.checked;if(!C.canPoint(state.mode,member)){clearStudentHover(member);delete state.points[member.id]}if(!member.allowed)member.writeAllowed=false;publish();roster()});label.append(input,document.createTextNode(' Pointer'));row.appendChild(label);
      const writeLabel=document.createElement('label'),writeInput=document.createElement('input');writeInput.type='checkbox';writeInput.checked=member.writeAllowed===true;writeInput.disabled=state.mode==='nobody'||(state.mode==='selected'&&!member.allowed);
      writeInput.addEventListener('change',()=>{member.writeAllowed=writeInput.checked;publish()});writeLabel.append(writeInput,document.createTextNode(' Writing'));row.appendChild(writeLabel);
    }
    const remove=document.createElement('button');remove.textContent=member.admitted?'Remove '+member.name:'Decline '+member.name;
    remove.addEventListener('click',()=>{send(member.connection,{type:'removed'});member.connection.close();removeMember(member)});row.appendChild(remove);list.appendChild(row);
  }
}
function removeMember(member){
  if(members.get(member.id)!==member)return;
  clearStudentHover(member);
  member.call?.close();clearTimeout(member.mediaTimer);members.delete(member.id);delete state.points[member.id];highlightStore.edit(member.id,"clear");publishHighlights();publish();roster();
}
function clearStudentHover(member){clearTimeout(member.pointTimer);member.pointTimer=null;member.pendingPoint=null}
function commitStudentHover(member){
  member.pointTimer=null;const point=member.pendingPoint;member.pendingPoint=null;
  if(!point||members.get(member.id)!==member||!live()||!C.canPoint(state.mode,member))return;
  member.lastPoint=Date.now();state.points[member.id]=point;publish();
}
function favorTextDetail(call){
  const tune=()=>{
    const pc=call?.peerConnection;if(!pc?.getSenders)return;
    const sender=pc.getSenders().find(item=>item.track?.kind==='video');if(!sender?.getParameters||!sender?.setParameters)return;
    try{
      const parameters=sender.getParameters();parameters.degradationPreference='maintain-resolution';
      if(parameters.encodings?.length)parameters.encodings.forEach(encoding=>{encoding.maxFramerate=8;if(!encoding.scaleResolutionDownBy||encoding.scaleResolutionDownBy>1)encoding.scaleResolutionDownBy=1});
      sender.setParameters(parameters).catch(()=>{});
    }catch{}
  };
  tune();setTimeout(tune,500);
}
function callStudent(member){
  member.call?.close();clearTimeout(member.mediaTimer);if(!screen||!member.admitted)return;
  const call=peer.call(member.peerId,screen,{metadata:{generation}});member.call=call;favorTextDetail(call);
  if(!call){fail('Could not send the lesson to '+member.name+'. Ask him to leave and rejoin.');return}
  call.on('error',()=>fail('The screen connection to '+member.name+' failed. Ask him to rejoin or try another network.'));
  member.mediaTimer=setTimeout(()=>{if(members.get(member.id)===member&&state.sharing&&!member.videoReady)fail(member.name+' has not received the lesson. School network restrictions may be blocking it.')},20000);
}
function receiveStudent(connection){
  if(!started||members.has('student:'+connection.peer)){connection.close();return}
  let member=null;
  const handshake=setTimeout(()=>{if(!member)connection.close()},15000);
  connection.on('data',message=>{
    if(!message||typeof message!=='object')return;
    if(message.type==='join'&&!member){
      const name=C.cleanName(message.name);if(!name){connection.close();return}
      if(members.size>=12){send(connection,{type:'full'});connection.close();return}
      clearTimeout(handshake);member={id:'student:'+connection.peer,peerId:connection.peer,name,color:C.colors[colorIndex++%C.colors.length],allowed:false,writeAllowed:false,admitted:true,connection,lastPoint:0};members.set(member.id,member);publish();send(connection,{type:'highlights',strokes:highlightStore.strokes});roster();if(screen)callStudent(member);window.ClassPointerPdf?.studentJoined(member);return;
    }
    if(!member||members.get(member.id)!==member)return;
    if(message.type==='highlight'&&live()&&C.canWrite(state.mode,member)){if(highlightStore.add(member.id,message.stroke))publishHighlights();else send(member.connection,{type:'highlight-error'});return}
    if(message.type==='edit-highlights'&&member.admitted){if(['undo','clear'].includes(message.action)){highlightStore.edit(member.id,message.action);publishHighlights()}return}
    if(message.type==='video-ready'&&member.admitted){member.videoReady=true;clearTimeout(member.mediaTimer)}
    if(message.type==='pointer-hide'&&member.admitted){clearStudentHover(member);delete state.points[member.id];member.lastPoint=0;publish()}
    if(message.type==='point'&&live()&&C.canPoint(state.mode,member)&&C.validPoint(message.point)){
      // Identity comes from this connection, never from a student-supplied name or ID.
      member.pendingPoint={x:message.point.x,y:message.point.y,...C.pointStyle(message.point)};
      const delay=75-(Date.now()-member.lastPoint);
      if(delay<=0){clearTimeout(member.pointTimer);commitStudentHover(member)}
      else if(!member.pointTimer)member.pointTimer=setTimeout(()=>commitStudentHover(member),delay);
    }
  });
  connection.on('close',()=>{clearTimeout(handshake);if(member)removeMember(member)});
  connection.on('error',()=>{if(member)removeMember(member)});
}
function peerError(error){
  const kind=error?.type;
  const message=kind==='peer-unavailable'?'This class is no longer open. Ask your teacher for a new join link.':
    ['network','socket-error','socket-closed','server-error'].includes(kind)?'Could not reach the classroom connection service ('+kind+'). Try joining again. If this repeats, ask the school to allow secure WebSocket connections to 0.peerjs.com on port 443.':
    kind==='webrtc'?'The browser could not connect to the teacher. Ask the school to allow WebRTC connections.':
    kind==='browser-incompatible'?'This browser does not support the classroom connection. Open this page in Chrome or Edge.':
    'The classroom connection failed'+(typeof kind==='string'&&/^[a-z-]+$/.test(kind)?' ('+kind+')':'')+'. Try joining again.';
  fail(message);if(!started&&!admitted){if(isTeacher){endClass();fail(message)}else{leaveClass();fail(message)}}
}
function makePeer(id){
  if(typeof Peer==='undefined'){fail('The classroom connection library could not load. Refresh or ask the school to allow this page.');return null}
  const instance=new Peer(id||'class-pointer-student-'+crypto.randomUUID());instance.on('error',peerError);
  instance.on('disconnected',()=>{status('Connection service interrupted. Existing lesson connections may still work.');if(!instance.destroyed)instance.reconnect()});return instance;
}
async function startClass(){
  clearError();$('startClass').disabled=true;status('Opening class…');
  try{if(window.ClassPointerDashboard)await window.ClassPointerDashboard.ready}catch(error){$('startClass').disabled=false;fail(error.message);return}
  peer=makePeer('class-pointer-'+crypto.randomUUID());if(!peer){$('startClass').disabled=false;return}
  const current=peer;
  joinTimer=setTimeout(()=>{if(peer===current&&!started){endClass();fail('The class could not connect. Try again or use another network.')}},20000);
  peer.on('open',async id=>{
    if(peer!==current)return;
    try{if(window.ClassPointerDashboard)await window.ClassPointerDashboard.publish(id)}catch(error){if(peer===current){endClass();fail('Could not open the lesson on student dashboards. '+error.message)}return}
    if(peer!==current)return;clearTimeout(joinTimer);started=true;$('endClass').disabled=false;$('shareScreen').disabled=false;
    const link=new URL(location.href);link.search='';link.hash='';link.searchParams.set('room',id);$('joinLink').value=link.href;$('invitePanel').hidden=false;status(window.ClassPointerDashboard?'Class open. Students click Class Pointer on Fun Torah Tools and join automatically.':'Class open. Send the join link. Students join automatically.');roster();
  });
  peer.on('connection',receiveStudent);peer.on('call',call=>call.close());
}
function stopSharing(){
  cancelHover();highlighter?.cancel();highlightStore.reset();publishHighlights();generation++;
  const oldViewport=viewportController;viewportController=null;const oldScreen=screen;screen=null;
  oldViewport?.stop();oldScreen?.getTracks().forEach(track=>track.stop());
  for(const member of members.values()){clearStudentHover(member);member.call?.close();member.call=null;member.videoReady=false;clearTimeout(member.mediaTimer)}
  resetTabControls();state.sharing=false;state.points={};$('lesson').srcObject=null;$('placeholder').hidden=false;$('stopScreen').disabled=true;$('shareScreen').disabled=!started;publish();
}
function resetOverlaysForViewChange(){
  cancelHover();highlighter?.cancel();state.points={};highlightStore.reset();publishHighlights();publish();
}
// Captured Surface Control (Chrome 136+): scroll and zoom a shared *tab* from this page.
function tabControlSupported(controller,captured){
  return !!controller&&typeof controller.forwardWheel==='function'&&captured.getVideoTracks()[0]?.getSettings?.().displaySurface==='browser';
}
function setupTabControls(controller,captured){
  if(!isTeacher||!tabControlSupported(controller,captured)){resetTabControls();return}
  captureControl=controller;tabScrollOn=false;$('tabControls').hidden=false;updateTabControls();
  controller.addEventListener?.('zoomlevelchange',updateTabControls);
}
function resetTabControls(){
  const old=captureControl;captureControl=null;tabScrollOn=false;
  if(old)old.forwardWheel(null).catch(()=>{});
  const box=$('tabControls');if(box){box.hidden=true;updateTabControls()}
}
function updateTabControls(){
  const on=!!captureControl&&tabScrollOn,btn=$('tabScroll');if(!btn)return;
  btn.textContent=on?'🖱 Scroll tab: on':'🖱 Scroll tab: off';btn.setAttribute('aria-pressed',String(on));
  $('stage').classList.toggle('tab-scrolling',on);
  let level=null;try{level=captureControl?.zoomLevel??null}catch(_){}
  const levels=window.CaptureController?.getSupportedZoomLevels?.()||[];
  $('tabZoomOut').disabled=!captureControl||(level!=null&&levels.length&&level<=levels[0]);
  $('tabZoomIn').disabled=!captureControl||(level!=null&&levels.length&&level>=levels[levels.length-1]);
  if(level!=null)$('tabZoomIn').title='Zoom the shared tab in (now '+level+'%)';
}
function tabControlError(error){
  fail(error?.name==='NotAllowedError'?'Chrome did not allow controlling the shared tab. Click the button again and choose Allow.':'Could not control the shared tab. Try sharing a Chrome tab (not a window or whole screen).');
}
async function toggleTabScroll(){
  if(!captureControl)return;clearError();
  try{
    if(tabScrollOn){await captureControl.forwardWheel(null);tabScrollOn=false;status('Scroll tab is off. The mouse wheel no longer moves the shared tab.')}
    else{await captureControl.forwardWheel($('stage'));tabScrollOn=true;status('Scroll tab is on. Use your mouse wheel over the lesson to scroll the shared tab.')}
  }catch(error){tabScrollOn=false;tabControlError(error)}
  updateTabControls();
}
async function zoomTab(direction){
  if(!captureControl)return;clearError();
  try{await(direction>0?captureControl.increaseZoomLevel():captureControl.decreaseZoomLevel())}catch(error){tabControlError(error)}
  updateTabControls();
}
async function shareScreen(){
  clearError();window.ClassPointerPdf?.close(true);if(!navigator.mediaDevices?.getDisplayMedia){fail('Use Chrome or Edge on a computer to share your teaching screen.');return}
  $('shareScreen').disabled=true;const currentPeer=peer;let captured=null,processor=null,outgoing=null;
  try{
    // Keep the teacher on the Class Pointer page after picking a tab/window to share (Chrome/Edge 109+).
    let captureController=null;captureControl=null;
    if(typeof window.CaptureController==='function'){try{captureController=new CaptureController();captureController.setFocusBehavior?.('no-focus-change')}catch(_){captureController=null}}
    const displayOptions={video:{width:{ideal:2560},height:{ideal:1440},frameRate:{ideal:8,max:10}},audio:false};
    if(captureController)displayOptions.controller=captureController;
    captured=await navigator.mediaDevices.getDisplayMedia(displayOptions);
    if(peer!==currentPeer||!started){captured.getTracks().forEach(track=>track.stop());return}
    if(window.ClassPointerViewport?.create){
      processor=await window.ClassPointerViewport.create({rawStream:captured,stage:$('stage'),lesson:$('lesson'),onBeforeViewChange:resetOverlaysForViewChange,onStatus:status,onError:fail});
      if(peer!==currentPeer||!started){processor?.stop();return}
      viewportController=processor;outgoing=processor.stream||captured;
    }else outgoing=captured;
    screen=outgoing;generation++;state.sharing=true;state.points={};$('lesson').srcObject=screen;$('placeholder').hidden=true;$('stopScreen').disabled=false;
    setupTabControls(captureController,captured);captured.getVideoTracks()[0]?.addEventListener('ended',()=>{if(screen===outgoing)stopSharing()},{once:true});
    await $('lesson').play();if(screen!==outgoing)return;publish();for(const member of members.values())if(member.admitted)callStudent(member);
    status(viewportController?.active?'Teaching screen is sharing. Use Choose shared area, Zoom +, and Move view to focus the lesson.':'Teaching screen is sharing. Move your mouse over the picture to point as Teacher.');
  }catch(error){
    if(peer!==currentPeer||(error.name==='AbortError'&&!screen)){processor?.stop();captured?.getTracks().forEach(track=>track.stop());return}
    processor?.stop();if(viewportController===processor)viewportController=null;captured?.getTracks().forEach(track=>track.stop());stopSharing();
    fail(error.name==='NotAllowedError'?'Screen sharing was canceled. Click Share teaching screen to try again.':'Could not share the screen. Please try again.');
  }
}
function endClass(){
  window.ClassPointerPdf?.close(true);window.ClassPointerDashboard?.end().catch(()=>fail('Could not remove the dashboard lesson. Refresh before starting another class.'));
  clearTimeout(joinTimer);started=false;stopSharing();for(const member of members.values()){send(member.connection,{type:'ended'});member.connection.close()}
  members.clear();const oldPeer=peer;peer=null;oldPeer?.destroy();state={sharing:false,mode:'nobody',members:[],points:{}};$('accessMode').value='nobody';$('spotlight').checked=false;$('startClass').disabled=false;$('endClass').disabled=true;$('invitePanel').hidden=true;roster();status('Class ended. Start a new class for a new join link.');
}
function clearStudentVideo(){const oldCall=mediaCall;mediaCall=null;oldCall?.close();$('lesson').srcObject=null;$('placeholder').hidden=false;drawPointers()}
function leaveClass(){
  window.ClassPointerPdf?.reset();cancelHover();highlighter?.cancel();highlighter?.receive([]);clearTimeout(joinTimer);joining=false;admitted=false;clearStudentVideo();const oldConnection=teacherConnection;teacherConnection=null;oldConnection?.close();const oldPeer=peer;peer=null;oldPeer?.destroy();
  state={sharing:false,mode:'nobody',members:[],points:{}};$('joinForm').hidden=false;$('joinClass').disabled=false;$('leaveClass').hidden=true;$('pointerLayer').replaceChildren();$('permissionText').textContent='Enter your name to join your class.';status('Not connected.');
}
function joinClass(event){
  event.preventDefault();if(joining||peer)return;const name=C.cleanName($('studentName').value);if(!name){fail('Please enter your name.');return}
  clearError();joining=true;$('joinClass').disabled=true;status('Connecting to your teacher…');peer=makePeer();if(!peer){joining=false;$('joinClass').disabled=false;return}
  const current=peer;
  joinTimer=setTimeout(()=>{if(peer===current&&joining){leaveClass();fail('Could not reach your teacher. Check the join link or try another network.')}},20000);
  peer.on('open',()=>{
    if(peer!==current)return;
    teacherConnection=peer.connect(room,{reliable:true});const connection=teacherConnection;
    connection.on('open',()=>{if(teacherConnection===connection)send(connection,{type:'join',name})});
    connection.on('data',message=>{
      if(teacherConnection!==connection||!message)return;
      if(window.ClassPointerPdf?.handleMessage(message))return;
      if(message.type==='highlights'){highlighter?.receive(message.strokes);return}
      if(message.type==='highlight-error'){fail('Could not add the highlight. Try a shorter stroke or clear some of your highlights.');return}
      if(message.type==='waiting'){clearTimeout(joinTimer);joining=false;$('joinForm').hidden=true;$('leaveClass').hidden=false;status('Connected. Waiting for your teacher to admit you.');pointerPermission()}
      if(message.type==='state'){
        clearTimeout(joinTimer);joining=false;admitted=true;$('joinForm').hidden=true;$('leaveClass').hidden=false;state=message.state;
        if(!live()){highlighter?.cancel();highlighter?.receive([]);clearStudentVideo();window.ClassPointerPdf?.reset()}else if(!state.sharing)clearStudentVideo();status(state.sharing?'Class connected.':state.pdf?'Class connected. Following your teacher in the '+(state.documentKind==='webpage'?'webpage.':'PDF.'):'Admitted. Waiting for the teaching screen.');pointerPermission();drawPointers();
      }
      if(['ended','removed','full'].includes(message.type)){leaveClass();fail(message.type==='ended'?'Your teacher ended the class.':message.type==='full'?'This first test supports up to 12 students.':'Your teacher removed you from the class.')}
    });
    connection.on('close',()=>{if(teacherConnection===connection){leaveClass();fail('The teacher connection closed. Ask your teacher whether to rejoin.')}});
    connection.on('error',()=>{if(teacherConnection===connection){leaveClass();fail('Could not connect to the teacher. Try another network or a new join link.')}});
  });
  peer.on('call',call=>{
    if(call.peer!==room||!teacherConnection?.open){call.close();return}
    mediaCall?.close();mediaCall=call;call.answer();
    call.on('stream',incoming=>{if(mediaCall!==call)return;$('lesson').srcObject=incoming;$('placeholder').hidden=true;$('lesson').play().catch(error=>{if(mediaCall===call&&error.name!=='AbortError')fail('Click the lesson to resume video playback.')});send(teacherConnection,{type:'video-ready'});status('Live teaching screen received.');drawPointers()});
    call.on('close',()=>{if(mediaCall===call){mediaCall=null;$('lesson').srcObject=null;$('placeholder').hidden=false;status('Teaching screen paused.');drawPointers()}});
    call.on('error',()=>fail('Could not receive the teaching screen. Leave and rejoin, or try another network.'));
  });
  peer.on('connection',connection=>connection.close());
}
function cancelHover(){clearTimeout(hoverTimer);hoverTimer=null;pendingPoint=null}
function hideOwnPointer(){
  cancelHover();lastHover=0;
  if(isTeacher){if(state.points.teacher){delete state.points.teacher;publish()}}else send(teacherConnection,{type:'pointer-hide'});
}
function sendHover(){
  hoverTimer=null;const point=pendingPoint;pendingPoint=null;if(navigating||!point||!live()||!allowed())return;
  lastHover=Date.now();
  if(isTeacher){state.points.teacher=point;publish()}else send(teacherConnection,{type:'point',point});
}
function pointAt(event,immediate=false){
  if(navigating||!live())return;
  if(!allowed()){if(immediate)$('pointerStatus').textContent='Your teacher has not enabled your pointer.';return}
  const pdfOpen=window.ClassPointerPdf?.active();const video=$('lesson'),rect=$('stage').getBoundingClientRect(),box=pdfOpen?{left:0,top:0,w:1,h:1}:C.pictureBox(rect.width,rect.height,video.videoWidth,video.videoHeight);if(!box)return;
  const pdfPoint=pdfOpen?window.ClassPointerPdf.normalized(event):null;if(pdfOpen&&!pdfPoint){hideOwnPointer();return}
  const point={x:pdfOpen?pdfPoint.x:(event.clientX-rect.left-box.left)/box.w,y:pdfOpen?pdfPoint.y:(event.clientY-rect.top-box.top)/box.h,...C.pointStyle({tool:$(isTeacher?'teacherTool':'studentTool').value,color:$(isTeacher?'teacherColor':'studentColor').value})};
  if(!C.validPoint(point)){hideOwnPointer();return}
  pendingPoint=point;
  // Keep a trailing update, so the final hover location is never lost between sends.
  if(immediate||Date.now()-lastHover>=90){clearTimeout(hoverTimer);sendHover()}
  else if(!hoverTimer)hoverTimer=setTimeout(sendHover,90-(Date.now()-lastHover));
}
$('stage').addEventListener('pointermove',event=>pointAt(event));
$('stage').addEventListener('pointerleave',hideOwnPointer);
$('stage').addEventListener('pointercancel',hideOwnPointer);
$('stage').addEventListener('click',event=>{
  if(state.sharing&&$('lesson').paused)$('lesson').play().catch(()=>fail('Video playback could not resume. Leave and rejoin the class.'));
  pointAt(event,true);
});
$('accessMode').addEventListener('change',()=>{
  state.mode=$('accessMode').value;for(const member of members.values())if(!C.canPoint(state.mode,member)){clearStudentHover(member);delete state.points[member.id];member.writeAllowed=false}publish();roster();
});
function changeStyle(){
  const style=C.pointStyle({tool:$(isTeacher?'teacherTool':'studentTool').value,color:$(isTeacher?'teacherColor':'studentColor').value});
  if(pendingPoint)Object.assign(pendingPoint,style);
  if(isTeacher&&state.points.teacher){Object.assign(state.points.teacher,style);publish()}
}
['teacherTool','teacherColor','studentTool','studentColor'].forEach(id=>$(id).addEventListener('change',changeStyle));
$('spotlight').addEventListener('change',()=>{state.spotlight=$('spotlight').checked;publish()});
$('clearTeacher').addEventListener('click',()=>{cancelHover();delete state.points.teacher;publish()});
$('clearAll').addEventListener('click',()=>{cancelHover();state.points={};publish()});
$('copyLink').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('joinLink').value);status('Join link copied. Send it to your students.')}catch{$('joinLink').select();status('Select and copy the student join link.')}});
$('startClass').addEventListener('click',startClass);$('endClass').addEventListener('click',endClass);$('shareScreen').addEventListener('click',shareScreen);$('stopScreen').addEventListener('click',stopSharing);
if($('tabScroll')){$('tabScroll').addEventListener('click',toggleTabScroll);$('tabZoomIn').addEventListener('click',()=>zoomTab(1));$('tabZoomOut').addEventListener('click',()=>zoomTab(-1))}
$('joinForm').addEventListener('submit',joinClass);$('leaveClass').addEventListener('click',leaveClass);
new ResizeObserver(drawPointers).observe($('stage'));$('lesson').addEventListener('loadedmetadata',drawPointers);$('lesson').addEventListener('resize',drawPointers);
function publishHighlights(){highlighter?.receive(highlightStore.strokes);for(const member of members.values())if(member.admitted)send(member.connection,{type:'highlights',strokes:highlightStore.strokes})}
function submitStroke(stroke){if(isTeacher){if(highlightStore.add('teacher',stroke))publishHighlights();else fail('Highlight limit reached. Undo or clear some highlights.')}else send(teacherConnection,{type:'highlight',stroke})}
function live(){return state.sharing||state.pdf===true}
if(window.createClassHighlighter)highlighter=window.createClassHighlighter({
  teacher:isTeacher,allowed:()=>!navigating&&writingAllowed(),sharing:()=>state.sharing,owner:()=>isTeacher?'teacher':'student:'+peer?.id,
  ownerName:owner=>owner==='teacher'?'Teacher':state.members.find(m=>m.id===owner)?.name||'Student',
  color:()=>isTeacher?'#ffcc00':state.members.find(m=>m.id==='student:'+peer?.id)?.color||'#ffcc00',
  submit:submitStroke,
  edit(action){if(isTeacher){if(action==='all')highlightStore.reset();else highlightStore.edit('teacher',action);publishHighlights()}else send(teacherConnection,{type:'edit-highlights',action})}
});
if(highlighter){const baseReceive=highlighter.receive;highlighter.receive=next=>{baseReceive(next);window.ClassPointerPdf?.setStrokes(next)}}
// Small, fixed doorway used by PDF mode (pdf-mode.js). Nothing else reaches into this file.
window.ClassPointerBridge={isTeacher,send,fail,clearError,status,live,allowed,writingAllowed,submitStroke,redraw:drawPointers,members:()=>members,sharing:()=>state.sharing,stopSharing,
  navigating:()=>navigating,
  highlights:()=>highlightStore.strokes,
  owner:()=>isTeacher?'teacher':'student:'+peer?.id,ownColor:()=>isTeacher?'#ffcc00':state.members.find(m=>m.id==='student:'+peer?.id)?.color||'#ffcc00',
  setPdf(on,kind='pdf'){state.pdf=on;state.documentKind=on?kind:null;state.points={};if(!on){highlightStore.reset();publishHighlights()}publish()},
  resetMarks(){state.points={};highlightStore.reset();publishHighlights();publish()}};
function setNavigation(on){
  if(navigating===on)return;
  navigating=on;cancelHover();hideOwnPointer();highlighter?.cancel();
  $('stage').classList.toggle('mouse-navigation',on);pointerPermission();
  const hint=$('navigationHint');if(hint)hint.textContent=on?'🖱 Mouse mode — release Shift to return to your tool':'Hold Shift for mouse navigation';
  document.dispatchEvent(new Event('class-pointer-navigation'));
}
document.addEventListener('keydown',event=>{
  if(event.key!=='Shift'||event.repeat||event.target.closest?.('input,select,textarea,[contenteditable],dialog[open]'))return;
  setNavigation(true);
});
document.addEventListener('keyup',event=>{if(event.key==='Shift'||!event.shiftKey)setNavigation(false)});
window.addEventListener('blur',()=>setNavigation(false));
document.addEventListener('visibilitychange',()=>{if(document.hidden)setNavigation(false)});
$('teacherPanel').hidden=!isTeacher;$('studentPanel').hidden=isTeacher;if(!isTeacher)status('Join your teacher’s class.');
window.addEventListener('pagehide',()=>{if(isTeacher)endClass();else leaveClass()});
if(!isTeacher&&new URL(location.href).searchParams.get('dashboard')==='student'){
  let saved=null;try{saved=window.ClassPointerDashboardCore.handoff(JSON.parse(sessionStorage.getItem('classPointerDashboardJoin')),room)}catch{}
  if(saved){$('studentName').value=C.cleanName(saved.name);$('studentName').readOnly=true;const welcome=document.createElement('p');welcome.textContent='Joining as '+$('studentName').value+'.';$('studentPanel').prepend(welcome);joinClass({preventDefault(){}})}
  else{ $('joinClass').disabled=true;fail('Go back to Fun Torah Tools and click Class Pointer to join with your name.'); }
}
