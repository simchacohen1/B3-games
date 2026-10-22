/* Clean replacement lesson surface for Kitzur Simanim Beis and Gimel.
   Does not read, migrate, or delete prior student state. Existing login shell stays in charge. */
(function(){
'use strict';
const map={
s2a:[2,[1,2]],s2b:[2,[3,4,5]],s2extra:[2,[3,4,5]],s2c:[2,[6,7,8]],s2d:[2,[9]],
s3a:[3,[1]],s3b:[3,[2]],s3c:[3,[3]],s3d:[3,[4]],s3e:[3,[5]],s3f:[3,[6]],s3g:[3,[7]],s3h:[3,[8]]
};
const words={
2:{1:[['בְּרִיָּה חֲדָשָׁה','a new creation'],['נְטִילַת יָדַיִם','washing hands']],2:[['טַלִּית קָטָן','tallis katan']],3:[['יָמִין','right'],['שְׂמֹאל','left']],4:[['כֶּלִי','a vessel']],5:[['נְטִילָה','washing']],6:[['מַיִם','water']],7:[['בְּרָכָה','blessing']],8:[['סָפֵק','doubt']],9:[['צִפָּרְנָיו','his nails']]},
3:{1:[['צָנוּעַ','modest'],['הַצְנֵעַ לֶכֶת','walk modestly']],2:[['צְנִיעוּת','modesty']],3:[['עֲנָוָה','humility']],4:[['בְּגָדִים','clothing']],5:[['יָמִין','right'],['שְׂמֹאל','left']],6:[['בְּגָדִים','clothing']],7:[['רֹאשׁ','head']],8:[['קוֹמָה','posture']]}
};
const questions={
2:{1:['Why do we wash our hands in the morning?','To prepare to serve Hashem','To play outside','To change our shoes'],2:['What should we put on early in the morning?','A tallis katan','A winter coat','A school bag'],3:['Which hand is washed first?','Right','Left','Both only once'],4:['Where should washing water go?','Into an appropriate vessel','On the floor','On a sefer'],5:['What do we take care not to touch before washing?','The places named in the seif','A pencil','Our shoes'],6:['What should be used for proper washing?','Water and a vessel','A towel only','Dry sand'],7:['What bracha is associated with washing?','Al netilas yadayim','Shehecheyanu','Hamotzi'],8:['What should we learn about an uncertain case?','The rule described in the seif','Guessing without learning','Skipping every bracha'],9:['When else might washing be required?','After clipping nails','After reading','After counting pencils']]},
3:{1:['How should a person behave even in private?','With modesty','To impress others','Without thinking'],2:['What quality are we learning?','Modesty','Showing off','Pride'],3:['What should guide Jewish clothing?','Our values and halacha','Every fashion','Someone else’s approval'],4:['What kind of clothing should we wear?','Clean and appropriate','Only expensive clothing','Only colorful clothing'],5:['What do the directions right and left teach us?','There is a proper order','Order never matters','Always start with the left'],6:['What should we be careful about when dressing?','The order and care described in the seif','Rushing without care','Never dressing'],7:['What reminds a person of Hashem?','Keeping the head properly covered','Taking off every hat','Looking upward'],8:['How should a person carry himself?','With humility','With arrogance','To be noticed']]}
};
const labels=['','א','ב','ג','ד','ה','ו','ז','ח','ט'];
const css=document.createElement('style');css.textContent=String.raw\`
.section.fresh-siman-on > :not(.fresh-siman-root){display:none!important}
.fresh-siman-root{font:16px/1.5 "Trebuchet MS",Arial,sans-serif;color:#193c53;max-width:1160px;margin:10px auto 28px}
.fresh-top{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;background:#173b62;color:white;padding:17px 22px;border-radius:18px 18px 0 0}
.fresh-top h2{margin:0;font-size:24px;color:white}.fresh-top small{font-size:14px;display:block;opacity:.88}
.fresh-step{padding:12px 20px 22px;border:1px solid #c7d8e4;background:#fbf8ef;margin:0 0 15px;border-radius:0 0 18px 18px;box-shadow:0 5px 18px #173b6213}
.fresh-step h3{font-size:23px;text-align:right;margin:2px 0 11px;color:#173b62}
.fresh-split{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(270px,.85fr);gap:20px}
.fresh-source{font-family:"Times New Roman",serif;font-size:25px;line-height:2.08;direction:rtl;text-align:right;background:#fff;border:1px solid #dfd4b8;border-radius:14px;padding:18px 21px;white-space:normal}
.fresh-word{border:0;border-bottom:2px solid #d99e30;background:#fff0bd;color:#163b57;font:inherit;cursor:pointer;padding:0 3px;border-radius:4px}
.fresh-word:focus-visible,.fresh-root button:focus-visible{outline:3px solid #1b79bb;outline-offset:3px}
.fresh-art{background:#fff;border:1px solid #d3dfeb;padding:13px;border-radius:15px;align-self:start}
.fresh-art img{display:block;width:100%;max-height:350px;object-fit:contain}
.fresh-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}
.fresh-actions button,.fresh-check button{background:#175e8b;color:white;border:0;border-radius:8px;padding:9px 12px;font-weight:700;cursor:pointer}
.fresh-note{background:#ecf6ff;border-left:4px solid #418eb9;padding:10px 13px;margin:13px 0;border-radius:7px;min-height:40px}
.fresh-check{border-top:1px solid #d6d6d6;margin-top:14px;padding-top:12px}
.fresh-check h4{margin:0 0 8px}.fresh-answers{display:flex;flex-wrap:wrap;gap:8px}
.fresh-answers button{background:#fff;border:2px solid #a8c3d9;color:#24465a;text-align:left}
.fresh-answers button.correct{background:#d9f5df;border-color:#4f985d}.fresh-answers button.incorrect{background:#ffe0dd;border-color:#cc6f67}
.fresh-color-editor{margin-top:10px;padding:10px;background:#f3f9fc;border:1px solid #bcd4e3;border-radius:10px}
.fresh-color-editor canvas{display:block;width:100%;touch-action:none;border:1px solid #bfcbd4;background:white;margin-top:8px}
.fresh-color-editor label{display:inline-flex;gap:8px;align-items:center}
.fresh-muted{font-size:13px;color:#4b6373}
@media(max-width:800px){.fresh-split{grid-template-columns:1fr}.fresh-top h2{font-size:21px}.fresh-source{font-size:22px}}
\`;document.head.append(css);
function normalize(s){return s.normalize('NFD').replace(/[\u0591-\u05c7]/g,'').replace(/[־\u200e\u200f]/g,' ').replace(/\s+/g,' ').trim();}
function makeSource(el,text,entries,output){
 const parts=text.split(/(\s+)/),known=entries.map(([w,en])=>({tokens:normalize(w).split(' '),en}));
 for(let i=0;i<parts.length;i++){
  if(/^\s+$/.test(parts[i])){el.append(document.createTextNode(parts[i]));continue;}
  const normalized=normalize(parts[i]).replace(/^[^א-ת]+|[^א-ת]+$/g,'');
  const hit=known.find(x=>x.tokens.length===1&&x.tokens[0]===normalized);
  if(hit){const b=document.createElement('button');b.type='button';b.className='fresh-word';b.textContent=parts[i];b.onclick=()=>{output.textContent=parts[i]+' — '+hit.en};el.append(b)}
  else el.append(document.createTextNode(parts[i]));
 }
}
function makeColor(box,url){
 box.replaceChildren();
 const controls=document.createElement('div');controls.className='fresh-color-editor';
 const label=document.createElement('label');label.textContent='Choose a fill color: ';
 const input=document.createElement('input');input.type='color';input.value='#e7c75b';label.append(input);
 const reset=document.createElement('button');reset.textContent='Reset colors';reset.type='button';
 const canvas=document.createElement('canvas');canvas.setAttribute('aria-label','Color an enclosed space in the illustration');
 const hint=document.createElement('p');hint.className='fresh-muted';hint.textContent='Click an enclosed white space to color it. This practice drawing is not saved.';
 controls.append(label,reset,hint,canvas);box.append(controls);
 const context=canvas.getContext('2d',{willReadFrequently:true}),img=new Image();
 img.onload=()=>{canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;context.drawImage(img,0,0)};
 img.onerror=()=>hint.textContent='The picture could not be loaded.';
 img.src=url;reset.onclick=()=>{if(img.complete&&img.naturalWidth)context.drawImage(img,0,0)};
 canvas.addEventListener('pointerdown',e=>{
 const rect=canvas.getBoundingClientRect();if(!canvas.width)return;
 const w=canvas.width,h=canvas.height,x=Math.floor((e.clientX-rect.left)*w/rect.width),y=Math.floor((e.clientY-rect.top)*h/rect.height);
 if(x<0||y<0||x>=w||y>=h)return;
 const picture=context.getImageData(0,0,w,h),data=picture.data,start=(y*w+x)*4,old=[data[start],data[start+1],data[start+2]],fill=[1,3,5].map(n=>parseInt(input.value.slice(n,n+2),16));
 if(Math.max(...old)<80)return;
 const visited=new Uint8Array(w*h),queue=new Int32Array(w*h);let head=0,tail=1;queue[0]=y*w+x;visited[y*w+x]=1;const limit=w*h;
 while(head<tail&&head<limit){const pos=queue[head++],k=pos*4,px=pos%w,py=Math.floor(pos/w);
 if(Math.max(Math.abs(data[k]-old[0]),Math.abs(data[k+1]-old[1]),Math.abs(data[k+2]-old[2]))>32)continue;
 data[k]=fill[0];data[k+1]=fill[1];data[k+2]=fill[2];data[k+3]=255;
 for(const next of [px?pos-1:-1,px<w-1?pos+1:-1,py?pos-w:-1,py<h-1?pos+w:-1])if(next>=0&&!visited[next]){visited[next]=1;queue[tail++]=next;}
 }
 context.putImageData(picture,0,0);
 });
}
function build(id,number,seifim){
 const section=document.getElementById(id),source=number===2?window.HalachaSimanBSource:window.HalachaSimanCSource;
 if(!section||!source||section.querySelector('.fresh-siman-root'))return;
 const root=document.createElement('div');root.className='fresh-siman-root';
 const header=document.createElement('header');header.className='fresh-top';
 const title=document.createElement('h2');title.textContent='סימן '+(number===2?'ב׳':'ג׳')+' — Halacha illustrated';
 const subtitle=document.createElement('small');subtitle.textContent='Read • Understand • Explore • Color';header.append(title,subtitle);root.append(header);
 seifim.forEach(n=>{
 const step=document.createElement('article');step.className='fresh-step';
 const h=document.createElement('h3');h.dir='rtl';h.textContent='סעיף '+labels[n];step.append(h);
 const split=document.createElement('div');split.className='fresh-split';
 const left=document.createElement('div'),reading=document.createElement('div');reading.className='fresh-source';reading.lang='he';reading.dir='rtl';
 const note=document.createElement('div');note.className='fresh-note';note.textContent='Click a highlighted Hebrew word to reveal its meaning.';
 makeSource(reading,source[n-1],words[number][n]||[],note);
 left.append(reading,note);
 const q=questions[number][n],check=document.createElement('div');check.className='fresh-check';
 const qtitle=document.createElement('h4');qtitle.textContent='Think & Check: '+q[0];check.append(qtitle);
 const answers=document.createElement('div');answers.className='fresh-answers';const status=document.createElement('p');status.setAttribute('role','status');
 q.slice(1).forEach((answer,i)=>{const b=document.createElement('button');b.type='button';b.textContent=answer;b.onclick=()=>{answers.querySelectorAll('button').forEach(x=>{x.classList.remove('correct','incorrect')});b.classList.add(i===0?'correct':'incorrect');status.textContent=i===0?'Correct!':'Try again.'};answers.append(b)});
 check.append(answers,status);left.append(check);
 const picture=document.createElement('div');picture.className='fresh-art';
 const img=document.createElement('img');img.alt='Illustration for Siman '+number+' Seif '+n;img.src='recovered-art/siman-'+number+'-seif-'+String(n).padStart(2,'0')+'.png';img.loading='lazy';
 const buttons=document.createElement('div');buttons.className='fresh-actions';const color=document.createElement('button');color.type='button';color.textContent='🎨 Color this picture';
 const colorPlace=document.createElement('div');color.onclick=()=>makeColor(colorPlace,img.src);buttons.append(color);picture.append(img,buttons,colorPlace);
 split.append(left,picture);step.append(split);root.append(step);
 });
 section.prepend(root);section.classList.add('fresh-siman-on');
}
function init(){Object.entries(map).forEach(([id,[n,seifim]])=>build(id,n,seifim));}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
const holder=document.getElementById('sections');if(holder)new MutationObserver(init).observe(holder,{childList:true});
})();