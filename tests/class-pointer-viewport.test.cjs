const {test}=require('node:test');
const assert=require('node:assert/strict');
const V=require('../class-pointer-prototype/viewport-core.js');

test('viewport output keeps source aspect ratio while bounding resolution',()=>{
  assert.deepEqual(V.outputSize(1920,1080),{width:1280,height:720});
  assert.deepEqual(V.outputSize(2560,1600),{width:1152,height:720});
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
  assert.deepEqual(V.panRegion(base,view,1,1),{x:0.5,y:0.4,w:0.3,h:0.3});
});

test('drag selection is normalized and preserves lesson aspect',()=>{
  const selected=V.selectionFromDrag({x:100,y:100},{x:500,y:300},800,450,800/450);
  assert.ok(selected);
  assert.ok(Math.abs(selected.w-selected.h)<1e-12);
  assert.ok(selected.x>=0&&selected.y>=0&&selected.x+selected.w<=1&&selected.y+selected.h<=1);
});
