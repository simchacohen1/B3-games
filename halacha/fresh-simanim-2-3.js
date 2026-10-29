/* Classroom lessons for Kitzur Simanim Beis and Gimel (same design as Siman Alef).
   Does not read, migrate, or delete prior student state. Existing login shell stays in charge. */
(function(){
'use strict';
const map={
s2a:[2,[1,2]],s2b:[2,[3,4,5]],s2extra:[2,[3,4,5]],s2c:[2,[6,7,8]],s2d:[2,[9]],
s3a:[3,[1]],s3b:[3,[2]],s3c:[3,[3]],s3d:[3,[4]],s3e:[3,[5]],s3f:[3,[6]],s3g:[3,[7]],s3h:[3,[8]]
};
// Plain (unpointed) forms exactly as they appear in each seif; the pointed form shown to students is taken from the text.
const words={2:{1:[["בריה חדשה","a new creation"],["כהן","a Kohen"],["הכיור","the washbasin"],["הטמאה","impurity"],["אצבעותיו","his fingers"]],2:[["הטלית קטן","the tallis katan"],["ארבע אמות","four amos"],["ציצית","tzitzis"],["יברך","say a bracha"]],3:[["ימין","right"],["שמאל","left"],["שלש פעמים","three times"],["פניו","his face"],["פיו","his mouth"]],4:[["כלי","a vessel"],["להנות","to benefit"],["וישפכם","and pour them out"],["ממי","from the water of"]],5:[["בחטם","in the nose"],["בעינים","in the eyes"],["באזנים","in the ears"],["בפה","in the mouth"]],6:[["כח גברא","koach gavra (a person's own force)"],["מים","water"],["נהר","a river"],["בשלג","in snow"],["הדחק","an emergency"]],7:[["יברך","say a bracha"],["שינקה","that he cleans"],["וירחץ","and wash"],["נטילת ידים","washing hands"]],8:[["ספק","doubt"],["בסרוגים","alternating"],["נשמין","breaths"],["יברך","say a bracha"]],9:[["צפרניו","his nails"],["מבית הכסא","from the bathroom"],["מנעליו","his shoes"],["מבית הקברות","from the cemetery"]]},3:{1:[["צנוע","modest"],["והצנע לכת","and walk modestly"],["ובחשכה","and in the dark"],["והבשת","and shame"]],2:[["בחקות","in the customs of"],["עובדי כוכבים","idol worshippers"],["מלבוש","clothing"],["מתדמין","imitate"]],3:[["בגדים יקרים","expensive clothes"],["גאוה","pride"],["ממצעים","moderate"],["ונקיים","and clean"]],4:[["ימין","right"],["שמאל","left"],["יקדים","put first"],["התפלין","the tefillin"]],5:[["שני בגדים","two garments"],["יזהר","be careful"],["ביחד","together"],["לשכחה","to forgetting"]],6:[["בגלוי הראש","with an uncovered head"],["הקטנים","the children"],["לכסות","to cover"],["דשמיא","of Heaven"]],7:[["זקופה","upright"],["נטוי","stretched out"],["בינונית","moderate"],["חכם","a wise person"]],8:[["שתי נשים","two women"],["כלבים","dogs"],["חזירים","pigs"],["ילך","walk"]]}};
const questions={
2:{1:['Why do we wash our hands in the morning?','To prepare to serve Hashem','To play outside','To change our shoes'],2:['What should we put on early in the morning?','A tallis katan','A winter coat','A school bag'],3:['Which hand is washed first?','Right','Left','Both only once'],4:['Where should washing water go?','Into an appropriate vessel','On the floor','On a sefer'],5:['What do we take care not to touch before washing?','The places named in the seif','A pencil','Our shoes'],6:['What should be used for proper washing?','Water and a vessel','A towel only','Dry sand'],7:['What bracha is associated with washing?','Al netilas yadayim','Shehecheyanu','Hamotzi'],8:['What should we learn about an uncertain case?','The rule described in the seif','Guessing without learning','Skipping every bracha'],9:['When else might washing be required?','After clipping nails','After reading','After counting pencils']},
3:{1:['How should a person behave even in private?','With modesty','To impress others','Without thinking'],2:['What quality are we learning?','Modesty','Showing off','Pride'],3:['What should guide Jewish clothing?','Our values and halacha','Every fashion','Someone else’s approval'],4:['What kind of clothing should we wear?','Clean and appropriate','Only expensive clothing','Only colorful clothing'],5:['What do the directions right and left teach us?','There is a proper order','Order never matters','Always start with the left'],6:['What should we be careful about when dressing?','The order and care described in the seif','Rushing without care','Never dressing'],7:['What reminds a person of Hashem?','Keeping the head properly covered','Taking off every hat','Looking upward'],8:['How should a person carry himself?','With humility','With arrogance','To be noticed']}
};
const labels=['','א','ב','ג','ד','ה','ו','ז','ח','ט'];
// ---- Classroom renderer: same design as Siman Alef (picture left, Hebrew right, vocabulary, coloring, Back/Next) ----
// English names and summaries below were written for 3rd graders from each seif's Hebrew; the rabbi should review them.
const names={
2:{1:['Washing Hands in the Morning','When we wake up we are like a new creation, ready to serve Hashem. We wash our hands like a Kohen did, because during sleep the spirit of impurity rests on the body.'],
 2:['Tallis Katan First','Put on the tallis katan first, so we do not walk four amos without tzitzis. Our hands are not clean yet, so we do not make the bracha on it yet.'],
 3:['How to Wash','Pour water from a cup three times, taking turns: right hand first, then left. Wash up to the wrist, and also wash your face and mouth.'],
 4:['Wash into a Vessel','Wash into a vessel, not onto the ground. Do not benefit from the water; pour it where people do not walk.'],
 5:['Before We Wash','Until we wash, we do not touch our mouth, nose, eyes, ears or food, because the impurity on our hands can hurt them.'],
 6:['When Water Is Missing','It is best to wash with a cup, proper water and koach gavra. If we do not have these we may use other ways, but only when truly necessary.'],
 7:['Waiting for the Bracha','We bless Hashem with our whole body, so we first clean ourselves, wash again, and only then say the bracha on washing hands.'],
 8:['A Doubtful Case','If we are not sure we need to wash again, for example after a short nap, we wash three times but do not make a bracha.'],
 9:['Other Times We Wash','We also wash our hands after using the bathroom, cutting nails or hair, taking off shoes, and in the other cases listed here.']},
3:{1:['Modesty','Be modest in everything we do, even in private, because Hashem fills the whole world and sees even in the dark.'],
 2:['Not Copying Other Nations','We do not copy the clothing and customs of non-Jews. We keep to the Jewish way.'],
 3:['Clean, Moderate Clothing','Do not wear very expensive clothes that bring pride, or very poor or dirty ones. Clothes should be clean and moderate.'],
 4:['Right Before Left','The right side is important in Torah, so we put on the right first and take off the left first. For tying, the left comes first because of tefillin.'],
 5:['One Garment at a Time','Be careful not to put on two garments at once, because it is easy to forget one.'],
 6:['Covering the Head','We do not walk four amos or say holy words with an uncovered head, and we teach children to cover their heads.'],
 7:['Walking with Humility','Do not walk stiffly with a raised neck, and do not bend over too much. Walk in a moderate, humble way.'],
 8:['Walking Between','Be careful not to walk between two women, or between two dogs or two pigs.']}};
const strip=s=>String(s||'').replace(/[֑-ׇ]/g,'');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const colors=['#e53838','#ff9216','#fddd27','#40b85b','#248df0','#9255d6','#926044','#252525','#ed81b1','#ffffff'];
const colorNames={'#e53838':'Red','#ff9216':'Orange','#fddd27':'Yellow','#40b85b':'Green','#248df0':'Blue','#9255d6':'Purple','#926044':'Brown','#252525':'Black','#ed81b1':'Pink','#ffffff':'White'};
// Add a file name here (for example 'siman-2-seif-01.png') after putting the large picture in halacha/art/simanim/.
const LARGE_ART=new Set(['siman-2-seif-01.png','siman-2-seif-02.png','siman-2-seif-03.png','siman-2-seif-04.png','siman-2-seif-05.png','siman-2-seif-06.png','siman-2-seif-07.png','siman-2-seif-08.png','siman-2-seif-09.png','siman-3-seif-01.png','siman-3-seif-02.png','siman-3-seif-03.png','siman-3-seif-04.png','siman-3-seif-05.png','siman-3-seif-06.png','siman-3-seif-07.png','siman-3-seif-08.png']);
const SKIP=new Set(['s2extra']); // duplicate of Siman Gimmel seif 3 (kept in the data, hidden from the tabs)
const keyFor=(id,n)=>'halacha_picture_siman_bg_v1_'+id+'_'+n;
const readonly=()=>Boolean(typeof HALACHA_TEACHER_PREVIEW!=='undefined'&&HALACHA_TEACHER_PREVIEW);
const hide=document.createElement('style');
hide.textContent='.ha-bg.ha-slide-off{display:none!important}@media print{.ha-bg.ha-slide-off{display:block!important}}'
 +'#tabs button[data-id="s2extra"]{display:none!important}'
 +'.ha-bg .ha-art canvas{aspect-ratio:auto!important;width:auto;max-width:100%;max-height:720px;margin:0 auto}'
 +'.ha-bg .ha-art{display:flex;flex-direction:column;align-items:center;justify-content:flex-start}'
 +'.ha-bg .ha-art .ha-status{width:100%}'
 +'.ha-bg .ha-art canvas.wide{width:100%;max-height:none;aspect-ratio:auto}'
 +'.ha-bg-notes{margin:0 14px 10px}.ha-bg-check .ha-checkanswers{display:flex;flex-wrap:wrap;gap:8px;margin:6px 12px 6px}'
 +'.ha-bg-check .ha-checkanswers button{background:#fff;border:2px solid #a8c3d9;border-radius:10px;padding:8px 12px;font-weight:700;color:#24465a}'
 +'.ha-bg-check .ha-checkanswers button.correct{background:#d9f5df;border-color:#4f985d}.ha-bg-check .ha-checkanswers button.incorrect{background:#ffe0dd;border-color:#cc6f67}'
 +'.ha-bg-check .ha-checkq{margin:10px 12px 2px;font-weight:800}.ha-bg-check .ha-checkstatus{margin:2px 12px 12px;font-weight:700}';
document.head.append(hide);
function speech(text,language,status){
 if(!window.speechSynthesis){status.textContent='Audio is unavailable in this browser.';return}
 speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang=language;u.rate=.8;speechSynthesis.speak(u);
}
function persist(key,actions){
 if(readonly())return;
 if(typeof halachaCloudLoading!=='undefined'&&halachaCloudLoading)return;
 S[key]=actions.map(a=>a.t==='fill'?{t:'fill',x:a.x,y:a.y,c:a.c}:{t:a.t,c:a.c,size:a.size,pts:a.pts});
 if(typeof save==='function')save();
}
// Turn the seif text into plain text plus clickable vocabulary words. Matching ignores nekudos and
// handles one-word and two-word entries, so every vocabulary word really highlights.
function fillHebrew(el,text,entries,onPick){
 const surfaces=[];
 const parts=text.split(/(\s+)/);
 const entryTokens=entries.map(([w],i)=>({i,tokens:strip(w).replace(/[־]/g,' ').split(/\s+/).filter(Boolean)})).sort((a,b)=>b.tokens.length-a.tokens.length);
 const norm=s=>strip(s).replace(/^[^א-ת]+|[^א-ת]+$/g,'');
 let i=0;
 while(i<parts.length){
  if(/^\s+$/.test(parts[i])||!parts[i]){el.append(document.createTextNode(parts[i]));i++;continue}
  let hit=null;
  for(const e of entryTokens){
   let ok=true,p=i;
   for(let t=0;t<e.tokens.length;t++){
    while(p<parts.length&&/^\s+$/.test(parts[p]))p++;
    if(p>=parts.length||norm(parts[p])!==e.tokens[t]){ok=false;break}
    if(t<e.tokens.length-1)p++;
   }
   if(ok){hit={e,end:p};break}
  }
  if(hit){
   const b=document.createElement('button');b.type='button';b.className='ha-keyword';
   const raw=parts.slice(i,hit.end+1).join(''),m=raw.match(/^([^\u0590-\u05FF]*)([\s\S]*?)([^\u0590-\u05FF]*)$/);
   b.textContent=m[2];if(!surfaces[hit.e.i])surfaces[hit.e.i]=m[2];b.onclick=()=>onPick(hit.e.i);
   if(m[1])el.append(document.createTextNode(m[1]));el.append(b);if(m[3])el.append(document.createTextNode(m[3]));i=hit.end+1;
  }else{el.append(document.createTextNode(parts[i]));i++}
 }
 return surfaces;
}
const flat=[]; // every seif classroom in reading order: {lesson, number, seif}
Object.entries(map).forEach(([lesson,[number,seifim]])=>{if(!SKIP.has(lesson))seifim.forEach(seif=>flat.push({lesson,number,seif}))});
// Show exactly one seif (slide) of a lesson at a time.
function activate(sectionId,seif){
 const cards=[...document.querySelectorAll('#'+sectionId+' .ha-classroom')];
 if(!cards.length)return null;
 const target=cards.find(c=>c.dataset.seif===String(seif))||cards[0];
 cards.forEach(c=>c.classList.toggle('ha-slide-off',c!==target));
 const r=target.querySelector('.ha-hebrew'),t=target.querySelector('.ha-text-toggle');
 if(r&&t)requestAnimationFrame(()=>{t.hidden=!r.classList.contains('expanded')&&r.scrollHeight<=r.clientHeight+4});
 return target;
}
function go(entry){
 if(!entry)return;
 if(typeof show==='function')show(entry.lesson);
 const card=activate(entry.lesson,entry.seif);
 if(card)card.scrollIntoView({block:'start'});
}
// Siman Gimmel, Seif 6: extend the mother's teichel across the exposed hair.
// Use identical corrected artwork for the baseline and redraw overlay so coloring
// and teacher preview never restore the original fringe after undo or save.
function fullyCoverMotherHair(ctx,width,height){
 ctx.save();ctx.scale(width/1100,height/825);
 ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=5;
 ctx.fillStyle='#fff';ctx.strokeStyle='#111';
 ctx.beginPath();
 ctx.moveTo(203,180);
 ctx.bezierCurveTo(220,116,291,60,345,74);
 ctx.bezierCurveTo(369,80,384,117,373,154);
 ctx.bezierCurveTo(356,133,330,119,302,123);
 ctx.bezierCurveTo(267,132,238,160,203,180);
 ctx.closePath();ctx.fill();ctx.stroke();
 ctx.beginPath();ctx.moveTo(218,169);ctx.bezierCurveTo(272,122,334,91,370,137);ctx.stroke();
 ctx.restore();
}
function make(sectionId,number,seif){
 const section=document.getElementById(sectionId);
 const source=number===2?window.HalachaSimanBSource:window.HalachaSimanCSource;
 if(!section||!source||section.querySelector('.ha-classroom[data-seif="'+seif+'"]'))return;
 const meta=names[number][seif];let entries=words[number][seif]||[];
 const q=questions[number][seif];
 const position=flat.findIndex(f=>f.lesson===sectionId&&f.seif===seif&&f.number===number);
 const prevOf=()=>flat.slice(0,position).filter(f=>f.number===number).pop(),nextOf=()=>flat.slice(position+1).find(f=>f.number===number);
 const el=document.createElement('div');el.className='ha-classroom ha-bg';el.dataset.halachaClassroom=sectionId;el.dataset.seif=String(seif);
 const real=typeof lessons!=='undefined'?lessons.find(x=>x.id===sectionId):null;
 const firstOfLesson=flat.find(f=>f.lesson===sectionId)===flat[position];
 el.innerHTML=(firstOfLesson&&real?`<details class="ha-teachernotes ha-bg-notes" ${readonly()?'':'hidden'}><summary>Teacher notes and questions</summary><p>${esc(real.objective||'')}</p><ol>${(real.qs||[]).map(x=>'<li>'+esc(x)+'</li>').join('')}</ol></details>`:'')
 +`<div class="ha-mast"><button type="button" class="ha-nav ha-prev">← Back</button><h2>סימן ${number===2?'ב':'ג'} - סעיף ${labels[seif]}<small>${esc(meta[0])}</small></h2><button type="button" class="ha-nav ha-next">Next →</button></div>
 <div class="ha-layout"><div class="ha-art" aria-label="Coloring picture"><canvas aria-label="Color the picture" width="440" height="1236"></canvas><p class="ha-status" role="status">Choose a color, then click inside the picture to fill it.</p></div>
 <div class="ha-side"><section class="ha-card ha-halachacard"><h3>📖 The Halacha <button class="ha-speak" title="Hear the explanation" aria-label="Hear English explanation">🔊</button></h3><div class="ha-hebrew" dir="rtl" lang="he"></div><button class="ha-text-toggle" type="button" aria-expanded="false">Show more text</button><p class="ha-summary">${esc(meta[1])}</p></section>
 <section class="ha-card ha-vocabcard"><h3>📚 Learn the Words</h3><p class="ha-instruction">Click a highlighted Hebrew word to learn its meaning and practice.</p><div class="ha-wordchips"></div><div class="ha-wordcard"><div class="ha-emoji">📖</div><div class="ha-wordinfo"><div class="ha-wordhe" lang="he" dir="rtl"></div><div class="ha-worden"></div><div class="ha-miniactions"><button class="ha-listen">🔊 Listen</button><button class="ha-practice">🎮 Practice</button></div></div></div><div class="ha-quiz" hidden><strong>Choose the correct meaning:</strong><div class="ha-answers"></div><p class="ha-feedback" role="status"></p></div></section>
 <section class="ha-card ha-bg-check"><h3>🤔 Think &amp; Check</h3><p class="ha-checkq">${esc(q[0])}</p><div class="ha-checkanswers"></div><p class="ha-checkstatus" role="status"></p></section></div></div>
 <div class="ha-tools"><b>🎨 Color the Picture</b><div class="ha-palette" role="group" aria-label="Choose a coloring color"></div><label class="ha-custom-color">Custom color <input class="ha-custom-input" type="color" value="#e53838" aria-label="Choose a custom coloring color"></label><span class="ha-current-color" aria-live="polite">Selected color: Red</span><div class="ha-buttons"><button class="ha-fill selected">🪣 Fill</button><button class="ha-brush">🖌 Brush</button><button class="ha-eraser">Eraser</button><button class="ha-undo">↶ Undo</button><button class="ha-redo">↷ Redo</button><button class="ha-clear">Clear</button><button class="ha-download">↓ Save PNG</button></div><label class="ha-brush-size-label">Brush size <input class="ha-brush-size" type="range" min="3" max="36" step="1" value="9" aria-label="Brush thickness"><output class="ha-brush-size-value" for="">9 px</output></label></div>`;
 const siblings=section.querySelectorAll('.ha-classroom');
 if(siblings.length)siblings[siblings.length-1].after(el);else section.insertBefore(el,section.firstChild);
 section.classList.add('ha-new');
 if(section.querySelectorAll('.ha-classroom').length>1)el.classList.add('ha-slide-off');
 const $=s=>el.querySelector(s),canvas=$('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
 let key=keyFor(sectionId,seif);
 let image=new Image(),correctedArt=null,base=null,actions=[],redoStack=[],color=colors[0],tool='fill',brushSize=9,activeWord=0,drawing=null,ready=false;
 const status=t=>{$('.ha-status').textContent=t};
 const commit=t=>{if(!readonly()&&typeof halachaCloudLoading!=='undefined'&&halachaCloudLoading){status('Please wait for your account to finish loading.');return}persist(key,actions);status(t)};
 const SCALE=3;
 function recolor(x,y,hex){
  const w=canvas.width,h=canvas.height;if(!base||x<0||y<0||x>=w||y>=h)return;
  const im=ctx.getImageData(0,0,w,h),data=im.data,k=(y*w+x)*4;
  if(base.data[k]<220)return;
  const rgb=[1,3,5].map(n=>parseInt(hex.slice(n,n+2),16));
  const queue=new Int32Array(w*h),visited=new Uint8Array(w*h);let head=0,tail=0;queue[tail++]=y*w+x;visited[y*w+x]=1;
  while(head<tail){const idx=queue[head++],p=idx*4;
   if(base.data[p]<220||base.data[p+1]<220||base.data[p+2]<220)continue;
   data[p]=rgb[0];data[p+1]=rgb[1];data[p+2]=rgb[2];
   if(idx%w>0&&!visited[idx-1]){visited[idx-1]=1;queue[tail++]=idx-1}
   if(idx%w<w-1&&!visited[idx+1]){visited[idx+1]=1;queue[tail++]=idx+1}
   if(idx>=w&&!visited[idx-w]){visited[idx-w]=1;queue[tail++]=idx-w}
   if(idx<w*(h-1)&&!visited[idx+w]){visited[idx+w]=1;queue[tail++]=idx+w}
  }
  ctx.putImageData(im,0,0);
 }
 function redraw(){if(!base)return;ctx.putImageData(base,0,0);
  for(const a of actions){if(a.t==='fill'){recolor(a.x,a.y,a.c)}else if(a.pts&&a.pts.length){ctx.lineWidth=a.t==='eraser'?20:(a.size||9);ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=a.t==='eraser'?'white':a.c;ctx.beginPath();a.pts.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));if(a.pts.length===1)ctx.lineTo(a.pts[0][0]+.1,a.pts[0][1]+.1);ctx.stroke()}}
  ctx.globalCompositeOperation='multiply';{const sx=Number(image.dataset.sx||0);if(correctedArt)ctx.drawImage(correctedArt,0,0);else ctx.drawImage(image,sx,0,image.naturalWidth-sx,image.naturalHeight,0,0,canvas.width,canvas.height)}ctx.globalCompositeOperation='source-over';
 }
 const pointer=e=>{const r=canvas.getBoundingClientRect();return [Math.max(0,Math.min(canvas.width-1,Math.round((e.clientX-r.left)*canvas.width/r.width))),Math.max(0,Math.min(canvas.height-1,Math.round((e.clientY-r.top)*canvas.height/r.height)))]};
 canvas.addEventListener('pointerdown',e=>{if(!ready)return;e.preventDefault();
  if(!readonly()&&typeof halachaCloudLoading!=='undefined'&&halachaCloudLoading){status('Loading saved work — please wait.');return}
  const [x,y]=pointer(e);
  if(tool==='fill'){
   if(base.data[(y*canvas.width+x)*4]<220){status('Tap inside a white section, not on an outline.');return}
   actions.push({t:'fill',x,y,c:color});redoStack=[];redraw();commit('✓ Section colored.');return;
  }
  drawing={t:tool,c:color,size:brushSize,pts:[[x,y]]};actions.push(drawing);redoStack=[];canvas.setPointerCapture(e.pointerId);redraw();
 });
 canvas.addEventListener('pointermove',e=>{if(!drawing)return;drawing.pts.push(pointer(e));redraw()});
 const done=()=>{if(drawing){drawing=null;commit('✓ Picture updated.')}};
 canvas.addEventListener('pointerup',done);canvas.addEventListener('pointercancel',done);
 function chooseColor(c,selected){color=c;$('.ha-palette').querySelectorAll('button').forEach(n=>{n.classList.toggle('selected',n===selected);n.setAttribute('aria-pressed',String(n===selected))});$('.ha-current-color').textContent='Selected color: '+(colorNames[c.toLowerCase()]||c.toUpperCase());$('.ha-custom-input').value=c}
 for(const c of colors){const b=document.createElement('button');b.type='button';b.className='ha-color';b.style.background=c;b.setAttribute('aria-label','Choose '+(colorNames[c]||c)+' color');b.setAttribute('aria-pressed','false');b.onclick=()=>chooseColor(c,b);$('.ha-palette').appendChild(b)}
 $('.ha-custom-input').addEventListener('input',e=>chooseColor(e.target.value.toLowerCase(),null));chooseColor(colors[0],$('.ha-palette').firstChild);
 function selectTool(t){tool=t;[['fill','.ha-fill'],['brush','.ha-brush'],['eraser','.ha-eraser']].forEach(([n,s])=>$(s).classList.toggle('selected',t===n));status(t==='fill'?'Click inside a picture section to fill it.':'Drag on the picture to '+(t==='brush'?'draw.':'erase.'))}
 $('.ha-fill').onclick=()=>selectTool('fill');$('.ha-brush').onclick=()=>selectTool('brush');$('.ha-eraser').onclick=()=>selectTool('eraser');
 $('.ha-brush-size').addEventListener('input',e=>{brushSize=Number(e.target.value);$('.ha-brush-size-value').textContent=brushSize+' px'});
 $('.ha-undo').onclick=()=>{if(!ready||!actions.length)return;redoStack.push(actions.pop());redraw();commit('Last coloring action undone.')};
 $('.ha-redo').onclick=()=>{if(!ready||!redoStack.length)return;actions.push(redoStack.pop());redraw();commit('Coloring action restored.')};
 $('.ha-clear').onclick=()=>{if(!ready||!actions.length||!confirm('Clear this coloring picture?'))return;actions=[];redoStack=[];redraw();commit('Picture cleared.')};
 $('.ha-download').onclick=()=>{if(!ready)return;const link=document.createElement('a');link.download='Halacha-Siman-'+(number===2?'Beis':'Gimmel')+'-Seif-'+seif+'.png';link.href=canvas.toDataURL('image/png');link.click()};
 const prev=prevOf(),next=nextOf();
 if(!prev)$('.ha-prev').disabled=true;else $('.ha-prev').onclick=()=>go(prev);
 if(!next)$('.ha-next').disabled=true;else $('.ha-next').onclick=()=>go(next);
 $('.ha-speak').onclick=()=>speech(meta[1],'en-US',$('.ha-status'));
 function selectWord(i){if(!entries.length)return;activeWord=i;const w=entries[i];$('.ha-wordhe').textContent=w[0];$('.ha-worden').textContent=w[1];$('.ha-wordchips').querySelectorAll('button').forEach((b,n)=>b.classList.toggle('on',n===i));$('.ha-quiz').hidden=true}
 if(!entries.length){$('.ha-vocabcard').hidden=true}
 $('.ha-listen').onclick=()=>{if(entries.length)speech(entries[activeWord][0],'he-IL',$('.ha-status'))};
 const pool=[...new Set(Object.values(words[number]).flat().map(w=>w[1]))];
 $('.ha-practice').onclick=()=>{if(!entries.length)return;const w=entries[activeWord];$('.ha-quiz').hidden=false;$('.ha-feedback').textContent='';$('.ha-answers').replaceChildren();
  const others=pool.filter(x=>x!==w[1]).sort(()=>Math.random()-.5).slice(0,2);
  [w[1],...others].sort(()=>Math.random()-.5).forEach(opt=>{const b=document.createElement('button');b.type='button';b.textContent=opt;b.onclick=()=>{$('.ha-feedback').textContent=opt===w[1]?'✓ Correct!':'Not quite. Try again.'};$('.ha-answers').appendChild(b)})};
 const surfaces=fillHebrew($('.ha-hebrew'),source[seif-1],entries,selectWord);
 entries=entries.map(([h,e],i)=>[surfaces[i]||h,e]);
 for(const [i,w] of entries.entries()){const b=document.createElement('button');b.type='button';b.textContent=w[0];b.onclick=()=>selectWord(i);$('.ha-wordchips').appendChild(b)}
 selectWord(0);
 const reading=$('.ha-hebrew'),toggle=$('.ha-text-toggle');
 toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));reading.classList.toggle('expanded',open);toggle.textContent=open?'Show less text':'Show more text'});
 requestAnimationFrame(()=>{if(el.offsetParent!==null&&reading.scrollHeight<=reading.clientHeight+4)toggle.hidden=true});
 const checkBox=$('.ha-checkanswers'),checkStatus=$('.ha-checkstatus');
 q.slice(1).forEach((answer,i)=>{const b=document.createElement('button');b.type='button';b.textContent=answer;b.onclick=()=>{checkBox.querySelectorAll('button').forEach(x=>x.classList.remove('correct','incorrect'));b.classList.add(i===0?'correct':'incorrect');checkStatus.textContent=i===0?'Correct!':'Try again.'};checkBox.append(b)});
 function restore(){
  if(!ready||drawing)return;
  const saved=typeof S!=='undefined'&&S[key];
  actions=Array.isArray(saved)?saved.slice():[];redoStack=[];
  redraw();status(readonly()?'Teacher preview: coloring is temporary and is not saved.':'Choose a color and tap inside the picture to fill it.');
 }
 el.halachaRestorePicture=restore;
 const pictureName='siman-'+number+'-seif-'+String(seif).padStart(2,'0')+'.png';
 let usingLarge=LARGE_ART.has(pictureName);
 // Small strips come with a sliver of the neighbouring panel on the left; start at the blue panel border.
 function stripStart(img){
  const probe=document.createElement('canvas');probe.width=img.naturalWidth;probe.height=img.naturalHeight;
  const c=probe.getContext('2d',{willReadFrequently:true});c.drawImage(img,0,0);
  const d=c.getImageData(0,0,probe.width,probe.height).data,limit=Math.floor(probe.width*0.4);
  for(let x=0;x<limit;x++){let blue=0;for(let y=0;y<probe.height;y++){const k=(y*probe.width+x)*4;if(d[k+2]>190&&d[k]<150&&d[k+2]-d[k]>60)blue++}if(blue>probe.height*0.55)return x}
  return 0;
 }
 image.onload=()=>{
  const large=usingLarge&&image.naturalWidth>=700;
  canvas.classList.toggle('wide',large);
  const sx=large?0:stripStart(image),sw=image.naturalWidth-sx;
  // Small pictures are drawn 3x larger (smooth) so they are easier to tap; outlines stay closed.
  const scale=large?1:SCALE;
  key=keyFor(sectionId,seif)+(large?'_large':'');
  canvas.width=Math.round(sw*scale);canvas.height=Math.round(image.naturalHeight*scale);
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingQuality='high';ctx.drawImage(image,sx,0,sw,image.naturalHeight,0,0,canvas.width,canvas.height);
  if(number===3&&seif===6&&large){
   fullyCoverMotherHair(ctx,canvas.width,canvas.height);
   correctedArt=document.createElement('canvas');correctedArt.width=canvas.width;correctedArt.height=canvas.height;
   correctedArt.getContext('2d').drawImage(canvas,0,0);
  }
  base=ctx.getImageData(0,0,canvas.width,canvas.height);ready=true;canvas.dataset.ready='true';
  image.dataset.sx=String(sx);restore();
 };
 image.onerror=()=>{if(usingLarge){usingLarge=false;image.src='recovered-art/'+pictureName;return}status('Could not load this lesson picture.')};
 image.src=usingLarge?'art/simanim/'+pictureName:'recovered-art/'+pictureName;
}
function init(){Object.entries(map).forEach(([id,[n,seifim]])=>{if(!SKIP.has(id))seifim.forEach(s=>make(id,n,s))})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
const holder=document.getElementById('sections');if(holder)new MutationObserver(init).observe(holder,{childList:true});
})();
