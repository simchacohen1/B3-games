'use strict';
// Execute the actual page handlers with native Canvas and in-memory student storage.
// npm install --prefix /tmp/sefer-canvas @napi-rs/canvas
// FTT_CANVAS_MODULE=/tmp/sefer-canvas/node_modules/@napi-rs/canvas node sefer-hamitzvos/tools/verify-coloring.cjs
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const {Image,createCanvas}=require(process.env.FTT_CANVAS_MODULE||'@napi-rs/canvas');
const root=path.resolve(__dirname,'..'),repo=path.dirname(root),src=fs.readFileSync(path.join(root,'index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const originalSrc=Object.getOwnPropertyDescriptor(Image.prototype,'src');
class Picture extends Image{set src(value){this.requestedSrc=value;try{originalSrc.set.call(this,fs.readFileSync(path.resolve(root,String(value).split('?')[0])))}catch(e){this.onerror?.(e)}}get src(){return this.requestedSrc}}
function fixture(local=new Map(),remote=new Map()){
 const els=new Map(),session=new Map([['b3Games_studentId','synthetic-only'],['b3Games_studentClass','synthetic-class']]);let scale=1;
 function element(type='div'){
  const e=type==='canvas'?createCanvas(300,150):type==='image'?new Picture():{};
  Object.assign(e,{style:{},dataset:{},children:[],events:{},textContent:'',value:'20',classList:{toggle(){},add(){},remove(){}},setAttribute(){},appendChild(child){this.children.push(child)},replaceChildren(){this.children=[]},addEventListener(name,fn){this.events[name]=fn},setPointerCapture(){},getBoundingClientRect(){return {left:10,top:20,width:this.width*scale,height:this.height*scale}}});return e;
 }
 const document={getElementById(id){if(!els.has(id))els.set(id,element(['paint','fillPaint'].includes(id)?'canvas':id==='outline'?'image':'div'));return els.get(id)},createElement(type){return element(type)},querySelectorAll(selector){return selector==='#dayCards button'?els.get('dayCards')?.children||[]:[]}};
 const api=map=>({getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,String(v))});
 const c={document,sessionStorage:api(session),localStorage:api(local),Image:Picture,URLSearchParams,Intl,console,confirm:()=>true,setTimeout,clearTimeout,setInterval:()=>0,location:{search:''},Date:class extends Date{constructor(...args){super(...(args.length?args:['2026-10-20T14:00:00Z']))}}};
 c.window=c;c.addEventListener=()=>{};c.B3SiteSettings={onAuthStateChanged:fn=>fn({},true,{role:'teacher',authorized:true})};c.B3_FIREBASE_CONFIG={};
 c.firebase={apps:[{}],database:()=>({ref:key=>({once:async()=>({val:()=>remote.get(key)}),set:async value=>{remote.set(key,value)}})})};
 vm.createContext(c);for(const file of ['schedule.js','sun-times.js','calendar.js','descriptions.js','region-groups.js','fill.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),c);
 vm.runInContext(src,c);
 return {c,els,local,remote,scale:v=>scale=v,run:code=>vm.runInContext(code,c),tap(x,y,type='mouse'){const cv=els.get('paint'),r=cv.getBoundingClientRect();cv.events.pointerdown({clientX:r.left+(x+.5)*scale,clientY:r.top+(y+.5)*scale,pointerType:type,pointerId:1});cv.events.pointerup?.({pointerId:1})},async ready(n){if(n)this.run(`load(${n})`);for(let tries=0;tries<100;tries++){await new Promise(r=>setTimeout(r,10));if(this.run('!!regionMask && !paintLoading'))return}throw Error('picture/mask failed to load')},hash(){return Buffer.from(els.get('fillPaint').getContext('2d').getImageData(0,0,els.get('paint').width,els.get('paint').height).data)},pixel(x,y){return [...els.get('fillPaint').getContext('2d').getImageData(x,y,1,1).data]}};
}
(async()=>{
 const f=fixture();
 const legacyLocalKey='ftt-sefer-hamitzvos:'+JSON.stringify(['b3-2026','synthetic-class','synthetic-only',500]);
 const legacyLocalValue=JSON.stringify([{type:'legacy-record-preserved'}]),legacyCloudPath='b3Games/students/synthetic-only/seferHamitzvos/coloring/500';
 f.local.set(legacyLocalKey,legacyLocalValue);f.remote.set(legacyCloudPath,{strokes:[{type:'legacy-record-preserved'}],updatedAt:1});
 await f.ready(484);
 for(const n of [1,475,484,487,495,496,497,498,499,500,501,502,503,613]){
  await f.ready(n);const seeds=f.run(`(()=>{const d=regionMask.labels,w=cv.width,counts=new Map(),seeds=new Map();for(let i=0;i<d.length;i++){const id=d[i];if(id){counts.set(id,(counts.get(id)||0)+1);seeds.set(id,i)}}return [...counts].filter(([,n])=>n>=9).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([id])=>{const i=seeds.get(id);return[i%w,Math.floor(i/w)]})})()`);
  f.run('strokes=[];rebuildFillLayer();selectedColor="#e53935";setTool("fill")');f.scale(.5);f.tap(...seeds[0]);assert.deepEqual(f.pixel(...seeds[0]),[229,57,53,255]);const first=f.hash();
  f.run('selectedColor="#1976d2"');f.scale(1.25);f.tap(...seeds[1],'touch');assert.deepEqual(f.pixel(...seeds[1]),[25,118,210,255]);assert.deepEqual(f.pixel(...seeds[0]),[229,57,53,255]);
  f.els.get('undo').onclick();assert.deepEqual(f.hash(),first,'undo restores adjacent region exactly');
  // Native destination-out verifies erasing bucket colors; undo restores them.
  f.run('setTool("eraser")');f.tap(...seeds[0]);assert.ok(f.pixel(...seeds[0])[3]<255);f.els.get('undo').onclick();assert.deepEqual(f.hash(),first,'undo restores erased fill');
  f.run('setTool("fill")');await new Promise(r=>setTimeout(r,400));const remoteBefore=JSON.stringify([...f.remote]);const reloaded=fixture(f.local,f.remote);await reloaded.ready(n);assert.deepEqual(reloaded.hash(),first,'saved fill survives reload');assert.equal(JSON.stringify([...f.remote]),remoteBefore,'load does not overwrite remote');
  reloaded.els.get('clear').onclick();assert.ok(reloaded.hash().every(v=>v===0),'reset clears paint');
  console.log(`PASS ${n}: native fill, adjacent preservation, mouse/touch scaling, erase, undo, save, reload, reset`);
 }
 for(const n of [500,501,502,503]){
  const localKey=f.run(`key(${n})`),cloudPath=`b3Games/students/synthetic-only/seferHamitzvos/coloring/${n}-approved-20261025`;
  assert.ok(localKey.endsWith('"approved-20261025"]'),'new art has isolated local save key');
  assert.ok(f.local.has(localKey),'new art saves locally');assert.ok(f.remote.has(cloudPath),'new art saves to its versioned account path');
 }
 assert.equal(f.local.get(legacyLocalKey),legacyLocalValue,'preexisting local card 500 progress remains untouched');
 assert.deepEqual(f.remote.get(legacyCloudPath),{strokes:[{type:'legacy-record-preserved'}],updatedAt:1},'preexisting cloud card 500 progress remains untouched');
 console.log('PASS cards 500–503: versioned local/account progress is isolated and legacy records remain untouched');
 // Regression: switching dates before the 350ms debounce must not lose
 // the first card's account save or leave old pixels on the new picture.
 const rapid=fixture();await rapid.ready(484);
 const quickSeed=rapid.run('(()=>{const d=regionMask.labels,w=cv.width,i=d.findIndex(v=>v>0);return [i%w,Math.floor(i/w)]})()');
 rapid.run('selectedColor="#ff7043";setTool("fill")');rapid.tap(...quickSeed);
 rapid.run('load(485);load(486);load(487)');
 await rapid.ready();await new Promise(r=>setTimeout(r,550));
 assert.equal(rapid.run('num'),487,'last requested picture wins');
 assert.equal(rapid.run('paintLoading'),false,'navigation finishes');
 assert.equal(rapid.run('strokes.length'),0,'old card drawing is not shown on new art');
 assert.ok(rapid.run('regionMaskCache.size<=3'),'recent masks are bounded');
 const saved484=rapid.remote.get('b3Games/students/synthetic-only/seferHamitzvos/coloring/484-v2');
 assert.equal(saved484?.strokes.length,1,'old card save survives immediate next/previous navigation');
 assert.equal(rapid.run('cardSaveTimers.size'),0,'no pending card timers linger');
 await rapid.ready(484);
 assert.deepEqual(rapid.pixel(...quickSeed),[255,112,67,255],'saved picture remains colored when revisited');
 console.log('PASS rapid history navigation preserves prior saves, isolates colors, and bounds mask cache');
 const week=fixture(),weekSamples=[],weekColors=['#e53935','#1976d2','#43a047','#8e24aa'];
 for(const [index,n]of [500,501,502,503].entries()){
  await week.ready(n);
  const seed=week.run('(()=>{const d=regionMask.labels,w=cv.width,i=d.findIndex(v=>v>0);return [i%w,Math.floor(i/w)]})()'),color=weekColors[index],rgb=color.match(/[0-9a-f]{2}/gi).map(v=>parseInt(v,16));
  week.run(`selectedColor="${color}";setTool("fill")`);week.tap(...seed);assert.deepEqual(week.pixel(...seed),[...rgb,255]);
  weekSamples.push({n,seed,color:[...rgb,255]});await new Promise(r=>setTimeout(r,400));
 }
 for(const sample of weekSamples.slice().reverse()){
  await week.ready(sample.n);assert.deepEqual(week.pixel(...sample.seed),sample.color,`card ${sample.n} reopens with its saved fill`);
  assert.ok(week.remote.has(`b3Games/students/synthetic-only/seferHamitzvos/coloring/${sample.n}-approved-20261025`),`day card ${sample.n} save persisted separately`);
 }
 assert.equal(week.run('regionMaskCache.size')<=3,true,'weekly navigation keeps the region cache bounded');
 console.log('PASS Oct 25–31 cards: repeat days restore saved colors and keep card data separate');
 // Legacy stroke replay remains the original tracer, and does not rewrite records.
 await f.ready(484);const seed=f.run('(()=>{const r=FTTMitzvahFill.traceRegion(sourcePixels,cv.width,cv.height,400,400);return r.pixels?[400,400]:null})()');
 assert.ok(seed);f.run(`strokes=[{type:'fill',seed:${JSON.stringify(seed)},color:'#43a047'}];rebuildFillLayer();persist()`);const legacy=f.hash();await new Promise(r=>setTimeout(r,400));const old=fixture(f.local,f.remote);await old.ready(484);assert.deepEqual(old.hash(),legacy);assert.equal(old.run('strokes[0].maskVersion'),undefined);console.log('PASS legacy saved coloring remains pixel-identical after reload');
 // Object-aware fill: one tap colors the whole pants (every strip between fold lines), nothing next to it.
 {
  const g=fixture();await g.ready(475);
  g.run('strokes=[];rebuildFillLayer();selectedColor="#1976d2";setTool("fill")');
  const strips=[[205,800],[380,800],[266,914],[270,795],[1018,861],[1162,848]],blue=[25,118,210,255];
  const shoe=[160,1010],ground=[305,800],belt=[345,640],shirt=[345,522];
  const seen=g.hash();
  g.tap(...strips[0]);
  for(const s of strips.slice(0,4))assert.deepEqual(g.pixel(...s),blue,'every strip of the left pants is colored by ONE tap '+s);
  for(const s of [strips[4],strips[5],shoe,ground,shirt])assert.equal(g.pixel(...s)[3],0,'neighbouring objects stay uncolored '+s);
  assert.equal(g.run('strokes[0].objectVersion'),2);assert.equal(g.run('strokes[0].maskVersion'),1);
  const one=g.hash();
  g.run('selectedColor="#e53935"');g.tap(...strips[2]);
  for(const s of strips.slice(0,4))assert.deepEqual(g.pixel(...s),[229,57,53,255],'repeat coloring replaces the whole object '+s);
  g.els.get('undo').onclick();assert.deepEqual(g.hash(),one,'undo restores the previous color of the whole object');
  g.els.get('undo').onclick();assert.deepEqual(g.hash(),seen,'second undo clears');
  g.els.get('redo').onclick();assert.deepEqual(g.hash(),one,'redo brings the first color back');
  g.els.get('redo').onclick();for(const s of strips.slice(0,4))assert.deepEqual(g.pixel(...s),[229,57,53,255]);
  g.els.get('undo').onclick();g.run('selectedColor="#43a047"');g.tap(...belt);
  assert.equal(g.run('redoStack.length'),0,'a new stroke clears redo');
  g.els.get('redo').onclick();assert.equal(g.run('strokes.length'),2,'redo with nothing to redo changes nothing');
  await new Promise(r=>setTimeout(r,400));const again=fixture(g.local,g.remote);await again.ready(475);
  assert.deepEqual(again.hash(),g.hash(),'object fills survive save and reload');
  // A picture colored before this change keeps its exact pixels (strip-only legacy section fill).
  const legacy=fixture();await legacy.ready(475);
  legacy.run('strokes=[{type:"fill",seed:[205,800],color:"#43a047",maskVersion:1}];rebuildFillLayer()');
  assert.deepEqual(legacy.pixel(205,800),[67,160,71,255]);assert.equal(legacy.pixel(380,800)[3],0,'legacy record still fills only its own section');
  console.log('PASS 475 object-aware: whole pants in one tap, no leaks, repeat color, undo, redo, save, reload, legacy record');
 }
})().catch(e=>{console.error(e);process.exitCode=1});
