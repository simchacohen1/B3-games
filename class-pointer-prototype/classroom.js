'use strict';
const C=window.ClassPointerCore,$=id=>document.getElementById(id);
const room=new URL(location.href).searchParams.get('room'),isTeacher=!room;   const entry=new URL(location.href).searchParams.get('dashboard');
   if((isTeacher&&entry!=='teacher')||(!isTeacher&&entry!=='student')){document.body.innerHTML='<main style="padding:2rem;font:1rem system-ui">Open Class Pointer from Fun Torah Tools.</main>';throw Error('Class Pointer must be opened from the dashboard.')}
const members=new Map();
// Students stay in Shorashim and other Fun Torah Tools pages. Their authenticated
// presence connections can receive embedded whiteboard messages without navigating.
const presence=new Map();
// Students the teacher deliberately removed from this class session are not let back in automatically.
const removedKey='classPointerRemoved:'+(new URL(location.href).searchParams.get('class')||'');
const removedStudents=new Set((()=>{try{return JSON.parse(sessionStorage.getItem(removedKey)||'[]').filter(id=>typeof id==='string')}catch{return[]}})());
function saveRemoved(){try{sessionStorage.setItem(removedKey,JSON.stringify(Array.from(removedStudents)))}catch{}}
const autoJoin=!isTeacher&&entry==='student';
let reconnectTimer=null,reconnectAttempts=0,stopReconnecting=false,replacedHere=false;
let peer=null,teacherConnection=null,screen=null,mediaCall=null,viewportController=null,state={sharing:false,mode:'selected',tools:{pointer:true,highlight:false,pen:false},members:[],points:{}},started=false,openingClass=false,admitted=false,joining=false,joinTimer=null;
let closingClass=false,endPromise=Promise.resolve();
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
function selected(member){return !!member?.admitted&&member.allowed===true&&state.mode==='selected'}
function memberTools(member){return member?.tools||state.tools}
function toolAllowed(tool,member=ownMember()){return isTeacher||selected(member)&&memberTools(member)?.[tool]===true}
function allowed(){return toolAllowed('pointer')}
function writingAllowed(tool){return toolAllowed(['pen','line','pen-arrow','rectangle','ellipse','triangle','text'].includes(tool)?'pen':'highlight')}
function pointerPermission(){
  const mayPoint=allowed(),mayWrite=writingAllowed('highlight')||writingAllowed('pen');$('stage').style.cursor=navigating?'default':mayPoint?'crosshair':'not-allowed';
  if(!mayPoint)cancelHover();if(!mayWrite)highlighter?.cancel()
  if(!isTeacher){
    const tool=$('studentTool');if(tool){for(const option of tool.options){if(C.highlightTools.includes(option.value))option.disabled=!writingAllowed(option.value);else option.disabled=!mayPoint}if(tool.selectedOptions[0]?.disabled){const first=Array.from(tool.options).find(o=>!o.disabled);if(first){tool.value=first.value;tool.dispatchEvent(new Event('change',{bubbles:true}))}}}
    $('permissionText').textContent=!admitted?'Connecting to your class.':!mayPoint?'Watch the lesson. Your teacher has not enabled your pointer.':mayWrite?'Use the tools your teacher enabled.':'Pointer only. Your teacher has not enabled writing tools.';
  }
}
// Before a video or PDF has loaded, the blank classroom is still a valid
// pointer surface. Otherwise zero video dimensions made all pointers disappear.
function pointerPictureBox(rect,video){
 return video.videoWidth>0&&video.videoHeight>0
  ? C.pictureBox(rect.width,rect.height,video.videoWidth,video.videoHeight)
  : {left:0,top:0,w:rect.width,h:rect.height};
}
function drawPointers(){
  const video=$('lesson'),rect=$('stage').getBoundingClientRect(),box=window.ClassPointerPdf?.active()?window.ClassPointerPdf.box():pointerPictureBox(rect,video);
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
  state.members=Array.from(members.values()).filter(member=>member.admitted).map(member=>({id:member.id,name:member.name,color:member.color,admitted:true,allowed:member.allowed,tools:memberTools(member)}));
  for(const member of members.values())if(member.admitted)send(member.connection,{type:'state',state});
  drawPointers();pointerPermission();
}
function roster(){
  document.dispatchEvent(new CustomEvent('classpointer:roster'));
  const list=$('roster');list.replaceChildren();
  if(!members.size){list.textContent=started?'No students yet. Send the join link to one student.':'Start a class to receive join requests.';return}
  for(const member of members.values()){
    const row=document.createElement('div');row.className='roster-row';const name=document.createElement('span');name.textContent=member.name+(member.admitted?' — admitted':' — waiting');row.appendChild(name);
    if(!member.admitted){const admit=document.createElement('button');admit.textContent='Admit '+member.name;admit.addEventListener('click',()=>{member.admitted=true;publish();send(member.connection,{type:"highlights",strokes:highlightStore.strokes});roster();if(screen)callStudent(member)});row.appendChild(admit)}
    else{
      const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=member.allowed;
      input.setAttribute('aria-label','Select '+member.name);
      input.addEventListener('change',()=>{member.allowed=input.checked;if(member.allowed)member.tools={...state.tools};if(!member.allowed){clearStudentHover(member);delete state.points[member.id]}publish();roster()});
      label.append(input,document.createTextNode(' Select'));row.appendChild(label);
    }
    const remove=document.createElement('button');remove.textContent=member.admitted?'Remove '+member.name:'Decline '+member.name;
    remove.addEventListener('click',()=>removeStudentDeliberately(member));row.appendChild(remove);list.appendChild(row);
  }
}
function removeMember(member){
  if(members.get(member.id)!==member)return;
  clearStudentHover(member);
  member.call?.close();clearTimeout(member.mediaTimer);members.delete(member.id);delete state.points[member.id];highlightStore.edit(member.id,"clear");publishHighlights();publish();roster();window.ClassPointerBoards?.studentLeft(member);
}
function clearStudentHover(member){clearTimeout(member.pointTimer);member.pointTimer=null;member.pendingPoint=null}
function commitStudentHover(member){
  member.pointTimer=null;const point=member.pendingPoint;member.pendingPoint=null;
  if(!point||members.get(member.id)!==member||!live()||!selected(member)||!memberTools(member)?.pointer)return;
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
// One-way lesson transport for server-verified activity presence connections.
let activityLessonStream=null,activityPresentationId=null,activityPresentationEnabled=true,activityTeacherAuthorized=true,activityTeacherEpoch=0;
function closeActivityCall(entry){const old=entry.lessonCall;entry.lessonCall=null;try{old?.close()}catch{}}
function sendActivityLesson(entry){
  closeActivityCall(entry);
  if(!started||!activityTeacherAuthorized||!activityPresentationEnabled||!activityLessonStream||presence.get(entry.id)!==entry)return;
  send(entry.connection,{type:'lesson-presentation',id:activityPresentationId,active:true});
  try{entry.lessonCall=peer.call(entry.connection.peer,activityLessonStream,{metadata:{kind:'activity-lesson',presentationId:activityPresentationId}});favorTextDetail(entry.lessonCall)}catch{send(entry.connection,{type:'lesson-presentation',id:activityPresentationId,active:false})}
}
function setActivityLesson(stream){
  activityLessonStream=stream;if(stream)activityPresentationId=crypto.randomUUID();
  for(const entry of presence.values()){
    closeActivityCall(entry);
    if(stream&&activityPresentationEnabled)sendActivityLesson(entry);
    else send(entry.connection,{type:'lesson-presentation',id:activityPresentationId,active:false});
  }
}
document.addEventListener('class-pointer-teacher-signed-out',()=>{
  if(!isTeacher)return;activityTeacherAuthorized=false;activityTeacherEpoch++;stopSharing();window.ClassPointerPdf?.close(true);
  $('shareScreen').disabled=true;$('openBrowserTab').disabled=true;$('openWhiteboard').disabled=true;
});
document.addEventListener('class-pointer-teacher-restored',()=>{
  if(!isTeacher)return;activityTeacherAuthorized=true;
  $('shareScreen').disabled=!started||!activityTeacherAuthorized;$('openBrowserTab').disabled=!started||!activityTeacherAuthorized;$('openWhiteboard').disabled=!started;
});
document.addEventListener('class-pointer-document-presentation',event=>{if(isTeacher)setActivityLesson(event.detail?.stream||null)});
document.addEventListener('class-pointer-workspace',event=>{
  if(!isTeacher||event.detail==='students')return;
  const enabled=event.detail==='teach';
  if(enabled&&!activityPresentationEnabled&&activityLessonStream)activityPresentationId=crypto.randomUUID();
  activityPresentationEnabled=enabled;
  for(const entry of presence.values()){
    if(activityPresentationEnabled)sendActivityLesson(entry);
    else{closeActivityCall(entry);send(entry.connection,{type:'lesson-presentation',id:activityPresentationId,active:false})}
  }
});
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
  const admitJoin=message=>{
      const name=C.cleanName(message.name);if(!name){connection.close();return}
      const verifiedId=window.ClassPointerDashboardCore?.validId(message.studentId)?message.studentId:null;
      // A student the teacher removed stays out of this class session until the teacher allows him back.
      if(verifiedId&&removedStudents.has(verifiedId)){send(connection,{type:'removed'});setTimeout(()=>connection.close(),300);return}
      // Browser tabs and reconnects get new PeerJS IDs. Keep only one live
      // connection per signed-in student (by verified id, else by name), rather than one per PeerJS ID.
      const sameStudent=existing=>verifiedId&&existing.studentId?existing.studentId===verifiedId:existing.name.toLocaleLowerCase()===name.toLocaleLowerCase();
      const duplicate=Array.from(members.values()).find(sameStudent);
      if(!duplicate&&members.size>=40){send(connection,{type:'full'});connection.close();return}

      const previousAccess=duplicate?{allowed:duplicate.allowed,writeAllowed:duplicate.writeAllowed,tools:duplicate.tools,color:duplicate.color,studentId:duplicate.studentId}:null;
      if(duplicate){
        // Remove the stale entry before closing its connection; its close
        // callback cannot subsequently remove the replacement.
        removeMember(duplicate);
        // Not a removal: the same student simply connected again (refresh, reconnect or another tab).
        send(duplicate.connection,{type:'replaced'});
        setTimeout(()=>duplicate.connection.close(),300);
      }
      clearTimeout(handshake);member={id:'student:'+connection.peer,peerId:connection.peer,name,studentId:window.ClassPointerDashboardCore?.validId(message.studentId)?message.studentId:(previousAccess?.studentId||null),color:previousAccess?.color||C.colors[colorIndex++%C.colors.length],allowed:previousAccess?.allowed||false,writeAllowed:previousAccess?.writeAllowed||false,tools:previousAccess?.tools||null,admitted:true,connection,lastPoint:0};if(!previousAccess)applyLevel(member,savedLevel(name));members.set(member.id,member);publish();send(connection,{type:'highlights',strokes:highlightStore.strokes});roster();if(screen)callStudent(member);window.ClassPointerPdf?.studentJoined(member);window.ClassPointerBoards?.studentJoined(member);return;
  };
  let joinPending=false;
  connection.on('data',message=>{
    if(!message||typeof message!=='object')return;
    if(member?.presence){
      if(presence.get(member.id)!==member)return;
      if(message.type==='lesson-retry'&&message.id===activityPresentationId&&Date.now()-(member.lastLessonRetry||0)>2000){member.lastLessonRetry=Date.now();sendActivityLesson(member)}
      if(message.type==='where'){member.activity=cleanActivity(message.activity);roster()}
      if(typeof message.type==='string'&&message.type.startsWith('board-'))window.ClassPointerBoards?.fromStudent(member,message);
      return;
    }
    if(message.type==='join'&&!member){
      const gate=window.ClassPointerJoinGate;
      if(message.presence===true){
        // Background connection from another Fun Torah Tools page. Always needs a server-verified ticket.
        if(!gate?.required||joinPending){connection.close();return}
        joinPending=true;
        gate.verify(message.ticket,connection.peer).then(verified=>{joinPending=false;if(!verified||member||!connection.open||!started){connection.close();return}clearTimeout(handshake);member=admitPresence(connection,verified,message.activity)}).catch(()=>{joinPending=false;connection.close()});
        return;
      }
      if(gate&&gate.required){
        // The room id is public, so nobody is admitted on their own say-so. The server must confirm a
        // short-lived ticket for this class, this lesson and this very connection; the student's id and
        // name come only from that answer.
        if(joinPending)return;
        joinPending=true;
        gate.verify(message.ticket,connection.peer).then(verified=>{joinPending=false;if(!verified||member||!connection.open||!started){connection.close();return}admitJoin({...message,name:verified.studentName,studentId:verified.studentId})}).catch(()=>{joinPending=false;connection.close()});
        return;
      }
      admitJoin(message);
      return;
    }
    if(!member||members.get(member.id)!==member)return;
    if(typeof message.type==='string'&&message.type.startsWith('board-')){if(member.admitted)window.ClassPointerBoards?.fromStudent(member,message);return}
    if(message.type==='highlight'&&live()&&selected(member)&&memberTools(member)?.[['pen','line','pen-arrow','rectangle','ellipse','triangle','text'].includes(message.stroke?.tool)?'pen':'highlight']){if(highlightStore.add(member.id,message.stroke))publishHighlights();else send(member.connection,{type:'highlight-error'});return}
    if(message.type==='edit-highlights'&&member.admitted){if(['undo','clear'].includes(message.action)){highlightStore.edit(member.id,message.action);publishHighlights()}return}
    if(message.type==='video-ready'&&member.admitted){member.videoReady=true;clearTimeout(member.mediaTimer)}
    if(message.type==='pointer-hide'&&member.admitted){clearStudentHover(member);delete state.points[member.id];member.lastPoint=0;publish()}
    if(message.type==='point'&&live()&&selected(member)&&memberTools(member)?.pointer&&C.validPoint(message.point)){
      // Identity comes from this connection, never from a student-supplied name or ID.
      member.pendingPoint={x:message.point.x,y:message.point.y,...C.pointStyle(message.point)};
      const delay=75-(Date.now()-member.lastPoint);
      if(delay<=0){clearTimeout(member.pointTimer);commitStudentHover(member)}
      else if(!member.pointTimer)member.pointTimer=setTimeout(()=>commitStudentHover(member),delay);
    }
  });
  connection.on('close',()=>{clearTimeout(handshake);if(member?.presence)dropPresence(member);else if(member)removeMember(member)});
  connection.on('error',()=>{if(member?.presence)dropPresence(member);else if(member)removeMember(member)});
}
function cleanActivity(value){return String(typeof value==='string'?value:'').replace(/[\u0000-\u001f<>]/g,'').replace(/\s+/g,' ').trim().slice(0,40)}
function admitPresence(connection,verified,activity){
  const studentId=verified.studentId,name=C.cleanName(verified.studentName)||'Student';
  if(removedStudents.has(studentId)){send(connection,{type:'removed'});setTimeout(()=>connection.close(),300);return null}
  // A boy may have several tabs open: each keeps its own connection (closing one never disconnects
  // the others), and the Students panel still lists him once.
  if(Array.from(presence.values()).filter(entry=>entry.studentId===studentId).length>=6||presence.size>=120){send(connection,{type:'full'});setTimeout(()=>connection.close(),300);return null}
  const entry={id:'presence:'+connection.peer,presence:true,admitted:true,studentId,name,activity:cleanActivity(activity),connection,connectedAt:Date.now()};
  presence.set(entry.id,entry);send(connection,{type:'present'});sendActivityLesson(entry);
  window.ClassPointerBoards?.studentJoined(entry);roster();
  return entry;
}
function dropPresence(entry,notice){
  if(presence.get(entry.id)!==entry)return;
  presence.delete(entry.id);closeActivityCall(entry);window.ClassPointerBoards?.studentLeft(entry);
  if(notice){send(entry.connection,{type:notice});setTimeout(()=>{try{entry.connection.close()}catch{}},300)}
  roster();
}
function removeStudentDeliberately(entry){
  // Only this path tells a student he was removed, and it keeps him out until the teacher allows him back.
  if(entry.studentId){removedStudents.add(entry.studentId);saveRemoved();window.ClassPointerActivityShares?.revokeStudents([entry.studentId])}
  for(const other of Array.from(presence.values()))if(other===entry||(entry.studentId&&other.studentId===entry.studentId)){send(other.connection,{type:'removed'});closeActivityCall(other);presence.delete(other.id);window.ClassPointerBoards?.studentLeft(other);setTimeout(()=>{try{other.connection.close()}catch{}},300)}
  for(const other of Array.from(members.values()))if(other===entry||(entry.studentId&&other.studentId===entry.studentId)){send(other.connection,{type:'removed'});removeMember(other);setTimeout(()=>{try{other.connection.close()}catch{}},300)}
  roster();
}
function peerError(error){
  const kind=error?.type;
  const message=kind==='peer-unavailable'?'This class is no longer open. Ask your teacher for a new join link.':
    ['network','socket-error','socket-closed','server-error'].includes(kind)?'Could not reach the classroom connection service ('+kind+'). Try joining again. If this repeats, ask the school to allow secure WebSocket connections to 0.peerjs.com on port 443.':
    kind==='webrtc'?'The browser could not connect to the teacher. Ask the school to allow WebRTC connections.':
    kind==='browser-incompatible'?'This browser does not support the classroom connection. Open this page in Chrome or Edge.':
    'The classroom connection failed'+(typeof kind==='string'&&/^[a-z-]+$/.test(kind)?' ('+kind+')':'')+'. Try joining again.';
  if(autoJoin){
    // The lesson is gone (teacher closed or reopened it): wait for the next one on the class page.
    if(kind==='peer-unavailable'){goWaiting('Your teacher’s lesson closed. Waiting for the next one…');return}
    if(['network','socket-error','socket-closed','server-error'].includes(kind)&&admitted){
      status('Connection interrupted. Reconnecting…');
      if(peer&&!peer.destroyed&&peer.disconnected){try{peer.reconnect()}catch{}}
      return;
    }
    if(kind==='browser-incompatible'){stopReconnecting=true;leaveClass();fail(message);return}
    scheduleReconnect();return;
  }
  // Temporary PeerJS signalling interruptions should not end a functioning lesson.
  if(['network','socket-error','socket-closed','server-error'].includes(kind)&&(started||admitted)){
    status('Classroom connection interrupted. Trying to reconnect; your current lesson may still work.');
    if(peer&&!peer.destroyed&&peer.disconnected){try{peer.reconnect()}catch{}}
    return;
  }
  fail(message);if(!started&&!admitted){if(isTeacher){endClass();fail(message)}else{leaveClass();fail(message)}}
}
function makePeer(id){
  if(typeof Peer==='undefined'){fail('The classroom connection library could not load. Refresh or ask the school to allow this page.');return null}
  const instance=new Peer(id||'class-pointer-student-'+crypto.randomUUID());instance.on('error',peerError);instance.on('open',()=>{clearError();if(started||admitted)status('Classroom connection restored.');});
  instance.on('disconnected',()=>{status('Connection service interrupted. Existing lesson connections may still work.');if(!instance.destroyed)instance.reconnect()});return instance;
}
async function startClass(){
  if(!isTeacher||started||openingClass||closingClass)return;
  openingClass=true;
  const startButton=$('startClass');startButton.disabled=true;startButton.hidden=true;
  clearError();status('Opening your classroom automatically…');
  try{
    // Wait for Firebase to delete the old room before creating another one.
    await endPromise;
    if(window.ClassPointerDashboard)await window.ClassPointerDashboard.ready;
  }catch(error){
    openingClass=false;startButton.disabled=false;startButton.hidden=false;
    startButton.textContent='↻ Retry opening classroom';fail(error.message);return;
  }
  if(!openingClass)return;
  peer=makePeer('class-pointer-'+crypto.randomUUID());if(!peer){
    openingClass=false;startButton.disabled=false;startButton.hidden=false;startButton.textContent='↻ Retry opening classroom';return;
  }
  const current=peer;
  joinTimer=setTimeout(()=>{if(peer===current&&!started){endClass();fail('The class could not connect. Try again or use another network.')}},20000);
  peer.on('open',async id=>{
    if(peer!==current)return;
    try{if(window.ClassPointerDashboard)await window.ClassPointerDashboard.publish(id)}catch(error){if(peer===current){endClass();fail('Could not open the lesson on student dashboards. '+error.message)}return}
    if(peer!==current)return;clearTimeout(joinTimer);started=true;openingClass=false;$('endClass').disabled=false;$('shareScreen').disabled=false;$('openBrowserTab').disabled=false;
    $('startClass').hidden=true;
    const sendButton=$('sendEveryoneShare');if(sendButton)sendButton.disabled=false;
    const link=new URL(location.href);link.search='';link.hash='';link.searchParams.set('room',id);$('joinLink').value=link.href;$('invitePanel').hidden=false;status('Class ready! Click Share teaching screen, or open another lesson. Students can join automatically.');roster();
    if(new URL(location.href).searchParams.get('sendEveryoneShare')==='1')void requestEveryoneToShare();
    if(new URL(location.href).searchParams.get('sendEveryoneBoards')==='1')document.dispatchEvent(new Event('classpointer:send-to-whiteboards'));
  });
  peer.on('connection',receiveStudent);
  if(window.ClassPointerJoinGate?.required)window.ClassPointerJoinGate.watch(()=>Array.from(members.values()).concat(Array.from(presence.values())),m=>{send(m.connection,{type:'removed'});if(m.presence){closeActivityCall(m);presence.delete(m.id)}else removeMember(m);roster();try{m.connection.close()}catch{}});peer.on('call',call=>{if(call.metadata?.kind==='activity-screen'){if(window.ClassPointerActivityShares)void window.ClassPointerActivityShares.incomingCall(call);else call.close();return}if(!window.ClassPointerBoards?.incomingCall(call))call.close()});
}
async function requestEveryoneToShare(){
  if(!isTeacher||!started)return;
  // Use the same Screens mode as the working student gallery. This enables
  // the teacher's grid and broadcasts the class-specific navigation request.
  document.dispatchEvent(new Event('classpointer:send-to-screens'));
}
function stopSharing(){
  if(isTeacher)setActivityLesson(null);
  cancelHover();highlighter?.cancel();highlightStore.reset();publishHighlights();generation++;
  const oldViewport=viewportController;viewportController=null;const oldScreen=screen;screen=null;
  oldViewport?.stop();oldScreen?.getTracks().forEach(track=>track.stop());
  for(const member of members.values()){clearStudentHover(member);member.call?.close();member.call=null;member.videoReady=false;clearTimeout(member.mediaTimer)}
  resetTabControls();state.sharing=false;state.points={};$('lesson').srcObject=null;$('placeholder').hidden=false;$('stopScreen').disabled=true;$('shareScreen').disabled=!started||!activityTeacherAuthorized;$('openBrowserTab').disabled=!started||!activityTeacherAuthorized;publish();
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
async function captureBrowserTab(){
  if(!started||!activityTeacherAuthorized)return;
  const captureEpoch=activityTeacherEpoch;
  if(!navigator.mediaDevices?.getDisplayMedia){fail('Use Chrome or Edge on a computer to capture a tab, window, or screen.');return}
  clearError();$('openBrowserTab').disabled=true;
  let stream=null,video=null;
  try{
    const opts={video:{frameRate:1},audio:false,preferCurrentTab:false,selfBrowserSurface:'exclude'};
    let controller=null;
    if(typeof window.CaptureController==='function'){
      try{controller=new CaptureController();opts.controller=controller}catch(_){controller=null}
    }
    stream=await navigator.mediaDevices.getDisplayMedia(opts);
    if(!started||!activityTeacherAuthorized||captureEpoch!==activityTeacherEpoch)return;
    // Chrome/Edge may otherwise switch focus to the source tab after Share.
    try{controller?.setFocusBehavior?.('focus-capturing-application')}catch(_){try{controller?.setFocusBehavior?.('no-focus-change')}catch(__){}}
    const track=stream.getVideoTracks()[0];
    if(!track)throw Error('No screen or window was selected.');
    video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=stream;
    await video.play();
    if(!video.videoWidth||!video.videoHeight)await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('The selected source did not provide a picture.')),7000);
      video.addEventListener('loadeddata',()=>{clearTimeout(timer);resolve()},{once:true});
    });
    if(!started||!activityTeacherAuthorized||captureEpoch!==activityTeacherEpoch)return;
    if(!video.videoWidth||!video.videoHeight)throw Error('The selected source is not ready to capture.');
    const width=Math.min(1800,video.videoWidth),height=Math.round(width*video.videoHeight/video.videoWidth);
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    canvas.getContext('2d',{alpha:false}).drawImage(video,0,0,width,height);
    const dataUrl=canvas.toDataURL('image/jpeg',0.82);
    track.stop();stream=null;video.srcObject=null;
    if(await window.ClassPointerPdf.openSnapshot(dataUrl,width,height)){
      document.dispatchEvent(new Event('class-pointer-capture-ready'));
      // Best effort: after the still image is captured, ask the browser to
      // return to Class Pointer. Browsers may ignore focus requests.
      try{window.focus()}catch(_){}
      requestAnimationFrame(()=>{try{window.focus()}catch(_){}});
    }
  }catch(error){fail(error.name==='NotAllowedError'?'Capture was canceled.':error.message||'Could not capture the selected source.')}
  finally{stream?.getTracks().forEach(t=>t.stop());if(video)video.srcObject=null;$('openBrowserTab').disabled=!started||!activityTeacherAuthorized}
}
async function shareScreen(preferTab=false){
  if(!activityTeacherAuthorized)return;
  clearError();window.ClassPointerPdf?.close(true);if(!navigator.mediaDevices?.getDisplayMedia){fail('Use Chrome or Edge on a computer to share your teaching screen.');return}
  $('shareScreen').disabled=true;$('openBrowserTab').disabled=true;const currentPeer=peer,captureEpoch=activityTeacherEpoch;let captured=null,processor=null,outgoing=null;
  try{
    // Keep the teacher on the Class Pointer page after picking a tab/window to share (Chrome/Edge 109+).
    let captureController=null;captureControl=null;
    if(typeof window.CaptureController==='function'){try{captureController=new CaptureController();captureController.setFocusBehavior?.('no-focus-change')}catch(_){captureController=null}}
    const displayOptions={video:{width:{ideal:2560},height:{ideal:1440},frameRate:{ideal:8,max:10}},audio:false};
    if(captureController)displayOptions.controller=captureController;
    if(preferTab){displayOptions.preferCurrentTab=false;displayOptions.selfBrowserSurface='exclude';displayOptions.surfaceSwitching='include';}
    captured=await navigator.mediaDevices.getDisplayMedia(displayOptions);
    if(preferTab&&captured.getVideoTracks()[0]?.getSettings?.().displaySurface!=='browser'){
      captured.getTracks().forEach(track=>track.stop());captured=null;
      fail('Choose a browser tab in the sharing picker, not a window or entire screen.');
      $('shareScreen').disabled=!started||!activityTeacherAuthorized;$('openBrowserTab').disabled=!started||!activityTeacherAuthorized;return;
    }
    if(peer!==currentPeer||!started||!activityTeacherAuthorized||captureEpoch!==activityTeacherEpoch){captured.getTracks().forEach(track=>track.stop());return}
    if(window.ClassPointerViewport?.create){
      processor=await window.ClassPointerViewport.create({rawStream:captured,stage:$('stage'),lesson:$('lesson'),onBeforeViewChange:resetOverlaysForViewChange,onStatus:status,onError:fail});
      if(peer!==currentPeer||!started||!activityTeacherAuthorized||captureEpoch!==activityTeacherEpoch){processor?.stop();captured?.getTracks().forEach(track=>track.stop());return}
      viewportController=processor;outgoing=processor.stream||captured;
    }else outgoing=captured;
    screen=outgoing;generation++;state.sharing=true;state.points={};$('lesson').srcObject=screen;$('placeholder').hidden=true;$('stopScreen').disabled=false;
    setupTabControls(captureController,captured);captured.getVideoTracks()[0]?.addEventListener('ended',()=>{if(screen===outgoing)stopSharing()},{once:true});
    await $('lesson').play();if(screen!==outgoing)return;document.dispatchEvent(new Event('class-pointer-capture-ready'));setActivityLesson(screen);publish();for(const member of members.values())if(member.admitted)callStudent(member);
    status(preferTab?'Browser tab is sharing. Use Scroll tab and Tab A−/A+ when supported; hold Shift to navigate without marking.':viewportController?.active?'Teaching screen is sharing. Use Choose shared area, Zoom +, and Move view to focus the lesson.':'Teaching screen is sharing. Move your mouse over the picture to point as Teacher.');
  }catch(error){
    if(peer!==currentPeer||(error.name==='AbortError'&&!screen)){processor?.stop();captured?.getTracks().forEach(track=>track.stop());return}
    processor?.stop();if(viewportController===processor)viewportController=null;captured?.getTracks().forEach(track=>track.stop());stopSharing();
    fail(error.name==='NotAllowedError'?'Screen sharing was canceled. Click Share teaching screen to try again.':'Could not share the screen. Please try again.');
  }
}
function endClass(){
  if(!isTeacher||closingClass)return endPromise;
  closingClass=true;
  window.ClassPointerActivityShares?.closeAll();
  window.ClassPointerBoards?.endClass();
  window.ClassPointerPdf?.close(true);
  clearTimeout(joinTimer);started=false;openingClass=false;stopSharing();
  for(const member of members.values()){send(member.connection,{type:'ended'});member.connection.close()}
  members.clear();
  for(const entry of presence.values()){closeActivityCall(entry);send(entry.connection,{type:'ended'});try{entry.connection.close()}catch{}}
  presence.clear();
  const oldPeer=peer;peer=null;oldPeer?.destroy();
  state={sharing:false,mode:'selected',tools:{pointer:true,highlight:false,pen:false},members:[],points:{}};
  for(const [id,tool] of [['allowPointer','pointer'],['allowHighlight','highlight'],['allowPen','pen']])$(id).checked=state.tools[tool];
  defaultLevel='none';nameLevels.clear();
  $('accessMode').value='selected';$('spotlight').checked=false;
  const button=$('startClass');
  button.disabled=true;button.hidden=false;button.textContent='Ending class…';
  $('endClass').disabled=true;$('invitePanel').hidden=true;roster();
  status('Ending class and clearing its connection…');
  // A restart must not overlap an unfinished Firebase removal. Keep the
  // original window usable rather than requiring it to be closed and reopened.
  endPromise=Promise.resolve().then(()=>window.ClassPointerDashboard?.end()).then(()=>{
    closingClass=false;
    button.disabled=false;button.textContent='↻ Start another class';
    status('Class ended. Click Start another class to reopen it.');
  }).catch(error=>{
    closingClass=false;
    button.disabled=true;button.textContent='Classroom cleanup failed';
    fail('Could not finish ending the class. Refresh before starting again. '+(error?.message||''));
  });
  return endPromise;
}
function clearStudentVideo(){const oldCall=mediaCall;mediaCall=null;oldCall?.close();$('lesson').srcObject=null;$('placeholder').hidden=false;drawPointers()}
function leaveClass(){
  window.ClassPointerBoards?.reset();window.ClassPointerPdf?.reset();cancelHover();highlighter?.cancel();highlighter?.receive([]);clearTimeout(joinTimer);joining=false;admitted=false;clearStudentVideo();const oldConnection=teacherConnection;teacherConnection=null;oldConnection?.close();const oldPeer=peer;peer=null;oldPeer?.destroy();
  state={sharing:false,mode:'selected',tools:{pointer:false,highlight:false,pen:false},members:[],points:{}};$('joinForm').hidden=autoJoin;$('joinClass').disabled=false;$('leaveClass').hidden=true;$('pointerLayer').replaceChildren();$('permissionText').textContent=autoJoin?'Connecting to your class.':'Enter your name to join your class.';status(autoJoin?'Connecting to your class…':'Not connected.');
}
function joinSucceeded(){
  reconnectAttempts=0;clearError();
  try{const saved=JSON.parse(sessionStorage.getItem('classPointerDashboardJoin')||'null');if(saved&&saved.room===room){saved.at=Date.now();sessionStorage.setItem('classPointerDashboardJoin',JSON.stringify(saved))}}catch{}
}
// Students who came from Fun Torah Tools reconnect on their own; there is no Join button to press.
function scheduleReconnect(delay){
  if(!autoJoin||stopReconnecting)return;
  clearTimeout(reconnectTimer);clearTimeout(joinTimer);
  const wasAdmitted=admitted;
  leaveClass();
  reconnectAttempts++;
  if(reconnectAttempts>8){goWaiting('Still trying to reach your teacher…');return}
  const wait=delay??Math.min(15000,1000*2**Math.min(reconnectAttempts-1,4));
  status(wasAdmitted?'Connection interrupted. Reconnecting…':'Connecting to your teacher…');
  reconnectTimer=setTimeout(()=>{if(!stopReconnecting&&!peer)joinClass({preventDefault(){}})},wait);
}
// Go back to the class waiting page; it joins the teacher's current or next lesson automatically.
// The same boy opened Class Pointer in another tab. When he comes back to this tab, it takes over again.
function resumeHere(){
  if(!autoJoin||!replacedHere||document.hidden)return;
  replacedHere=false;stopReconnecting=false;reconnectAttempts=0;clearError();status('Connecting to your class…');
  if(!peer)joinClass({preventDefault(){}});
}
if(autoJoin){document.addEventListener('visibilitychange',resumeHere);window.addEventListener('focus',resumeHere);$('connectionStatus').addEventListener('click',resumeHere)}
function goWaiting(text){
  stopReconnecting=true;clearTimeout(reconnectTimer);leaveClass();status(text);
  setTimeout(()=>location.replace('dashboard.html'),2500);
}
function joinClass(event){
  event.preventDefault();if(joining||peer)return;const name=C.cleanName($('studentName').value);if(!name){fail('Please enter your name.');return}
  clearError();joining=true;$('joinClass').disabled=true;status('Connecting to your teacher…');peer=makePeer();if(!peer){joining=false;$('joinClass').disabled=false;return}
  const current=peer;
  joinTimer=setTimeout(()=>{if(peer===current&&joining){if(autoJoin){scheduleReconnect();return}leaveClass();fail('Could not reach your teacher. Check the join link or try another network.')}},20000);
  peer.on('open',()=>{
    if(peer!==current)return;
    teacherConnection=peer.connect(room,{reliable:true});const connection=teacherConnection;
    connection.on('open',async()=>{if(teacherConnection!==connection)return;let studentId=null,classId=null;try{const saved=JSON.parse(sessionStorage.getItem('classPointerDashboardJoin')||'null');if(window.ClassPointerDashboardCore.handoff(saved,room)){studentId=saved.studentId;classId=saved.classId}}catch(_){}
      if(!studentId){try{studentId=sessionStorage.getItem('b3Games_studentId')||null;classId=sessionStorage.getItem('b3Games_studentClass')||null}catch(_){}}
      let ticket=null;
      // Ask the school server to confirm this student (own passcode, active in this class) before connecting.
      if(studentId&&classId&&window.ClassPointerJoinAuth){try{ticket=(await window.ClassPointerJoinAuth.issue({room,classId,studentId,peerId:current.id})).ticket}catch(error){if(teacherConnection===connection){
        // Network trouble: try again. A real refusal (not in this class, signed out): stop and explain.
        if(autoJoin&&!(error.status>=400&&error.status<500)){scheduleReconnect();return}
        stopReconnecting=true;leaveClass();fail(error.message||'The school could not confirm you for this class.')}return}}
      if(teacherConnection!==connection)return;send(connection,{type:'join',name,studentId,ticket})});
    connection.on('data',message=>{
      if(teacherConnection!==connection||!message)return;
      if(window.ClassPointerBoards?.fromTeacher(message))return;
      if(window.ClassPointerPdf?.handleMessage(message))return;
      if(message.type==='highlights'){highlighter?.receive(message.strokes);return}
      if(message.type==='highlight-error'){fail('Could not add the highlight. Try a shorter stroke or clear some of your highlights.');return}
      if(message.type==='waiting'){clearTimeout(joinTimer);joining=false;$('joinForm').hidden=true;$('leaveClass').hidden=false;status('Connected. Waiting for your teacher to admit you.');pointerPermission()}
      if(message.type==='state'){
        if(!admitted)joinSucceeded();
        clearTimeout(joinTimer);joining=false;admitted=true;$('joinForm').hidden=true;$('leaveClass').hidden=autoJoin;state=message.state;
        if(!live()){highlighter?.cancel();highlighter?.receive([]);clearStudentVideo();window.ClassPointerPdf?.reset()}else if(!state.sharing)clearStudentVideo();status(state.sharing?'Class connected.':state.pdf?'Class connected. Following your teacher in the '+(state.documentKind==='webpage'?'webpage.':state.documentKind==='whiteboard'?'whiteboard.':'PDF.'):'Admitted. Waiting for the teaching screen.');pointerPermission();drawPointers();
      }
      // Only a deliberate removal by the teacher shows the removal message.
      if(message.type==='removed'){stopReconnecting=true;try{sessionStorage.setItem('classPointerRemovedRoom',room)}catch{}leaveClass();$('joinForm').hidden=true;status('Not connected.');fail('Your teacher removed you from the class.');return}
      if(message.type==='replaced'){replacedHere=true;stopReconnecting=true;leaveClass();$('joinForm').hidden=true;status('Class Pointer is open in another tab. Click here to continue in this tab.');return}
      if(message.type==='ended'){if(autoJoin){goWaiting('Your teacher ended the lesson. Waiting for the next one…');return}leaveClass();fail('Your teacher ended the class.');return}
      if(message.type==='full'){if(autoJoin){scheduleReconnect(15000);status('The class is full right now. Trying again soon…');return}leaveClass();fail('This class is full.')}
    });
    connection.on('close',()=>{if(teacherConnection===connection){if(autoJoin){scheduleReconnect();return}leaveClass();fail('The teacher connection closed. Ask your teacher whether to rejoin.')}});
    connection.on('error',()=>{if(teacherConnection===connection){if(autoJoin){scheduleReconnect();return}leaveClass();fail('Could not connect to the teacher. Try another network or a new join link.')}});
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
  if(isTeacher&&$('teacherTool').value==='eraser'){hideOwnPointer();return}
  if(navigating||!live())return;
  if(!allowed()){if(immediate)$('pointerStatus').textContent='Your teacher has not enabled your pointer.';return}
  const pdfOpen=window.ClassPointerPdf?.active();const video=$('lesson'),rect=$('stage').getBoundingClientRect(),box=pdfOpen?{left:0,top:0,w:1,h:1}:pointerPictureBox(rect,video);if(!box)return;
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
// Per-student levels for the Students table: none, point, highlight (point+highlight), pen (all three).
// Levels are remembered by name for students who have not joined yet; "Everyone" sets the default.
const LEVELS=['none','point','highlight','pen'];
let defaultLevel='none';const nameLevels=new Map();
function levelTools(level){return{pointer:level!=='none',highlight:level==='highlight'||level==='pen',pen:level==='pen'}}
function levelOf(member){if(!member.allowed)return 'none';const t=memberTools(member)||{};return t.pen?'pen':t.highlight?'highlight':t.pointer?'point':'none'}
function savedLevel(name){return nameLevels.get(String(name).toLocaleLowerCase())||defaultLevel}
function applyLevel(member,level){
  member.allowed=level!=='none';member.tools=levelTools(level);
  if(!member.allowed){clearStudentHover(member);delete state.points[member.id]}
}
if(isTeacher)window.ClassPointerRoster={
  levels:LEVELS.slice(),
  everyone:()=>defaultLevel,
  list:()=>[...Array.from(members.values()).map(m=>({id:m.id,name:m.name,studentId:m.studentId||null,admitted:!!m.admitted,color:m.color,level:levelOf(m)})),
    ...Array.from(presence.values()).filter((p,i,all)=>!Array.from(members.values()).some(m=>m.studentId&&m.studentId===p.studentId)&&all.findIndex(o=>o.studentId===p.studentId)===i).map(p=>({id:p.id,name:p.name,studentId:p.studentId,admitted:true,presence:true,activity:p.activity,level:savedLevel(p.name)}))],
  levelForName(name){const key=String(name).toLocaleLowerCase();const m=Array.from(members.values()).find(x=>x.admitted&&x.name.toLocaleLowerCase()===key);return m?levelOf(m):savedLevel(name)},
  setLevelForName(name,level){
    if(!LEVELS.includes(level))return;const key=String(name).toLocaleLowerCase();nameLevels.set(key,level);
    for(const m of members.values())if(m.admitted&&m.name.toLocaleLowerCase()===key)applyLevel(m,level);
    state.mode='selected';$('accessMode').value='selected';publish();roster();
  },
  setAll(level){
    if(!LEVELS.includes(level))return;defaultLevel=level;nameLevels.clear();
    for(const m of members.values())if(m.admitted)applyLevel(m,level);
    state.mode='selected';$('accessMode').value='selected';publish();roster();
  },
  admit(id){const m=members.get(id);if(!m||m.admitted)return;Array.from($('roster').querySelectorAll('button')).find(b=>b.textContent==='Admit '+m.name)?.click()},
  remove(id){const m=members.get(id)||presence.get(id);if(!m)return;removeStudentDeliberately(m)},
  removedIds:()=>Array.from(removedStudents),
  allowBack(studentId){if(removedStudents.delete(studentId)){saveRemoved();roster()}}
};
function setAllPointerAccess(enabled){
  if(!isTeacher)return;
  state.mode='selected';
  $('accessMode').value='selected';
  for(const member of members.values()){
    if(!member.admitted)continue;
    member.allowed=enabled;if(enabled)member.tools={...state.tools};
    if(!enabled){
      clearStudentHover(member);
      delete state.points[member.id];
    }
  }
  publish();roster();
}
$('pointerSelectAll')?.addEventListener('click',()=>setAllPointerAccess(true));
$('pointerClearAll')?.addEventListener('click',()=>setAllPointerAccess(false));
for(const [id,tool] of [['allowPointer','pointer'],['allowHighlight','highlight'],['allowPen','pen']]){$(id)?.addEventListener('change',()=>{state.tools[tool]=$(id).checked;for(const member of members.values())if(member.allowed)member.tools={...state.tools};if(!state.tools.pointer){for(const member of members.values()){clearStudentHover(member);delete state.points[member.id]}}publish()})}
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
$('sendEveryoneShare')?.addEventListener('click',requestEveryoneToShare);
 $('startClass').addEventListener('click',startClass);$('endClass').addEventListener('click',endClass);$('shareScreen').addEventListener('click',()=>shareScreen(false));$('openBrowserTab').addEventListener('click',captureBrowserTab);$('stopScreen').addEventListener('click',stopSharing);
if($('tabScroll')){$('tabScroll').addEventListener('click',toggleTabScroll);$('tabZoomIn').addEventListener('click',()=>zoomTab(1));$('tabZoomOut').addEventListener('click',()=>zoomTab(-1))}
$('joinForm').addEventListener('submit',joinClass);$('leaveClass').addEventListener('click',leaveClass);
new ResizeObserver(drawPointers).observe($('stage'));$('lesson').addEventListener('loadedmetadata',drawPointers);$('lesson').addEventListener('resize',drawPointers);
function publishHighlights(){highlighter?.receive(highlightStore.strokes);for(const member of members.values())if(member.admitted)send(member.connection,{type:'highlights',strokes:highlightStore.strokes})}
function submitStroke(stroke){if(isTeacher){if(highlightStore.add('teacher',stroke))publishHighlights();else fail('Highlight limit reached. Undo or clear some highlights.')}else if(writingAllowed(stroke.tool))send(teacherConnection,{type:'highlight',stroke})}
function live(){return state.sharing||state.pdf===true}
if(window.createClassHighlighter)highlighter=window.createClassHighlighter({
  teacher:isTeacher,allowed:()=>!navigating&&writingAllowed($(isTeacher?'teacherTool':'studentTool').value),sharing:()=>state.sharing&&!state.pdf,owner:()=>isTeacher?'teacher':'student:'+peer?.id,
  ownerName:owner=>owner==='teacher'?'Teacher':state.members.find(m=>m.id===owner)?.name||'Student',
  color:()=>isTeacher?'#ffcc00':state.members.find(m=>m.id==='student:'+peer?.id)?.color||'#ffcc00',
  submit:submitStroke,
  edit(action,id){if(isTeacher){if(action==='all')highlightStore.reset();else highlightStore.edit('teacher',action,id);publishHighlights()}else send(teacherConnection,{type:'edit-highlights',action})}
});
if(highlighter){const baseReceive=highlighter.receive;highlighter.receive=next=>{baseReceive(next);window.ClassPointerPdf?.setStrokes(next)}}
// Small, fixed doorway used by PDF mode (pdf-mode.js). Nothing else reaches into this file.
window.ClassPointerBridge={isTeacher,send,fail,
  sendTeacher:message=>send(teacherConnection,message),started:()=>started,
  // Student → teacher screen (Student boards, Screens mode). One-way: the teacher answers without sending video back.
  callTeacher:stream=>!isTeacher&&peer&&teacherConnection?.open?peer.call(room,stream,{metadata:{kind:'student-screen'}}):null,clearError,status,live,allowed,writingAllowed,submitStroke,redraw:drawPointers,members:()=>members,presence:()=>presence,sharing:()=>state.sharing,stopSharing,
  navigating:()=>navigating,
  highlights:()=>highlightStore.strokes,
  owner:()=>isTeacher?'teacher':'student:'+peer?.id,ownColor:()=>isTeacher?'#ffcc00':state.members.find(m=>m.id==='student:'+peer?.id)?.color||'#ffcc00',
  setPdf(on,kind='pdf'){state.pdf=on;state.documentKind=on?kind:null;state.points={};if(!on){highlightStore.reset();publishHighlights()}highlighter?.render();publish()},
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
$('teacherPanel').hidden=!isTeacher;$('studentPanel').hidden=isTeacher;if(!isTeacher)status(autoJoin?'Connecting to your class…':'Join your teacher’s class.');
if(autoJoin){$('joinForm').hidden=true;$('leaveClass').hidden=true}
window.addEventListener('pagehide',()=>{if(isTeacher)endClass();else leaveClass()});
// Open teacher classroom is the only start action needed. Wait for class-scoped
// authorization in startClass, then establish and publish the session automatically.
// Browser screen capture itself must still be initiated by an explicit user click.
if(isTeacher)void startClass();
if(!isTeacher&&new URL(location.href).searchParams.get('dashboard')==='student'){
  let saved=null;try{saved=window.ClassPointerDashboardCore.handoff(JSON.parse(sessionStorage.getItem('classPointerDashboardJoin')),room)}catch{}
  let removedHere=false;try{removedHere=sessionStorage.getItem('classPointerRemovedRoom')===room}catch{}
  if(removedHere){status('Not connected.');fail('Your teacher removed you from the class.')}
  else if(saved){$('studentName').value=C.cleanName(saved.name);$('studentName').readOnly=true;const welcome=document.createElement('p');welcome.textContent='Signed in as '+$('studentName').value+'.';$('studentPanel').prepend(welcome);joinClass({preventDefault(){}})}
  // No class hand-off in this tab: the class page checks the sign-in and brings him straight back.
  else location.replace('dashboard.html');
}
