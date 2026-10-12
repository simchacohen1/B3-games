/* Halacha Studio: additive editor. Existing artwork keys and account saving stay intact. */
(() => {
'use strict';
const palette = [['Red','#e53935'],['Orange','#fb8c00'],['Yellow','#fdd835'],['Green','#43a047'],['Blue','#1e88e5'],['Purple','#8e24aa'],['Brown','#6d4c41'],['Black','#263238'],['White','#ffffff']];
const history = new Map();
let restoring = false;
const readonly = () => !!HALACHA_TEACHER_VIEW;
const pages = id => [...document.querySelectorAll('#'+id+' .page')];
const pageAt = (id,i) => pages(id)[i];
function snapshot(id) {
 const result={};
 for(const key of [id+'_scrap_pages',id+'_scrap',id+'_draw',id+'_theme',id+'_studio_bg']) if(S[key]!==undefined) result[key]=S[key];
 return JSON.stringify(result);
}
function seed(id){history.set(id,{past:[],present:snapshot(id),future:[]});}
function record(id){
 if(restoring||readonly())return;
 let h=history.get(id); if(!h){seed(id);return;}
 const next=snapshot(id);if(next===h.present)return;
 h.past.push(h.present);if(h.past.length>25)h.past.shift();h.present=next;h.future=[];updateHistory(id);
}
function updateHistory(id){let h=history.get(id);document.querySelectorAll('#'+id+' [data-history]').forEach(b=>b.disabled=readonly()||!h||!(b.dataset.history==='undo'?h.past:h.future).length);}
const oldSave=save;
save=function(){if(!readonly())lessons.forEach(l=>record(l.id));return oldSave();};
window.studioHistory=async(id,direction)=>{
 if(readonly())return;
 let h=history.get(id);if(!h)return;
 const from=direction==='undo'?h.past:h.future,to=direction==='undo'?h.future:h.past;
 if(!from.length)return;
 if(pages(id).some(p=>p.querySelector('.draw-layer')._loading))return;
 to.push(h.present);h.present=from.pop();const state=JSON.parse(h.present);
 restoring=true;closeCustomizer();
 for(const key of [id+'_scrap_pages',id+'_scrap',id+'_draw',id+'_theme',id+'_studio_bg'])delete S[key];
 Object.assign(S,state);
 for(const [i,p]of pages(id).entries()){
  pageCanvas(p).innerHTML=(S[id+'_scrap_pages']||[])[i]||(!i?S[id+'_scrap']||'':'');
  p.querySelectorAll('.scrap').forEach(e=>{ensureDeleteControl(e);ensureResizeHandle(e);drag(e);});
  p.classList.remove('drawing');applyBackground(id,i);await restoreDrawing(id,i);
 }
 oldSave();restoring=false;updateHistory(id);
};
function applyBackground(id,i){
 const p=pageAt(id,i),bg=(S[id+'_studio_bg']||[])[i];if(!p)return;
 p.className='page '+(S[id+'_theme']||'');p.dataset.studioBg=bg||'';
}
function toolbar(id,i){
 return `<div class="studio-page-label">Page ${i+1}</div><div class="page-tools studio-tools" aria-label="Page ${i+1} drawing tools">
 <div class="studio-tool-row">${[['select','✥ Move'],['pen','✏️ Pencil'],['marker','🖍 Marker'],['erase','⌫ Eraser'],['fill','🪣 Fill'],['line','╱ Line'],['rect','▢ Box'],['circle','◯ Circle']].map(([m,t])=>`<button data-mode="${m}" type="button" onclick="studioMode('${id}',${i},'${m}')" aria-pressed="${m==='select'}">${t}</button>`).join('')}</div>
 <div class="studio-tool-row studio-palette">${palette.map(([n,c])=>`<button class="studio-swatch" style="--swatch:${c}" title="${n}" aria-label="${n}" data-color="${c}" aria-pressed="${n==='Blue'}" onclick="studioColor('${id}',${i},'${c}')"></button>`).join('')}<label>Size <select aria-label="Brush size" onchange="this.closest('.page').dataset.size=this.value"><option value="3">Small</option><option value="8" selected>Medium</option><option value="18">Big</option></select></label></div>
 </div>`;
}
window.studioMode=(id,i,mode)=>{
 if(readonly())return;const p=pageAt(id,i);if(!p||(p.querySelector('.draw-layer')._loading||p.querySelector('.draw-layer')._loadFailed))return;
 p.dataset.drawMode=mode;p.classList.toggle('drawing',mode!=='select');
 p.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.mode===mode));
};
window.studioColor=(id,i,color)=>{
 if(readonly())return;const p=pageAt(id,i);p.dataset.pen=color;
 p.querySelectorAll('[data-color]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.color===color));
 if(!p.classList.contains('drawing'))studioMode(id,i,'pen');
};
function resetContext(c){const ctx=c.getContext('2d');ctx.setTransform(c.width/c.clientWidth,0,0,c.height/c.clientHeight,0,0);ctx.lineCap='round';ctx.lineJoin='round';ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';return ctx;}
async function restoreDrawing(id,i){
 const p=pageAt(id,i),c=p&&p.querySelector('.draw-layer');if(!c||!p.clientWidth)return;
 const token=c._restoreToken=(c._restoreToken||0)+1;c._loading=true;c._loadFailed=false;
 const ctx=c.getContext('2d');ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,c.width,c.height);
 const src=(S[id+'_draw']||[])[i];
 try{if(src){const im=new Image();await new Promise((resolve,reject)=>{im.onload=resolve;im.onerror=reject;im.src=src;});if(c._restoreToken===token){ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(im,0,0,c.width,c.height);}}}
 catch(error){c._loadFailed=true;throw error;}
 finally{if(c._restoreToken===token){c._loading=false;resetContext(c);}}
}
// Iterative, bounded flood fill on the drawing layer; stickers and lesson cards are separate.
function floodFill(c,x,y,color){
 const ctx=c.getContext('2d'),w=c.width,h=c.height,data=ctx.getImageData(0,0,w,h),a=data.data;
 x=Math.max(0,Math.min(w-1,x));y=Math.max(0,Math.min(h-1,y));const start=y*w+x,offset=start*4,target=Array.from(a.slice(offset,offset+4));
 const rgb=color.slice(1).match(/../g).map(n=>parseInt(n,16)),replacement=[...rgb,255];
 const matches=k=>{let o=k*4;return target[3]===0?a[o+3]===0:Math.abs(a[o]-target[0])<=24&&Math.abs(a[o+1]-target[1])<=24&&Math.abs(a[o+2]-target[2])<=24&&Math.abs(a[o+3]-target[3])<=24;};
 if(replacement.every((v,i)=>Math.abs(v-target[i])<=24))return;
 const seen=new Uint8Array(w*h),stack=new Int32Array(w*h);let count=1;stack[0]=start;seen[start]=1;
 while(count){const k=stack[--count],o=k*4;a.set(replacement,o);const col=k%w;
  const neighbors=[col?k-1:-1,col<w-1?k+1:-1,k>=w?k-w:-1,k<w*(h-1)?k+w:-1];
  for(const n of neighbors)if(n>=0&&!seen[n]&&matches(n)){seen[n]=1;stack[count++]=n;}
 }
 ctx.putImageData(data,0,0);
}
setupDraw=function(id,i){
 const p=pageAt(id,i),c=p&&p.querySelector('.draw-layer');if(!c||!p.clientWidth||!p.clientHeight)return;
 const w=p.clientWidth,h=p.clientHeight,dpr=Math.min(2,window.devicePixelRatio||1);
 if(c._w===Math.round(w)&&c._h===Math.round(h))return;
 // Copy the current bitmap before resizing; never save a transient blank canvas.
 const backup=document.createElement('canvas');backup.width=c.width;backup.height=c.height;if(c._w&&!c._loading)backup.getContext('2d').drawImage(c,0,0);
 const hadBitmap=!!c._w&&!c._loading;c._w=Math.round(w);c._h=Math.round(h);c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);c.style.width=w+'px';c.style.height=h+'px';
 if(hadBitmap)c.getContext('2d').drawImage(backup,0,0,c.width,c.height);else restoreDrawing(id,i).catch(()=>{setSaveStatus('Could not display drawing — your saved artwork is kept.');});
 resetContext(c);p.dataset.pen=p.dataset.pen||'#1e88e5';p.dataset.size=p.dataset.size||'8';
 let start=null,last=null,base=null;
 const point=e=>{let r=c.getBoundingClientRect();return[(e.clientX-r.left)*w/r.width,(e.clientY-r.top)*h/r.height];};
 function paint(e){
  const ctx=resetContext(c),[x,y]=point(e),mode=p.dataset.drawMode||'pen',sz=+(p.dataset.size||8);
  if(['line','rect','circle'].includes(mode)){
   ctx.putImageData(base,0,0);ctx.strokeStyle=p.dataset.pen;ctx.lineWidth=sz;ctx.beginPath();
   if(mode==='line'){ctx.moveTo(...start);ctx.lineTo(x,y);}else if(mode==='rect')ctx.rect(start[0],start[1],x-start[0],y-start[1]);else ctx.ellipse((x+start[0])/2,(y+start[1])/2,Math.abs(x-start[0])/2,Math.abs(y-start[1])/2,0,0,Math.PI*2);
   ctx.stroke();return;
  }
  ctx.globalCompositeOperation=mode==='erase'?'destination-out':'source-over';ctx.strokeStyle=p.dataset.pen;ctx.fillStyle=p.dataset.pen;ctx.lineWidth=mode==='erase'?Math.max(20,sz*3):mode==='marker'?sz*2:sz;
  if(mode==='marker')ctx.globalAlpha=.3;
  ctx.beginPath();ctx.moveTo(...last);ctx.lineTo(x,y);ctx.stroke();
  if(x===last[0]&&y===last[1]){ctx.beginPath();ctx.arc(x,y,ctx.lineWidth/2,0,Math.PI*2);ctx.fill();}
  last=[x,y];ctx.globalAlpha=1;
 }
 c.onpointerdown=e=>{
  if(readonly()||c._loading||!p.classList.contains('drawing'))return;
  e.preventDefault();c.setPointerCapture(e.pointerId);start=last=point(e);
  if(p.dataset.drawMode==='fill'){floodFill(c,Math.round(start[0]*c.width/w),Math.round(start[1]*c.height/h),p.dataset.pen);start=last=null;saveDrawing(id);return;}
  base=c.getContext('2d').getImageData(0,0,c.width,c.height);paint(e);
 };
 c.onpointermove=e=>{if(start)paint(e);};
 const finish=e=>{if(!start)return;if(e.type==='pointerup')paint(e);start=last=base=null;saveDrawing(id);};
 c.onpointerup=finish;c.onpointercancel=finish;c.onlostpointercapture=finish;
};
saveDrawing=function(id){
 if(readonly())return;
 const old=S[id+'_draw']||[];
 S[id+'_draw']=pages(id).map((p,i)=>{let c=p.querySelector('.draw-layer');return c._w&&!c._loading&&!c._loadFailed?c.toDataURL('image/png'):old[i]||'';});save();
};
window.studioBackground=(id,theme)=>{
 if(readonly())return;S[id+'_studio_bg']=pages(id).map(()=>theme);pages(id).forEach((p,i)=>applyBackground(id,i));save();
};
// Locally rendered vector stickers stay sharp when resized and require no remote services.
const svgBody={
 "torah": "<g filter=\"url(#shadow)\"><path d=\"M33 28h94v111H33z\" fill=\"#fff\" stroke=\"#fff\" stroke-width=\"12\" stroke-linejoin=\"round\"/><path d=\"M35 23v118m90-118v118\" stroke=\"url(#wood)\" stroke-width=\"9\" stroke-linecap=\"round\"/><ellipse cx=\"35\" cy=\"24\" rx=\"10\" ry=\"5\" fill=\"url(#gold)\"/><ellipse cx=\"125\" cy=\"24\" rx=\"10\" ry=\"5\" fill=\"url(#gold)\"/><ellipse cx=\"35\" cy=\"141\" rx=\"10\" ry=\"5\" fill=\"url(#gold)\"/><ellipse cx=\"125\" cy=\"141\" rx=\"10\" ry=\"5\" fill=\"url(#gold)\"/><path d=\"M42 40Q80 28 118 40v89Q80 140 42 129z\" fill=\"url(#velvet)\" stroke=\"#20335d\" stroke-width=\"2\"/><path d=\"M47 44Q80 34 113 44v79q-33 10-66 0z\" fill=\"none\" stroke=\"#d9b960\" stroke-width=\"2\" stroke-dasharray=\"2 3\"/><path d=\"M67 27l-5-13 12 6 6-13 6 13 12-6-5 13z\" fill=\"url(#gold)\" stroke=\"#977032\" stroke-width=\"1.2\"/><ellipse cx=\"80\" cy=\"28\" rx=\"17\" ry=\"4\" fill=\"url(#gold)\"/><circle cx=\"80\" cy=\"17\" r=\"2.3\" fill=\"#d72d45\"/><g fill=\"none\" stroke=\"url(#gold)\" stroke-width=\"3\" stroke-linecap=\"round\"><path d=\"M80 103V61m-8 0v10q0 8 8 8t8-8V61m-24 0v13q0 12 16 12t16-12V61m-40 0v15q0 18 24 18t24-18V61M70 104h20M65 110h30\"/></g><g fill=\"#ffd66b\"><ellipse cx=\"56\" cy=\"58\" rx=\"2\" ry=\"3\"/><ellipse cx=\"64\" cy=\"58\" rx=\"2\" ry=\"3\"/><ellipse cx=\"72\" cy=\"58\" rx=\"2\" ry=\"3\"/><ellipse cx=\"80\" cy=\"58\" rx=\"2\" ry=\"3\"/><ellipse cx=\"88\" cy=\"58\" rx=\"2\" ry=\"3\"/><ellipse cx=\"96\" cy=\"58\" rx=\"2\" ry=\"3\"/><ellipse cx=\"104\" cy=\"58\" rx=\"2\" ry=\"3\"/></g><path d=\"M55 119q25 8 50 0\" fill=\"none\" stroke=\"#e3c06a\" stroke-width=\"1.5\"/><path d=\"M50 48v69\" stroke=\"#7896c2\" stroke-opacity=\".35\" stroke-width=\"5\" stroke-linecap=\"round\"/></g>",
 "tzedakah": "<g filter=\"url(#shadow)\"><path d=\"M39 48 111 41l18 13v81l-18 13-72-9z\" fill=\"#fff\" stroke=\"#fff\" stroke-width=\"10\" stroke-linejoin=\"round\"/><path d=\"m39 55 72-9 18 12-70 10z\" fill=\"#62c6bc\" stroke=\"#247d78\" stroke-width=\"1.5\"/><path d=\"M39 55 111 62v83l-72-8z\" fill=\"url(#teal)\" stroke=\"#246e69\" stroke-width=\"2\"/><path d=\"m111 62 18-4v77l-18 10z\" fill=\"#217a72\" stroke=\"#246e69\" stroke-width=\"2\"/><path d=\"m58 55 42 4\" stroke=\"#17463f\" stroke-width=\"4\" stroke-linecap=\"round\"/><path d=\"m51 72 48 5v46l-48-5z\" fill=\"#fff8e8\" stroke=\"#dcc99b\" stroke-width=\"1.5\"/><text x=\"76\" y=\"95\" fill=\"#28585a\" font-family=\"Arial,sans-serif\" font-size=\"17\" font-weight=\"bold\" text-anchor=\"middle\" direction=\"rtl\">צדקה</text><path d=\"M66 105q10-11 20 0q-2 6-10 11q-8-5-10-11\" fill=\"#e78679\"/><path d=\"M45 64v58\" stroke=\"#acf2e4\" stroke-width=\"3\" stroke-opacity=\".7\"/><ellipse cx=\"86\" cy=\"29\" rx=\"17\" ry=\"19\" fill=\"url(#gold)\" stroke=\"#a87a32\" stroke-width=\"2\" transform=\"rotate(16 86 29)\"/><ellipse cx=\"86\" cy=\"29\" rx=\"12\" ry=\"14\" fill=\"none\" stroke=\"#b28a40\" stroke-width=\"1\"/><path d=\"M86 19v20m-5-16h10m-10 12h10\" stroke=\"#b58a39\" stroke-width=\"2.5\"/><path d=\"m85 48-1 6\" stroke=\"#d4af4d\" stroke-width=\"2\" stroke-dasharray=\"2 2\"/><path d=\"m28 37-3 4 3 4 3-4zM134 29l-4 6 4 6 4-6z\" fill=\"#f1c45f\"/></g>",
 "challah": "<g filter=\"url(#shadow)\"><ellipse cx=\"80\" cy=\"121\" rx=\"65\" ry=\"24\" fill=\"url(#silver)\" stroke=\"#fff\" stroke-width=\"8\"/><ellipse cx=\"80\" cy=\"121\" rx=\"58\" ry=\"18\" fill=\"#eff5fb\" stroke=\"#95aac4\" stroke-width=\"1.2\"/><path d=\"M26 106q7-22 43-23q48 0 64 22q11 20-26 29H51q-32-6-25-28\" fill=\"url(#bread)\" stroke=\"#a86832\" stroke-width=\"2\"/><g fill=\"url(#bread)\" stroke=\"#a56831\" stroke-width=\"1.6\"><path d=\"M40 97q1-8 12-9q15 0 21 11q2 8-10 10q-15 1-23-12z\"/><path d=\"M65 94q5-10 18-7q16 3 21 13q-1 8-14 9q-16-3-25-15z\"/><path d=\"M91 97q8-8 19-2q17 7 18 18q-5 9-19 3q-15-7-18-19z\"/><path d=\"M43 110q10-8 24-1q15 8 15 17q-10 8-25 1q-12-5-14-17z\"/><path d=\"M68 111q9-9 24-2q16 8 16 17q-9 8-25 3q-14-6-15-18z\"/></g><path d=\"M30 71q8-21 40-22q40-1 57 20q10 19-19 27H53q-27-6-23-25z\" fill=\"url(#bread)\" stroke=\"#98592d\" stroke-width=\"2\"/><g fill=\"url(#bread)\" stroke=\"#aa6834\" stroke-width=\"1.7\"><path d=\"M40 64q4-11 16-11q14 0 21 12q1 10-12 11q-15-2-25-12z\"/><path d=\"M65 60q7-10 19-4q17 6 21 16q-5 9-18 5q-16-5-22-17z\"/><path d=\"M92 66q11-8 21 0q13 9 11 19q-8 7-19-1q-12-7-13-18z\"/><path d=\"M47 78q9-9 23-2q15 6 15 16q-11 7-23 2q-14-4-15-16z\"/><path d=\"M75 79q10-9 22-1q15 7 15 14q-12 7-25 1q-12-6-12-14z\"/></g><g stroke=\"#fff0bd\" stroke-width=\"2\" stroke-linecap=\"round\"><path d=\"m51 61 3 1m10 6 3-1m17-4 3 2m16 11 3 2m-48 8 3 2m20 2 3 1m28-8 2 2m-57 16 3 2m22-8 2 2m16 5 3 1m-36 11 3 2m19 0 2 2m22-7 2 2\"/></g></g>",
 "kiddush": "<g filter=\"url(#shadow)\"><path d=\"M49 16h62v29q0 27-22 35v39q0 7 25 12v8H44v-8q25-5 25-12V80Q49 72 49 45z\" fill=\"#fff\" stroke=\"#fff\" stroke-width=\"12\" stroke-linejoin=\"round\"/><path d=\"M47 20h66l-6 37q-4 26-27 27T53 57z\" fill=\"url(#silver)\" stroke=\"#75839b\" stroke-width=\"1.7\"/><ellipse cx=\"80\" cy=\"21\" rx=\"33\" ry=\"9\" fill=\"url(#silver)\" stroke=\"#75839b\" stroke-width=\"1.6\"/><ellipse cx=\"80\" cy=\"21\" rx=\"27\" ry=\"5\" fill=\"#75284a\"/><path d=\"M59 33q4 29 13 36\" fill=\"none\" stroke=\"white\" stroke-width=\"5\" stroke-linecap=\"round\"/><path d=\"M54 49q26 9 52 0M58 61q22 9 44 0\" fill=\"none\" stroke=\"#a0a9ba\" stroke-width=\"1.4\"/><g fill=\"none\" stroke=\"#8996ac\" stroke-width=\"1.2\"><path d=\"M75 39q-4-8-8-3t5 7q-6 6 0 8t5-9m5-3q4-8 8-3t-5 7q6 6 0 8t-5-9\"/></g><path d=\"M80 84v35\" stroke=\"url(#silver)\" stroke-width=\"10\"/><ellipse cx=\"80\" cy=\"91\" rx=\"8\" ry=\"5\" fill=\"url(#silver)\" stroke=\"#94a2b7\" stroke-width=\"1\"/><path d=\"M78 118q-5 10-31 13v7h66v-7q-26-3-31-13\" fill=\"url(#silver)\" stroke=\"#7d8ba2\" stroke-width=\"1.5\"/><ellipse cx=\"80\" cy=\"137\" rx=\"33\" ry=\"5\" fill=\"url(#silver)\" stroke=\"#7d8ba2\" stroke-width=\"1.3\"/><path d=\"m121 39-4 6 4 6 4-6z\" fill=\"#d1b765\"/></g>",
 "washing": "<g filter=\"url(#shadow)\"><path d=\"M45 46q35-12 70 0v70q0 16-35 16t-35-16z\" fill=\"#fff\" stroke=\"#fff\" stroke-width=\"11\"/><path d=\"M48 61H31q-21 0-17 27q3 22 32 25M112 61h17q21 0 17 27q-3 22-32 25\" fill=\"none\" stroke=\"#fff\" stroke-width=\"16\"/><path d=\"M48 61H31q-21 0-17 27q3 22 32 25M112 61h17q21 0 17 27q-3 22-32 25\" fill=\"none\" stroke=\"url(#silver)\" stroke-width=\"9\"/><path d=\"M47 48q33-12 66 0v66q0 18-33 18t-33-18z\" fill=\"url(#silver)\" stroke=\"#71859b\" stroke-width=\"2\"/><ellipse cx=\"80\" cy=\"48\" rx=\"33\" ry=\"10\" fill=\"#cddce6\" stroke=\"#71859b\" stroke-width=\"2\"/><ellipse cx=\"80\" cy=\"48\" rx=\"27\" ry=\"6\" fill=\"#567a96\"/><path d=\"M56 61v47q0 9 10 11\" fill=\"none\" stroke=\"#fff\" stroke-width=\"5\" stroke-linecap=\"round\"/><path d=\"M105 62v46\" stroke=\"#7b90a7\" stroke-width=\"2\"/><path d=\"M50 105q30 9 60 0M52 113q28 9 56 0\" fill=\"none\" stroke=\"#a0b4c9\" stroke-width=\"1.4\"/><path d=\"M75 8q-18 22 0 25q18-3 0-25\" fill=\"url(#water)\" stroke=\"#58a8cb\" stroke-width=\"1\"/><path d=\"M98 16q-13 15 0 18q13-3 0-18\" fill=\"url(#water)\"/><path d=\"m72 20-2 5\" stroke=\"white\" stroke-width=\"2\" stroke-linecap=\"round\"/></g>",
 "siddur": "<g filter=\"url(#shadow)\"><path d=\"m36 27 79-13 16 13v104l-79 15-16-14z\" fill=\"#fff\" stroke=\"#fff\" stroke-width=\"12\" stroke-linejoin=\"round\"/><path d=\"m37 30 76-12 17 10-75 13z\" fill=\"#fff6da\" stroke=\"#b7a582\" stroke-width=\"1.2\"/><path d=\"m43 31 69-11m-62 19 72-13\" stroke=\"#cfbda0\" stroke-width=\"1\"/><path d=\"M37 30 53 40v105l-16-12z\" fill=\"#762d44\" stroke=\"#582537\" stroke-width=\"1.5\"/><path d=\"m53 40 77-13v105l-77 14z\" fill=\"url(#book)\" stroke=\"#582537\" stroke-width=\"2\"/><path d=\"m60 47 63-11v89l-63 11z\" fill=\"none\" stroke=\"#dfb86a\" stroke-width=\"1.5\"/><path d=\"m64 53 55-9v75l-55 10z\" fill=\"none\" stroke=\"#dfb86a\" stroke-opacity=\".6\" stroke-width=\".7\"/><text x=\"91\" y=\"81\" text-anchor=\"middle\" font-size=\"20\" font-family=\"Arial,sans-serif\" font-weight=\"bold\" fill=\"#ffe4a2\" direction=\"rtl\" transform=\"rotate(-9 91 81)\">סידור</text><path d=\"m79 95 13-2 10-7m-22 12 12-2 9-6\" stroke=\"#dfb86a\" stroke-width=\"1.5\"/><path d=\"M42 48v75\" stroke=\"#ab6475\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"m113 129 7-1v20l-4-4-3 5z\" fill=\"#e0bb54\"/></g>",
 "shofar": "<g filter=\"url(#shadow)\"><path d=\"M20 114q79 27 107-89l14 7Q119 160 18 139z\" fill=\"#fff\" stroke=\"#fff\" stroke-width=\"12\" stroke-linejoin=\"round\"/><path d=\"M22 115q82 16 105-88l13 6q-19 117-122 105z\" fill=\"url(#horn)\" stroke=\"#805137\" stroke-width=\"2\"/><path d=\"M28 123q76 11 103-84\" fill=\"none\" stroke=\"#ffe2aa\" stroke-width=\"5\" stroke-linecap=\"round\"/><path d=\"m117 56 13 5m-20 15 13 7m-24 9 12 10m-28 4 9 13m-29-5 6 16m-28-15 2 17\" fill=\"none\" stroke=\"#9e663d\" stroke-width=\"2.2\"/><ellipse cx=\"20\" cy=\"126\" rx=\"7\" ry=\"13\" fill=\"#936039\" stroke=\"#73452f\" stroke-width=\"1.5\" transform=\"rotate(8 20 126)\"/><ellipse cx=\"20\" cy=\"126\" rx=\"3.5\" ry=\"8\" fill=\"#472f25\" transform=\"rotate(8 20 126)\"/><ellipse cx=\"134\" cy=\"30\" rx=\"8\" ry=\"4\" fill=\"#d2ac78\" stroke=\"#805137\" stroke-width=\"1.5\" transform=\"rotate(23 134 30)\"/><path d=\"M42 105q-11-12-8-26m10 19q-5-9-2-17\" fill=\"none\" stroke=\"#e9bb55\" stroke-width=\"2.5\" stroke-linecap=\"round\"/></g>",
 "star": "<g filter=\"url(#shadow)\"><path d=\"m80 17 20 38 43 7-32 31 7 44-38-21-38 21 7-44-32-31 43-7z\" fill=\"url(#gold)\" stroke=\"#fff\" stroke-width=\"9\" stroke-linejoin=\"round\"/><path d=\"m80 17 20 38 43 7-32 31 7 44-38-21-38 21 7-44-32-31 43-7z\" fill=\"url(#gold)\" stroke=\"#ba8b35\" stroke-width=\"2\" stroke-linejoin=\"round\"/><path d=\"m38 67 30-4 12-25\" fill=\"none\" stroke=\"#fff0bc\" stroke-width=\"5\" stroke-linecap=\"round\"/><path d=\"m80 106 27 14-5-29 21-20-28-4-15-27\" fill=\"none\" stroke=\"#dfa537\" stroke-width=\"1\"/><path d=\"m137 24-4 7 4 7 4-7zm-117 9-3 5 3 5 3-5z\" fill=\"#f6d276\"/></g>",
 "heart": "<g filter=\"url(#shadow)\"><path d=\"M80 138Q17 100 21 63Q22 20 59 28q14 2 21 19q7-17 21-19q37-8 38 35q4 37-59 75z\" fill=\"url(#rose)\" stroke=\"#fff\" stroke-width=\"10\"/><path d=\"M80 138Q17 100 21 63Q22 20 59 28q14 2 21 19q7-17 21-19q37-8 38 35q4 37-59 75z\" fill=\"url(#rose)\" stroke=\"#bb4c6a\" stroke-width=\"2\"/><path d=\"M34 65q-1-22 18-22\" fill=\"none\" stroke=\"#ffe1e9\" stroke-width=\"6\" stroke-linecap=\"round\"/><path d=\"M94 113q27-23 31-44\" fill=\"none\" stroke=\"#d75277\" stroke-width=\"2\" stroke-linecap=\"round\"/><path d=\"m137 19-3 5 3 5 3-5zM13 108l-3 5 3 5 3-5z\" fill=\"#e7b75a\"/></g>",
 "sunrise": "<g filter=\"url(#shadow)\"><circle cx=\"80\" cy=\"78\" r=\"36\" fill=\"url(#gold)\" stroke=\"#fff\" stroke-width=\"8\"/><g stroke=\"#f0b449\" stroke-width=\"5\" stroke-linecap=\"round\"><path d=\"M80 16v15M38 29l9 12m-30 24 15 4m90-40-9 12m30 24-15 4\"/></g><circle cx=\"80\" cy=\"78\" r=\"36\" fill=\"url(#gold)\" stroke=\"#d59b39\" stroke-width=\"1.5\"/><path d=\"M19 100q15-14 32 0q15-14 31 0q16-14 31 0q15-14 28 0v34H19z\" fill=\"url(#water)\" stroke=\"#fff\" stroke-width=\"5\" stroke-linejoin=\"round\"/><path d=\"M28 113q15-7 29 0t28 0t28 0t20 0M35 126q13-6 24 0t23 0t23 0t19 0\" fill=\"none\" stroke=\"#fff\" stroke-opacity=\".75\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M61 62q9-13 25-12\" fill=\"none\" stroke=\"#fff0bc\" stroke-width=\"5\" stroke-linecap=\"round\"/></g>"
};
const stickerNames={torah:'Torah',tzedakah:'Tzedakah',challah:'Challah',kiddush:'Kiddush cup',washing:'Washing cup',siddur:'Siddur',shofar:'Shofar',star:'Gold star',heart:'Kindness',sunrise:'New day'};
const stickerSrc=k=>'data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><defs><linearGradient id="gold" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#fff0b4"/><stop offset=".4" stop-color="#edbf53"/><stop offset=".65" stop-color="#ffda76"/><stop offset="1" stop-color="#bc842f"/></linearGradient><linearGradient id="velvet"><stop stop-color="#182c58"/><stop offset=".4" stop-color="#345487"/><stop offset=".75" stop-color="#223760"/><stop offset="1" stop-color="#11284d"/></linearGradient><linearGradient id="silver"><stop stop-color="#7f94ad"/><stop offset=".22" stop-color="#f7fbff"/><stop offset=".45" stop-color="#ccd9e5"/><stop offset=".6" stop-color="#fff"/><stop offset="1" stop-color="#8d9fb8"/></linearGradient><linearGradient id="wood"><stop stop-color="#936134"/><stop offset=".45" stop-color="#dab178"/><stop offset="1" stop-color="#86502d"/></linearGradient><linearGradient id="teal"><stop stop-color="#318f86"/><stop offset=".4" stop-color="#60c7b4"/><stop offset="1" stop-color="#328e80"/></linearGradient><linearGradient id="bread" x1="0" y1="0" x2=".3" y2="1"><stop stop-color="#ffe09a"/><stop offset=".45" stop-color="#e9ac50"/><stop offset="1" stop-color="#be7937"/></linearGradient><linearGradient id="book"><stop stop-color="#85314d"/><stop offset=".45" stop-color="#bd5b6d"/><stop offset="1" stop-color="#87334d"/></linearGradient><linearGradient id="horn" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#f9dfb1"/><stop offset=".5" stop-color="#d3a56c"/><stop offset="1" stop-color="#a97946"/></linearGradient><linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#b7eff9"/><stop offset="1" stop-color="#59add2"/></linearGradient><linearGradient id="rose" x1="0" y1="0" x2=".6" y2="1"><stop stop-color="#ffb0bc"/><stop offset=".5" stop-color="#ed7e99"/><stop offset="1" stop-color="#cc577c"/></linearGradient><filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="3" stdDeviation="2" flood-color="#344766" flood-opacity=".2"/></filter></defs>'+svgBody[k]+'</svg>');
window.studioSticker=(id,key)=>{if(readonly()||!svgBody[key])return;const e=add(id,'photo','<img alt="'+stickerNames[key]+'" src="'+stickerSrc(key)+'">',studioTarget(id));e.classList.add('studio-sticker','clear');e.style.width='160px';persist(id);};
window.studioTarget=id=>+(document.querySelector('#'+id+' .studio-target')?.value||0);
window.studioText=id=>{
 if(readonly())return;pages(id).forEach((p,i)=>studioMode(id,i,'select'));
 const e=add(id,'textbox','<div class="tb-move">✥ Move</div><div class="tb-text" contenteditable="true" data-ph="Type your idea…"></div>',studioTarget(id));e.querySelector('.tb-text').focus();
};
window.studioPiece=action=>{
 if(readonly())return;const e=activePiece||document.querySelector('.section.on .scrap.selected');if(!e)return;
 const id=e.closest('.section').id;
 if(action==='copy'){const copy=e.cloneNode(true);copy.classList.remove('selected');e.parentNode.appendChild(copy);ensureDeleteControl(copy);ensureResizeHandle(copy);drag(copy);copy.style.left=e.offsetLeft+20+'px';copy.style.top=e.offsetTop+20+'px';clampPiece(copy);}
 if(action==='front'){e.parentNode.appendChild(e);e.style.zIndex=30;}
 if(action==='back'){e.parentNode.insertBefore(e,e.parentNode.firstChild);e.style.zIndex=20;}
 if(action==='flip'){const im=e.querySelector('img');if(im)im.style.transform=im.style.transform?'':'scaleX(-1)';}
 if(action==='crop'){const im=e.querySelector('img');if(im){const crop=e.dataset.cropped!=='1';e.dataset.cropped=crop?'1':'0';im.style.height=crop?'100%':'';im.style.objectFit=crop?'cover':'';im.style.aspectRatio=crop?'1 / 1':'';}}
 if(action==='delete'){removeP(e);closeCustomizer();return;}
 persist(id);
};
upload=function(ev,id){
 if(readonly())return;const f=ev.target.files[0];if(!f)return;
 if(!/^image\//.test(f.type)){alert('Choose a picture file.');return;}
 const reader=new FileReader();reader.onload=()=>{const im=new Image();im.onload=()=>{const c=document.createElement('canvas'),scale=Math.min(1,1600/Math.max(im.width,im.height));c.width=Math.max(1,Math.round(im.width*scale));c.height=Math.max(1,Math.round(im.height*scale));c.getContext('2d').drawImage(im,0,0,c.width,c.height);pages(id).forEach((p,i)=>studioMode(id,i,'select'));add(id,'photo','<img alt="My picture" src="'+c.toDataURL('image/png')+'">',studioTarget(id));};im.onerror=()=>alert('This picture could not be opened. Try a PNG or JPG.');im.src=reader.result;};reader.readAsDataURL(f);ev.target.value='';
};
function upgrade(id){
 const sec=document.getElementById(id);if(!sec||sec.dataset.studio)return;sec.dataset.studio='1';
 const side=sec.querySelector('.side');side.querySelector('h3').textContent='✨ My Halacha Studio';
 const intro=document.createElement('div');intro.className='studio-intro';intro.innerHTML='<b>Create something wonderful!</b><span>Move • Draw • Decorate</span>';side.querySelector('h3').after(intro);
 const actions=document.createElement('div');actions.className='studio-actions';actions.innerHTML=`<button data-history="undo" onclick="studioHistory('${id}','undo')">↶ Undo</button><button data-history="redo" onclick="studioHistory('${id}','redo')">↷ Redo</button><label>Add to <select class="studio-target" aria-label="Page for new pieces"><option value="0">Page 1</option><option value="1">Page 2</option></select></label>`;intro.after(actions);
 const themes=side.querySelector('.themeRow');themes.className='studio-backgrounds';themes.innerHTML='<b>Backgrounds</b>'+[['paper','📜 Paper'],['sky','☁ Sky'],['garden','🌿 Garden'],['stars','✨ Stars'],['blank','⬜ White']].map(([k,n])=>`<button onclick="studioBackground('${id}','${k}')">${n}</button>`).join('');
 const stickers=document.createElement('div');stickers.className='studio-stickers';stickers.innerHTML='<b>Torah stickers</b><div>'+Object.keys(svgBody).map(k=>`<button title="${stickerNames[k]}" onclick="studioSticker('${id}','${k}')"><img alt="" src="${stickerSrc(k)}"><span>${stickerNames[k]}</span></button>`).join('')+'</div>';themes.after(stickers);
 const textBtn=side.querySelector('[onclick^="addTextBox"]');if(textBtn)textBtn.setAttribute('onclick',`studioText('${id}')`);
 const addRow=textBtn&&textBtn.closest('.step');if(addRow)actions.after(addRow);
 const help=side.querySelector('p:last-child');if(help)help.innerHTML='<small>Pick Move to edit pieces. Drag the blue dots to resize. Click a piece to change its style. Fill colors your drawings; stickers keep their own colors.</small>';
 const reset=document.createElement('button');reset.className='studio-reset';reset.textContent='Reset scrapbook';reset.onclick=()=>{if(!readonly()&&confirm('Clear both pages? You can Undo afterwards.'))resetScrapbookPage(id);};side.appendChild(reset);
 pages(id).forEach((p,i)=>{
  p.querySelector('.page-tools').outerHTML=toolbar(id,i);applyBackground(id,i);
  if(readonly()){p.querySelectorAll('.tb-text').forEach(t=>t.contentEditable='false');p.querySelectorAll('.scrap').forEach(e=>{e.onpointerdown=e.onpointermove=e.onpointerup=null;});}
 });
 if(readonly())sec.querySelectorAll('.side button,.side select,.side input,.page-tools button,.page-tools select').forEach(b=>b.disabled=true);
 seed(id);updateHistory(id);
}
const originalRender=render;render=function(l){originalRender(l);upgrade(l.id);};
lessons.forEach(l=>upgrade(l.id));
const panel=document.getElementById('pieceCustomizer');
if(panel){
 panel.querySelector('.pc-title').textContent='✨ Edit this piece';
 for(const key of ['pcText','pcBg']){
  const input=document.getElementById(key),select=document.createElement('select');select.id=key;select.setAttribute('aria-label',key==='pcText'?'Text color':'Piece background');
  const colors=[['Original',input.value],...palette,['Cream','#fff1b8']];select.innerHTML=colors.map(([n,c])=>'<option value="'+c+'">'+n+'</option>').join('');select.onchange=()=>applyPieceStyle();input.replaceWith(select);
 }
 const sz=document.getElementById('pcFontSize');sz.max=96;sz.min=10;
 const edit=document.createElement('textarea');edit.id='studioPieceText';edit.setAttribute('aria-label','Piece text');edit.placeholder='Edit your text';edit.oninput=()=>{if(!activePiece||readonly())return;const t=activePiece.querySelector('.tb-text')||activePiece.querySelector('.studio-piece-content');if(t){t.textContent=edit.value;persist(activePiece.closest('.section').id);}};panel.querySelector('.pc-title').after(edit);
 const extra=document.createElement('div');extra.className='studio-piece-actions';extra.innerHTML=[['copy','⧉ Copy'],['front','Bring forward'],['back','Send behind'],['flip','Flip picture'],['crop','Square crop'],['delete','🗑 Delete']].map(([k,n])=>`<button onclick="studioPiece('${k}')">${n}</button>`).join('');panel.appendChild(extra);
 const originalOpen=openCustomizer;openCustomizer=function(e,ev){
  if(readonly())return;
  // Wrap only the item's direct text, keeping legacy controls and workbook HTML intact.
  if(!e.querySelector('img,.tb-text,.studio-piece-content')&&!e.classList.contains('workbook-piece')){
   const nodes=[...e.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim());if(nodes.length){const content=document.createElement('span');content.className='studio-piece-content';e.insertBefore(content,nodes[0]);nodes.forEach(n=>content.appendChild(n));}
  }
  originalOpen(e,ev);panel.style.left=Math.max(8,Math.min(window.innerWidth-300,e.getBoundingClientRect().right+8))+'px';panel.style.top='100px';
  const t=e.querySelector('.tb-text,.studio-piece-content');edit.hidden=!t;edit.value=t?t.textContent:'';
  for(const key of ['pcText','pcBg']){const select=document.getElementById(key),color=rgbToHex(getComputedStyle(e)[key==='pcText'?'color':'backgroundColor']);if(![...select.options].some(o=>o.value===color)){select.options[0].value=color||'#ffffff';select.options[0].textContent='Original';}select.value=color||'#ffffff';}
  sz.value=Math.max(10,Math.min(96,parseInt(getComputedStyle(e).fontSize)||18));
 };
}
document.addEventListener('paste',e=>{if(readonly()||!e.target.closest?.('.work'))return;const file=[...(e.clipboardData?.files||[])].find(f=>f.type.startsWith('image/'));if(file){e.preventDefault();upload({target:{files:[file],value:''}},currentSectionId());}});
// Teacher inspection stays read-only, including new tools and old inline controls.
for(const event of ['click','pointerdown','input','change','dblclick'])document.addEventListener(event,e=>{if(readonly()&&e.target.closest?.('.work,#pieceCustomizer')){e.preventDefault();e.stopImmediatePropagation();}},true);
document.addEventListener('keydown',e=>{
 if(readonly()||e.target.isContentEditable||e.target.closest?.('input,textarea,select'))return;
 if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){const id=currentSectionId();if(id){e.preventDefault();studioHistory(id,e.key.toLowerCase()==='y'||e.shiftKey?'redo':'undo');}}
});
})();
