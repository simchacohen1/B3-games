const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../class-pointer-prototype/classroom-core.js');
const vm=require('node:vm'),fs=require('node:fs'),{EventEmitter}=require('node:events');
function teacherFixture(){
  const elements=new Map();
  function element(){return {value:'nobody',hidden:false,style:{setProperty(){}},classList:{},events:{},append(){},appendChild(){},replaceChildren(){},addEventListener(type,fn){this.events[type]=fn},getBoundingClientRect(){return{width:800,height:450}}}}
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
  assert.equal(f.run("state.points['student:student-a'].tool"),undefined);
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
