'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../class-pointer-prototype/pdf-mode.js'),'utf8');
function harness(){
  const events=[],draw=[],timers=new Map();let next=0,stopped=0;
  const ctx=new Proxy({}, {get(target,key){if(!(key in target))target[key]=(...args)=>draw.push([key,...args]);return target[key]}});
  const canvas={getContext:()=>ctx,captureStream:()=>({getTracks:()=>[{stop:()=>stopped++}]})};
  const context={document:{createElement:()=>canvas,dispatchEvent:event=>events.push(event)},CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail}},Image:class {constructor(){this.complete=true;this.naturalWidth=100}},setInterval:fn=>{timers.set(++next,fn);return next},clearInterval:id=>timers.delete(id),isTeacher:true,isBoardOpen:()=>true,W:1600,H:900,scroller:{clientWidth:1600,clientHeight:900,scrollLeft:30,scrollTop:20},lay:{lefts:[0],tops:[0],widths:[1],heights:[900/1600]},boardPictures:[{image:'picture',x:.1,y:.2,w:.3,h:.4}],strokes:[{tool:'pen',color:'#123456',size:.01,points:[{x:.2,y:.3},{x:.4,y:.5}]}],draft:null,B:{owner:()=> 'teacher'}};
  vm.createContext(context);
  const start=source.indexOf('  let boardPresentation=null');
  const end=source.indexOf("  if(isTeacher)window.addEventListener('pagehide',stopBoardPresentation);",start);
  vm.runInContext(source.slice(start,end)+'\nglobalThis.api={startBoardPresentation,stopBoardPresentation,paintBoardPresentation,stream:()=>boardPresentation};',context);
  return {context,events,draw,timers,canvas,get stopped(){return stopped}};
}
test('teacher board presentation is live, paints pictures and ink in viewport coordinates, and stops cleanly',()=>{
  const h=harness();h.context.api.startBoardPresentation('data:image/jpeg;base64,board');
  assert.equal(h.events.length,1);assert.ok(h.events[0].detail.stream);assert.equal(h.timers.size,1);
  assert.ok(h.draw.some(row=>row[0]==='translate'&&row[1]===-30&&row[2]===-20));
  assert.ok(h.draw.some(row=>row[0]==='drawImage'&&row[1]==='picture'&&row[2]===160&&row[3]===180));
  assert.ok(h.draw.some(row=>row[0]==='moveTo'&&row[1]===320&&row[2]===270));
  assert.ok(h.draw.some(row=>row[0]==='lineTo'&&row[1]===640&&row[2]===450));
  h.context.api.stopBoardPresentation();assert.equal(h.stopped,1);assert.equal(h.timers.size,0);assert.equal(h.events.at(-1).detail.stream,null);
  h.context.api.stopBoardPresentation();assert.equal(h.stopped,1);
});
test('replacement closes old media and a student never creates a presentation',()=>{
  const h=harness();h.context.api.startBoardPresentation('one');h.context.api.startBoardPresentation('two');
  assert.equal(h.stopped,1);assert.equal(h.timers.size,1);
  h.context.isTeacher=false;h.context.api.startBoardPresentation('three');
  assert.equal(h.stopped,2);assert.equal(h.timers.size,0);assert.equal(h.context.api.stream(),null);
});
test('presentation dimensions are bounded without changing board or student state',()=>{
  const h=harness();h.context.scroller.clientWidth=4000;h.context.scroller.clientHeight=3000;
  const prior=JSON.stringify(h.context.strokes);h.context.api.startBoardPresentation('board');
  assert.ok(h.canvas.width<=1920);assert.ok(h.canvas.height<=1080);assert.equal(JSON.stringify(h.context.strokes),prior);
});
