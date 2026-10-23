'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),zlib=require('node:zlib'),crypto=require('node:crypto'),vm=require('node:vm');
const {regionFromMask,createRegionMask}=require('../sefer-hamitzvos/fill.js');
// Decode the shipped 8-bit grayscale/RGB/RGBA PNGs, without native test dependencies.
function png(path){
 const b=fs.readFileSync(path),width=b.readUInt32BE(16),height=b.readUInt32BE(20),type=b[25],channels=({0:1,2:3,6:4})[type];
 assert.equal(b[24],8);assert.ok(channels,`${path}: supported PNG`);assert.equal(b[28],0);
 let pos=8,parts=[];while(pos<b.length){const len=b.readUInt32BE(pos),kind=b.toString('ascii',pos+4,pos+8);if(kind==='IDAT')parts.push(b.subarray(pos+8,pos+8+len));pos+=12+len;}
 const raw=zlib.inflateSync(Buffer.concat(parts)),stride=width*channels,pixels=Buffer.alloc(height*stride),data=new Uint8ClampedArray(width*height*4);
 const paeth=(a,b,c)=>{const p=a+b-c,aa=Math.abs(p-a),bb=Math.abs(p-b),cc=Math.abs(p-c);return aa<=bb&&aa<=cc?a:bb<=cc?b:c;};
 for(let y=0;y<height;y++){
  const filter=raw[y*(stride+1)];
  for(let x=0;x<stride;x++){const i=y*stride+x,a=x>=channels?pixels[i-channels]:0,up=y?pixels[i-stride]:0,c=y&&x>=channels?pixels[i-stride-channels]:0;pixels[i]=(raw[y*(stride+1)+1+x]+[0,a,up,Math.floor((a+up)/2),paeth(a,up,c)][filter])&255;}
 }
 for(let i=0;i<width*height;i++){const j=i*channels;data[i*4]=pixels[j];data[i*4+1]=pixels[j+(channels===1?0:1)];data[i*4+2]=pixels[j+(channels===1?0:2)];data[i*4+3]=channels===4?pixels[j+3]:255;}
 return {width,height,data};
}
const root='sefer-hamitzvos/',manifest=JSON.parse(fs.readFileSync(root+'region-manifest.json'));
const label=(data,i)=>data[i*4]|data[i*4+1]<<8|data[i*4+2]<<16;
test('all 613 masks match native artwork, never include outline pixels, and reject whole-picture components',()=>{
 assert.equal(Object.keys(manifest).length,613);
 for(const [card,m]of Object.entries(manifest)){
  const path=root+m.source;assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex'),m.sha256,card+' source unchanged');
  const art=png(path),mask=createRegionMask(art,art.width,art.height);assert.equal(mask.width,art.width);assert.equal(mask.height,art.height);
  assert.equal(crypto.createHash('sha256').update(Buffer.from(mask.labels.buffer)).digest('hex'),m.labelsSha256,card+' matches independent segmentation');
  const sizes=new Map();for(let i=0;i<mask.width*mask.height;i++){
   const id=mask.labels[i];if(!id)continue;sizes.set(id,(sizes.get(id)||0)+1);
   assert.ok(art.data[i*4]>=232&&art.data[i*4+1]>=232&&art.data[i*4+2]>=232,card+' ink barrier');
  }
  assert.equal(sizes.size,m.regions);assert.ok([...sizes.values()].every(n=>n<=mask.width*mask.height*.18),card+' no page-size fill');
 }
});
for(const n of [1,475,476,484,487,499,613])test(`real picture ${n}: adjacent, detailed and small sections stay isolated`,()=>{
 const m=manifest[n],art=png(root+m.source),mask=createRegionMask(art,art.width,art.height),seeds=new Map(),counts=new Map();
 for(let i=0;i<mask.width*mask.height;i++){const id=mask.labels[i];if(id){seeds.set(id,i);counts.set(id,(counts.get(id)||0)+1);}}
 const small=[...counts].filter(([,n])=>n>=3).sort((a,b)=>a[1]-b[1])[0],large=[...counts].sort((a,b)=>b[1]-a[1])[0];
 assert.ok(small&&large&&small[0]!==large[0]);
 const target=new Uint8Array(mask.width*mask.height);let before;
 for(const [id,size]of [small,large]){
  const i=seeds.get(id),result=regionFromMask(mask,mask.width,mask.height,i%mask.width,Math.floor(i/mask.width));assert.equal(result.pixels.length,size);
  before=target.slice();for(const p of result.pixels){assert.equal(mask.labels[p],id);target[p]=id===small[0]?1:2;}
  for(let p=0;p<target.length;p++)if(mask.labels[p]!==id)assert.equal(target[p],before[p],'neighbor color preserved');
 }
 // CSS size/zoom changes map back to the same native pixel for mouse or touch.
 const i=seeds.get(small[0]),x=i%mask.width,y=Math.floor(i/mask.width);
 for(const factor of [.3,.75,1,1.5]){
  const cssX=(x+.5)*factor,cssY=(y+.5)*factor;
  assert.equal(regionFromMask(mask,mask.width,mask.height,cssX/factor,cssY/factor).region,small[0]);
 }
});
test('missing, mismatched or giant masks fail closed',()=>{
 assert.equal(regionFromMask(null,9,9,4,4).reason,'unavailable');
 const data=new Uint8ClampedArray(9*9*4);for(let i=0;i<81;i++){data[i*4]=1;data[i*4+3]=255;}
 assert.equal(regionFromMask({data,width:8,height:9},9,9,4,4).reason,'unavailable');
 assert.equal(regionFromMask({data,width:9,height:9},9,9,4,4).reason,'open');
});
test('all 613 descriptions and vocabulary selections are explicit and preserve the established edition',()=>{
 const c={window:{}};c.window=c;vm.runInNewContext(fs.readFileSync(root+'descriptions.js','utf8'),c);vm.runInNewContext(fs.readFileSync('word-bank/mitzvah-titles.js','utf8'),c);vm.runInNewContext(fs.readFileSync('word-bank/sefer-vocabulary-catalog.js','utf8'),c);
 const d=c.FTT_MITZVAH_DESCRIPTIONS;assert.equal(Object.keys(d).length,613);
 for(const [ref,text]of Object.entries(d)){
  assert.ok(text.length>8&&text.length<220,ref);if(ref[0]==='N')assert.match(text,/\b(?:not|no)\b/i,ref+' prohibition');
  const words=c.FTTSeferVocabulary.forRef(ref);assert.ok(words.length>=1&&words.length<=3,ref);assert.ok(words.every(w=>/[א-ת]/.test(w.hebrew)&&w.english));
 }
 assert.match(d.N295,/deliberate/);assert.match(d.N296,/unintentional/);assert.match(d.P247,/attacker/);assert.match(d.N297,/life is in danger/);
 const plain=s=>s.replace(/[\u0591-\u05c7]/g,'');
 for(const ref of ['P225','N296'])assert.ok(c.FTTSeferVocabulary.forRef(ref).some(w=>plain(w.hebrew)==='עיר מקלט'));
 assert.match(d.N154,/Do not.*wrong order/);assert.match(d.P105,/seminal discharge/);assert.ok(!d.P105.includes('<br>'));
});
test('off-thread segmentation matches unchanged artwork and repeat taps reuse one bounded region',()=>{
 const art=png(root+manifest[484].source),direct=createRegionMask(art,art.width,art.height);
 const context={Uint8ClampedArray,Uint32Array,ArrayBuffer,console};let response;
 context.self=context;
 context.importScripts=()=>vm.runInNewContext(fs.readFileSync(root+'fill.js','utf8'),context);
 context.postMessage=(message,transfers)=>{response=message;assert.ok(transfers.includes(message.labels));};
 vm.runInNewContext(fs.readFileSync(root+'mask-worker.js','utf8'),context);
 const input=new Uint8ClampedArray(art.data).buffer;
 context.onmessage({data:{revision:7,card:484,width:art.width,height:art.height,pixels:input}});
 assert.equal(response.revision,7);assert.equal(response.card,484);
 assert.equal(response.error,undefined);
 assert.equal(crypto.createHash('sha256').update(Buffer.from(response.labels)).digest('hex'),manifest[484].labelsSha256);
 const mask={width:art.width,height:art.height,labels:new Uint32Array(response.labels)};
 const firstIndex=mask.labels.findIndex(Boolean),x=firstIndex%mask.width,y=Math.floor(firstIndex/mask.width);
 const first=regionFromMask(mask,mask.width,mask.height,x,y),second=regionFromMask(mask,mask.width,mask.height,x,y);
 assert.strictEqual(second.pixels,first.pixels,'same image region is cached, not scanned again');
 assert.ok(mask.recentPixels.size<=4,'bounded pixel cache');
});
test('white fringe completion paints enclosed gaps without crossing ink or another section',()=>{
 const {includeSafeWhiteFringe}=require('../sefer-hamitzvos/fill.js');
 const width=20,height=16,total=width*height,labels=new Uint32Array(total),data=new Uint8ClampedArray(total*4);
 for(let i=0;i<total;i++){data[i*4]=255;data[i*4+1]=255;data[i*4+2]=255;data[i*4+3]=255;}
 for(let y=2;y<=9;y++)for(let x=2;x<=5;x++)labels[y*width+x]=1;
 // An artificially closed white gap within one enclosed region.
 labels[5*width+4]=0;
 for(let y=2;y<=9;y++)for(let x=9;x<=11;x++)labels[y*width+x]=2;
 // Genuine dark border must never get colored.
 for(let y=1;y<=10;y++){const i=y*width+7;data[i*4]=data[i*4+1]=data[i*4+2]=0;}
 const mask={width,height,labels},seed=regionFromMask(mask,width,height,3,5);
 const complete=includeSafeWhiteFringe(mask,{data},seed);
 assert.ok([...complete.pixels].includes(5*width+4),'white gap receives same color');
 assert.ok(complete.pixels.every(i=>data[i*4]>=232),'dark pixels untouched');
 assert.ok(complete.pixels.every(i=>labels[i]===1||labels[i]===0),'other labeled region untouched');
 assert.strictEqual(includeSafeWhiteFringe(mask,{data},seed).pixels,complete.pixels,'result cached');
});
module.exports={png};
