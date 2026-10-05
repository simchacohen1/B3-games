'use strict';
const C=window.ClassPointerCore,$=id=>document.getElementById(id);
const room=new URL(location.href).searchParams.get('room'),isTeacher=!room;
const members=new Map();
let peer=null,teacherConnection=null,screen=null,mediaCall=null,state={sharing:false,mode:'nobody',members:[],points:{}},started=false,admitted=false,joining=false,joinTimer=null;
let generation=0,colorIndex=0;
function status(text){$('connectionStatus').textContent=text}
function fail(text){$('error').textContent=text;$('error').hidden=false}
function clearError(){$('error').hidden=true}
function send(connection,message){if(connection?.open){try{connection.send(message)}catch{fail('The connection was interrupted. Please rejoin the class.')}}}
function allowed(){return isTeacher||C.canPoint(state.mode,state.members.find(member=>member.id==='student:'+peer?.id))}
function pointerPermission(){
  $('stage').style.cursor=allowed()?'crosshair':'not-allowed';
  if(!isTeacher)$('permissionText').textContent=!admitted?'Waiting for your teacher to admit you.':allowed()?'You may point. Click the shared picture.':'Watch the lesson. Your teacher has not enabled your pointer.';
}
function drawPointers(){
  const video=$('lesson'),rect=$('stage').getBoundingClientRect(),box=C.pictureBox(rect.width,rect.height,video.videoWidth,video.videoHeight);
  $('pointerLayer').replaceChildren();if(!state.sharing||!box)return;
  Object.entries(state.points).forEach(([id,point])=>{
    if(!C.validPoint(point))return;
    const member=id==='teacher'?{name:'Teacher',color:'#ffcc00'}:state.members.find(person=>person.id===id);
    if(!member)return;
    const pointer=document.createElement('div');pointer.className='pointer'+(id==='teacher'&&point.tool==='arrow'?' arrow':'');pointer.dataset.person=id;
    pointer.style.setProperty('--color',member.color);pointer.style.left=(box.left+point.x*box.w)+'px';pointer.style.top=(box.top+point.y*box.h)+'px';
    const name=document.createElement('span');name.className='name';name.textContent=member.name;pointer.appendChild(name);$('pointerLayer').appendChild(pointer);
  });
}
function publish(){
  state.members=Array.from(members.values()).filter(member=>member.admitted).map(({id,name,color,allowed})=>({id,name,color,admitted:true,allowed}));
  for(const member of members.values())if(member.admitted)send(member.connection,{type:'state',state});
  drawPointers();pointerPermission();
}
function roster(){
  const list=$('roster');list.replaceChildren();
  if(!members.size){list.textContent=started?'No students yet. Send the join link to one student.':'Start a class to receive join requests.';return}
  for(const member of members.values()){
    const row=document.createElement('div');row.className='roster-row';const name=document.createElement('span');name.textContent=member.name+(member.admitted?' — admitted':' — waiting');row.appendChild(name);
    if(!member.admitted){const admit=document.createElement('button');admit.textContent='Admit '+member.name;admit.addEventListener('click',()=>{member.admitted=true;publish();roster();if(screen)callStudent(member)});row.appendChild(admit)}
    else{
      const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=member.allowed;input.disabled=state.mode!=='selected';
      input.addEventListener('change',()=>{member.allowed=input.checked;if(!C.canPoint(state.mode,member))delete state.points[member.id];publish()});label.append(input,document.createTextNode('Allow '+member.name+' to point'));row.appendChild(label);
    }
    const remove=document.createElement('button');remove.textContent=member.admitted?'Remove '+member.name:'Decline '+member.name;
    remove.addEventListener('click',()=>{send(member.connection,{type:'removed'});member.connection.close();removeMember(member)});row.appendChild(remove);list.appendChild(row);
  }
}
function removeMember(member){
  if(members.get(member.id)!==member)return;
  member.call?.close();clearTimeout(member.mediaTimer);members.delete(member.id);delete state.points[member.id];publish();roster();
}
function callStudent(member){
  member.call?.close();clearTimeout(member.mediaTimer);if(!screen||!member.admitted)return;
  const call=peer.call(member.peerId,screen,{metadata:{generation}});member.call=call;
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
      clearTimeout(handshake);member={id:'student:'+connection.peer,peerId:connection.peer,name,color:C.colors[colorIndex++%C.colors.length],allowed:false,admitted:false,connection,lastPoint:0};members.set(member.id,member);send(connection,{type:'waiting'});roster();return;
    }
    if(!member||members.get(member.id)!==member)return;
    if(message.type==='video-ready'&&member.admitted){member.videoReady=true;clearTimeout(member.mediaTimer)}
    if(message.type==='point'&&state.sharing&&C.canPoint(state.mode,member)&&C.validPoint(message.point)){
      const now=Date.now();if(now-member.lastPoint<75)return;member.lastPoint=now;
      // Identity comes from this connection, never from a student-supplied name or ID.
      state.points[member.id]={x:message.point.x,y:message.point.y};publish();
    }
  });
  connection.on('close',()=>{clearTimeout(handshake);if(member)removeMember(member)});
  connection.on('error',()=>{if(member)removeMember(member)});
}
function peerError(error){
  const message=error.type==='peer-unavailable'?'This class is no longer open. Ask your teacher for a new join link.':'The classroom connection failed. Try again; the school network may be blocking it.';
  fail(message);if(!started&&!admitted){if(isTeacher){endClass();fail(message)}else{leaveClass();fail(message)}}
}
function makePeer(id){
  if(typeof Peer==='undefined'){fail('The classroom connection library could not load. Refresh or ask the school to allow this page.');return null}
  const instance=id?new Peer(id):new Peer();instance.on('error',peerError);
  instance.on('disconnected',()=>{status('Connection service interrupted. Existing lesson connections may still work.');if(!instance.destroyed)instance.reconnect()});return instance;
}
function startClass(){
  clearError();$('startClass').disabled=true;status('Opening class…');
  peer=makePeer('class-pointer-'+crypto.randomUUID());if(!peer){$('startClass').disabled=false;return}
  const current=peer;
  joinTimer=setTimeout(()=>{if(peer===current&&!started){endClass();fail('The class could not connect. Try again or use another network.')}},20000);
  peer.on('open',id=>{
    if(peer!==current)return;clearTimeout(joinTimer);started=true;$('endClass').disabled=false;$('shareScreen').disabled=false;
    const link=new URL(location.href);link.search='';link.hash='';link.searchParams.set('room',id);$('joinLink').value=link.href;$('invitePanel').hidden=false;status('Class open. Send the join link and admit your students.');roster();
  });
  peer.on('connection',receiveStudent);peer.on('call',call=>call.close());
}
function stopSharing(){
  generation++;const oldScreen=screen;screen=null;oldScreen?.getTracks().forEach(track=>track.stop());
  for(const member of members.values()){member.call?.close();member.call=null;member.videoReady=false;clearTimeout(member.mediaTimer)}
  state.sharing=false;state.points={};$('lesson').srcObject=null;$('placeholder').hidden=false;$('stopScreen').disabled=true;$('shareScreen').disabled=!started;publish();
}
async function shareScreen(){
  clearError();if(!navigator.mediaDevices?.getDisplayMedia){fail('Use Chrome or Edge on a computer to share your teaching screen.');return}
  $('shareScreen').disabled=true;const currentPeer=peer;
  try{
    const captured=await navigator.mediaDevices.getDisplayMedia({video:{width:{ideal:1280},frameRate:{ideal:12,max:15}},audio:false});
    if(peer!==currentPeer||!started){captured.getTracks().forEach(track=>track.stop());return}
    screen=captured;generation++;state.sharing=true;state.points={};$('lesson').srcObject=screen;$('placeholder').hidden=true;$('stopScreen').disabled=false;
    screen.getVideoTracks()[0].addEventListener('ended',()=>{if(screen===captured)stopSharing()},{once:true});
    await $('lesson').play();if(screen!==captured)return;publish();for(const member of members.values())if(member.admitted)callStudent(member);status('Teaching screen is sharing. Click the picture to point as Teacher.');
  }catch(error){if(peer!==currentPeer||(error.name==='AbortError'&&!screen))return;stopSharing();fail(error.name==='NotAllowedError'?'Screen sharing was canceled. Click Share teaching screen to try again.':'Could not share the screen. Please try again.')}
}
function endClass(){
  clearTimeout(joinTimer);started=false;stopSharing();for(const member of members.values()){send(member.connection,{type:'ended'});member.connection.close()}
  members.clear();const oldPeer=peer;peer=null;oldPeer?.destroy();state={sharing:false,mode:'nobody',members:[],points:{}};$('accessMode').value='nobody';$('startClass').disabled=false;$('endClass').disabled=true;$('invitePanel').hidden=true;roster();status('Class ended. Start a new class for a new join link.');
}
function clearStudentVideo(){const oldCall=mediaCall;mediaCall=null;oldCall?.close();$('lesson').srcObject=null;$('placeholder').hidden=false;drawPointers()}
function leaveClass(){
  clearTimeout(joinTimer);joining=false;admitted=false;clearStudentVideo();const oldConnection=teacherConnection;teacherConnection=null;oldConnection?.close();const oldPeer=peer;peer=null;oldPeer?.destroy();
  state={sharing:false,mode:'nobody',members:[],points:{}};$('joinForm').hidden=false;$('joinClass').disabled=false;$('leaveClass').hidden=true;$('pointerLayer').replaceChildren();$('permissionText').textContent='Enter your name to request admission.';status('Not connected.');
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
      if(message.type==='waiting'){clearTimeout(joinTimer);joining=false;$('joinForm').hidden=true;$('leaveClass').hidden=false;status('Connected. Waiting for your teacher to admit you.');pointerPermission()}
      if(message.type==='state'){
        clearTimeout(joinTimer);joining=false;admitted=true;$('joinForm').hidden=true;$('leaveClass').hidden=false;state=message.state;
        if(!state.sharing)clearStudentVideo();status(state.sharing?'Class connected.':'Admitted. Waiting for the teaching screen.');pointerPermission();drawPointers();
      }
      if(['ended','removed','full'].includes(message.type)){leaveClass();fail(message.type==='ended'?'Your teacher ended the class.':message.type==='full'?'This first test supports up to 12 students.':'Your teacher declined or ended your admission.')}
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
$('stage').addEventListener('click',event=>{
  if(!state.sharing)return;
  if($('lesson').paused)$('lesson').play().catch(()=>fail('Video playback could not resume. Leave and rejoin the class.'));
  if(!allowed()){$('pointerStatus').textContent='Your teacher has not enabled your pointer.';return}
  const video=$('lesson'),rect=$('stage').getBoundingClientRect(),box=C.pictureBox(rect.width,rect.height,video.videoWidth,video.videoHeight);if(!box)return;
  const point={x:(event.clientX-rect.left-box.left)/box.w,y:(event.clientY-rect.top-box.top)/box.h};
  if(!C.validPoint(point)){$('pointerStatus').textContent='Click inside the picture, away from the black margins.';return}
  if(isTeacher){state.points.teacher={...point,tool:$('teacherTool').value};publish()}else send(teacherConnection,{type:'point',point});
  $('pointerStatus').textContent=isTeacher?'Teacher pointer placed.':'Pointer sent to your teacher.';
});
$('accessMode').addEventListener('change',()=>{
  state.mode=$('accessMode').value;for(const member of members.values())if(!C.canPoint(state.mode,member))delete state.points[member.id];publish();roster();
});
$('teacherTool').addEventListener('change',()=>{if(state.points.teacher){state.points.teacher.tool=$('teacherTool').value;publish()}});
$('clearTeacher').addEventListener('click',()=>{delete state.points.teacher;publish()});
$('clearAll').addEventListener('click',()=>{state.points={};publish()});
$('copyLink').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('joinLink').value);status('Join link copied. Send it to your students.')}catch{$('joinLink').select();status('Select and copy the student join link.')}});
$('startClass').addEventListener('click',startClass);$('endClass').addEventListener('click',endClass);$('shareScreen').addEventListener('click',shareScreen);$('stopScreen').addEventListener('click',stopSharing);
$('joinForm').addEventListener('submit',joinClass);$('leaveClass').addEventListener('click',leaveClass);
new ResizeObserver(drawPointers).observe($('stage'));$('lesson').addEventListener('loadedmetadata',drawPointers);$('lesson').addEventListener('resize',drawPointers);
$('teacherPanel').hidden=!isTeacher;$('studentPanel').hidden=isTeacher;if(!isTeacher)status('Join your teacher’s class.');
window.addEventListener('pagehide',()=>{if(isTeacher)endClass();else leaveClass()});
