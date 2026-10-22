/* Recovered Halacha art for Simanim 2–3.
   Each drawing remains attached to its authentic seif topic. */
(function(){
'use strict';
const artRoot='recovered-art/';
const siman2={
 s2a:[1,2],s2b:[3],s2extra:[3],s2c:[4,5],s2d:[6,7,8,9]
};
const siman3={s3a:[1],s3b:[2],s3c:[3],s3d:[4],s3e:[5],s3f:[6],s3g:[7],s3h:[8]};
const vocabulary={
 1:[['בְּרִיָּה חֲדָשָׁה','a new creation'],['רֽוּחַ הַטֻּמְאָה','a spirit of impurity'],['צִיצִית','tzitzit']],
 2:[['צָנוּעַ','modest'],['כַּחֲשֵׁכָה כָּאוֹרָה','darkness is like light'],['הַכְנָעָה','humility']],
 3:[['חֻקּוֹת הַגּוֹיִים','the customs of the nations'],['עֲנָוָה','humility'],['צְנִיעוּת','modesty']],
 4:[['בְּגָדִים מְמֻצָּעִים וּנְקִיִּים','moderate and clean clothing'],['גַּאֲוָה','haughtiness'],['מִנְעָלִים','shoes']],
 5:[['יָמִין','right'],['שְׂמֹאל','left'],['תְּפִלִּין','tefillin']],
 6:[['שְׁנֵי בְגָדִים','two garments'],['שִׁכְחָה','forgetfulness']],
 7:[['גִּלּוּי הָרֹאשׁ','uncovered head'],['דָּבָר שֶׁבִּקְדֻשָּׁה','words of holiness'],['אֵימְתָא דִשְׁמַיָּא','reverence for Heaven']],
 8:[['מִדָּה בֵינוֹנִית','a moderate degree'],['קֹמָה זְקוּפָה','upright posture']],
 9:[['שְׁתֵּי נָשִׁים','two women'],['כְּלָבִים','dogs'],['חֲזִירִים','swine']]
};
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const styles=document.createElement('style');
styles.textContent=`
.hal-recovered{margin:16px 0 20px;padding:14px;border:2px solid #a9cfdf;border-radius:15px;background:#f7fbff}
.hal-recovered h3{margin:0 0 10px;color:#173b62}
.hal-recovered-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
.hal-recovered-card{margin:0;padding:9px;background:white;border:1px solid #ccdce5;border-radius:12px;box-shadow:0 2px 6px #183b5910}
.hal-recovered-card img{width:100%;height:auto;display:block;cursor:pointer}
.hal-recovered-card figcaption{font-weight:850;text-align:center;padding:7px}
.hal-recovered-actions{display:flex;gap:7px;flex-wrap:wrap}
.hal-recovered-actions button,.hal-recovered button{border:0;border-radius:8px;padding:8px 10px;background:#155d8c;color:#fff;font-weight:800;cursor:pointer}
.hal-recovered-actions button:disabled,.hal-recovered button:disabled{opacity:.55;cursor:not-allowed}
.hal-recovered-editor{margin:12px 0;padding:12px;background:#fff;border:2px solid #b7d0df;border-radius:12px}
.hal-recovered-editor canvas{display:block;width:100%;height:auto;max-width:720px;margin:10px auto;border:1px solid #cbd5e1;touch-action:none;background:white}
.hal-recovered-colors{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.hal-recovered-colors input[type=color]{width:42px;height:38px}
.hal-recovered-words{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.hal-recovered-word{display:flex;gap:8px;align-items:center;background:#fff;border:1px solid #bed5e1;border-radius:9px;padding:6px 8px}
.hal-recovered-word strong{font-size:19px}
.hal-recovered-word button{font-size:12px;padding:6px}
`;
document.head.appendChild(styles);
function readonly(){return !!window.HALACHA_TEACHER_PREVIEW||!!window.HALACHA_TEACHER_VIEW||new URLSearchParams(location.search).has('teacherView')}
function putText(lessonId,text,hebrew){if(readonly()||typeof window.add!=='function')return;const dir=hebrew?' lang="he" dir="rtl"':'';const piece=window.add(lessonId,'textbox','<div class="tb-text"'+dir+' contenteditable="true">'+escape(text)+'</div>');if(piece){piece.style.width='245px';if(typeof window.persist==='function')window.persist(lessonId)}}
function installEditor(container, lessonId, seif, imageUrl){
 const old=container.querySelector('.hal-recovered-editor');if(old)old.remove();
 const editor=document.createElement('section');editor.className='hal-recovered-editor';
 const title=document.createElement('h4');title.textContent='🎨 Color this seif';
 const colors=document.createElement('div');colors.className='hal-recovered-colors';
 const color=document.createElement('input');color.type='color';color.value='#f6d56f';color.setAttribute('aria-label','Choose a coloring color');
 const label=document.createElement('label');label.append('Color ',color);
 const reset=document.createElement('button');reset.type='button';reset.textContent='Reset';
 const save=document.createElement('button');save.type='button';save.textContent=readonly()?'Preview only':'Add colored picture to scrapbook';
 const canvas=document.createElement('canvas');canvas.setAttribute('aria-label','Click or tap an enclosed area of the illustration to fill it');
 const status=document.createElement('span');status.setAttribute('role','status');
 colors.append(label,reset,save,status);editor.append(title,colors,canvas);container.append(editor);
 const base=new Image();base.crossOrigin='anonymous';
 base.onload=()=>{canvas.width=base.naturalWidth;canvas.height=base.naturalHeight;draw();};
 base.onerror=()=>{status.textContent='Could not load the illustration.'};
 const ctx=canvas.getContext('2d',{willReadFrequently:true});base.src=imageUrl;
 let painted=null;
 function draw(){ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(painted||base,0,0)}
 reset.onclick=()=>{painted=null;draw();status.textContent='Coloring reset.'};
 save.onclick=()=>{if(readonly()){status.textContent='Teacher preview is read only.';return}if(!canvas.width)return;const html='<img class="hal-colored-saved" alt="Colored Siman '+(lessonId.startsWith('s2')?'2':'3')+', Seif '+seif+'" style="width:260px;max-width:100%;height:auto" src="'+canvas.toDataURL('image/png')+'">';const piece=window.add(lessonId,'photo',html,0);if(piece){piece.style.width='280px';window.persist(lessonId);status.textContent='Colored picture added to your scrapbook.'}};
 canvas.addEventListener('pointerdown',event=>{
  if(readonly()||!base.complete||!canvas.width)return;
  const rect=canvas.getBoundingClientRect(),x=Math.floor((event.clientX-rect.left)*canvas.width/rect.width),y=Math.floor((event.clientY-rect.top)*canvas.height/rect.height);
  if(x<0||y<0||x>=canvas.width||y>=canvas.height)return;
  const data=ctx.getImageData(0,0,canvas.width,canvas.height),pixels=data.data,w=canvas.width,h=canvas.height,seed=(y*w+x)*4,target=[pixels[seed],pixels[seed+1],pixels[seed+2]],fill=[1,3,5].map(i=>parseInt(color.value.slice(i,i+2),16));
  if(target[0]<55&&target[1]<55&&target[2]<55){status.textContent='Choose a white enclosed space, not an outline.';return}
  const threshold=34,seen=new Uint8Array(w*h),queue=new Int32Array(w*h);let head=0,tail=0;queue[tail++]=y*w+x;seen[y*w+x]=1;
  while(head<tail){const pos=queue[head++],px=pos%w,py=(pos/w)|0,k=pos*4;if(Math.max(Math.abs(pixels[k]-target[0]),Math.abs(pixels[k+1]-target[1]),Math.abs(pixels[k+2]-target[2]))>threshold)continue;
   pixels[k]=fill[0];pixels[k+1]=fill[1];pixels[k+2]=fill[2];pixels[k+3]=255;
   const near=[px?pos-1:-1,px<w-1?pos+1:-1,py?pos-w:-1,py<h-1?pos+w:-1];
   for(const next of near)if(next>=0&&!seen[next]){seen[next]=1;queue[tail++]=next}
  }
  ctx.putImageData(data,0,0);painted=document.createElement('canvas');painted.width=w;painted.height=h;painted.getContext('2d').drawImage(canvas,0,0);status.textContent='Filled a space. Choose another color or add this picture to your scrapbook.';
 });
}
function addGallery(lessonId,seifNumbers,simanNumber){
 const host=document.getElementById(lessonId);if(!host||host.querySelector('.hal-recovered'))return;
 const box=document.createElement('section');box.className='hal-recovered';box.setAttribute('aria-label','Illustrations and vocabulary for Kitzur seifim');
 const head=document.createElement('h3');head.textContent='סימן '+(simanNumber===2?'ב׳':'ג׳')+' — Illustrated Seifim';box.append(head);
 const grid=document.createElement('div');grid.className='hal-recovered-grid';box.append(grid);
 if(simanNumber===2&&lessonId==='s2a'){
  const summary=document.createElement('figure');summary.className='hal-recovered-card';
  const summaryImage=document.createElement('img');summaryImage.src=artRoot+'siman-2-summary.png';summaryImage.alt='Siman 2 summary illustration';summaryImage.loading='lazy';summaryImage.decoding='async';
  const summaryCaption=document.createElement('figcaption');summaryCaption.textContent='סיכום סימן ב׳';summary.append(summaryImage,summaryCaption);grid.append(summary);
 }
 const sourceMap={};
 (simanNumber===2?window.HalachaSimanBSource:window.HalachaSimanCSource||[]).forEach((text,index)=>sourceMap[index+1]=text);
 for(const seif of seifNumbers){
  const file=simanNumber===2?'siman-2-seif-'+String(seif).padStart(2,'0')+'.png':'siman-3-seif-'+String(seif).padStart(2,'0')+'.png';
  const url=artRoot+file,figure=document.createElement('figure');figure.className='hal-recovered-card';
  const img=document.createElement('img');img.src=url;img.alt='Kitzur Shulchan Aruch, Siman '+simanNumber+', Seif '+seif;img.loading='lazy';img.decoding='async';
  const cap=document.createElement('figcaption');cap.textContent='סעיף '+seif;
  const actions=document.createElement('div');actions.className='hal-recovered-actions';
  const colorButton=document.createElement('button');colorButton.type='button';colorButton.textContent='Color this picture';colorButton.disabled=readonly();colorButton.onclick=()=>installEditor(box,lessonId,seif,url);
  const sourceButton=document.createElement('button');sourceButton.type='button';sourceButton.textContent='Read seif';sourceButton.onclick=()=>{const text=sourceMap[seif];if(text){let panel=box.querySelector('.hal-recovered-source');if(!panel){panel=document.createElement('details');panel.className='hal-recovered-source';const summary=document.createElement('summary');summary.textContent='Kitzur מקור — select a seif to read';panel.append(summary);box.append(panel)}panel.open=true;let entry=panel.querySelector('[data-seif="'+seif+'"]');if(!entry){entry=document.createElement('p');entry.dataset.seif=seif;entry.lang='he';entry.dir='rtl';entry.style.cssText='font-size:19px;line-height:1.8;text-align:right';entry.textContent='סעיף '+seif+' — '+text;panel.append(entry)}entry.scrollIntoView({behavior:'smooth',block:'center'})}};
  actions.append(colorButton,sourceButton);figure.append(img,cap,actions);grid.append(figure);
 }
 const words=document.createElement('div');words.className='hal-recovered-words';
 [...new Set(seifNumbers.flatMap(n=>vocabulary[n]||[]).map(item=>JSON.stringify(item)))].map(x=>JSON.parse(x)).forEach(([he,en])=>{const row=document.createElement('div');row.className='hal-recovered-word';const term=document.createElement('strong');term.textContent=he;term.lang='he';term.dir='rtl';const meaning=document.createElement('span');meaning.textContent=en;const find=document.createElement('button');find.type='button';find.textContent='Find source';find.onclick=()=>{const related=seifNumbers.find(n=>(vocabulary[n]||[]).some(pair=>pair[0]===he));const sourceButton=[...box.querySelectorAll('.hal-recovered-actions button')].find(b=>b.textContent==='Read seif'&&b.closest('figure')?.textContent.includes('סעיף '+related));if(sourceButton)sourceButton.click();else{const panel=box.querySelector('.hal-recovered-source');if(panel)panel.open=true}};const add=document.createElement('button');add.type='button';add.textContent='＋ Scrapbook';add.disabled=readonly();add.onclick=()=>putText(lessonId,he,true);row.append(term,meaning,find,add);words.append(row)});
 box.append(words);
 const target=host.querySelector('.work');host.insertBefore(box,target||null);
}
function boot(){
 Object.entries(siman2).forEach(([id,seifim])=>addGallery(id,seifim,2));
 Object.entries(siman3).forEach(([id,seifim])=>addGallery(id,seifim,3));
 if(typeof lessons!=='undefined'){lessons.forEach(lesson=>{if(lesson.siman==='ג'&&lesson.id.startsWith('s3'))lesson.sourceText=lesson.sourceText||''})}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
window.HalachaRecoveredIllustrations={installEditor,addGallery};
})();
