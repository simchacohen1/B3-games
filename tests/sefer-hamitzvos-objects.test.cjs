'use strict';
// Object-aware sections (objectVersion 2): one tap colors a whole object, never a neighbour.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),zlib=require('node:zlib'),vm=require('node:vm');
const {createObjectMask,regionFromObjects,buildRegionIndex,createRegionMask}=require('../sefer-hamitzvos/fill.js');
function png(path){
 const b=fs.readFileSync(path),width=b.readUInt32BE(16),height=b.readUInt32BE(20),type=b[25],channels=({0:1,2:3,6:4})[type];
 let pos=8,parts=[];while(pos<b.length){const len=b.readUInt32BE(pos),kind=b.toString('ascii',pos+4,pos+8);if(kind==='IDAT')parts.push(b.subarray(pos+8,pos+8+len));pos+=12+len;}
 const raw=zlib.inflateSync(Buffer.concat(parts)),stride=width*channels,pixels=Buffer.alloc(height*stride),data=new Uint8ClampedArray(width*height*4);
 const paeth=(a,b,c)=>{const p=a+b-c,aa=Math.abs(p-a),bb=Math.abs(p-b),cc=Math.abs(p-c);return aa<=bb&&aa<=cc?a:bb<=cc?b:c;};
 for(let y=0;y<height;y++){const f=raw[y*(stride+1)];for(let x=0;x<stride;x++){const i=y*stride+x,a=x>=channels?pixels[i-channels]:0,up=y?pixels[i-stride]:0,c=y&&x>=channels?pixels[i-stride-channels]:0;pixels[i]=(raw[y*(stride+1)+1+x]+[0,a,up,Math.floor((a+up)/2),paeth(a,up,c)][f])&255;}}
 for(let i=0;i<width*height;i++){const j=i*channels;data[i*4]=pixels[j];data[i*4+1]=pixels[j+(channels===1?0:1)];data[i*4+2]=pixels[j+(channels===1?0:2)];data[i*4+3]=channels===4?pixels[j+3]:255;}
 return {width,height,data};
}
const ctx={window:{}};ctx.window=ctx;vm.runInNewContext(fs.readFileSync('sefer-hamitzvos/region-groups.js','utf8'),ctx);
const GROUPS=ctx.FTT_SEFER_REGION_GROUPS;
// Synthetic art: white page, black frame, thick-outlined box with a thin "fold" line through it.
function art(w,h,draw){const data=new Uint8ClampedArray(w*h*4).fill(255);const set=(x,y,v)=>{if(x>=0&&y>=0&&x<w&&y<h){const i=(y*w+x)*4;data[i]=data[i+1]=data[i+2]=v;}};draw(set);return {data,width:w,height:h};}
const rect=(set,x0,y0,x1,y1,t)=>{for(let x=x0;x<=x1;x++)for(let k=0;k<t;k++){set(x,y0+k,0);set(x,y1-k,0);}for(let y=y0;y<=y1;y++)for(let k=0;k<t;k++){set(x0+k,y,0);set(x1-k,y,0);}};
function pants(withGap){
 return art(600,500,set=>{
  rect(set,0,0,599,499,6);
  rect(set,150,150,450,350,6);                      // the whole object, thick outline
  for(let y=156;y<345;y++){set(300,y,0);set(301,y,0);} // thin fold line (2px) splitting it in two strips
  rect(set,360,200,430,280,6);                      // a different object INSIDE the first (a pocket)
  if(withGap)for(let x=150;x<156;x++)set(x,250,255);   // tiny break in the outline
 });
}
const at=(m,x,y)=>m.labels[y*m.width+x];
test('a thin fold line splits strips unless the group names them; the group never swallows a neighbouring object',()=>{
 const a=pants(false),plain=createObjectMask(a,a.width,a.height,[]);
 const l=at(plain,220,250),r=at(plain,340,250),pocket=at(plain,390,240);
 assert.ok(l&&r&&pocket);assert.notEqual(l,r,'without groups the strips stay separate (safe default)');
 const grouped=createObjectMask(a,a.width,a.height,[{name:'pants',join:[[220,250],[340,250]]}]);
 assert.equal(at(grouped,220,250),at(grouped,340,250));
 assert.notEqual(at(grouped,220,250),at(grouped,390,240),'pocket is a different object');
 assert.deepEqual(grouped.groups.map(g=>g.ok),[true]);
});
test('slivers around thin lines are colored with the object, but thick outlines and the open page are not',()=>{
 const a=pants(false),m=createObjectMask(a,a.width,a.height,[{name:'p',join:[[220,250],[340,250]]}]);
 const side=at(m,220,250);
 // The 2px fold line itself is covered by the section next to it (the line art sits above the paint).
 for(const x of [299,300,301,302])assert.ok(at(m,x,200)===side,`fold line pixel ${x} colored with its object`);
 for(const [x,y] of [[152,250],[150,150],[449,349],[360,240]])assert.equal(at(m,x,y)===side,false,`thick outline at ${x},${y} must stay unpainted or belong to another object`);
 assert.equal(at(m,5,5),0,'outside frame / open page stays unfilled');
 assert.equal(at(m,70,250),0);
});
test('a tiny gap in an outline is repaired without opening a path to the page outside',()=>{
 const a=pants(true),m=createObjectMask(a,a.width,a.height,[{name:'p',join:[[220,250],[340,250]]}]);
 const inside=at(m,220,250),outsideSpot=at(m,100,250);
 assert.ok(inside);assert.notEqual(inside,outsideSpot);
 const idx=buildRegionIndex(m.labels),count=idx.starts[inside+1]-idx.starts[inside];
 for(let n=0;n<count;n++){const p=idx.items[idx.starts[inside]+n],x=p%a.width,y=(p/a.width)|0;assert.ok(x>=150&&x<=450&&y>=150&&y<=350,`leak to ${x},${y}`);}
});
test('regionFromObjects: bounded slices, border/outside/unavailable fail closed, repeat taps are the same cached slice',()=>{
 const a=pants(false),m=createObjectMask(a,a.width,a.height,[]),mask={width:m.width,height:m.height,labels:m.labels};
 const first=regionFromObjects(mask,220,250),again=regionFromObjects(mask,221,251);
 assert.equal(first.region,again.region);assert.equal(first.pixels.length,again.pixels.length);
 for(const p of first.pixels)assert.equal(mask.labels[p],first.region);
 assert.equal(regionFromObjects(mask,3,3).reason,'border');
 assert.equal(regionFromObjects(mask,-1,5).reason,'outside');
 assert.equal(regionFromObjects(null,1,1).reason,'unavailable');
 assert.equal(regionFromObjects({width:5,height:5,labels:new Uint32Array(3)},1,1).reason,'unavailable');
});
test('bad groups never merge anything: unknown seed, wrong type, seed outside the picture',()=>{
 const a=pants(false),base=createObjectMask(a,a.width,a.height,[]);
 const bad=createObjectMask(a,a.width,a.height,[{name:'x',join:[[220,250],[5,5]]},{name:'y',foo:1},{name:'z',join:[[220,250],[2000,2000]]}]);
 assert.deepEqual([...bad.labels],[...base.labels]);
 assert.deepEqual(bad.groups.map(g=>g.ok),[false,false,false]);
});
test('the unchanged section engine still gives the same sections underneath (saved pictures replay identically)',()=>{
 const a=pants(true),fine=createRegionMask(a,a.width,a.height),obj=createObjectMask(a,a.width,a.height,[]);
 assert.deepEqual([...obj.fine],[...fine.labels]);
});
const SAME=[[[205,800],[380,800],[266,914],[270,795]],[[1018,861],[1162,848]],[[330,340],[225,365]],[[345,522],[266,613]]];
const DIFFER=[[[205,800],[330,640]],[[205,800],[160,1010]],[[205,800],[305,800]],[[330,340],[250,300]],[[330,340],[345,522]],[[1018,861],[1100,900]],[[1018,861],[1018,1000]],[[1018,861],[1250,1000]]];
for(const card of [475,478,479,480])test(`card ${card}: groups are valid, bounded, and every seed lands on a fillable section`,()=>{
 const a=png(`sefer-hamitzvos/coloring-v2/${card}.png`),groups=GROUPS[card];assert.ok(groups&&groups.length>=9,'curated');
 const m=createObjectMask(a,a.width,a.height,groups),sizes=new Map();
 for(const l of m.labels)if(l)sizes.set(l,(sizes.get(l)||0)+1);
 for(const g of m.groups)assert.ok(g.ok,`${g.name}: ${g.reason}`);
 for(const g of groups){
  const labels=new Set(g.join.map(([x,y])=>at(m,x,y)));
  assert.equal(labels.size,1,`${g.name}: all pieces are one object`);
  const size=sizes.get([...labels][0]);assert.ok(size>0&&size<a.width*a.height*.06,`${g.name}: ${(100*size/a.width/a.height).toFixed(1)}% of the picture`);
 }
 // Thick outlines are never under paint; only thin fold lines (painted beneath the line art) are.
 let covered=0;for(let i=0;i<m.labels.length;i++)if(m.labels[i]&&m.thick[i])covered++;
 assert.equal(covered,0,'outline stays unfilled');
});
test('card 475: pants, face, shirt and shoes are whole objects, neighbours stay separate',()=>{
 const a=png('sefer-hamitzvos/coloring-v2/475.png'),m=createObjectMask(a,a.width,a.height,GROUPS[475]);
 for(const set of SAME){const ids=new Set(set.map(([x,y])=>at(m,x,y)));assert.equal(ids.size,1,JSON.stringify(set));assert.ok(!ids.has(0));}
 for(const [p,q] of DIFFER)assert.notEqual(at(m,...p),at(m,...q),JSON.stringify([p,q]));
});
test('region-groups.js is generated from the checked-in source',()=>{
 const src=JSON.parse(fs.readFileSync('sefer-hamitzvos/tools/region-groups-source.json','utf8'));
 assert.deepEqual(Object.keys(src).sort(),Object.keys(GROUPS).sort());
 for(const card of Object.keys(src))assert.equal(src[card].length,GROUPS[card].length);
});
