'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

function element(tag){
  return {
    tag,style:{cssText:''},dataset:{},children:[],listeners:{},hidden:false,disabled:false,textContent:'',
    setAttribute(){},append(...nodes){this.children.push(...nodes)},appendChild(node){this.children.push(node);return node},addEventListener(type,fn){this.listeners[type]=fn},
    remove(){this.removed=true},focus(){},play(){this.played=true;return Promise.resolve()}
  };
}
function waitFor(predicate,message){
  return new Promise((resolve,reject)=>{
    const start=Date.now(),timer=setInterval(()=>{
      if(predicate()){clearInterval(timer);resolve()}
      else if(Date.now()-start>2000){clearInterval(timer);reject(Error(message))}
    },5);
  });
}

test('Shorashim screen capture reaches the authenticated teacher receiver and renders live video',async()=>{
  const room='class-pointer-12345678-1234-1234-1234-123456789abc';
  const now=Date.now();
  let sessionListener, issued, verified, answered=false;
  const videoTrack={stop(){},addEventListener(){}};
  const captured={active:true,getTracks:()=>[videoTrack],getVideoTracks:()=>[videoTrack]};

  class Call{
    constructor(metadata,media){this.metadata=metadata;this.media=media;this.listeners={}}
    on(type,fn){(this.listeners[type]??=[]).push(fn)}
    emit(type,value){for(const fn of this.listeners[type]||[])fn(value)}
    answer(){answered=true;setTimeout(()=>this.emit('stream',this.media),0)}
    close(){}
  }
  class Peer{
    constructor(id){this.id=id;this.listeners={};setTimeout(()=>this.emit('open',id),0)}
    once(type,fn){this.listeners[type]=fn}
    emit(type,value){this.listeners[type]?.(value)}
    call(target,media,options){
      assert.equal(target,room,'student must call the active teacher PeerJS room');
      const call=new Call(options.metadata,media);
      setTimeout(()=>{void teacherWindow.ClassPointerActivityShares.incomingCall(call)},0);
      return call;
    }
    destroy(){}
  }

  // Model the live class session as the Firebase listener exposes it to the student.
  const database={ref:path=>({on(_event,callback){assert.match(path,/\/classes\/et\/classPointerSessions$/);sessionListener=callback}})};
  const studentFirebase={apps:[{}],database:()=>database};
  const studentWindow={firebase:studentFirebase,Peer,B3_FIREBASE_CONFIG:{},FunTorahStudentClass:{resolve:async()=>({workspaceId:'b3-2026',classId:'et'})},addEventListener(){}};
  const studentDocument={currentScript:{src:'https://funtorahtools.com/class-pointer-prototype/activity-share.js'},head:{appendChild(){}},body:{children:[],appendChild(node){this.children.push(node)}},createElement:element};
  const studentSession=new Map([['b3Games_studentId','arik'],['b3Games_classPin','123456']]);
  const studentFetch=async(url,options)=>{
    if(String(url).includes('funTorahStudentAuth'))return {ok:true,json:async()=>({ok:true})};
    issued=JSON.parse(options.body);
    return {ok:true,json:async()=>({ok:true,token:'a'.repeat(64),studentName:'Arik'})};
  };
  const studentContext={window:studentWindow,document:studentDocument,location:{href:'https://funtorahtools.com/shorashim/index.html',pathname:'/shorashim/index.html'},URL,sessionStorage:{getItem:key=>studentSession.get(key)||null,setItem:(key,value)=>studentSession.set(key,value)},firebase:studentFirebase,fetch:studentFetch,navigator:{mediaDevices:{getDisplayMedia:()=>Promise.resolve(captured)}},AbortSignal,Date,setTimeout,clearTimeout,setInterval,clearInterval,crypto:require('node:crypto').webcrypto,Peer,console};
  vm.runInNewContext(read('class-pointer-prototype/activity-share.js'),studentContext);
  await waitFor(()=>sessionListener,'student Firebase session subscription did not start');

  // Install the real teacher receiver with mocked Firebase Auth and an authorized verify response.
  const stage=element('main'),joinLink=element('input'),endClass=element('button');
  joinLink.value='https://funtorahtools.com/class-pointer-prototype/classroom.html?room='+room;
  const teacherNodes={stage,joinLink,endClass};
  const teacherDocument={createElement:element,getElementById:id=>teacherNodes[id]||null};
  const teacherWindow={};
  const teacherFirebase={auth:()=>({currentUser:{getIdToken:async()=> 'teacher-id-token'}})};
  const teacherFetch=async(_url,options)=>{
    verified={...JSON.parse(options.body),authorization:options.headers.Authorization};
    return {ok:true,status:200,json:async()=>({ok:true,studentId:'arik',studentName:'Arik'})};
  };
  vm.runInNewContext(read('class-pointer-prototype/activity-screen-teacher.js'),{
    window:teacherWindow,document:teacherDocument,location:{search:'?dashboard=teacher&class=et'},URLSearchParams,URL,MutationObserver:class{observe(){}},firebase:teacherFirebase,fetch:teacherFetch,console
  });

  sessionListener({val:()=>({[room]:{roomId:room,createdAt:now,teacherUid:'teacher-et',studentScreenSharing:true,shareRequest:{at:now}}})});
  const holder=studentDocument.body.children.find(node=>node.id==='fttActivityScreenShare');
  const overlay=studentDocument.body.children.find(node=>node.id==='fttShareRequestOverlay');
  assert.equal(overlay.style.display,'flex','the student receives the request while remaining on Shorashim');
  await holder.children[0].listeners.click();
  await waitFor(()=>answered,'teacher did not answer the authenticated PeerJS media call; student status: '+holder.children[1].textContent+'; authorization: '+JSON.stringify(verified));
  await waitFor(()=>{
    const tray=stage.children.find(node=>node.id==='activityScreenTray');
    const card=tray?.children[0];
    return card?.children.some(node=>node.tag==='video'&&node.srcObject===captured);
  },'teacher video receiver did not attach the student MediaStream');

  assert.deepEqual({...issued},{action:'issue',studentId:'arik',pin:'123456',classId:'et',room});
  assert.equal(verified.action,'verify');
  assert.equal(verified.classId,'et');
  assert.equal(verified.room,room);
  assert.equal(verified.token,'a'.repeat(64));
  assert.equal(verified.authorization,'Bearer teacher-id-token');
  const tray=stage.children.find(node=>node.id==='activityScreenTray');
  const rendered=tray.children[0].children.find(node=>node.tag==='video');
  assert.equal(tray.hidden,false,'the teacher screen tray is visible');
  assert.equal(rendered.srcObject,captured,'the teacher displays the live student capture stream');
  assert.equal(rendered.played,true);
});

test('Shorashim and supported activity entry pages load the direct share client',()=>{
  for(const file of ['shorashim/index.html','index.html','chavrusa/index.html','weekly-quiz/index.html','chazara/index.html']){
    assert.match(read(file),/class-pointer-prototype\/activity-share\.js/,file+' must load the activity screen-sharing client');
  }
});
