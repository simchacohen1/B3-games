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
 torah:'<rect x="25" y="25" width="70" height="65" rx="12" fill="#2686cc"/><path d="M60 28v58" stroke="#aadfff" stroke-width="3"/><path d="M22 18v78M98 18v78" stroke="#bd8539" stroke-width="10"/><circle cx="22" cy="18" r="8" fill="#ffd56b"/><circle cx="98" cy="18" r="8" fill="#ffd56b"/><path d="m60 42 5 10 11 2-8 8 2 12-10-6-10 6 2-12-8-8 11-2z" fill="#ffe38b"/>',
 tzedakah:'<rect x="29" y="37" width="64" height="65" rx="12" fill="#38b59a"/><path d="M40 48h42" stroke="#12695e" stroke-width="5"/><circle cx="61" cy="20" r="14" fill="#ffd15b"/><path d="M61 11v18M55 15h12M55 25h12" stroke="#b88421" stroke-width="3"/><path d="M44 69q17-22 34 0q0 14-17 23Q44 83 44 69" fill="#fff"/>',
 challah:'<ellipse cx="60" cy="82" rx="49" ry="16" fill="#cad9ef"/><g fill="#f1b34e" stroke="#b5772b" stroke-width="3"><ellipse cx="39" cy="61" rx="16" ry="30" transform="rotate(-30 39 61)"/><ellipse cx="62" cy="61" rx="16" ry="30" transform="rotate(30 62 61)"/><ellipse cx="81" cy="61" rx="15" ry="27" transform="rotate(-25 81 61)"/></g><path d="m36 48 4 2m17 8 3 2m19-14 4 3m-8 24 3 2" stroke="#fff7da" stroke-width="4"/>',
 kiddush:'<path d="M29 20h62v17q0 33-31 34Q29 70 29 37z" fill="#a7c7ed" stroke="#3b689c" stroke-width="3"/><path d="M33 26h54v10H33z" fill="#aa4774"/><path d="M60 71v25M39 101h42" stroke="#3b689c" stroke-width="8" stroke-linecap="round"/><path d="M39 43q0 14 11 17" fill="none" stroke="white" stroke-width="5"/>',
 washing:'<path d="M33 37h52v50q0 12-26 12T33 87z" fill="#71cbe9" stroke="#2586ac" stroke-width="3"/><path d="M33 48H21q-15 0-9 28l21 6M85 48h13q15 0 9 28l-22 6" fill="none" stroke="#2586ac" stroke-width="7"/><ellipse cx="59" cy="37" rx="26" ry="8" fill="#d3f5ff"/><path d="M53 8q-14 17 0 20q14-3 0-20m24 1q-10 14 0 17q10-3 0-17" fill="#32a9de"/>',
 siddur:'<path d="M13 26q25-10 47 2q22-12 47-2v65q-25-10-47 2q-22-12-47-2z" fill="#fffaf0" stroke="#517cb5" stroke-width="4"/><path d="M60 28v65M24 43h24M24 54h24M24 65h24M72 43h24M72 54h24M72 65h24" stroke="#83a0c4" stroke-width="3"/>',
 shofar:'<path d="M17 85q70 13 77-64l16 3q-6 100-93 78z" fill="#d9a364" stroke="#8e572e" stroke-width="3"/><path d="m89 45 15 5m-22 15 14 8m-30 7 11 13m-31-6 5 16" stroke="#b37a40" stroke-width="4"/>',
 star:'<path d="m60 10 14 28 31 5-23 23 5 32-27-15-27 15 5-32-23-23 31-5z" fill="#ffd15b" stroke="#e4a52c" stroke-width="3"/><path d="m40 46 11-2 5-10" fill="none" stroke="#fff5c4" stroke-width="5"/>',
 heart:'<path d="M60 100Q5 64 16 35Q30 9 60 35Q90 9 104 35Q115 64 60 100" fill="#f27a96" stroke="#c8496b" stroke-width="3"/><path d="M28 39q8-9 17-2" fill="none" stroke="#ffd8e2" stroke-width="6"/>',
 sunrise:'<circle cx="60" cy="68" r="26" fill="#ffd15b"/><path d="M14 80h92M60 20v12M23 35l9 9M97 35l-9 9M11 63h12M97 63h12" stroke="#efae35" stroke-width="5" stroke-linecap="round"/><path d="M15 89h90M28 99h64" stroke="#57b7d6" stroke-width="4"/>'
};
const stickerNames={torah:'Torah',tzedakah:'Tzedakah',challah:'Challah',kiddush:'Kiddush cup',washing:'Washing cup',siddur:'Siddur',shofar:'Shofar',star:'Gold star',heart:'Kindness',sunrise:'New day'};
const stickerSrc=k=>'data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">'+svgBody[k]+'</svg>');
window.studioSticker=(id,key)=>{if(readonly()||!svgBody[key])return;const e=add(id,'photo','<img alt="'+stickerNames[key]+'" src="'+stickerSrc(key)+'">',studioTarget(id));e.classList.add('studio-sticker','clear');e.style.width='120px';persist(id);};
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
