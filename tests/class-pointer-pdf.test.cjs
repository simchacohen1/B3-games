const test=require('node:test'),assert=require('node:assert/strict'),P=require('../class-pointer-prototype/pdf-core.js');

test('layout stacks pages with small gaps and finds the page at a position',()=>{
  const lay=P.layout([1.4,1.4,1.5]);
  assert.equal(lay.count,3);assert.equal(lay.tops[0],0);
  assert.ok(Math.abs(lay.tops[1]-1.42)<1e-9);assert.ok(Math.abs(lay.total-(1.4+0.02+1.4+0.02+1.5))<1e-9);
  assert.equal(P.pageAt(lay,0),0);assert.equal(P.pageAt(lay,lay.tops[1]/lay.total+0.001),1);assert.equal(P.pageAt(lay,1),2);assert.equal(P.pageAt(lay,5),2);assert.equal(P.pageAt(lay,-1),0);
  assert.equal(P.pageTop(lay,2),lay.tops[2]/lay.total);
});
test('a document position gives the same spot at any zoom or screen width',()=>{
  const lay=P.layout([1.4,1.4]);
  const y=(lay.tops[1]+0.5*lay.heights[1])/lay.total; // middle of page 2
  for(const width of [600,1100,2400]){const h=width*lay.total;assert.ok(Math.abs(y*h/width-(lay.tops[1]+0.5*lay.heights[1]))<1e-9)}
});
test('odd page shapes fall back to a normal page',()=>{
  const lay=P.layout([NaN,0,-3,1e9,1.3]);assert.deepEqual(lay.heights.slice(0,4),[1.4,1.4,1.4,1.4]);assert.equal(lay.heights[4],1.3);
  assert.equal(P.layout([]).count,0);assert.equal(P.pageAt(P.layout([]),0.5),0);
});
test('zoom steps move one at a time and stay inside the limits',()=>{
  assert.equal(P.nextZoom(1,1),1.25);assert.equal(P.nextZoom(1,-1),0.75);assert.equal(P.nextZoom(4,1),4);assert.equal(P.nextZoom(0.5,-1),0.5);
  assert.equal(P.nextZoom(1.1,1),1.25);assert.equal(P.nextZoom(1.1,-1),1);
});
test('a student only accepts a sane view from the teacher',()=>{
  assert.deepEqual(P.cleanView({zoom:2,top:0.5,left:0.25}),{zoom:2,top:0.5,left:0.25});
  assert.deepEqual(P.cleanView({zoom:99,top:-4,left:9}),{zoom:4,top:0,left:1});
  assert.equal(P.cleanView({zoom:'x',top:0,left:0}),null);assert.equal(P.cleanView(null),null);assert.equal(P.cleanView({zoom:1,top:NaN,left:0}),null);
});
test('file offers are checked for size and chunk count',()=>{
  const good={id:'a',name:'Chumash',size:200000,chunks:P.chunkCount(200000)};
  assert.deepEqual(P.cleanOffer(good),{id:'a',name:'Chumash',size:200000,chunks:good.chunks});
  assert.equal(P.cleanOffer({...good,chunks:good.chunks+1}),null);
  assert.equal(P.cleanOffer({...good,size:P.MAX_BYTES+1,chunks:P.chunkCount(P.MAX_BYTES+1)}),null);
  assert.equal(P.cleanOffer({...good,size:0}),null);assert.equal(P.cleanOffer({...good,id:5}),null);assert.equal(P.cleanOffer(null),null);
  assert.equal(P.cleanOffer({...good,name:'<img src=x onerror=1>\u0000A'}).name,'img src=x onerror=1A');
});
test('chunks are rebuilt into the exact file and bad chunks are refused',()=>{
  const data=new Uint8Array(P.CHUNK*2+10).map((_,i)=>i%251),offer=P.cleanOffer({id:'a',name:'x',size:data.length,chunks:P.chunkCount(data.length)});
  const t={...offer,parts:new Array(offer.chunks),received:0};
  assert.equal(P.acceptChunk(t,{id:'zzz',i:0,data:data.slice(0,5)}),false);
  assert.equal(P.acceptChunk(t,{id:'a',i:9,data:data.slice(0,5)}),false);
  assert.equal(P.acceptChunk(t,{id:'a',i:0,data:'text'}),false);
  assert.equal(P.acceptChunk(t,{id:'a',i:0,data:new Uint8Array(P.CHUNK+1)}),false);
  assert.equal(P.assemble(t),null);
  for(let i=2;i>=0;i--)assert.equal(P.acceptChunk(t,{id:'a',i,data:i===2?data.slice(2*P.CHUNK):data.slice(i*P.CHUNK,(i+1)*P.CHUNK).buffer}),true);
  assert.equal(P.acceptChunk(t,{id:'a',i:1,data:data.slice(P.CHUNK,2*P.CHUNK)}),false); // no repeats
  assert.deepEqual(Array.from(P.assemble(t)),Array.from(data));
});
test('classroom.js keeps its permission checks when a PDF is open',()=>{
  const src=require('fs').readFileSync(__dirname+'/../class-pointer-prototype/classroom.js','utf8');
  assert.ok(src.includes("C.canWrite(state.mode,member)"));assert.ok(src.includes("C.canPoint(state.mode,member)"));
  assert.ok(src.includes('function live(){return state.sharing||state.pdf===true}'));
  assert.ok(!/message\.type==='point'&&state\.sharing/.test(src));
});
