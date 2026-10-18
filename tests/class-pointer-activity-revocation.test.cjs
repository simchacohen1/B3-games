'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const room='class-pointer-12345678-1234-1234-1234-123456789abc';

function element(tag){
  return {
    tag,style:{cssText:''},dataset:{},children:[],hidden:false,disabled:false,removed:false,textContent:'',
    append(...nodes){this.children.push(...nodes);for(const node of nodes)node.parent=this},
    appendChild(node){this.append(node)},
    remove(){this.removed=true;if(this.parent)this.parent.children=this.parent.children.filter(item=>item!==this)}
  };
}
function receiverFixture(){
  const stage=element('stage'),endClass=element('button'),joinLink=element('input');
  endClass.disabled=false;joinLink.value='https://example.test/class-pointer-prototype/classroom.html?room='+room;
  const elements={stage,endClass,joinLink};
  const document={getElementById:id=>elements[id]||null,createElement:element};
  const window={};
  const context=vm.createContext({
    window,document,location:{search:'?dashboard=teacher&class=pointer-test'},
    URLSearchParams,URL,MutationObserver:class{observe(){}},
    firebase:{auth:()=>({currentUser:{getIdToken:async()=> 'teacher-token'}})},
    fetch:async(_url,options)=>{const token=JSON.parse(options.body).token,studentId=token[0]==='a'?'student-a':'student-b';return{ok:true,status:200,json:async()=>({ok:true,studentId,studentName:studentId==='student-a'?'Student A':'Student B'})}},
    console:{warn(){}}
  });
  vm.runInContext(read('class-pointer-prototype/activity-screen-teacher.js'),context);
  return{window,stage,endClass};
}
function callFor(student='student-a'){
  const listeners=new Map();
  return{
    metadata:{kind:'activity-screen',token:(student==='student-a'?'a':'b').repeat(64)},
    closed:0,answered:0,
    on(event,handler){listeners.set(event,handler)},
    answer(){this.answered++},
    close(){this.closed++;listeners.get('close')?.()},
    emit(event,value){listeners.get(event)?.(value)}
  };
}

test('teacher denial immediately closes only that student activity screen',async()=>{
  const f=receiverFixture(),first=callFor(),other=callFor('student-b');
  assert.equal(await f.window.ClassPointerActivityShares.incomingCall(first),true);
  await f.window.ClassPointerActivityShares.incomingCall(other);
  const tray=f.stage.children.find(node=>node.id==='activityScreenTray');
  assert.equal(tray.hidden,false);
  assert.equal(tray.children.length,2);
  f.window.ClassPointerActivityShares.revokeStudents(['student-a']);
  assert.equal(first.closed,1);
  assert.equal(other.closed,0);
  assert.equal(tray.children.length,1);
  assert.equal(tray.hidden,false);
});

test('turning off screen sharing closes every live activity screen',async()=>{
  const f=receiverFixture(),call=callFor();
  await f.window.ClassPointerActivityShares.incomingCall(call);
  f.window.ClassPointerActivityShares.closeAll();
  const tray=f.stage.children.find(node=>node.id==='activityScreenTray');
  assert.equal(call.closed,1);
  assert.equal(tray.children.length,0);
  assert.equal(tray.hidden,true);
});

test('teacher permission updates trigger immediate screen revocation after private policy is saved',()=>{
  const session=read('class-pointer-prototype/dashboard-session.js');
  assert.match(session,/await context\.db\.ref\(permissionPath\(ref\.key\)\)\.set\(rows\);\s*const denied=Object\.entries\(rows\)/);
  assert.match(session,/ClassPointerActivityShares\?\.revokeStudents\(denied\)/);
  assert.match(session,/if\(enabled!==true\)window\.ClassPointerActivityShares\?\.closeAll\(\)/);
});
