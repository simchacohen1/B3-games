'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('class-pointer-prototype/pdf-mode.js','utf8');
const code=source.slice(source.indexOf('  function activityPoint('),source.indexOf('  // ---------- Pointing and drawing'));
function fixture({W=1200,H=80000,left=0,top=2400,width=1200,height=600}={}){
 const context=vm.createContext({W,H,scroller:{scrollLeft:left,scrollTop:top,clientWidth:width,clientHeight:height}});
 vm.runInContext(code,context);return context;
}
test('student midpoint on page 3 maps to visible document coordinates and round trips',()=>{
 const f=fixture();const p=f.activityPoint({x:.5,y:.5,tool:'target'});
 assert.equal(p.x,.5);assert.equal(p.y,2700/80000);
 const back=f.activityPoint(p,false);assert.equal(back.x,.5);assert.equal(back.y,.5);assert.equal(back.tool,'target');
});
test('zoom and horizontal scrolling map to whole-document positions',()=>{
 const f=fixture({W:2400,left:600});const p=f.activityPoint({x:.5,y:.5});
 assert.equal(p.x,.5);assert.equal(p.y,2700/80000);
});
test('outgoing marks use the video viewport without modifying stored ink',()=>{
 const f=fixture();const message={points:{teacher:{x:.5,y:2700/80000}},strokes:[{owner:'test',points:[{x:.2,y:2400/80000},{x:.4,y:3000/80000}]}]};
 const mapped=f.activityMarks(message);assert.equal(mapped.points.teacher.y,.5);
 assert.equal(mapped.strokes[0].points[0].y,0);assert.equal(mapped.strokes[0].points[1].y,1);
 assert.equal(message.strokes[0].points[0].y,2400/80000);
});
test('marks outside the viewport remain outside and do not clamp onto another page',()=>{
 const f=fixture();assert.ok(f.activityPoint({x:.5,y:0},false).y<0);
});
