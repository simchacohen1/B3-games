/* Guided Kitzur Siman Beis, grouped without merging or omitting seif text. */
(function(){
'use strict';
const source=window.HalachaSimanBSource;
if(!Array.isArray(source)||source.length!==9)return;
const groups={
 s2a:{title:'Why We Wash & Our Tzitzis',intro:'We start each day ready to serve Hashem.',seifim:[1,2],phrases:[
  {seif:1,word:'בְּרִיָּה חֲדָשָׁה',meaning:'like a new person'},
  {seif:1,word:'שָׁלֹשׁ פְּעָמִים מַיִם בְּסֵרוּגִים',meaning:'three times, alternating'},
  {seif:2,word:'הַטַּלִּית קָטָן',meaning:'the tallis katan'}],prompt:'I begin my morning with נטילת ידים and ציצית.'},
 s2b:{title:'The Order of Morning Washing',intro:'Learn the order and how to handle the washing water.',seifim:[3,4,5],phrases:[
  {seif:3,word:'עַל יַד יָמִין',meaning:'on the right hand'},
  {seif:4,word:'דַּוְקָא לְתוֹךְ כֶּלִי',meaning:'specifically into a vessel'},
  {seif:5,word:'לֹא יִגַּע קֹדֶם נְטִילָה',meaning:'do not touch before washing'}],prompt:'Right, left — three times, with care.'},
 s2c:{title:'Proper Washing, Brachos & Special Cases',intro:'What is preferred, when we say the brachos, and what happens when we are unsure.',seifim:[6,7,8],phrases:[
  {seif:6,word:'בִּכְלִי וּבְמַיִם וּבְכֹחַ גַּבְרָא',meaning:'with a vessel, water and human pouring'},
  {seif:7,word:'עַל נְטִילַת יָדַיִם',meaning:'the blessing on washing hands'},
  {seif:8,word:'יֵשׁ סָפֵק',meaning:'there is a doubt'}],prompt:'I learn how to wash properly and when to say a bracha.'},
 s2d:{title:'Other Times to Wash',intro:'Discover additional activities after which we wash our hands.',seifim:[9],phrases:[
  {seif:9,word:'אֵלּוּ דְבָרִים צְרִיכִין נְטִילַת יָדַיִם בַּמַּיִם',meaning:'these situations require washing with water'},
  {seif:9,word:'הַנּוֹטֵל צִפָּרְנָיו',meaning:'someone who clips his nails'}],prompt:'I remember the times to wash my hands.'}
};
const heb=['','א','ב','ג','ד','ה','ו','ז','ח','ט'];
const esc=s=>String(s).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
function readonly(){return !!(typeof HALACHA_TEACHER_VIEW!=='undefined'&&HALACHA_TEACHER_VIEW);}
function el(tag,cls,text){const x=document.createElement(tag);if(cls)x.className=cls;if(typeof text==='string')x.textContent=text;return x;}
function fillSource(container,txt,phrases){
 let cursor=0,hits=[];
 phrases.forEach(p=>{const at=txt.indexOf(p.word);if(at>=0)hits.push({at,end:at+p.word.length,p});});
 hits.sort((a,b)=>a.at-b.at);
 for(const hit of hits){
  if(hit.at<cursor)continue;
  container.appendChild(document.createTextNode(txt.slice(cursor,hit.at)));
  const mark=el('mark','hal-b-source-highlight',txt.slice(hit.at,hit.end));
  mark.title='Important words from the original seif';
  container.appendChild(mark);cursor=hit.end;
 }
 container.appendChild(document.createTextNode(txt.slice(cursor)));
}
function addText(id,value,hebrew){
 if(readonly()||typeof window.add!=='function')return;
 const dir=hebrew?' lang="he" dir="rtl"':'';
 const piece=window.add(id,'textbox','<div class="tb-text" contenteditable="true"'+dir+'>'+esc(value)+'</div>');
 if(piece){piece.style.width='265px';piece.classList.add('hal-b-added-text');if(typeof window.persist==='function')window.persist(id);}
}
function makePhrase(config,id,views){
 const n=el('div','hal-b-phrase-card');
 const title=el('strong','',config.word);
 title.dir='rtl';title.lang='he';
 n.append(title,el('span','hal-b-meaning',config.meaning));
 const actions=el('div','hal-b-phrase-actions');
 const find=el('button','hal-b-find','🔎 Find in the seif');
 find.type='button';
 find.addEventListener('click',()=>{
  const seif=views.get(config.seif);if(!seif)return;
  seif.open=true;
  const mark=[...seif.querySelectorAll('.hal-b-source-highlight')].find(x=>x.textContent===config.word);
  if(mark){mark.scrollIntoView({behavior:'smooth',block:'center'});mark.classList.add('hal-b-source-found');setTimeout(()=>mark.classList.remove('hal-b-source-found'),1800);}
 });
 const add=el('button','hal-b-copy','＋ Put in scrapbook');
 add.type='button';add.disabled=readonly();
 add.addEventListener('click',()=>addText(id,config.word,true));
 actions.append(find,add);n.appendChild(actions);return n;
}
function install(id){
 const config=groups[id],section=document.getElementById(id);
 if(!config||!section||section.querySelector('.hal-b-guide'))return;
 const work=section.querySelector('.work');if(!work)return;
 const panel=el('section','hal-b-guide');
 panel.setAttribute('aria-label','Guided Kitzur Siman Beis lesson');
 const top=el('div','hal-b-top');
 const title=el('h2','', 'סִימָן ב׳ · סְעִיפִים '+config.seifim.map(n=>heb[n]).join('–'));
 const hide=el('button','hal-b-hide','Hide lesson');
 hide.type='button';hide.setAttribute('aria-expanded','true');
 const inner=el('div','hal-b-inner');
 hide.addEventListener('click',()=>{const hidden=panel.classList.toggle('hal-b-hidden');hide.textContent=hidden?'Show lesson':'Hide lesson';hide.setAttribute('aria-expanded',String(!hidden));});
 const jump=el('button','hal-b-jump','🎨 Scrapbook');
 jump.type='button';jump.addEventListener('click',()=>work.scrollIntoView({behavior:'smooth',block:'start'}));
 top.append(title,jump,hide);panel.appendChild(top);
 inner.appendChild(el('p','hal-b-intro',config.intro));
 inner.appendChild(el('h3','','📖 Read the original Kitzur text'));
 const sourceHost=el('div','hal-b-sources'),views=new Map();
 for(const seif of config.seifim){
  const details=el('details','hal-b-seif-source');
  const summary=el('summary','','סעיף '+heb[seif]+' — Full Hebrew text (click to read)');
  const p=el('p','hal-b-hebrew');p.lang='he';p.dir='rtl';
  fillSource(p,source[seif-1],config.phrases.filter(x=>x.seif===seif));
  details.append(summary,p);sourceHost.appendChild(details);views.set(seif,details);
 }
 inner.appendChild(sourceHost);
 inner.appendChild(el('h3','','Important phrases from these סעיפים'));
 const phraseList=el('div','hal-b-phrases');
 config.phrases.forEach(p=>phraseList.appendChild(makePhrase(p,id,views)));
 inner.appendChild(phraseList);
 const idea=el('button','hal-b-title','＋ Put this idea in my scrapbook');
 idea.type='button';idea.disabled=readonly();
 idea.addEventListener('click',()=>addText(id,config.prompt,false));
 inner.appendChild(idea);
 inner.appendChild(el('p','hal-b-quiz-note','The picture/question activity is on the scrapbook page below. Decorate before or after answering.'));
 panel.appendChild(inner);section.insertBefore(panel,work);
}
const previousRender=render;
render=function(lesson){previousRender(lesson);if(lesson&&groups[lesson.id])install(lesson.id);};
Object.keys(groups).forEach(install);
})();
