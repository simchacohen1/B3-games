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
 vm.createContext(c);for(const file of ['schedule.js','sun-times.js','calendar.js','descriptions.js','fill.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),c);
 vm.runInContext(src,c);
 return {c,els,local,remote,scale:v=>scale=v,run:code=>vm.runInContext(code,c),tap(x,y,type='mouse'){const cv=els.get('paint'),r=cv.getBoundingClientRect();cv.events.pointerdown({clientX:r.left+(x+.5)*scale,clientY:r.top+(y+.5)*scale,pointerType:type,pointerId:1});cv.events.pointerup?.({pointerId:1})},async ready(n){if(n)this.run(`load(${n})`);for(let tries=0;tries<100;tries++){await new Promise(r=>setTimeout(r,10));if(this.run('!!regionMask && !paintLoading'))return}throw Error('picture/mask failed to load')},hash(){return Buffer.from(els.get('fillPaint').getContext('2d').getImageData(0,0,els.get('paint').width,els.get('paint').height).data)},pixel(x,y){return [...els.get('fillPaint').getContext('2d').getImageData(x,y,1,1).data]}};
}
(async()=>{
 const f=fixture();await f.ready(484);
 for(const n of [1,475,484,487,499,613]){
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
 // Legacy stroke replay remains the original tracer, and does not rewrite records.
 await f.ready(484);const seed=f.run('(()=>{const r=FTTMitzvahFill.traceRegion(sourcePixels,cv.width,cv.height,400,400);return r.pixels?[400,400]:null})()');
 assert.ok(seed);f.run(`strokes=[{type:'fill',seed:${JSON.stringify(seed)},color:'#43a047'}];rebuildFillLayer();persist()`);const legacy=f.hash();await new Promise(r=>setTimeout(r,400));const old=fixture(f.local,f.remote);await old.ready(484);assert.deepEqual(old.hash(),legacy);assert.equal(old.run('strokes[0].maskVersion'),undefined);console.log('PASS legacy saved coloring remains pixel-identical after reload');
})().catch(e=>{console.error(e);process.exitCode=1});
