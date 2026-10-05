const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../class-pointer-prototype/classroom-core.js');
const vm=require('node:vm'),fs=require('node:fs'),{EventEmitter}=require('node:events');
function teacherFixture(){
  const elements=new Map();
  function element(){return {value:'nobody',hidden:false,dataset:{},style:{setProperty(){}},classList:{},events:{},append(){},appendChild(){},replaceChildren(){},remove(){},addEventListener(type,fn){this.events[type]=fn},getBoundingClientRect(){return{left:0,top:0,width:800,height:450}}}}
  const document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)},createElement:element,createTextNode:text=>({textContent:text})};
  const context=vm.createContext({document,window:{ClassPointerCore:C,addEventListener(){}},location:{href:'https://example.test/classroom.html'},URL,ResizeObserver:class{observe(){}},setTimeout:()=>1,clearTimeout(){},Date,console});
  vm.runInContext(fs.readFileSync(require.resolve('../class-pointer-prototype/classroom.js'),'utf8'),context);
  const connection=new EventEmitter();connection.peer='student-a';connection.open=true;connection.sent=[];connection.send=message=>connection.sent.push(structuredClone(message));connection.close=()=>connection.emit('close');context.connection=connection;
  vm.runInContext('started=true;receiveStudent(connection)',context);connection.emit('data',{type:'join',name:'Mayer'});
  return{context,connection,elements,run:code=>vm.runInContext(code,context)};
}
test('admission is required in every pointer permission mode',()=>{
  for(const mode of ['nobody','selected','everyone'])assert.equal(C.canPoint(mode,{admitted:false,allowed:true}),false);
  assert.equal(C.canPoint('nobody',{admitted:true,allowed:true}),false);
  assert.equal(C.canPoint('selected',{admitted:true,allowed:false}),false);
  assert.equal(C.canPoint('selected',{admitted:true,allowed:true}),true);
  assert.equal(C.canPoint('everyone',{admitted:true,allowed:false}),true);
});
test('network coordinates reject malformed, nonfinite, and off-picture points',()=>{
  for(const point of [null,{}, {x:'0.5',y:0.5},{x:NaN,y:0.5},{x:Infinity,y:0},{x:-0.01,y:0},{x:0,y:1.01}])assert.equal(C.validPoint(point),false);
  assert.equal(C.validPoint({x:0,y:1}),true);assert.equal(C.validPoint({x:0.5,y:0.5}),true);
});
test('normalized coordinates align across wide and portrait video and preview resize',()=>{
  assert.deepEqual(C.pictureBox(1600,900,1200,900),{w:1200,h:900,left:200,top:0});
  assert.deepEqual(C.pictureBox(800,450,1200,900),{w:600,h:450,left:100,top:0});
  assert.deepEqual(C.pictureBox(800,450,800,1600),{w:225,h:450,left:287.5,top:0});
  assert.deepEqual(C.pictureBox(800,450,1600,400),{w:800,h:200,left:0,top:125});
  assert.equal(C.pictureBox(800,450,0,0),null);
});
test('student names have a bounded display length and exclude control characters',()=>{
  assert.equal(C.cleanName('  Mayer\n\u0000 '),'Mayer');assert.equal(C.cleanName({name:'Mayer'}),'');
  assert.equal(C.cleanName('M'.repeat(100)).length,32);
});
test('teacher rejects network pointer messages until admission and permission',()=>{
  const f=teacherFixture();f.run("state.sharing=true;state.mode='everyone'");f.connection.emit('data',{type:'point',point:{x:0.5,y:0.5}});
  assert.equal(f.run('Object.keys(state.points).length'),0);
  f.run("members.get('student:student-a').admitted=true;state.mode='selected'");f.connection.emit('data',{type:'point',point:{x:0.5,y:0.5}});
  assert.equal(f.run('Object.keys(state.points).length'),0);
  f.run("members.get('student:student-a').allowed=true");f.connection.emit('data',{type:'point',id:'teacher',name:'Teacher',point:{x:0.25,y:0.75,tool:'arrow'}});
  assert.equal(f.run('state.points.teacher'),undefined);assert.equal(f.run("state.points['student:student-a'].x"),0.25);
  assert.equal(f.run("state.points['student:student-a'].tool"),'arrow');
});
test('revoking access removes student pointers while preserving teacher position',()=>{
  const f=teacherFixture();f.run("members.get('student:student-a').admitted=true;members.get('student:student-a').allowed=true;state.mode='selected';state.points={'student:student-a':{x:0.2,y:0.2},teacher:{x:0.7,y:0.7}}");
  f.elements.get('accessMode').value='nobody';f.elements.get('accessMode').events.change();
  assert.equal(f.run("state.points['student:student-a']"),undefined);assert.equal(f.run('state.points.teacher.x'),0.7);
  f.connection.emit('data',{type:'point',point:{x:0.5,y:0.5}});assert.equal(f.run("state.points['student:student-a']"),undefined);
});
test('disconnected students are removed from the roster and pointer state',()=>{
  const f=teacherFixture();f.run("state.points['student:student-a']={x:0.5,y:0.5}");f.connection.close();
  assert.equal(f.run('members.size'),0);assert.equal(f.run("state.points['student:student-a']"),undefined);
});
test('pointer styles accept only supported shapes and palette colors',()=>{
  assert.deepEqual(C.pointStyle({tool:'star',color:'#dca0ff'}),{tool:'star',color:'#dca0ff'});
  assert.equal(C.pointStyle({tool:'yad'}).tool,'target');
  assert.deepEqual(C.pointStyle({tool:'spotlight',color:'url(https://example.test)'}),{tool:'target',color:null});
});
test('leaving the picture cancels queued hover and removes only that student',()=>{
  const f=teacherFixture();f.run("members.get('student:student-a').admitted=true;state.points={'student:student-a':{x:0.1,y:0.2},teacher:{x:0.5,y:0.5}};pendingPoint={x:0.9,y:0.9};hoverTimer=1");
  f.connection.emit('data',{type:'pointer-hide'});
  assert.equal(f.run("state.points['student:student-a']"),undefined);assert.equal(f.run('state.points.teacher.x'),0.5);
  f.elements.get('stage').events.pointerleave();assert.equal(f.run('state.points.teacher'),undefined);assert.equal(f.run('pendingPoint'),null);
});
test('hover movement places a teacher pointer without clicking, and leaving letterbox hides it',()=>{
  const f=teacherFixture();f.run("state.sharing=true");f.elements.get('lesson').videoWidth=1200;f.elements.get('lesson').videoHeight=900;
  f.elements.get('teacherTool').value='star';f.elements.get('teacherColor').value='#75df9a';
  f.elements.get('stage').events.pointermove({clientX:400,clientY:225});
  assert.equal(f.run('state.points.teacher.x'),0.5);assert.equal(f.run('state.points.teacher.y'),0.5);
  assert.equal(f.run('state.points.teacher.tool'),'star');
  f.elements.get('stage').events.pointermove({clientX:10,clientY:225});assert.equal(f.run('state.points.teacher'),undefined);
});
test('a queued hover cannot restore a cleared pointer or survive stopped sharing',()=>{
  const f=teacherFixture();f.run("state.sharing=true;pendingPoint={x:0.2,y:0.2};hoverTimer=1");
  f.elements.get('clearTeacher').events.click();f.run('sendHover()');assert.equal(f.run('state.points.teacher'),undefined);
  f.run("pendingPoint={x:0.2,y:0.2};hoverTimer=1;stopSharing();sendHover()");assert.equal(f.run('state.points.teacher'),undefined);
});
test('network hover keeps the final position and never restores it after hiding',()=>{
  const f=teacherFixture();f.run("members.get('student:student-a').admitted=true;state.sharing=true;state.mode='everyone'");
  f.connection.emit('data',{type:'point',point:{x:0.1,y:0.2}});
  f.connection.emit('data',{type:'point',point:{x:0.7,y:0.2}});f.connection.emit('data',{type:'point',point:{x:0.9,y:0.2}});
  assert.equal(f.run("members.get('student:student-a').pendingPoint.x"),0.9);
  f.run("commitStudentHover(members.get('student:student-a'))");assert.equal(f.run("state.points['student:student-a'].x"),0.9);
  f.connection.emit('data',{type:'point',point:{x:0.6,y:0.6}});f.connection.emit('data',{type:'pointer-hide'});
  f.run("commitStudentHover(members.get('student:student-a'))");assert.equal(f.run("state.points['student:student-a']"),undefined);
});
const sampleStroke={tool:'highlight',color:'#75df9a',size:0.016,points:[{x:0.1,y:0.2},{x:0.6,y:0.2}]};
test('highlight validation bounds data and rejects nonfinite or off-picture strokes',()=>{
  assert.ok(C.cleanStroke(sampleStroke));
  for(const stroke of [{...sampleStroke,tool:'yad'},{...sampleStroke,points:[]},{...sampleStroke,points:[{x:NaN,y:0},{x:0,y:0}]},{...sampleStroke,points:Array(257).fill({x:0,y:0})}])assert.equal(C.cleanStroke(stroke),null);
});
test('highlights have separate owners and undo or clear never deletes another layer',()=>{
  const store=new C.HighlightStore();store.add('student:a',sampleStroke);store.add('student:b',sampleStroke);store.add('student:a',sampleStroke);
  store.edit('student:a','undo');assert.equal(store.strokes.length,2);
  store.edit('student:b','clear');assert.equal(store.strokes.length,1);assert.equal(store.strokes[0].owner,'student:a');
});
test('highlight messages enforce admission and permission and ignore forged ownership',()=>{
  const f=teacherFixture();f.run("state.sharing=true;state.mode='everyone'");f.connection.emit('data',{type:'highlight',stroke:sampleStroke});assert.equal(f.run('highlightStore.strokes.length'),0);
  f.run("members.get('student:student-a').admitted=true;state.mode='nobody'");f.connection.emit('data',{type:'highlight',stroke:sampleStroke});assert.equal(f.run('highlightStore.strokes.length'),0);
  f.run("state.mode='everyone'");f.connection.emit('data',{type:'highlight',stroke:{...sampleStroke,owner:'teacher'}});assert.equal(f.run('highlightStore.strokes[0].owner'),'student:student-a');
  f.run("highlightStore.add('teacher',{tool:'box',points:[{x:0,y:0},{x:0.5,y:0.5}]})");
  f.connection.emit('data',{type:'edit-highlights',action:'all',owner:'teacher'});assert.equal(f.run('highlightStore.strokes.length'),2);
  f.connection.emit('data',{type:'edit-highlights',action:'clear',owner:'teacher'});assert.equal(f.run('highlightStore.strokes.length'),1);assert.equal(f.run('highlightStore.strokes[0].owner'),'teacher');
});
