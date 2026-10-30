const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {sweptMinDistance,tagDistance}=require('../class-gallery/tag-collision.js');
const D=1.18;
test('fast players crossing paths in one step are caught',()=>{
  // endpoints are 4 apart, but the paths cross in the middle
  const d=sweptMinDistance({x:0,z:0},{x:2,z:0},{x:2,z:.3},{x:0,z:.3});
  assert.ok(d<D,'swept '+d);
  assert.ok(Math.hypot(0-2,0-.3)>D&&Math.hypot(2-0,0-.3)>D,'point checks miss it');
});
test('players passing far apart are not tagged',()=>{
  assert.ok(sweptMinDistance({x:0,z:0},{x:2,z:0},{x:2,z:3},{x:0,z:3})>D);
});
test('still players use plain distance',()=>{
  assert.equal(sweptMinDistance({x:0,z:0},{x:0,z:0},{x:3,z:4},{x:3,z:4}),5);
});
test('laggy shown avatar is caught by latest network position',()=>{
  const me0={x:0,z:0},me1={x:1,z:0};
  const shown0={x:5,z:0},shown1={x:5,z:0};
  assert.ok(tagDistance(me0,me1,shown0,shown1,null,null)>D);
  assert.ok(tagDistance(me0,me1,shown0,shown1,{x:5,z:0},{x:1.5,z:0})<D);
});
test('game page loads the sweep module and uses it for both modes',()=>{
  const h=fs.readFileSync(__dirname+'/../class-gallery/index.html','utf8');
  assert.match(h,/tag-collision\.js/);
  assert.equal((h.match(/tagContactDistance\(id,entry\)/g)||[]).length,3);
  assert.match(h,/recordTagSweep\(\);maybeTagNearbyClassmate\(\)/);
});
