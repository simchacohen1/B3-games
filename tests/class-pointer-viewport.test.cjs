const {test}=require('node:test');
const assert=require('node:assert/strict');
const V=require('../class-pointer-prototype/viewport-core.js');

test('viewport output keeps source aspect ratio while bounding resolution',()=>{
  assert.deepEqual(V.outputSize(1920,1080),{width:1920,height:1080});
  assert.deepEqual(V.outputSize(2560,1600),{width:2304,height:1440});
  assert.deepEqual(V.outputSize(800,600),{width:800,height:600});
});

test('zoom stays inside the selected shared area',()=>{
  const base={x:0.2,y:0.1,w:0.6,h:0.6};
  assert.deepEqual(V.zoomRegion(base,2),{x:0.35,y:0.25,w:0.3,h:0.3});
  assert.deepEqual(V.zoomRegion(base,2,{x:0.2,y:0.1}),{x:0.2,y:0.1,w:0.3,h:0.3});
});

test('panning cannot reveal pixels outside the selected shared area',()=>{
  const base={x:0.2,y:0.1,w:0.6,h:0.6},view={x:0.35,y:0.25,w:0.3,h:0.3};
  assert.deepEqual(V.panRegion(base,view,-1,-1),{x:0.2,y:0.1,w:0.3,h:0.3});
  const edge=V.panRegion(base,view,1,1);
  assert.equal(edge.x,0.5);assert.ok(Math.abs(edge.y-0.4)<1e-12);
  assert.equal(edge.w,0.3);assert.equal(edge.h,0.3);
});

test('drag selection is normalized and preserves lesson aspect',()=>{
  const selected=V.selectionFromDrag({x:100,y:100},{x:500,y:300},800,450,800/450);
  assert.ok(selected);
  assert.ok(Math.abs(selected.w-selected.h)<1e-12);
  assert.ok(selected.x>=0&&selected.y>=0&&selected.x+selected.w<=1&&selected.y+selected.h<=1);
});
const vm=require('node:vm'),fs=require('node:fs');
async function viewportFixture(){
  class Element extends EventTarget{
    constructor(tag){super();this.tag=tag;this.style={};this.classList={toggle(){},add(){},remove(){}};this.children=[];this.videoWidth=1280;this.videoHeight=720;this.readyState=2;this.captured=null}
    append(...children){this.children.push(...children)} appendChild(child){this.append(child)}
    setAttribute(name,value){this[name]=value} removeAttribute(name){delete this[name]}
    insertAdjacentElement(position,child){this.append(child)} remove(){}
    play(){return Promise.resolve()} getContext(){return{fillRect(){},drawImage(){}}}
    captureStream(){return{getTracks:()=>[]}} getBoundingClientRect(){return{width:800,height:450}}
    setPointerCapture(id){this.captured=id} hasPointerCapture(id){return this.captured===id} releasePointerCapture(){this.captured=null}
  }
  const body=new Element('body'),stage=new Element('stage'),tool=new Element('select'),share=new Element('button');share.parentElement=body;
  const document={body,createElement:tag=>new Element(tag),getElementById:id=>({shareScreen:share,teacherTool:tool}[id])};
  const context=vm.createContext({window:{ClassPointerViewportCore:V,ClassPointerCore:require('../class-pointer-prototype/classroom-core.js')},document,HTMLCanvasElement:Element,requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync(require.resolve('../class-pointer-prototype/viewport.js'),'utf8'),context);
  let resets=0;
  const controller=await context.window.ClassPointerViewport.create({rawStream:{getTracks:()=>[]},stage,lesson:stage,onBeforeViewChange(){resets++}});
  const controls=body.children[0],button=name=>controls.children.find(child=>child.textContent===name);
  function fire(target,type,extra={}){const event=new Event(type,{cancelable:true});Object.assign(event,{button:0,pointerId:1,clientX:400,clientY:225},extra);target.dispatchEvent(event);return event}
  return{stage,tool,controller,button,fire,resets:()=>resets};
}
test('pan blocks lesson pointers only until Move view is off or a teacher tool is chosen',async()=>{
  const f=await viewportFixture();
  assert.equal(f.fire(f.stage,'pointermove').defaultPrevented,false);
  f.fire(f.button('Zoom +'),'click');f.fire(f.button('Move view'),'click');
  assert.equal(f.fire(f.stage,'pointermove').defaultPrevented,true);
  assert.equal(f.fire(f.stage,'click').defaultPrevented,true);
  f.fire(f.stage,'pointerdown');assert.equal(f.stage.captured,1);
  f.fire(f.tool,'change');assert.equal(f.stage.captured,null);
  assert.equal(f.button('Move view')['aria-pressed'],'false');
  for(const type of ['pointerdown','pointermove','pointerup','click'])assert.equal(f.fire(f.stage,type).defaultPrevented,false);
  f.fire(f.button('Move view'),'click');f.fire(f.button('Move view'),'click');
  assert.equal(f.fire(f.stage,'pointermove').defaultPrevented,false);
  f.controller.stop();
});
test('pan does not intercept the fullscreen exit button and stopped shares remove handlers',async()=>{
  const f=await viewportFixture();f.fire(f.button('Zoom +'),'click');f.fire(f.button('Move view'),'click');
  // Dispatch on stage with a button target, as in capture phase of a real DOM event.
  for(const type of ['pointerdown','pointermove','click']){
    const event=new Event(type,{cancelable:true});Object.defineProperty(event,'target',{value:{closest:()=>({})}});Object.assign(event,{button:0,pointerId:2});
    f.stage.dispatchEvent(event);assert.equal(event.defaultPrevented,false);
  }
  f.controller.stop();
  assert.equal(f.fire(f.stage,'pointermove').defaultPrevented,false);
  assert.equal(f.fire(f.stage,'click').defaultPrevented,false);
});
